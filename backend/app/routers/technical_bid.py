from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import desc
from sqlalchemy.orm import Session
from typing import Any
import json
import re
import time
import uuid
from ..database import get_db
from ..models.models import (
    ChapterCitation,
    CitationSource,
    ImageModificationRecord,
    RagGenerationLog,
    TechnicalBidImage,
    TechnicalBidChunk,
    TechnicalBidLibrary,
    TechnicalBidConsistencyCheck,
    TechnicalBidConstraint,
    TechnicalBidProject,
    User,
)
from ..services.auth_service import get_current_user
from ..services.openai_service import OpenAIService
from ..services.rag_service import RagService
from ..utils.config_manager import config_manager

router = APIRouter(prefix="/api/technical-bids", tags=["技术标管理"])

class TechnicalProjectCreate(BaseModel):
    project_name: str

class TechnicalProjectUpdate(BaseModel):
    file_content: str | None = None
    project_overview: str | None = None
    tech_requirements: str | None = None
    outline_data: str | None = None
    status: str | None = None


class ConstraintUpsert(BaseModel):
    category: str
    key: str
    value: str
    is_mandatory: bool = True
    source_chapter: str | None = None


class ExtractConstraintsRequest(BaseModel):
    force: bool = False  # 是否清除已有约束重新提取


class GenerateWithRagRequest(BaseModel):
    chapter_id: str
    enable_rag: bool = True
    enable_citation: bool = True
    rag_config: dict[str, Any] | None = None


def _load_outline_data(project: TechnicalBidProject) -> dict[str, Any]:
    if not project.outline_data:
        return {}
    if isinstance(project.outline_data, dict):
        return project.outline_data
    try:
        return json.loads(project.outline_data)
    except Exception:
        return {}


def _flatten_outline_nodes(nodes: list[dict[str, Any]], parent_titles: list[str] | None = None) -> list[dict[str, Any]]:
    parent_titles = parent_titles or []
    result: list[dict[str, Any]] = []
    for item in nodes or []:
        chapter_id = str(item.get("id", "")).strip()
        title = str(item.get("title", "")).strip()
        content = str(item.get("content", "") or "")
        path = parent_titles + ([title] if title else [])
        result.append(
            {
                "id": chapter_id,
                "title": title,
                "content": content,
                "path": " > ".join([p for p in path if p]),
                "description": str(item.get("description", "") or ""),
            }
        )
        children = item.get("children") or []
        if children:
            result.extend(_flatten_outline_nodes(children, path))
    return result


def _extract_dimension_values(text: str) -> dict[str, set[str]]:
    value_map: dict[str, set[str]] = {
        "tech_stack.database": set(),
        "tech_stack.backend_framework": set(),
        "tech_stack.cache": set(),
        "architecture.pattern": set(),
    }
    source = (text or "").lower()
    db_patterns = [
        (r"\bmysql(?:\s*\d+(?:\.\d+)*)?\b", "MySQL"),
        (r"\bpostgresql(?:\s*\d+(?:\.\d+)*)?\b", "PostgreSQL"),
        (r"\boracle(?:\s*\d+(?:\.\d+)*)?\b", "Oracle"),
        (r"\bsql\s*server(?:\s*\d+(?:\.\d+)*)?\b", "SQL Server"),
    ]
    backend_patterns = [
        (r"\bspring\s*boot(?:\s*\d+(?:\.\d+)*)?\b", "Spring Boot"),
        (r"\bdjango(?:\s*\d+(?:\.\d+)*)?\b", "Django"),
        (r"\bflask(?:\s*\d+(?:\.\d+)*)?\b", "Flask"),
        (r"\bfastapi(?:\s*\d+(?:\.\d+)*)?\b", "FastAPI"),
        (r"\bnode\.?js\b", "Node.js"),
        (r"\b\.net\b", ".NET"),
    ]
    cache_patterns = [
        (r"\bredis(?:\s*\d+(?:\.\d+)*)?\b", "Redis"),
        (r"\bmemcached\b", "Memcached"),
    ]
    architecture_patterns = [
        (r"微服务", "微服务架构"),
        (r"单体", "单体架构"),
        (r"分层架构", "分层架构"),
        (r"\bsoa\b", "SOA"),
        (r"事件驱动", "事件驱动"),
    ]
    for pattern, value in db_patterns:
        if re.search(pattern, source):
            value_map["tech_stack.database"].add(value)
    for pattern, value in backend_patterns:
        if re.search(pattern, source):
            value_map["tech_stack.backend_framework"].add(value)
    for pattern, value in cache_patterns:
        if re.search(pattern, source):
            value_map["tech_stack.cache"].add(value)
    for pattern, value in architecture_patterns:
        if re.search(pattern, source):
            value_map["architecture.pattern"].add(value)
    return value_map


