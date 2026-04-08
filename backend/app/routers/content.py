"""内容相关API路由"""
import time
from fastapi import APIRouter, HTTPException, Depends
from ..models.schemas import ContentGenerationRequest, ChapterContentRequest
from ..models.models import TechnicalBidConstraint, TechnicalBidLibrary, TechnicalBidProject, User
from ..services.auth_service import get_current_user
from ..services.openai_service import OpenAIService
from ..services.rag_service import RagService
from ..routers.technical_bid import _build_constraints_payload, _estimate_citation, _save_citation_metrics
from ..utils.config_manager import config_manager
from ..utils.sse import sse_response
from ..database import get_db
from sqlalchemy.orm import Session
import json

router = APIRouter(prefix="/api/content", tags=["内容管理"])


def _load_generation_context(request: ChapterContentRequest, current_user: User, db: Session):
    parent_text = "\n".join([f"- {p.get('id', '')} {p.get('title', '')} {p.get('description', '')}" for p in (request.parent_chapters or [])])
    sibling_text = "\n".join([
        f"- {s.get('id', '')} {s.get('title', '')} {s.get('description', '')}"
        for s in (request.sibling_chapters or [])
        if s.get("id") != request.chapter.get("id")
    ])
    previous_summary = RagService.get_previous_summary(db, request.project_id or "", limit=5) if request.project_id else ""
    project = None
    tech_requirements_text = ""
    constraints_rows = []
    constraints_text = "无"
    if request.project_id:
        project = (
            db.query(TechnicalBidProject)
            .filter(TechnicalBidProject.id == request.project_id, TechnicalBidProject.user_id == current_user.id)
            .first()
        )
        if not project:
            raise HTTPException(status_code=404, detail="项目不存在")
        tech_requirements_text = (project.tech_requirements or project.file_content or "").strip()
        if tech_requirements_text:
            tech_requirements_text = tech_requirements_text[:6000]
        constraints_rows = db.query(TechnicalBidConstraint).filter(TechnicalBidConstraint.project_id == request.project_id).all()
        constraints_map, _ = _build_constraints_payload(constraints_rows)
        if constraints_map:
            constraints_text = json.dumps(constraints_map, ensure_ascii=False)
    return project, tech_requirements_text, constraints_rows, constraints_text, previous_summary, parent_text, sibling_text


def _build_generation_messages(
    request: ChapterContentRequest,
    tech_requirements_text: str,
    constraints_text: str,
    previous_summary: str,
    parent_text: str,
    sibling_text: str,
    rag_context: str,
):
    system_prompt = """你是专业技术标写作专家。请按以下优先级生成当前章节正文：
1. 招标文件技术要求、评分标准和强制性规范优先级最高，必须严格满足
2. 项目技术约束和已生成章节的一致性次之，禁止出现冲突或自相矛盾
3. 在不违背前两项的前提下，优先吸收RAG检索资料中的成熟方案、写法、术语和结构
4. 如果RAG资料与招标文件要求或技术约束冲突，必须放弃冲突内容并按招标要求改写
5. 没有依据时使用合规、稳妥的表述，不编造不存在的产品、参数、案例或承诺

输出要求：
1. 只输出正文，不输出标题
2. 语气正式，条理清晰，符合技术标写作
3. 与同级章节避免重复，和上级章节保持逻辑衔接
4. 引用历史资料时要结合当前项目要求进行适配，不能照抄"""
    user_prompt = f"""项目概述：
{request.project_overview or ""}

招标文件技术要求：
{tech_requirements_text or "无"}

当前章节：
ID: {request.chapter.get('id', '')}
标题: {request.chapter.get('title', '')}
描述: {request.chapter.get('description', '')}

上级章节：
{parent_text or "无"}

同级章节：
{sibling_text or "无"}

已生成摘要：
{previous_summary or "无"}

项目技术约束：
{constraints_text or "无"}

RAG检索资料：
{rag_context or "无"}

请生成章节正文。若存在RAG资料，请优先参考其中与当前项目匹配且不违背招标要求、技术约束的内容；若RAG资料不足或冲突，则以招标文件技术要求为准。"""
    return system_prompt, user_prompt


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


