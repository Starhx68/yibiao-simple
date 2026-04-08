import hashlib
import math
import os
import re
import threading
import time
import uuid
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, List, Optional

from fastapi import UploadFile
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models.models import RagGenerationLog, RagIndustryCategory, RagProjectTypeCategory, RagRebuildTask, TechnicalBidChunk, TechnicalBidLibrary
from .file_service import FileService
from .embedding_service import get_embedding_service, EmbeddingService
from ..config import settings


def get_default_rag_threshold() -> float:
    """获取默认的RAG相似度阈值"""
    return settings.rag_similarity_threshold


def get_default_rag_top_k() -> int:
    """获取默认的RAG检索数量"""
    return settings.rag_top_k

try:
    import chromadb
except Exception:
    chromadb = None


class RagService:
    _rebuild_task_ttl_seconds = 3600 * 24

    INDUSTRY_SEED_DATA: List[Dict[str, Any]] = [
        {"code": "A", "name": "农、林、牧、渔业", "keywords": ["农业", "林业", "牧业", "渔业", "高标准农田"]},
        {"code": "B", "name": "采矿业", "keywords": ["矿山", "煤矿", "采矿", "矿井", "矿业"]},
        {"code": "C", "name": "制造业", "keywords": ["制造", "生产线", "工厂", "装备", "加工"]},
        {"code": "D", "name": "电力、热力、燃气及水生产和供应业", "keywords": ["电力", "热力", "燃气", "供水", "变电站"]},
        {"code": "E", "name": "建筑业", "keywords": ["房屋建筑", "市政", "公路", "桥梁", "工程施工"]},
        {"code": "F", "name": "批发和零售业", "keywords": ["采购", "供应链", "批发", "零售", "商贸"]},
        {"code": "G", "name": "交通运输、仓储和邮政业", "keywords": ["交通运输", "仓储", "物流", "邮政", "冷链"]},
        {"code": "H", "name": "住宿和餐饮业", "keywords": ["酒店", "住宿", "餐饮", "食堂", "餐厨"]},
        {"code": "I", "name": "信息传输、软件和信息技术服务业", "keywords": ["信息化", "软件", "系统集成", "数据中心", "智慧城市"]},
        {"code": "J", "name": "金融业", "keywords": ["银行", "金融", "证券", "保险", "征信"]},
        {"code": "K", "name": "房地产业", "keywords": ["房地产", "地产开发", "物业", "不动产", "园区开发"]},
        {"code": "L", "name": "租赁和商务服务业", "keywords": ["咨询", "运维服务", "租赁", "外包", "商务服务"]},
        {"code": "M", "name": "科学研究和技术服务业", "keywords": ["科研", "检测", "勘察", "设计院", "技术服务"]},
        {"code": "N", "name": "水利、环境和公共设施管理业", "keywords": ["水利", "环保", "污水处理", "垃圾处理", "公共设施"]},
        {"code": "O", "name": "居民服务、修理和其他服务业", "keywords": ["运维", "维修", "保洁", "社区服务", "后勤保障"]},
        {"code": "P", "name": "教育", "keywords": ["教育", "学校", "校园", "教学", "实训"]},
        {"code": "Q", "name": "卫生和社会工作", "keywords": ["医疗", "医院", "卫生", "疾控", "养老"]},
        {"code": "R", "name": "文化、体育和娱乐业", "keywords": ["文旅", "文化", "体育", "会展", "演艺"]},
        {"code": "S", "name": "公共管理、社会保障和社会组织", "keywords": ["政务", "公安", "应急", "社会保障", "政府"]},
    ]
    PROJECT_TYPE_SEED_DATA: List[Dict[str, Any]] = [
        {"code": "0101", "name": "房屋建筑工程", "keywords": ["房屋建筑", "土建", "住宅", "办公楼", "建筑工程"]},
        {"code": "0102", "name": "市政公用工程", "keywords": ["市政", "管网", "道路", "照明", "排水"]},
        {"code": "0103", "name": "公路工程", "keywords": ["公路", "高速", "路基", "路面", "隧道"]},
        {"code": "0104", "name": "铁路工程", "keywords": ["铁路", "轨道", "站场", "线路", "高铁"]},
        {"code": "0105", "name": "水利水电工程", "keywords": ["水利", "水电", "水库", "堤防", "灌区"]},
        {"code": "0106", "name": "电力工程", "keywords": ["电力工程", "变电", "输电", "配电", "电网"]},
        {"code": "0107", "name": "机电安装工程", "keywords": ["机电", "安装", "设备安装", "暖通", "消防"]},
        {"code": "0108", "name": "环保工程", "keywords": ["环保工程", "污水", "废气", "固废", "生态治理"]},
        {"code": "0109", "name": "信息化工程", "keywords": ["信息化", "软件开发", "系统集成", "智慧", "平台建设"]},
        {"code": "0110", "name": "运维服务项目", "keywords": ["运维", "驻场", "托管", "维保", "服务外包"]},
        {"code": "0111", "name": "采购类项目", "keywords": ["设备采购", "货物采购", "招标采购", "供货", "集采"]},
        {"code": "0112", "name": "咨询与设计项目", "keywords": ["咨询", "设计", "可研", "勘察", "监理"]},
    ]

    @staticmethod
    def _cleanup_rebuild_tasks(db: Session, user_id: int) -> None:
        expire_before = datetime.utcnow() - timedelta(seconds=RagService._rebuild_task_ttl_seconds)
        db.query(RagRebuildTask).filter(
            RagRebuildTask.user_id == user_id,
            RagRebuildTask.status.in_(["success", "failed", "cancelled"]),
            RagRebuildTask.updated_at < expire_before,
        ).delete(synchronize_session=False)
        db.commit()

    @staticmethod
    def start_rebuild_vector_index_task(
        db: Session,
        user_id: int,
        library_id: Optional[int] = None,
        batch_size: int = 100,
    ) -> Dict[str, Any]:
        RagService._cleanup_rebuild_tasks(db=db, user_id=user_id)
        running_task = (
            db.query(RagRebuildTask)
            .filter(
                RagRebuildTask.user_id == user_id,
                RagRebuildTask.status.in_(["pending", "running"]),
            )
            .order_by(RagRebuildTask.created_at.desc())
            .first()
        )
        if running_task:
            return {
                "success": True,
                "accepted": False,
                "task_id": running_task.task_id,
                "status": running_task.status,
                "message": "已有重建任务在执行",
            }

        task_id = uuid.uuid4().hex
        task = RagRebuildTask(
            task_id=task_id,
            user_id=user_id,
            library_id=library_id,
            batch_size=batch_size,
            status="pending",
            progress=0,
            stage="pending",
            message="任务已创建，等待执行",
            total_chunks=0,
            processed_chunks=0,
            failed_chunks=0,
            result=None,
            error=None,
            started_at=datetime.utcnow(),
            finished_at=None,
        )
        db.add(task)
        db.commit()

        worker = threading.Thread(
            target=RagService._run_rebuild_task,
            args=(task_id,),
            name=f"rag-rebuild-{task_id[:8]}",
            daemon=True,
        )
        worker.start()
        return {
            "success": True,
            "accepted": True,
            "task_id": task_id,
            "status": "pending",
            "message": "重建任务已启动",
        }

    @staticmethod
    def get_rebuild_vector_index_task_status(db: Session, task_id: str, user_id: int) -> Optional[Dict[str, Any]]:
        RagService._cleanup_rebuild_tasks(db=db, user_id=user_id)
        task = (
            db.query(RagRebuildTask)
            .filter(RagRebuildTask.task_id == task_id, RagRebuildTask.user_id == user_id)
            .first()
        )
        if not task:
            return None
        return {
            "success": True,
            "task_id": task.task_id,
            "status": task.status,
            "progress": int(task.progress or 0),
            "message": task.message or "",
            "stage": task.stage or "pending",
            "total_chunks": task.total_chunks or 0,
            "processed_chunks": task.processed_chunks or 0,
            "failed_chunks": task.failed_chunks or 0,
            "started_at": task.started_at.timestamp() if task.started_at else None,
            "finished_at": task.finished_at.timestamp() if task.finished_at else None,
            "result": task.result,
            "error": task.error,
        }

    @staticmethod
    def _update_rebuild_task(task_id: str, **fields: Any) -> None:
        db = SessionLocal()
        try:
            task = db.query(RagRebuildTask).filter(RagRebuildTask.task_id == task_id).first()
            if not task:
                return
            for key, value in fields.items():
                if hasattr(task, key):
                    setattr(task, key, value)
            db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()

    @staticmethod
    def _update_library_progress(library_id: int, **fields: Any) -> None:
        """更新资料库处理进度"""
        db = SessionLocal()
        try:
            library = db.query(TechnicalBidLibrary).filter(TechnicalBidLibrary.id == library_id).first()
            if not library:
                return
            for key, value in fields.items():
                if hasattr(library, key):
                    setattr(library, key, value)
            db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()

    @staticmethod
    def _run_rebuild_task(task_id: str) -> None:
        db = SessionLocal()
        try:
            task = db.query(RagRebuildTask).filter(RagRebuildTask.task_id == task_id).first()
            if not task:
                return
            user_id = task.user_id
            library_id = task.library_id
            batch_size = task.batch_size or 100
            task.status = "running"
            task.progress = 1
            task.stage = "starting"
            task.message = "正在初始化重建任务"
            db.commit()

            def progress_updater(payload: Dict[str, Any]) -> None:
                RagService._update_rebuild_task(task_id, **payload)

            result = RagService.rebuild_vector_index(
                db=db,
                user_id=user_id,
                library_id=library_id,
                batch_size=batch_size,
                progress_callback=progress_updater,
            )
            if result.get("success"):
                RagService._update_rebuild_task(
                    task_id,
                    status="success",
                    progress=100,
                    stage="done",
                    message="向量索引重建完成",
                    result=result,
                    error=None,
                    finished_at=datetime.utcnow(),
                )
            else:
                RagService._update_rebuild_task(
                    task_id,
                    status="failed",
                    progress=100,
                    stage="failed",
                    message="向量索引重建失败",
                    result=result,
                    error="; ".join(result.get("errors", [])[:3]) if result.get("errors") else "重建失败",
                    finished_at=datetime.utcnow(),
                )
        except Exception as exc:
            RagService._update_rebuild_task(
                task_id,
                status="failed",
                progress=100,
                stage="failed",
                message=f"重建任务异常: {exc}",
                result=None,
                error=str(exc),
                finished_at=datetime.utcnow(),
            )
        finally:
            db.close()

    @staticmethod
    def _embedding_service() -> EmbeddingService:
        """获取向量嵌入服务实例"""
        return get_embedding_service()

    @staticmethod
    def _embedding_model_name() -> str:
        """获取当前嵌入模型名称"""
        service = RagService._embedding_service()
        return service.get_model_info()["model_name"]

    @staticmethod
    def _embedding_dimension() -> int:
        """获取当前嵌入模型的向量维度"""
        service = RagService._embedding_service()
        return service.dimension

    @staticmethod
    def _encode_embedding(text: str) -> List[float]:
        """
        使用向量嵌入服务对文本进行编码

        优先使用真正的语义向量模型（如bge-large-zh-v1.5），
        如果模型不可用则自动降级到hash embedding
        """
        service = RagService._embedding_service()
        return service.encode(text, normalize=True)

    @staticmethod
    def _encode_embeddings_batch(texts: List[str]) -> List[List[float]]:
        """批量编码文本"""
        service = RagService._embedding_service()
        return service.encode_batch(texts, normalize=True)

    @staticmethod
    def _hash_embedding(text: str, dim: Optional[int] = None) -> List[float]:
        """
        Hash embedding降级方案

        使用SHA256哈希生成伪向量，仅作为降级方案使用
        """
        dimension = dim or RagService._embedding_dimension()
        tokens = RagService._tokenize(text)
        if not tokens:
            return [0.0] * dimension
        vec = [0.0] * dimension
        for token in tokens:
            digest = hashlib.sha256(token.encode("utf-8", errors="ignore")).hexdigest()
            idx = int(digest[:8], 16) % dimension
            sign = 1.0 if int(digest[8:10], 16) % 2 == 0 else -1.0
            vec[idx] += sign
        norm = math.sqrt(sum(v * v for v in vec))
        if norm <= 0:
            return vec
        return [v / norm for v in vec]

    @staticmethod
    def _cosine_similarity(v1: List[float], v2: List[float]) -> float:
        if not v1 or not v2 or len(v1) != len(v2):
            return 0.0
        return max(0.0, min(1.0, sum(a * b for a, b in zip(v1, v2))))

    @staticmethod
    def _chroma_enabled() -> bool:
        if os.getenv("RAG_ENABLE_CHROMA", "1") != "1":
            return False
        return chromadb is not None

    @staticmethod
    def _chroma_collection():
        if not RagService._chroma_enabled():
            return None
        default_data_dir = getattr(
            settings,
            "data_dir",
            os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data")),
        )
        db_dir = (
            os.getenv("RAG_CHROMA_DATA_DIR")
            or os.getenv("RAG_CHROMA_DIR")
            or os.path.join(default_data_dir, "chromadb")
        )
        db_dir = os.path.abspath(db_dir)
        os.makedirs(db_dir, exist_ok=True)
        client = chromadb.PersistentClient(path=db_dir)
        return client.get_or_create_collection(name="technical_bid_chunks")

    @staticmethod
    def _tokenize(text: str) -> List[str]:
        if not text:
            return []
        raw_tokens = re.findall(r"[\u4e00-\u9fa5A-Za-z0-9_]+", text.lower())
        tokens: List[str] = []
        for token in raw_tokens:
            if len(token) <= 1:
                continue
            tokens.append(token)
        return tokens

    @staticmethod
    def _calc_similarity(query: str, content: str) -> float:
        if not query or not content:
            return 0.0
        query_tokens = RagService._tokenize(query)
        if not query_tokens:
            return 0.0
        content_tokens = RagService._tokenize(content)
        content_set = set(content_tokens)
        hit_count = sum(1 for t in query_tokens if t in content_set)
        overlap_score = hit_count / max(len(query_tokens), 1)
        phrase_score = 0.0
        q = query.strip().lower()
        c = content.lower()
        if q and q in c:
            phrase_score += 0.25
        for t in query_tokens[:8]:
            if t in c:
                phrase_score += 0.02
        return min(1.0, overlap_score * 0.75 + phrase_score)

    @staticmethod
    def _split_text_to_chunks(text: str, chunk_size: int = 800, overlap: int = 120) -> List[Dict[str, Any]]:
        if not text:
            return []
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        heading_pattern = re.compile(r"^(第[一二三四五六七八九十百千零〇两\d]+[章节部分篇卷]|[一二三四五六七八九十]+、|\d+(?:\.\d+){0,3}[、.．])")
        chunks: List[Dict[str, Any]] = []
        current_heading = "未分类章节"
        current_level = 1
        buffer = ""
        chapter_idx = 1

        def flush_buffer() -> None:
            nonlocal buffer, chapter_idx
            if not buffer.strip():
                return
            content = buffer.strip()
            summary = content[: min(220, len(content))]
            if summary:
                chunks.append({
                    "chapter_path": str(chapter_idx),
                    "chapter_level": current_level,
                    "chapter_title": current_heading,
                    "chunk_type": "summary",
                    "chunk_content": summary,
                    "is_summary_chunk": True,
                })
            start = 0
            piece_idx = 0
            while start < len(content):
                end = min(len(content), start + chunk_size)
                chunk_text = content[start:end].strip()
                if chunk_text:
                    chunks.append({
                        "chapter_path": str(chapter_idx),
                        "chapter_level": current_level,
                        "chapter_title": current_heading,
                        "chunk_type": "content",
                        "chunk_content": chunk_text,
                        "is_summary_chunk": piece_idx == 1,
                    })
                    piece_idx += 1
                if end >= len(content):
                    break
                start = max(0, end - overlap)
            chapter_idx += 1
            buffer = ""

        for line in lines:
            if heading_pattern.match(line):
                flush_buffer()
                current_heading = line
                current_level = 1
                if re.match(r"^\d+\.\d+", line):
                    current_level = 2
                if re.match(r"^\d+\.\d+\.\d+", line):
                    current_level = 3
                if re.match(r"^\d+\.\d+\.\d+\.\d+", line):
                    current_level = 4
                continue
            if len(buffer) + len(line) + 1 > chunk_size * 2:
                flush_buffer()
            buffer = f"{buffer}\n{line}".strip()
        flush_buffer()
        return chunks

    @staticmethod
    def _extract_title_page_text(file_content: str) -> str:
        if not file_content:
            return ""
        text = file_content.strip()
        page_marker = re.search(r"\n---\s*第\s*2\s*页\s*---", text)
        if page_marker:
            text = text[: page_marker.start()]
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        compact = "\n".join(lines[:30])
        return compact[:2000]

    @staticmethod
    def bootstrap_classification_catalog(db: Session, force: bool = False) -> Dict[str, int]:
        created_industry = 0
        created_project_type = 0
        if force:
            db.query(RagIndustryCategory).delete()
            db.query(RagProjectTypeCategory).delete()
            db.flush()
        existing_industry = {item.code for item in db.query(RagIndustryCategory.code).all()}
        for idx, item in enumerate(RagService.INDUSTRY_SEED_DATA, start=1):
            if item["code"] in existing_industry:
                continue
            db.add(
                RagIndustryCategory(
                    code=item["code"],
                    name=item["name"],
                    keywords=item.get("keywords", []),
                    sort_order=idx,
                    enabled=True,
                )
            )
            created_industry += 1
        existing_project = {item.code for item in db.query(RagProjectTypeCategory.code).all()}
        for idx, item in enumerate(RagService.PROJECT_TYPE_SEED_DATA, start=1):
            if item["code"] in existing_project:
                continue
            db.add(
                RagProjectTypeCategory(
                    code=item["code"],
                    name=item["name"],
                    keywords=item.get("keywords", []),
                    sort_order=idx,
                    enabled=True,
                )
            )
            created_project_type += 1
        if created_industry > 0 or created_project_type > 0 or force:
            db.commit()
        return {
            "industry_created": created_industry,
            "project_type_created": created_project_type,
            "industry_total": db.query(RagIndustryCategory).count(),
            "project_type_total": db.query(RagProjectTypeCategory).count(),
        }

    @staticmethod
    def get_classification_catalog(db: Session) -> Dict[str, List[Dict[str, Any]]]:
        if db.query(RagIndustryCategory).count() == 0 and db.query(RagProjectTypeCategory).count() == 0:
            RagService.bootstrap_classification_catalog(db=db, force=False)
        industry_rows = (
            db.query(RagIndustryCategory)
            .filter(RagIndustryCategory.enabled == True)
            .order_by(RagIndustryCategory.sort_order.asc(), RagIndustryCategory.id.asc())
            .all()
        )
        project_rows = (
            db.query(RagProjectTypeCategory)
            .filter(RagProjectTypeCategory.enabled == True)
            .order_by(RagProjectTypeCategory.sort_order.asc(), RagProjectTypeCategory.id.asc())
            .all()
        )
        return {
            "industry_items": [
                {"code": row.code, "name": row.name, "keywords": row.keywords or []}
                for row in industry_rows
            ],
            "project_type_items": [
                {"code": row.code, "name": row.name, "keywords": row.keywords or []}
                for row in project_rows
            ],
        }

    @staticmethod
    def _score_category_match(title_text: str, category_name: str, keywords: List[str]) -> float:
        if not title_text:
            return 0.0
        normalized = title_text.lower()
        score = 0.0
        if category_name and category_name.lower() in normalized:
            score += 1.4
        for keyword in keywords:
            word = str(keyword or "").strip().lower()
            if not word:
                continue
            if word in normalized:
                score += 1.0 if len(word) > 2 else 0.5
        return score

    @staticmethod
    def detect_categories_from_title(
        db: Session,
        file_content: str,
        min_score: float = 1.0,
    ) -> Dict[str, List[Dict[str, Any]]]:
        title_text = RagService._extract_title_page_text(file_content)
        catalog = RagService.get_classification_catalog(db)
        industry_scored: List[Dict[str, Any]] = []
        for item in catalog["industry_items"]:
            score = RagService._score_category_match(title_text, item["name"], item.get("keywords", []))
            if score >= min_score:
                industry_scored.append(
                    {"code": item["code"], "name": item["name"], "score": round(score, 2), "source": "title_auto"}
                )
        project_scored: List[Dict[str, Any]] = []
        for item in catalog["project_type_items"]:
            score = RagService._score_category_match(title_text, item["name"], item.get("keywords", []))
            if score >= min_score:
                project_scored.append(
                    {"code": item["code"], "name": item["name"], "score": round(score, 2), "source": "title_auto"}
                )
        industry_scored.sort(key=lambda x: x["score"], reverse=True)
        project_scored.sort(key=lambda x: x["score"], reverse=True)
        return {
            "title_text": title_text,
            "industry_tags": industry_scored[:4],
            "project_type_tags": project_scored[:4],
        }

    @staticmethod
    def _query_categories_by_codes(
        db: Session,
        industry_codes: Optional[List[str]] = None,
        project_type_codes: Optional[List[str]] = None,
    ) -> Dict[str, List[Dict[str, Any]]]:
        result = {"industry_tags": [], "project_type_tags": []}
        if industry_codes:
            rows = (
                db.query(RagIndustryCategory)
                .filter(RagIndustryCategory.code.in_(industry_codes), RagIndustryCategory.enabled == True)
                .all()
            )
            result["industry_tags"] = [{"code": row.code, "name": row.name, "source": "manual_select"} for row in rows]
        if project_type_codes:
            rows = (
                db.query(RagProjectTypeCategory)
                .filter(RagProjectTypeCategory.code.in_(project_type_codes), RagProjectTypeCategory.enabled == True)
                .all()
            )
            result["project_type_tags"] = [{"code": row.code, "name": row.name, "source": "manual_select"} for row in rows]
        return result

    @staticmethod
    async def ingest_library_file(
        db: Session,
        user_id: int,
        file: UploadFile,
        library_name: str,
        industry: Optional[str] = None,
        project_type: Optional[str] = None,
        industry_codes: Optional[List[str]] = None,
        project_type_codes: Optional[List[str]] = None,
        auto_classify: bool = True,
    ) -> TechnicalBidLibrary:
        started_at = datetime.utcnow()
        RagService.bootstrap_classification_catalog(db=db, force=False)
        file_content, file_path = await FileService.process_uploaded_file(file)
        file_name = file.filename or "unknown"
        stored_file_name = os.path.basename(file_path)
        file_hash = hashlib.sha256(file_content.encode("utf-8", errors="ignore")).hexdigest()
        auto_tags = RagService.detect_categories_from_title(db=db, file_content=file_content) if auto_classify else {
            "industry_tags": [],
            "project_type_tags": [],
            "title_text": "",
        }
        manual_tags = RagService._query_categories_by_codes(
            db=db,
            industry_codes=industry_codes,
            project_type_codes=project_type_codes,
        )
        industry_tag_map: Dict[str, Dict[str, Any]] = {}
        for item in auto_tags["industry_tags"] + manual_tags["industry_tags"]:
            code = item["code"]
            merged = industry_tag_map.get(code, {})
            merged.update(item)
            if merged.get("source") == "manual_select" and item.get("source") == "title_auto":
                merged["source"] = "manual_select,title_auto"
            elif item.get("source") == "manual_select" and merged.get("source") == "title_auto":
                merged["source"] = "manual_select,title_auto"
            industry_tag_map[code] = merged
        project_tag_map: Dict[str, Dict[str, Any]] = {}
        for item in auto_tags["project_type_tags"] + manual_tags["project_type_tags"]:
            code = item["code"]
            merged = project_tag_map.get(code, {})
            merged.update(item)
            if merged.get("source") == "manual_select" and item.get("source") == "title_auto":
                merged["source"] = "manual_select,title_auto"
            elif item.get("source") == "manual_select" and merged.get("source") == "title_auto":
                merged["source"] = "manual_select,title_auto"
            project_tag_map[code] = merged
        final_industry_tags = list(industry_tag_map.values())
        final_project_tags = list(project_tag_map.values())
        resolved_industry = industry or (final_industry_tags[0]["name"] if final_industry_tags else None)
        resolved_project_type = project_type or (final_project_tags[0]["name"] if final_project_tags else None)
        library = TechnicalBidLibrary(
            user_id=user_id,
            library_name=library_name or file_name,
            industry=resolved_industry,
            project_type=resolved_project_type,
            industry_tags=final_industry_tags,
            project_type_tags=final_project_tags,
            file_url=f"/uploads/{stored_file_name}",
            file_name=file_name,
            file_size=len(file_content.encode("utf-8", errors="ignore")),
            file_hash=file_hash,
            file_format=file_name.split(".")[-1].lower() if "." in file_name else "",
            total_pages=max(1, len(file_content) // 2000),
            status="processing",
            progress=5,
            processed_chunks=0,
            total_words=len(file_content),
            processing_started_at=started_at,
        )
        db.add(library)
        db.commit()
        db.refresh(library)
        chunks = RagService._split_text_to_chunks(file_content)
        total = len(chunks)
        created_chunks: List[TechnicalBidChunk] = []
        for i, c in enumerate(chunks):
            chunk_text = c["chunk_content"]
            chunk = TechnicalBidChunk(
                library_id=library.id,
                chunk_index=i,
                chunk_type=c["chunk_type"],
                chapter_path=c["chapter_path"],
                chapter_level=c["chapter_level"],
                chapter_title=c["chapter_title"][:200],
                parent_chapter_path=None,
                chunk_content=chunk_text,
                content_length=len(chunk_text),
                content_hash=hashlib.sha256(chunk_text.encode("utf-8", errors="ignore")).hexdigest(),
                vector_id=None,
                embedding_model=RagService._embedding_model_name(),
                embedding_dimension=RagService._embedding_dimension(),
                meta_json={"library_name": library.library_name},
                is_summary_chunk=bool(c["is_summary_chunk"]),
            )
            db.add(chunk)
            created_chunks.append(chunk)
        db.flush()

        # 确保向量模型已加载完成
        embedding_service = RagService._embedding_service()
        embedding_service._ensure_model_loaded()

        chroma_synced = False
        collection = RagService._chroma_collection()
        if collection and created_chunks:
            try:
                ids = []
                documents = []
                metadatas = []
                # 使用真正的向量嵌入服务批量编码
                chunk_texts = [chunk.chunk_content for chunk in created_chunks]
                embeddings = RagService._encode_embeddings_batch(chunk_texts)

                for idx, chunk in enumerate(created_chunks):
                    ids.append(f"chunk_{library.id}_{chunk.id}")
                    chunk.vector_id = f"chunk_{library.id}_{chunk.id}"
                    documents.append(chunk.chunk_content)
                    metadatas.append({
                        "chunk_db_id": str(chunk.id),
                        "library_id": str(library.id),
                        "library_name": library.library_name or "",
                        "chapter_path": chunk.chapter_path or "",
                        "chapter_title": chunk.chapter_title or "",
                        "industry": library.industry or "",
                        "project_type": library.project_type or "",
                        "industry_tags": ",".join([item.get("code", "") for item in final_industry_tags if item.get("code")]),
                        "project_type_tags": ",".join([item.get("code", "") for item in final_project_tags if item.get("code")]),
                        "user_id": str(user_id),
                        "embedding_model": RagService._embedding_model_name(),
                    })
                collection.upsert(
                    ids=ids,
                    documents=documents,
                    embeddings=embeddings,
                    metadatas=metadatas,
                )
                chroma_synced = True
            except Exception:
                chroma_synced = False
        library.total_chunks = total
        library.summary_chunks = len([c for c in chunks if c["chunk_type"] == "summary"])
        library.total_chapters = len({c["chapter_path"] for c in chunks})
        library.processed_chunks = total
        library.progress = 100
        library.status = "completed"
        library.processing_completed_at = datetime.utcnow()
        library.processing_duration = int((library.processing_completed_at - started_at).total_seconds())
        if not chroma_synced and RagService._chroma_enabled():
            library.error_msg = "ChromaDB写入失败，已降级为关键词检索"
        db.commit()
        db.refresh(library)
        return library

    @staticmethod
    def _run_ingest_library_task(
        library_id: int,
        user_id: int,
        file_path: str,
        file_name: str,
        library_name: str,
        industry: Optional[str] = None,
        project_type: Optional[str] = None,
        industry_codes: Optional[List[str]] = None,
        project_type_codes: Optional[List[str]] = None,
        auto_classify: bool = True,
    ) -> None:
        """后台执行文件导入任务"""
        db = SessionLocal()
        started_at = datetime.utcnow()
        try:
            # 读取文件内容
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                file_content = f.read()

            # 更新进度：文件已读取
            RagService._update_library_progress(
                library_id,
                progress=10
            )

            # 分类检测
            RagService.bootstrap_classification_catalog(db=db, force=False)
            auto_tags = RagService.detect_categories_from_title(db=db, file_content=file_content) if auto_classify else {
                "industry_tags": [],
                "project_type_tags": [],
                "title_text": "",
            }
            manual_tags = RagService._query_categories_by_codes(
                db=db,
                industry_codes=industry_codes,
                project_type_codes=project_type_codes,
            )

            industry_tag_map: Dict[str, Dict[str, Any]] = {}
            for item in auto_tags["industry_tags"] + manual_tags["industry_tags"]:
                code = item["code"]
                merged = industry_tag_map.get(code, {})
                merged.update(item)
                if merged.get("source") == "manual_select" and item.get("source") == "title_auto":
                    merged["source"] = "manual_select,title_auto"
                elif merged.get("source") == "manual_select" and merged.get("source") == "title_auto":
                    merged["source"] = "manual_select,title_auto"
                industry_tag_map[code] = merged

            project_tag_map: Dict[str, Dict[str, Any]] = {}
            for item in auto_tags["project_type_tags"] + manual_tags["project_type_tags"]:
                code = item["code"]
                merged = project_tag_map.get(code, {})
                merged.update(item)
                if merged.get("source") == "manual_select" and item.get("source") == "title_auto":
                    merged["source"] = "manual_select,title_auto"
                elif merged.get("source") == "manual_select" and merged.get("source") == "title_auto":
                    merged["source"] = "manual_select,title_auto"
                project_tag_map[code] = merged

            final_industry_tags = list(industry_tag_map.values())
            final_project_tags = list(project_tag_map.values())
            resolved_industry = industry or (final_industry_tags[0]["name"] if final_industry_tags else None)
            resolved_project_type = project_type or (final_project_tags[0]["name"] if final_project_tags else None)

            # 更新资料库信息
            file_hash = hashlib.sha256(file_content.encode("utf-8", errors="ignore")).hexdigest()
            stored_file_name = os.path.basename(file_path)

            library = db.query(TechnicalBidLibrary).filter(TechnicalBidLibrary.id == library_id).first()
            if not library:
                raise Exception(f"资料库不存在: {library_id}")

            library.industry = resolved_industry
            library.project_type = resolved_project_type
            library.industry_tags = final_industry_tags
            library.project_type_tags = final_project_tags
            library.file_url = f"/uploads/{stored_file_name}"
            library.file_name = file_name
            library.file_size = len(file_content.encode("utf-8", errors="ignore"))
            library.file_hash = file_hash
            library.file_format = file_name.split(".")[-1].lower() if "." in file_name else ""
            library.total_pages = max(1, len(file_content) // 2000)
            library.total_words = len(file_content)
            library.processing_started_at = started_at
            db.commit()

            # 更新进度：开始切分
            RagService._update_library_progress(
                library_id,
                progress=20
            )

            # 切分文档
            chunks = RagService._split_text_to_chunks(file_content)
            total = len(chunks)

            # 更新进度：开始创建chunks
            RagService._update_library_progress(
                library_id,
                total_chunks=total,
                progress=30
            )

            created_chunks: List[TechnicalBidChunk] = []
            for i, c in enumerate(chunks):
                chunk_text = c["chunk_content"]
                chunk = TechnicalBidChunk(
                    library_id=library.id,
                    chunk_index=i,
                    chunk_type=c["chunk_type"],
                    chapter_path=c["chapter_path"],
                    chapter_level=c["chapter_level"],
                    chapter_title=c["chapter_title"][:200],
                    parent_chapter_path=None,
                    chunk_content=chunk_text,
                    content_length=len(chunk_text),
                    content_hash=hashlib.sha256(chunk_text.encode("utf-8", errors="ignore")).hexdigest(),
                    vector_id=None,
                    embedding_model=RagService._embedding_model_name(),
                    embedding_dimension=RagService._embedding_dimension(),
                    meta_json={"library_name": library.library_name},
                    is_summary_chunk=bool(c["is_summary_chunk"]),
                )
                db.add(chunk)
                created_chunks.append(chunk)

                # 每处理100个chunk更新一次进度
                if (i + 1) % 100 == 0:
                    progress = 30 + int((i + 1) / total * 40)
                    RagService._update_library_progress(
                        library_id,
                        progress=progress,
                        processed_chunks=i + 1
                    )

            db.flush()

            # 更新进度：开始生成向量
            RagService._update_library_progress(
                library_id,
                progress=70
            )

            # 确保向量模型已加载完成（关键修复：等待异步加载完成）
            import logging
            logger = logging.getLogger(__name__)
            embedding_service = RagService._embedding_service()
            model_info = embedding_service.get_model_info()
            logger.info(f"[RAG Import] 模型状态: {model_info['model_name']}, loading={model_info['model_loading']}, is_real={model_info['is_real_embedding']}")

            embedding_service._ensure_model_loaded(timeout=600)  # 10分钟超时

            # 再次检查模型状态
            model_info = embedding_service.get_model_info()
            logger.info(f"[RAG Import] 确保加载后模型状态: {model_info['model_name']}, is_real={model_info['is_real_embedding']}")

            # 检查是否使用真正的向量模型，如果不是则报错
            if not embedding_service.is_real_embedding:
                RagService._update_library_progress(
                    library_id,
                    status="failed",
                    error_msg=f"向量模型加载失败，当前使用: {model_info['model_name']}。请检查日志或重建向量索引。"
                )
                logger.error(f"[RAG Import] 向量模型未正确加载，状态: {model_info}")
                return

            chroma_synced = False
            collection = RagService._chroma_collection()
            if collection and created_chunks:
                try:
                    # 分批处理向量嵌入，避免内存溢出
                    batch_size = 100  # 每批处理100个chunks
                    total_batches = (len(created_chunks) + batch_size - 1) // batch_size

                    for batch_idx in range(0, len(created_chunks), batch_size):
                        batch_chunks = created_chunks[batch_idx:batch_idx + batch_size]
                        batch_num = batch_idx // batch_size + 1

                        # 更新进度
                        progress = 70 + int((batch_idx + len(batch_chunks)) / len(created_chunks) * 25)
                        RagService._update_library_progress(
                            library_id,
                            progress=progress,
                            processed_chunks=batch_idx + len(batch_chunks)
                        )

                        # 批量生成向量
                        chunk_texts = [chunk.chunk_content for chunk in batch_chunks]
                        embeddings = RagService._encode_embeddings_batch(chunk_texts)

                        # 准备ChromaDB数据
                        ids = []
                        documents = []
                        metadatas = []

                        for chunk, embedding in zip(batch_chunks, embeddings):
                            vector_id = f"chunk_{library.id}_{chunk.id}"
                            chunk.vector_id = vector_id
                            ids.append(vector_id)
                            documents.append(chunk.chunk_content)
                            metadatas.append({
                                "chunk_db_id": str(chunk.id),
                                "library_id": str(library.id),
                                "library_name": library.library_name or "",
                                "chapter_path": chunk.chapter_path or "",
                                "chapter_title": chunk.chapter_title or "",
                                "industry": library.industry or "",
                                "project_type": library.project_type or "",
                                "industry_tags": ",".join([item.get("code", "") for item in final_industry_tags if item.get("code")]),
                                "project_type_tags": ",".join([item.get("code", "") for item in final_project_tags if item.get("code")]),
                                "user_id": str(user_id),
                                "embedding_model": RagService._embedding_model_name(),
                            })

                        # 批量写入ChromaDB
                        collection.upsert(
                            ids=ids,
                            documents=documents,
                            embeddings=embeddings,
                            metadatas=metadatas,
                        )

                        # 定期提交数据库更新
                        if batch_idx % (batch_size * 5) == 0:
                            db.commit()

                    chroma_synced = True
                except Exception as e:
                    chroma_synced = False
                    print(f"ChromaDB写入失败: {e}")
                    import traceback
                    traceback.print_exc()

            # 完成
            library.total_chunks = total
            library.summary_chunks = len([c for c in chunks if c["chunk_type"] == "summary"])
            library.total_chapters = len({c["chapter_path"] for c in chunks})
            library.processed_chunks = total
            library.progress = 100
            library.status = "completed"
            library.processing_completed_at = datetime.utcnow()
            library.processing_duration = int((library.processing_completed_at - started_at).total_seconds())
            if not chroma_synced and RagService._chroma_enabled():
                library.error_msg = "ChromaDB写入失败，已降级为关键词检索"
            else:
                library.error_msg = None
            db.commit()

        except Exception as e:
            # 标记失败
            try:
                RagService._update_library_progress(
                    library_id,
                    status="failed",
                    error_msg=f"处理失败: {str(e)}"
                )
            except:
                pass
            print(f"后台导入任务失败 (library_id={library_id}): {e}")
            import traceback
            traceback.print_exc()
        finally:
            db.close()

    @staticmethod
    async def ingest_library_file_async(
        db: Session,
        user_id: int,
        file: UploadFile,
        library_name: str,
        industry: Optional[str] = None,
        project_type: Optional[str] = None,
        industry_codes: Optional[List[str]] = None,
        project_type_codes: Optional[List[str]] = None,
        auto_classify: bool = True,
    ) -> TechnicalBidLibrary:
        """异步版本：创建资料库记录后，在后台线程中处理文件"""
        started_at = datetime.utcnow()
        file_name = file.filename or "unknown"

        # 保存文件到本地
        file_path = await FileService.save_uploaded_file(file)

        # 创建资料库记录（状态为processing）
        # 移除文件扩展名
        name_without_ext = file_name.rsplit('.', 1)[0] if '.' in file_name else file_name
        library = TechnicalBidLibrary(
            user_id=user_id,
            library_name=library_name or name_without_ext,
            industry=industry,
            project_type=project_type,
            industry_tags=[],
            project_type_tags=[],
            file_name=file_name,
            status="processing",
            progress=0,
            processed_chunks=0,
            processing_started_at=started_at,
        )
        db.add(library)
        db.commit()
        db.refresh(library)

        # 启动后台处理线程
        worker = threading.Thread(
            target=RagService._run_ingest_library_task,
            args=(
                library.id,
                user_id,
                file_path,
                file_name,
                library_name or file_name,
                industry,
                project_type,
                industry_codes,
                project_type_codes,
                auto_classify,
            ),
            name=f"rag-ingest-{library.id}",
            daemon=True,
        )
        worker.start()

        return library

    @staticmethod
    def search_chunks(
        db: Session,
        user_id: int,
        query: str,
        top_k: int = None,
        industry: Optional[str] = None,
        project_type: Optional[str] = None,
        similarity_threshold: float = None,
    ) -> List[Dict[str, Any]]:
        # 使用配置的默认值
        if top_k is None:
            top_k = get_default_rag_top_k()
        if similarity_threshold is None:
            similarity_threshold = get_default_rag_threshold()

        start = time.time()
        collection = RagService._chroma_collection()
        if collection:
            try:
                where_items = [{"user_id": str(user_id)}]
                if industry:
                    where_items.append({"industry": industry})
                if project_type:
                    where_items.append({"project_type": project_type})
                where_filter: Dict[str, Any] = {"$and": where_items} if len(where_items) > 1 else where_items[0]
                result = collection.query(
                    query_embeddings=[RagService._encode_embedding(query)],
                    n_results=max(top_k * 3, top_k),
                    where=where_filter,
                    include=["documents", "metadatas", "distances"],
                )
                rows: List[Dict[str, Any]] = []
                docs = result.get("documents") or [[]]
                metadatas = result.get("metadatas") or [[]]
                distances = result.get("distances") or [[]]
                for idx, doc in enumerate(docs[0]):
                    distance = distances[0][idx] if idx < len(distances[0]) else 1.0
                    similarity = max(0.0, min(1.0, 1.0 - float(distance)))
                    if similarity < similarity_threshold:
                        continue
                    meta = metadatas[0][idx] if idx < len(metadatas[0]) else {}
                    rows.append({
                        "chunk_id": f"chunk_{meta.get('chunk_db_id', '')}",
                        "library_id": int(meta.get("library_id", 0)),
                        "library_name": meta.get("library_name", ""),
                        "chapter_path": meta.get("chapter_path", ""),
                        "chapter_title": meta.get("chapter_title", ""),
                        "content": doc,
                        "similarity": round(similarity, 4),
                    })
                rows.sort(key=lambda x: x["similarity"], reverse=True)
                elapsed_ms = int((time.time() - start) * 1000)
                for item in rows[:top_k]:
                    item["retrieval_time_ms"] = elapsed_ms
                if rows:
                    return rows[:top_k]
            except Exception:
                pass
        q = (
            db.query(TechnicalBidChunk, TechnicalBidLibrary)
            .join(TechnicalBidLibrary, TechnicalBidChunk.library_id == TechnicalBidLibrary.id)
            .filter(
                TechnicalBidLibrary.user_id == user_id,
                TechnicalBidLibrary.status == "completed",
            )
        )
        if industry:
            q = q.filter(TechnicalBidLibrary.industry == industry)
        if project_type:
            q = q.filter(TechnicalBidLibrary.project_type == project_type)
        rows = q.limit(2500).all()
        scored: List[Dict[str, Any]] = []
        for chunk, library in rows:
            similarity = RagService._calc_similarity(query, chunk.chunk_content)
            if similarity < similarity_threshold:
                continue
            scored.append({
                "chunk_id": f"chunk_{chunk.id}",
                "library_id": library.id,
                "library_name": library.library_name,
                "chapter_path": chunk.chapter_path,
                "chapter_title": chunk.chapter_title,
                "content": chunk.chunk_content,
                "similarity": round(similarity, 4),
            })
        scored.sort(key=lambda x: x["similarity"], reverse=True)
        elapsed_ms = int((time.time() - start) * 1000)
        for item in scored[:top_k]:
            item["retrieval_time_ms"] = elapsed_ms
        return scored[:top_k]

    @staticmethod
    def delete_library_vectors(library_id: int, user_id: int) -> None:
        collection = RagService._chroma_collection()
        if not collection:
            return
        try:
            collection.delete(where={"$and": [{"library_id": str(library_id)}, {"user_id": str(user_id)}]})
        except Exception:
            return

    @staticmethod
    def build_chapter_query(chapter: Dict[str, Any], project_overview: str = "") -> str:
        chapter_title = chapter.get("title", "")
        chapter_description = chapter.get("description", "")
        parts = [chapter_title, chapter_description]
        if project_overview:
            parts.append(project_overview[:300])
        return "\n".join([p for p in parts if p]).strip()

    @staticmethod
    def get_previous_summary(db: Session, project_id: str, limit: int = 5) -> str:
        logs = (
            db.query(RagGenerationLog)
            .filter(RagGenerationLog.project_id == project_id)
            .order_by(RagGenerationLog.id.desc())
            .limit(limit)
            .all()
        )
        if not logs:
            return ""
        snippets: List[str] = []
        for log in reversed(logs):
            if not log.llm_response:
                continue
            text = log.llm_response[:220].replace("\n", " ")
            snippets.append(f"- {log.chapter_id}: {text}")
        return "\n".join(snippets)

    @staticmethod
    def save_generation_log(
        db: Session,
        project_id: str,
        chapter_id: str,
        query_text: str,
        retrieved_chunks: List[Dict[str, Any]],
        llm_model: str,
        llm_response: str,
        retrieval_time: int,
        generation_time: int,
        used_rag: bool = True,
    ) -> None:
        rag_sources = [
            {
                "library_id": item.get("library_id"),
                "library_name": item.get("library_name"),
                "chapter_title": item.get("chapter_title"),
                "similarity": item.get("similarity"),
            }
            for item in retrieved_chunks
        ]
        # 记录实际使用的嵌入模型
        embedding_service = RagService._embedding_service()
        actual_model = embedding_service.get_model_info()["model_name"]

        log = RagGenerationLog(
            project_id=project_id,
            chapter_id=chapter_id,
            query_text=query_text,
            query_embedding_model=actual_model,
            retrieved_count=len(retrieved_chunks),
            retrieved_chunks=retrieved_chunks,
            used_rag=used_rag,
            rag_sources=rag_sources,
            llm_model=llm_model,
            llm_response=llm_response,
            retrieval_time=retrieval_time,
            generation_time=generation_time,
            total_time=retrieval_time + generation_time,
        )
        db.add(log)
        db.commit()

    @staticmethod
    def rebuild_vector_index(
        db: Session,
        user_id: int,
        library_id: Optional[int] = None,
        batch_size: int = 100,
        progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> Dict[str, Any]:
        """
        重建向量索引

        Args:
            db: 数据库会话
            user_id: 用户ID
            library_id: 指定资料库ID，None表示重建所有
            batch_size: 批量处理大小

        Returns:
            重建结果统计
        """
        start_time = time.time()
        embedding_service = RagService._embedding_service()
        model_info = embedding_service.get_model_info()

        result = {
            "success": False,
            "model_name": model_info["model_name"],
            "dimension": model_info["dimension"],
            "is_real_embedding": model_info["is_real_embedding"],
            "total_libraries": 0,
            "total_chunks": 0,
            "processed_chunks": 0,
            "failed_chunks": 0,
            "elapsed_seconds": 0,
            "errors": [],
        }
        if progress_callback:
            progress_callback({
                "progress": 2,
                "stage": "prepare",
                "message": "正在检查可重建资料库",
                "total_chunks": 0,
                "processed_chunks": 0,
                "failed_chunks": 0,
            })

        try:
            # 获取需要重建的资料库
            query = db.query(TechnicalBidLibrary).filter(
                TechnicalBidLibrary.user_id == user_id,
                TechnicalBidLibrary.status == "completed",
            )
            if library_id is not None:
                query = query.filter(TechnicalBidLibrary.id == library_id)

            libraries = query.all()
            result["total_libraries"] = len(libraries)
            if progress_callback:
                progress_callback({
                    "progress": 5,
                    "stage": "scan-libraries",
                    "message": f"发现 {len(libraries)} 个资料库待处理",
                })

            if not libraries:
                result["success"] = True
                if progress_callback:
                    progress_callback({
                        "progress": 100,
                        "stage": "done",
                        "message": "未发现可重建数据",
                        "total_chunks": 0,
                        "processed_chunks": 0,
                        "failed_chunks": 0,
                    })
                return result

            # 获取或创建ChromaDB集合
            collection = RagService._chroma_collection()
            if not collection:
                result["errors"].append("ChromaDB不可用")
                if progress_callback:
                    progress_callback({
                        "progress": 100,
                        "stage": "failed",
                        "message": "ChromaDB不可用",
                    })
                return result

            # 获取所有需要重建的chunk
            library_ids = [lib.id for lib in libraries]
            chunks_query = db.query(TechnicalBidChunk).filter(
                TechnicalBidChunk.library_id.in_(library_ids)
            )
            all_chunks = chunks_query.all()
            result["total_chunks"] = len(all_chunks)
            if progress_callback:
                progress_callback({
                    "progress": 8,
                    "stage": "scan-chunks",
                    "message": f"待重建 chunk 数：{len(all_chunks)}",
                    "total_chunks": len(all_chunks),
                    "processed_chunks": 0,
                    "failed_chunks": 0,
                })

            if not all_chunks:
                result["success"] = True
                if progress_callback:
                    progress_callback({
                        "progress": 100,
                        "stage": "done",
                        "message": "未发现可重建 chunk",
                        "total_chunks": 0,
                        "processed_chunks": 0,
                        "failed_chunks": 0,
                    })
                return result

            # 按批次处理
            for i in range(0, len(all_chunks), batch_size):
                batch = all_chunks[i:i + batch_size]

                # 批量生成向量
                texts = [chunk.chunk_content for chunk in batch]
                try:
                    embeddings = RagService._encode_embeddings_batch(texts)
                except Exception as e:
                    result["errors"].append(f"批次 {i//batch_size + 1} 向量化失败: {str(e)}")
                    result["failed_chunks"] += len(batch)
                    if progress_callback:
                        handled = result["processed_chunks"] + result["failed_chunks"]
                        progress = 10 + int(90 * handled / max(result["total_chunks"], 1))
                        progress_callback({
                            "progress": min(99, progress),
                            "stage": "vectorize",
                            "message": f"批次 {i//batch_size + 1} 向量化失败，继续处理后续批次",
                            "total_chunks": result["total_chunks"],
                            "processed_chunks": result["processed_chunks"],
                            "failed_chunks": result["failed_chunks"],
                        })
                    continue

                # 更新ChromaDB
                for chunk, embedding in zip(batch, embeddings):
                    try:
                        vector_id = f"chunk_{chunk.library_id}_{chunk.id}"

                        # 删除旧的向量记录
                        try:
                            collection.delete(ids=[vector_id])
                        except Exception:
                            pass

                        # 获取资料库信息
                        library = next((lib for lib in libraries if lib.id == chunk.library_id), None)
                        if not library:
                            continue

                        # 插入新的向量
                        collection.upsert(
                            ids=[vector_id],
                            documents=[chunk.chunk_content],
                            embeddings=[embedding],
                            metadatas=[{
                                "chunk_db_id": str(chunk.id),
                                "library_id": str(chunk.library_id),
                                "library_name": library.library_name or "",
                                "chapter_path": chunk.chapter_path or "",
                                "chapter_title": chunk.chapter_title or "",
                                "industry": library.industry or "",
                                "project_type": library.project_type or "",
                                "industry_tags": ",".join([item.get("code", "") for item in (library.industry_tags or []) if item.get("code")]),
                                "project_type_tags": ",".join([item.get("code", "") for item in (library.project_type_tags or []) if item.get("code")]),
                                "user_id": str(user_id),
                                "embedding_model": model_info["model_name"],
                            }]
                        )

                        # 更新数据库中的向量信息
                        chunk.vector_id = vector_id
                        chunk.embedding_model = model_info["model_name"]
                        chunk.embedding_dimension = model_info["dimension"]

                        result["processed_chunks"] += 1

                    except Exception as e:
                        result["errors"].append(f"Chunk {chunk.id} 更新失败: {str(e)}")
                        result["failed_chunks"] += 1

                # 定期提交数据库更新
                if i % (batch_size * 5) == 0:
                    db.commit()
                if progress_callback:
                    handled = result["processed_chunks"] + result["failed_chunks"]
                    progress = 10 + int(90 * handled / max(result["total_chunks"], 1))
                    progress_callback({
                        "progress": min(99, progress),
                        "stage": "rebuilding",
                        "message": f"重建中：{handled}/{result['total_chunks']}",
                        "total_chunks": result["total_chunks"],
                        "processed_chunks": result["processed_chunks"],
                        "failed_chunks": result["failed_chunks"],
                    })

            db.commit()
            result["success"] = True
            result["elapsed_seconds"] = round(time.time() - start_time, 2)
            if progress_callback:
                progress_callback({
                    "progress": 100,
                    "stage": "done",
                    "message": "重建完成",
                    "total_chunks": result["total_chunks"],
                    "processed_chunks": result["processed_chunks"],
                    "failed_chunks": result["failed_chunks"],
                })

        except Exception as e:
            result["errors"].append(f"重建过程异常: {str(e)}")
            db.rollback()
            if progress_callback:
                progress_callback({
                    "progress": 100,
                    "stage": "failed",
                    "message": f"重建异常: {e}",
                    "total_chunks": result["total_chunks"],
                    "processed_chunks": result["processed_chunks"],
                    "failed_chunks": result["failed_chunks"],
                })

        return result

    @staticmethod
    def clear_vector_index(db: Session, user_id: int) -> Dict[str, Any]:
        """
        清空向量索引

        Args:
            db: 数据库会话
            user_id: 用户ID

        Returns:
            清空结果
        """
        result = {
            "success": False,
            "cleared_libraries": 0,
            "error": None,
        }

        try:
            # 获取用户的所有资料库
            libraries = db.query(TechnicalBidLibrary).filter(
                TechnicalBidLibrary.user_id == user_id
            ).all()

            library_ids = [lib.id for lib in libraries]

            # 删除ChromaDB中的向量
            collection = RagService._chroma_collection()
            if collection and library_ids:
                for library_id in library_ids:
                    try:
                        collection.delete(where={"library_id": str(library_id)})
                        result["cleared_libraries"] += 1
                    except Exception:
                        pass

            # 重置数据库中的向量信息
            if library_ids:
                db.query(TechnicalBidChunk).filter(
                    TechnicalBidChunk.library_id.in_(library_ids)
                ).update({
                    "vector_id": None,
                    "embedding_model": None,
                })
                db.commit()

            result["success"] = True

        except Exception as e:
            result["error"] = str(e)
            db.rollback()

        return result

    @staticmethod
    def get_vector_index_stats(db: Session, user_id: int) -> Dict[str, Any]:
        """
        获取向量索引统计信息

        Args:
            db: 数据库会话
            user_id: 用户ID

        Returns:
            统计信息
        """
        embedding_service = RagService._embedding_service()
        model_info = embedding_service.get_model_info()

        # 获取统计
        libraries = db.query(TechnicalBidLibrary).filter(
            TechnicalBidLibrary.user_id == user_id,
            TechnicalBidLibrary.status == "completed",
        ).all()

        library_ids = [lib.id for lib in libraries]
        total_chunks = 0
        indexed_chunks = 0

        if library_ids:
            chunks_query = db.query(TechnicalBidChunk).filter(
                TechnicalBidChunk.library_id.in_(library_ids)
            )
            total_chunks = chunks_query.count()
            indexed_chunks = chunks_query.filter(
                TechnicalBidChunk.vector_id.isnot(None)
            ).count()

        # 获取ChromaDB集合信息
        collection = RagService._chroma_collection()
        chroma_count = 0
        if collection:
            try:
                # 尝试获取用户数据的数量
                for library_id in library_ids:
                    try:
                        result = collection.get(
                            where={"library_id": str(library_id)},
                            limit=1,
                            include=["documents"]
                        )
                        chroma_count += len(result.get("ids", []))
                    except Exception:
                        pass
            except Exception:
                pass

        return {
            "model_name": model_info["model_name"],
            "model_type": model_info["model_type"],
            "dimension": model_info["dimension"],
            "is_real_embedding": model_info["is_real_embedding"],
            "cuda_available": model_info["cuda_available"],
            "model_loading": model_info.get("model_loading", False),
            "loading_state": model_info.get("loading_state", "idle"),
            "loading_progress": model_info.get("loading_progress", 0),
            "loading_stage": model_info.get("loading_stage", "idle"),
            "loading_message": model_info.get("loading_message", ""),
            "loading_candidate": model_info.get("loading_candidate", ""),
            "loading_errors": model_info.get("loading_errors", []),
            "loading_started_at": model_info.get("loading_started_at"),
            "loading_finished_at": model_info.get("loading_finished_at"),
            "total_libraries": len(libraries),
            "total_chunks": total_chunks,
            "indexed_chunks": indexed_chunks,
            "chroma_count": chroma_count,
            "needs_rebuild": indexed_chunks < total_chunks or model_info["model_name"] == "hash_embedding",
        }