def _split_sentences(text: str) -> list[str]:
    if not text:
        return []
    chunks = re.split(r"[。！？!?；;\n]+", text)
    return [c.strip() for c in chunks if c.strip()]


def _build_constraints_payload(records: list[TechnicalBidConstraint]) -> tuple[dict[str, dict[str, str]], dict[str, str]]:
    constraints: dict[str, dict[str, str]] = {}
    sources: dict[str, str] = {}
    for row in records:
        constraints.setdefault(row.category, {})[row.key_name] = row.value
        if row.source_chapter:
            sources[f"{row.category}.{row.key_name}"] = row.source_chapter
    return constraints, sources


def _has_usable_rag_libraries(db: Session, user_id: int) -> bool:
    return (
        db.query(TechnicalBidLibrary)
        .filter(
            TechnicalBidLibrary.user_id == user_id,
            TechnicalBidLibrary.status == "completed",
            TechnicalBidLibrary.total_chunks > 0,
        )
        .first()
        is not None
    )


def _run_consistency_check(project: TechnicalBidProject, constraints: list[TechnicalBidConstraint]) -> dict[str, Any]:
    outline_data = _load_outline_data(project)
    nodes = _flatten_outline_nodes(outline_data.get("outline", []))
    violations: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    dimension_hits: dict[str, dict[str, set[str]]] = {}
    global_dimension_values: dict[str, set[str]] = {
        "tech_stack.database": set(),
        "tech_stack.backend_framework": set(),
        "tech_stack.cache": set(),
        "architecture.pattern": set(),
    }
    for node in nodes:
        content = node.get("content") or ""
        if not content.strip():
            continue
        hit_map = _extract_dimension_values(content)
        dimension_hits[node["id"]] = hit_map
        for dim, vals in hit_map.items():
            global_dimension_values[dim].update(vals)
    for dim, vals in global_dimension_values.items():
        if len(vals) > 1:
            violations.append(
                {
                    "type": "cross_chapter_conflict",
                    "severity": "critical",
                    "dimension": dim,
                    "message": f"{dim} 存在多种互斥方案: {', '.join(sorted(vals))}",
                }
            )
    for row in constraints:
        dim = f"{row.category}.{row.key_name}"
        expected = (row.value or "").strip()
        if not expected:
            continue
        dim_values = global_dimension_values.get(dim, set())
        if not dim_values:
            warnings.append(
                {
                    "type": "constraint_not_verified",
                    "severity": "medium",
                    "dimension": dim,
                    "message": f"约束 {dim}={expected} 未在已生成章节中检测到明确证据",
                }
            )
            continue
        if expected not in dim_values:
            violations.append(
                {
                    "type": "constraint_conflict",
                    "severity": "critical" if row.is_mandatory else "high",
                    "dimension": dim,
                    "message": f"约束 {dim} 要求 {expected}，但检测到 {', '.join(sorted(dim_values))}",
                }
            )
    critical_issues = [v for v in violations if v.get("severity") == "critical"]
    result = "passed"
    if violations:
        result = "failed"
    elif warnings:
        result = "warning"
    return {
        "result": result,
        "violations": violations,
        "warnings": warnings,
        "critical_issues": critical_issues,
    }