@router.post("/generate-chapter")
async def generate_chapter_content(
    request: ChapterContentRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """为单个章节生成内容"""
    try:
        # 加载配置
        config = config_manager.load_config()
        
        if not config.get('api_key'):
            raise HTTPException(status_code=400, detail="请先配置OpenAI API密钥")

        # 创建OpenAI服务实例
        openai_service = OpenAIService()
        project, tech_requirements_text, constraints_rows, constraints_text, previous_summary, parent_text, sibling_text = _load_generation_context(request, current_user, db)
        effective_use_rag = bool(request.use_rag or _has_usable_rag_libraries(db, current_user.id))
        
        content = ""
        retrieved_chunks = []
        retrieval_time = 0
        generation_start = time.time()
        query_text = RagService.build_chapter_query(request.chapter, request.project_overview)
        if effective_use_rag:
            retrieval_start = time.time()
            rag_top_k = request.rag_top_k if request.rag_top_k is not None else 5
            rag_similarity_threshold = request.rag_similarity_threshold if request.rag_similarity_threshold is not None else 0.6
            retrieved_chunks = RagService.search_chunks(
                db=db,
                user_id=current_user.id,
                query=query_text,
                top_k=max(1, min(int(rag_top_k), 20)),
                industry=request.industry,
                project_type=request.project_type,
                similarity_threshold=max(0.0, min(float(rag_similarity_threshold), 1.0)),
            )
            retrieval_time = int((time.time() - retrieval_start) * 1000)
            rag_context = "\n\n".join([
                f"[资料{i + 1}] 来源:{item.get('library_name')} 章节:{item.get('chapter_title')}\n{item.get('content')}"
                for i, item in enumerate(retrieved_chunks)
            ])
            system_prompt, user_prompt = _build_generation_messages(
                request,
                tech_requirements_text,
                constraints_text,
                previous_summary,
                parent_text,
                sibling_text,
                rag_context,
            )
            messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}]
            async for chunk in openai_service.stream_chat_completion(messages, temperature=0.5):
                content += chunk
        else:
            system_prompt, user_prompt = _build_generation_messages(
                request,
                tech_requirements_text,
                constraints_text,
                previous_summary,
                parent_text,
                sibling_text,
                "",
            )
            messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}]
            async for chunk in openai_service.stream_chat_completion(messages, temperature=0.5):
                content += chunk
        generation_time = int((time.time() - generation_start) * 1000)
        if effective_use_rag and request.project_id:
            RagService.save_generation_log(
                db=db,
                project_id=request.project_id,
                chapter_id=request.chapter.get("id", "unknown"),
                query_text=query_text,
                retrieved_chunks=retrieved_chunks,
                llm_model=config.get("model_name", "unknown"),
                llm_response=content,
                retrieval_time=retrieval_time,
                generation_time=generation_time,
                used_rag=bool(retrieved_chunks),
            )
            citation = _estimate_citation(content, retrieved_chunks)
            _save_citation_metrics(
                db=db,
                project_id=request.project_id,
                chapter_id=request.chapter.get("id", "unknown"),
                chapter_title=request.chapter.get("title", request.chapter.get("id", "unknown")),
                metrics=citation,
                retrieved_chunks=retrieved_chunks,
            )
        
        return {"success": True, "content": content}
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"章节内容生成失败: {str(e)}")