def _estimate_citation(content: str, retrieved_chunks: list[dict[str, Any]]) -> dict[str, Any]:
    if not content:
        return {
            "total_sentences": 0,
            "cited_sentences": 0,
            "citation_ratio": 0.0,
            "sources": [],
            "risk_level": "low",
        }
    sentences = _split_sentences(content)
    total = len(sentences)
    if total == 0:
        return {
            "total_sentences": 0,
            "cited_sentences": 0,
            "citation_ratio": 0.0,
            "sources": [],
            "risk_level": "low",
        }
    source_counter: dict[str, int] = {}
    cited = 0
    for sent in sentences:
        sent_low = sent.lower()
        matched_source = None
        for item in retrieved_chunks:
            piece = str(item.get("content", "")).lower()
            if not piece:
                continue
            if sent_low and (sent_low[: min(25, len(sent_low))] in piece or piece[: min(25, len(piece))] in sent_low):
                matched_source = f"{item.get('library_name', '')}::{item.get('chapter_title', '')}"
                break
        if matched_source:
            cited += 1
            source_counter[matched_source] = source_counter.get(matched_source, 0) + 1
    ratio = round((cited / total) * 100, 2)
    risk_level = "low"
    if ratio >= 70:
        risk_level = "high"
    elif ratio >= 40:
        risk_level = "medium"
    source_items = []
    for key, count in source_counter.items():
        library_name, chapter_title = key.split("::", 1)
        source_items.append(
            {
                "library_name": library_name,
                "chapter_title": chapter_title,
                "contribution": round((count / max(cited, 1)) * 100, 2),
                "sentences_count": count,
            }
        )
    source_items.sort(key=lambda x: x["contribution"], reverse=True)
    return {
        "total_sentences": total,
        "cited_sentences": cited,
        "citation_ratio": ratio,
        "risk_level": risk_level,
        "sources": source_items,
    }


def _save_citation_metrics(db: Session, project_id: str, chapter_id: str, chapter_title: str, metrics: dict[str, Any], retrieved_chunks: list[dict[str, Any]]) -> ChapterCitation:
    row = (
        db.query(ChapterCitation)
        .filter(ChapterCitation.project_id == project_id, ChapterCitation.chapter_id == chapter_id)
        .order_by(desc(ChapterCitation.id))
        .first()
    )
    if row:
        row.total_sentences = metrics["total_sentences"]
        row.cited_sentences = metrics["cited_sentences"]
        row.citation_ratio = metrics["citation_ratio"]
        row.risk_level = metrics["risk_level"]
        row.chapter_title = chapter_title
    else:
        row = ChapterCitation(
            project_id=project_id,
            chapter_id=chapter_id,
            chapter_title=chapter_title,
            total_sentences=metrics["total_sentences"],
            cited_sentences=metrics["cited_sentences"],
            citation_ratio=metrics["citation_ratio"],
            risk_level=metrics["risk_level"],
        )
        db.add(row)
        db.flush()
    db.query(CitationSource).filter(CitationSource.citation_id == row.id).delete()
    source_lookup: dict[str, dict[str, Any]] = {}
    for source in metrics.get("sources", []):
        key = f"{source.get('library_name','')}::{source.get('chapter_title','')}"
        source_lookup[key] = {
            "library_name": source.get("library_name"),
            "chapter_title": source.get("chapter_title"),
            "contribution": source.get("contribution", 0),
            "sentences_count": source.get("sentences_count", 0),
            "similarity_sum": 0.0,
            "hit": 0,
            "library_id": None,
        }
    for chunk in retrieved_chunks:
        key = f"{chunk.get('library_name','')}::{chunk.get('chapter_title','')}"
        if key in source_lookup:
            source_lookup[key]["similarity_sum"] += float(chunk.get("similarity", 0.0))
            source_lookup[key]["hit"] += 1
            source_lookup[key]["library_id"] = chunk.get("library_id")
    for source in source_lookup.values():
        db.add(
            CitationSource(
                citation_id=row.id,
                library_id=source["library_id"],
                library_name=source["library_name"],
                chapter_title=source["chapter_title"],
                contribution=source["contribution"],
                sentences_count=source["sentences_count"],
                similarity_avg=round(source["similarity_sum"] / source["hit"], 4) if source["hit"] else 0.0,
            )
        )
    db.commit()
    db.refresh(row)
    return row