@router.post("/generate-chapter-stream")
async def generate_chapter_content_stream(
    request: ChapterContentRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """流式为单个章节生成内容"""
    try:
        # 加载配置
        config = config_manager.load_config()
        
        if not config.get('api_key'):
            raise HTTPException(status_code=400, detail="请先配置OpenAI API密钥")

        # 创建OpenAI服务实例
        openai_service = OpenAIService()
        project, tech_requirements_text, constraints_rows, constraints_text, previous_summary, parent_text, sibling_text = _load_generation_context(request, current_user, db)
        effective_use_rag = bool(request.use_rag or _has_usable_rag_libraries(db, current_user.id))
        
        async def generate():
            try:
                # 发送开始信号
                yield f"data: {json.dumps({'status': 'started', 'message': '开始生成章节内容...'}, ensure_ascii=False)}\n\n"
                
                # 流式生成章节内容
                full_content = ""
                retrieved_chunks = []
                retrieval_time = 0
                generation_start = time.time()
                query_text = RagService.build_chapter_query(request.chapter, request.project_overview)
                if effective_use_rag:
                    retrieval_start = time.time()
                    rag_top_k = request.rag_top_k if request.rag_top_k is not None else 5
                    rag_similarity_threshold = request.rag_similarity_threshold if request.rag_similarity_threshold is not None else 0.6
                    retrieved_chunks = RagService.search_chunks(
                        db=db,
                        user_id=current_user.id,
                        query=query_text,
                        top_k=max(1, min(int(rag_top_k), 20)),
                        industry=request.industry,
                        project_type=request.project_type,
                        similarity_threshold=max(0.0, min(float(rag_similarity_threshold), 1.0)),
                    )
                    retrieval_time = int((time.time() - retrieval_start) * 1000)
                    yield f"data: {json.dumps({'status': 'rag_retrieved', 'count': len(retrieved_chunks), 'items': retrieved_chunks}, ensure_ascii=False)}\n\n"
                    rag_context = "\n\n".join([
                        f"[资料{i + 1}] 来源:{item.get('library_name')} 章节:{item.get('chapter_title')}\n{item.get('content')}"
                        for i, item in enumerate(retrieved_chunks)
                    ])
                    system_prompt, user_prompt = _build_generation_messages(
                        request,
                        tech_requirements_text,
                        constraints_text,
                        previous_summary,
                        parent_text,
                        sibling_text,
                        rag_context,
                    )
                    messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}]
                    async for chunk in openai_service.stream_chat_completion(messages, temperature=0.5):
                        full_content += chunk
                        yield f"data: {json.dumps({'status': 'streaming', 'content': chunk, 'full_content': full_content}, ensure_ascii=False)}\n\n"
                else:
                    system_prompt, user_prompt = _build_generation_messages(
                        request,
                        tech_requirements_text,
                        constraints_text,
                        previous_summary,
                        parent_text,
                        sibling_text,
                        "",
                    )
                    messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}]
                    async for chunk in openai_service.stream_chat_completion(messages, temperature=0.5):
                        full_content += chunk
                        yield f"data: {json.dumps({'status': 'streaming', 'content': chunk, 'full_content': full_content}, ensure_ascii=False)}\n\n"
                generation_time = int((time.time() - generation_start) * 1000)
                if effective_use_rag and request.project_id:
                    RagService.save_generation_log(
                        db=db,
                        project_id=request.project_id,
                        chapter_id=request.chapter.get("id", "unknown"),
                        query_text=query_text,
                        retrieved_chunks=retrieved_chunks,
                        llm_model=config.get("model_name", "unknown"),
                        llm_response=full_content,
                        retrieval_time=retrieval_time,
                        generation_time=generation_time,
                        used_rag=bool(retrieved_chunks),
                    )
                    citation = _estimate_citation(full_content, retrieved_chunks)
                    _save_citation_metrics(
                        db=db,
                        project_id=request.project_id,
                        chapter_id=request.chapter.get("id", "unknown"),
                        chapter_title=request.chapter.get("title", request.chapter.get("id", "unknown")),
                        metrics=citation,
                        retrieved_chunks=retrieved_chunks,
                    )
                
                # 发送完成信号
                yield f"data: {json.dumps({'status': 'completed', 'content': full_content}, ensure_ascii=False)}\n\n"
                
            except Exception as e:
                # 发送错误信息
                yield f"data: {json.dumps({'status': 'error', 'message': str(e)}, ensure_ascii=False)}\n\n"
            
            # 发送结束信号
            yield "data: [DONE]\n\n"
        
        return sse_response(generate())
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"章节内容生成失败: {str(e)}")