@router.post("/")
def create_technical_project(data: TechnicalProjectCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project_id = str(uuid.uuid4())
    project = TechnicalBidProject(
        id=project_id,
        user_id=current_user.id,
        project_name=data.project_name,
        status="draft"
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return {"id": project.id, "project_name": project.project_name, "status": project.status}

@router.get("/")
def list_technical_projects(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    projects = db.query(TechnicalBidProject).filter(TechnicalBidProject.user_id == current_user.id).all()
    return {"items": [{"id": p.id, "project_name": p.project_name, "status": p.status, "created_at": p.created_at} for p in projects]}

@router.get("/{project_id}")
def get_technical_project(project_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(TechnicalBidProject).filter(TechnicalBidProject.id == project_id, TechnicalBidProject.user_id == current_user.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    return {
        "id": project.id,
        "project_name": project.project_name,
        "status": project.status,
        "file_content": project.file_content,
        "project_overview": project.project_overview,
        "tech_requirements": project.tech_requirements,
        "outline_data": json.loads(project.outline_data) if project.outline_data else None,
        "created_at": project.created_at
    }

@router.put("/{project_id}")
def update_technical_project(project_id: str, data: TechnicalProjectUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(TechnicalBidProject).filter(TechnicalBidProject.id == project_id, TechnicalBidProject.user_id == current_user.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    if data.file_content is not None:
        project.file_content = data.file_content
    if data.project_overview is not None:
        project.project_overview = data.project_overview
    if data.tech_requirements is not None:
        project.tech_requirements = data.tech_requirements
    if data.outline_data is not None:
        project.outline_data = data.outline_data
    if data.status is not None:
        project.status = data.status
        
    db.commit()
    return {"success": True, "message": "Project updated"}

@router.post("/{project_id}/mark-completed")
def mark_technical_project_completed(project_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(TechnicalBidProject).filter(TechnicalBidProject.id == project_id, TechnicalBidProject.user_id == current_user.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    project.status = "completed"
    db.commit()
    return {"success": True, "message": "Project marked as completed", "status": project.status}


@router.get("/{project_id}/constraints")
def get_project_constraints(project_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(TechnicalBidProject).filter(TechnicalBidProject.id == project_id, TechnicalBidProject.user_id == current_user.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    rows = (
        db.query(TechnicalBidConstraint)
        .filter(TechnicalBidConstraint.project_id == project_id)
        .order_by(TechnicalBidConstraint.id.asc())
        .all()
    )
    constraints, sources = _build_constraints_payload(rows)
    return {"project_id": project_id, "constraints": constraints, "constraint_sources": sources}


@router.post("/{project_id}/constraints")
def upsert_project_constraint(project_id: str, payload: ConstraintUpsert, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(TechnicalBidProject).filter(TechnicalBidProject.id == project_id, TechnicalBidProject.user_id == current_user.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    row = (
        db.query(TechnicalBidConstraint)
        .filter(
            TechnicalBidConstraint.project_id == project_id,
            TechnicalBidConstraint.category == payload.category,
            TechnicalBidConstraint.key_name == payload.key,
        )
        .first()
    )
    if row:
        row.value = payload.value
        row.is_mandatory = payload.is_mandatory
        row.source_chapter = payload.source_chapter or row.source_chapter
        row.created_by = current_user.id
    else:
        row = TechnicalBidConstraint(
            project_id=project_id,
            category=payload.category,
            key_name=payload.key,
            value=payload.value,
            is_mandatory=payload.is_mandatory,
            source_chapter=payload.source_chapter,
            created_by=current_user.id,
        )
        db.add(row)
    db.commit()
    return {"success": True, "message": "约束已保存"}


@router.post("/{project_id}/constraints/extract-from-tender")
async def extract_constraints_from_tender(
    project_id: str,
    payload: ExtractConstraintsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    从招标文件中自动提取技术约束

    使用大模型分析招标文件，提取其中强制要求的技术约束，
    如数据库类型、开发框架、部署方式、安全要求等。
    """
    project = db.query(TechnicalBidProject).filter(
        TechnicalBidProject.id == project_id,
        TechnicalBidProject.user_id == current_user.id
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # 检查是否有文件内容
    file_content = project.file_content or project.tech_requirements or ""
    if not file_content or len(file_content) < 100:
        return {
            "success": False,
            "message": "招标文件内容为空或过短，请先上传招标文件"
        }

    config = config_manager.load_config()
    if not config.get("api_key"):
        raise HTTPException(status_code=400, detail="请先配置OpenAI API密钥")

    openai_service = OpenAIService()

    # 如果是强制模式，先清除已有约束
    if payload.force:
        db.query(TechnicalBidConstraint).filter(
            TechnicalBidConstraint.project_id == project_id,
            TechnicalBidConstraint.source_chapter == "auto_extracted"
        ).delete()
        db.commit()

    # 构建提取技术约束的prompt
    system_prompt = """你是一名专业的招标文件分析师，专门负责从招标文件中提取"强制性技术约束"。

你的任务是：仔细分析招标文件，找出其中对技术方案有明确、强制性要求的内容。

## 重点提取以下类别的约束：

### 1. 技术栈 (tech_stack)
- 数据库：如"必须使用PostgreSQL"、"支持MySQL/Oracle"
- 后端框架：如"基于Spring Boot开发"、"使用.NET Core"
- 前端框架：如"使用Vue.js/React"
- 缓存/中间件：如"使用Redis缓存"

### 2. 架构设计 (architecture)
- 架构模式：如"必须采用微服务架构"、"支持B/S架构"
- 分层结构：如"采用MVC三层架构"
- 云原生：如"支持容器化部署"

### 3. 部署方式 (deployment)
- 部署环境：如"支持私有云部署"、"支持本地化部署"
- 服务器要求：如"支持Linux/Windows Server"
- 容器化：如"支持Docker/K8s部署"

### 4. 系统集成 (integration)
- 对接系统：如"需与XX系统对接"
- 接口协议：如"使用RESTful API"
- 数据交换：如"支持XML/JSON数据格式"

### 5. 安全要求 (security)
- 等保要求：如"符合等保三级要求"
- 加密要求：如"数据传输需加密"、"支持国密算法"
- 权限管理：如"支持RBAC权限模型"
- 审计要求：如"需记录操作日志"

## 输出格式：
对于每个提取到的约束，按以下JSON格式输出：
```json
{
  "constraints": [
    {
      "category": "tech_stack|architecture|deployment|integration|security",
      "key": "约束键名（英文）",
      "value": "约束值（原文内容）",
      "is_mandatory": true,
      "source": "招标文件中的位置描述"
    }
  ]
}
```

## 注意事项：
1. 只提取有明确强制性要求的条目（如"必须"、"应当"、"需"、"应"等关键词）
2. 如果是"建议"、"优先"、"可"等软性要求，is_mandatory设为false
3. 如果没有找到某类约束，该类别返回空数组
4. 尽量保持原文表述，不要概括或修改
5. 约束键名使用英文，简洁明了（如database、framework、deployment_mode等）

直接输出JSON，不要包含其他说明文字。"""

    user_prompt = f"""请分析以下招标文件内容，提取其中的强制性技术约束：

{file_content[:12000]}

请按JSON格式输出提取到的技术约束。"""

    try:
        # 调用大模型提取约束
        response_text = ""
        async for chunk in openai_service.stream_chat_completion(
            [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
            temperature=0.1,
        ):
            response_text += chunk

        # 解析JSON响应
        import re
        json_match = re.search(r'\{[\s\S]*\}', response_text)
        if not json_match:
            return {
                "success": False,
                "message": "未能解析出约束数据，请重试",
                "raw_response": response_text[:500]
            }

        try:
            result_data = json.loads(json_match.group())
        except json.JSONDecodeError:
            # 尝试修复JSON
            import ast
            try:
                result_data = ast.literal_eval(json_match.group())
            except:
                return {
                    "success": False,
                    "message": "约束数据解析失败，格式不正确",
                    "raw_response": json_match.group()[:500]
                }

        constraints = result_data.get("constraints", [])
        if not constraints:
            return {
                "success": False,
                "message": "未从招标文件中提取到技术约束，可能文件中没有明确的强制性技术要求"
            }

        # 保存提取到的约束
        added_count = 0
        for item in constraints:
            # 检查是否已存在相同的约束
            existing = db.query(TechnicalBidConstraint).filter(
                TechnicalBidConstraint.project_id == project_id,
                TechnicalBidConstraint.category == item.get("category"),
                TechnicalBidConstraint.key_name == item.get("key")
            ).first()

            if existing:
                # 更新已有约束
                existing.value = item.get("value", "")
                existing.is_mandatory = item.get("is_mandatory", True)
                existing.source_chapter = f"auto_extracted: {item.get('source', '')}"
            else:
                # 创建新约束
                new_constraint = TechnicalBidConstraint(
                    project_id=project_id,
                    category=item.get("category", ""),
                    key_name=item.get("key", ""),
                    value=item.get("value", ""),
                    is_mandatory=item.get("is_mandatory", True),
                    source_chapter=f"auto_extracted: {item.get('source', '')}",
                    created_by=current_user.id,
                )
                db.add(new_constraint)
                added_count += 1

        db.commit()

        return {
            "success": True,
            "message": f"成功从招标文件中提取并保存了 {len(constraints)} 条技术约束",
            "constraints_count": len(constraints),
            "added_count": added_count,
            "constraints": constraints
        }

    except Exception as e:
        return {
            "success": False,
            "message": f"提取约束时发生错误: {str(e)}"
        }


@router.post("/{project_id}/consistency-check")
def run_project_consistency_check(project_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(TechnicalBidProject).filter(TechnicalBidProject.id == project_id, TechnicalBidProject.user_id == current_user.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    constraints = db.query(TechnicalBidConstraint).filter(TechnicalBidConstraint.project_id == project_id).all()
    result = _run_consistency_check(project, constraints)
    check_row = TechnicalBidConsistencyCheck(
        project_id=project_id,
        chapter_id=None,
        check_type="global",
        check_result=result["result"],
        severity="critical" if result["critical_issues"] else ("high" if result["violations"] else ("medium" if result["warnings"] else "low")),
        violations={"violations": result["violations"], "warnings": result["warnings"]},
    )
    db.add(check_row)
    db.commit()
    db.refresh(check_row)
    return {
        "check_id": check_row.id,
        "result": result["result"],
        "violations": result["violations"],
        "warnings": result["warnings"],
        "blocked": len(result["critical_issues"]) > 0,
    }


@router.get("/{project_id}/consistency-report")
def get_project_consistency_report(project_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(TechnicalBidProject).filter(TechnicalBidProject.id == project_id, TechnicalBidProject.user_id == current_user.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    checks = (
        db.query(TechnicalBidConsistencyCheck)
        .filter(TechnicalBidConsistencyCheck.project_id == project_id)
        .order_by(desc(TechnicalBidConsistencyCheck.id))
        .all()
    )
    passed = sum(1 for c in checks if c.check_result == "passed")
    failed = sum(1 for c in checks if c.check_result == "failed")
    warnings = sum(1 for c in checks if c.check_result == "warning")
    critical_issues = 0
    details = []
    for c in checks[:100]:
        payload = c.violations or {}
        violations = payload.get("violations", [])
        critical_issues += sum(1 for v in violations if v.get("severity") == "critical")
        details.append(
            {
                "check_id": c.id,
                "check_type": c.check_type,
                "result": c.check_result,
                "severity": c.severity,
                "violations": violations,
                "warnings": payload.get("warnings", []),
                "checked_at": c.checked_at,
            }
        )
    overall_status = "passed"
    if failed > 0:
        overall_status = "failed"
    elif warnings > 0:
        overall_status = "warning"
    return {
        "project_id": project_id,
        "total_checks": len(checks),
        "passed": passed,
        "failed": failed,
        "warnings": warnings,
        "critical_issues": critical_issues,
        "overall_status": overall_status,
        "details": details,
    }


@router.post("/{project_id}/generate-with-rag")
async def generate_with_rag(project_id: str, payload: GenerateWithRagRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(TechnicalBidProject).filter(TechnicalBidProject.id == project_id, TechnicalBidProject.user_id == current_user.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    config = config_manager.load_config()
    if not config.get("api_key"):
        raise HTTPException(status_code=400, detail="请先配置OpenAI API密钥")
    outline_data = _load_outline_data(project)
    nodes = _flatten_outline_nodes(outline_data.get("outline", []))
    target = next((n for n in nodes if n.get("id") == payload.chapter_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="章节不存在")
    rag_cfg = payload.rag_config or {}
    rag_top_k = max(1, min(int(rag_cfg.get("top_k", 5)), 20))
    rag_threshold = max(0.0, min(float(rag_cfg.get("similarity_threshold", 0.6)), 1.0))
    retrieved_chunks: list[dict[str, Any]] = []
    retrieval_time = 0
    query_text = RagService.build_chapter_query(
        {"title": target.get("title", ""), "description": target.get("description", "")},
        project.project_overview or "",
    )
    effective_enable_rag = bool(payload.enable_rag or _has_usable_rag_libraries(db, current_user.id))
    if effective_enable_rag:
        begin = time.time()
        retrieved_chunks = RagService.search_chunks(
            db=db,
            user_id=current_user.id,
            query=query_text,
            top_k=rag_top_k,
            similarity_threshold=rag_threshold,
        )
        retrieval_time = int((time.time() - begin) * 1000)
    rag_context = "\n\n".join(
        [
            f"[资料{i + 1}] 来源:{item.get('library_name')} 章节:{item.get('chapter_title')}\n{item.get('content')}"
            for i, item in enumerate(retrieved_chunks)
        ]
    )
    constraints_rows = db.query(TechnicalBidConstraint).filter(TechnicalBidConstraint.project_id == project_id).all()
    constraints_map, _ = _build_constraints_payload(constraints_rows)
    constraints_text = json.dumps(constraints_map, ensure_ascii=False)
    openai_service = OpenAIService()
    system_prompt = "你是专业技术标写作专家。请严格遵循技术约束，避免与已定技术路线冲突。只输出章节正文。"
    user_prompt = f"""项目概述：
{project.project_overview or ""}

当前章节：
ID: {target.get("id", "")}
标题: {target.get("title", "")}
描述: {target.get("description", "")}

技术约束：
{constraints_text or "无"}

RAG参考资料：
{rag_context or "无"}

请生成章节正文："""
    generation_begin = time.time()
    generated = ""
    async for chunk in openai_service.stream_chat_completion(
        [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
        temperature=0.5,
    ):
        generated += chunk
    generation_time = int((time.time() - generation_begin) * 1000)
    redline_conflicts = []
    if constraints_rows:
        content_hit = _extract_dimension_values(generated)
        for row in constraints_rows:
            dim = f"{row.category}.{row.key_name}"
            vals = content_hit.get(dim, set())
            if vals and row.value not in vals:
                redline_conflicts.append(
                    {
                        "type": "redline_conflict",
                        "dimension": dim,
                        "expected": row.value,
                        "detected": sorted(vals),
                        "severity": "critical" if row.is_mandatory else "high",
                    }
                )
    critical_conflicts = [c for c in redline_conflicts if c.get("severity") == "critical"]
    if critical_conflicts:
        return {
            "type": "redline_block",
            "blocked": True,
            "message": "检测到核心红线冲突，已阻断输出，请先修复技术约束冲突",
            "violations": critical_conflicts,
        }
    if effective_enable_rag:
        RagService.save_generation_log(
            db=db,
            project_id=project_id,
            chapter_id=payload.chapter_id,
            query_text=query_text,
            retrieved_chunks=retrieved_chunks,
            llm_model=config.get("model_name", "unknown"),
            llm_response=generated,
            retrieval_time=retrieval_time,
            generation_time=generation_time,
            used_rag=bool(retrieved_chunks),
        )
    citation = _estimate_citation(generated, retrieved_chunks) if payload.enable_citation else None
    if citation is not None:
        _save_citation_metrics(
            db=db,
            project_id=project_id,
            chapter_id=payload.chapter_id,
            chapter_title=target.get("title", payload.chapter_id),
            metrics=citation,
            retrieved_chunks=retrieved_chunks,
        )
    return {
        "type": "result",
        "data": {
            "rag_info": {
                "retrieved_count": len(retrieved_chunks),
                "sources": [
                    {"library_name": item.get("library_name"), "chapter_title": item.get("chapter_title")}
                    for item in retrieved_chunks
                ],
            },
            "content": generated,
            "citation_info": citation,
        },
    }


@router.get("/{project_id}/citations")
def get_project_citations(project_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(TechnicalBidProject).filter(TechnicalBidProject.id == project_id, TechnicalBidProject.user_id == current_user.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    rows = (
        db.query(ChapterCitation)
        .filter(ChapterCitation.project_id == project_id)
        .order_by(ChapterCitation.id.asc())
        .all()
    )
    chapter_rows = []
    total_sentences = 0
    total_cited = 0
    risk_summary = {"high": 0, "medium": 0, "low": 0}
    for row in rows:
        total_sentences += row.total_sentences or 0
        total_cited += row.cited_sentences or 0
        risk_summary[row.risk_level or "low"] = risk_summary.get(row.risk_level or "low", 0) + 1
        sources_count = db.query(CitationSource).filter(CitationSource.citation_id == row.id).count()
        chapter_rows.append(
            {
                "chapter_id": row.chapter_id,
                "chapter_title": row.chapter_title or row.chapter_id,
                "citation_ratio": row.citation_ratio,
                "cited_sentences": row.cited_sentences,
                "total_sentences": row.total_sentences,
                "risk_level": row.risk_level,
                "sources_count": sources_count,
            }
        )
    avg_ratio = round((total_cited / max(total_sentences, 1)) * 100, 2) if total_sentences else 0.0
    return {
        "project_id": project_id,
        "total_chapters": len(chapter_rows),
        "total_sentences": total_sentences,
        "total_cited": total_cited,
        "avg_citation_ratio": avg_ratio,
        "risk_summary": risk_summary,
        "chapters": chapter_rows,
    }


@router.get("/{project_id}/citations/{chapter_id}")
def get_chapter_citation_detail(project_id: str, chapter_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(TechnicalBidProject).filter(TechnicalBidProject.id == project_id, TechnicalBidProject.user_id == current_user.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    row = (
        db.query(ChapterCitation)
        .filter(ChapterCitation.project_id == project_id, ChapterCitation.chapter_id == chapter_id)
        .order_by(desc(ChapterCitation.id))
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Chapter citation not found")
    sources = (
        db.query(CitationSource)
        .filter(CitationSource.citation_id == row.id)
        .order_by(desc(CitationSource.contribution))
        .all()
    )
    source_items = [
        {
            "library_name": s.library_name,
            "chapter_title": s.chapter_title,
            "contribution": s.contribution,
            "sentences_count": s.sentences_count,
            "similarity_avg": s.similarity_avg,
            "paragraph_samples": [
                chunk.chunk_content
                for chunk in db.query(TechnicalBidChunk)
                .filter(TechnicalBidChunk.library_id == s.library_id)
                .filter(TechnicalBidChunk.chapter_title == s.chapter_title)
                .order_by(desc(TechnicalBidChunk.content_length), TechnicalBidChunk.chunk_index.asc())
                .limit(2)
                .all()
            ],
        }
        for s in sources
    ]
    risk_reasons = []
    if (row.citation_ratio or 0) >= 70:
        risk_reasons.append("引用比例过高，可能存在过度复用风险")
    if source_items and source_items[0]["contribution"] >= 70:
        risk_reasons.append("单一来源引用占比过高")
    return {
        "chapter_id": chapter_id,
        "chapter_title": row.chapter_title or chapter_id,
        "citation_ratio": row.citation_ratio,
        "total_sentences": row.total_sentences,
        "cited_sentences": row.cited_sentences,
        "risk_level": row.risk_level,
        "risk_reasons": risk_reasons,
        "sources": source_items,
    }


@router.get("/{project_id}/citations/export")
def export_project_citations(project_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    stats = get_project_citations(project_id=project_id, current_user=current_user, db=db)
    lines = [
        f"# 引用报告 - {project_id}",
        "",
        f"- 章节数: {stats['total_chapters']}",
        f"- 总句数: {stats['total_sentences']}",
        f"- 引用句数: {stats['total_cited']}",
        f"- 平均引用比例: {stats['avg_citation_ratio']}%",
        "",
        "## 章节明细",
        "",
    ]
    for row in stats["chapters"]:
        lines.append(
            f"- {row['chapter_id']} 引用比例 {row['citation_ratio']}% ({row['cited_sentences']}/{row['total_sentences']}) 风险 {row['risk_level']}"
        )
    content = "\n".join(lines)
    return Response(
        content=content,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="citations_{project_id}.md"'},
    )


@router.get("/{project_id}/image-modifications")
def get_image_modifications(project_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(TechnicalBidProject).filter(TechnicalBidProject.id == project_id, TechnicalBidProject.user_id == current_user.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    rows = (
        db.query(ImageModificationRecord)
        .filter(ImageModificationRecord.project_id == project_id)
        .order_by(desc(ImageModificationRecord.id))
        .all()
    )
    image_ids = [r.source_image_id for r in rows if r.source_image_id is not None]
    image_map = {
        i.id: i
        for i in db.query(TechnicalBidImage).filter(TechnicalBidImage.id.in_(image_ids)).all()
    } if image_ids else {}
    total_images = len(set(image_ids))
    pending = sum(1 for r in rows if r.status == "pending")
    confirmed = sum(1 for r in rows if r.status == "confirmed")
    rejected = sum(1 for r in rows if r.status == "rejected")
    items = []
    for row in rows:
        source = image_map.get(row.source_image_id)
        marks = row.modification_marks if isinstance(row.modification_marks, list) else []
        confirmed_marks = len([m for m in marks if isinstance(m, dict) and m.get("confirmed")])
        items.append(
            {
                "modification_id": row.id,
                "source_image": {
                    "id": source.id if source else row.source_image_id,
                    "title": source.image_title if source else "",
                    "thumbnail_url": source.thumbnail_url if source else "",
                },
                "summary": row.modification_reason or row.modification_type or "",
                "status": row.status,
                "marks_count": len(marks),
                "confirmed_marks": confirmed_marks,
                "created_at": row.created_at,
            }
        )
    return {
        "project_id": project_id,
        "total_images": total_images,
        "pending_confirmation": pending,
        "confirmed": confirmed,
        "rejected": rejected,
        "modifications": items,
    }
