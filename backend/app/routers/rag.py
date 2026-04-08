from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.models import ImageModificationRecord, TechnicalBidChunk, TechnicalBidImage, TechnicalBidLibrary, TechnicalBidProject, User
from ..services.auth_service import get_current_user
from ..services.rag_service import RagService, get_default_rag_threshold
from ..services.embedding_service import get_embedding_service

router = APIRouter(prefix="/api/rag", tags=["RAG"])


@router.post("/library/upload")
async def upload_library_file(
    file: UploadFile = File(...),
    library_name: str | None = Form(None),
    industry: str | None = Form(None),
    project_type: str | None = Form(None),
    industry_codes: list[str] | None = Form(None),
    project_type_codes: list[str] | None = Form(None),
    auto_classify: bool = Form(True),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        library = await RagService.ingest_library_file(
            db=db,
            user_id=current_user.id,
            file=file,
            library_name=library_name or (file.filename or "历史技术标"),
            industry=industry,
            project_type=project_type,
            industry_codes=industry_codes,
            project_type_codes=project_type_codes,
            auto_classify=auto_classify,
        )
        return {
            "success": True,
            "library_id": library.id,
            "library_name": library.library_name,
            "status": library.status,
            "total_chunks": library.total_chunks,
            "industry_tags": library.industry_tags or [],
            "project_type_tags": library.project_type_tags or [],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"上传历史标书失败: {str(e)}")


@router.post("/library/upload-async")
async def upload_library_file_async(
    file: UploadFile = File(...),
    library_name: str | None = Form(None),
    industry: str | None = Form(None),
    project_type: str | None = Form(None),
    industry_codes: list[str] | None = Form(None),
    project_type_codes: list[str] | None = Form(None),
    auto_classify: bool = Form(True),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """异步上传：立即返回，文件在后台处理"""
    try:
        library = await RagService.ingest_library_file_async(
            db=db,
            user_id=current_user.id,
            file=file,
            library_name=library_name or (file.filename or "历史技术标"),
            industry=industry,
            project_type=project_type,
            industry_codes=industry_codes,
            project_type_codes=project_type_codes,
            auto_classify=auto_classify,
        )
        return {
            "success": True,
            "library_id": library.id,
            "library_name": library.library_name,
            "status": library.status,
            "message": "文件已开始后台处理",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"上传历史标书失败: {str(e)}")


@router.get("/library")
def list_libraries(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    industry: str | None = Query(None),
    status: str | None = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(TechnicalBidLibrary).filter(TechnicalBidLibrary.user_id == current_user.id)
    if industry:
        query = query.filter(TechnicalBidLibrary.industry == industry)
    if status:
        query = query.filter(TechnicalBidLibrary.status == status)
    total = query.count()
    rows = query.order_by(TechnicalBidLibrary.id.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "items": [
            {
                "id": row.id,
                "library_name": row.library_name,
                "industry": row.industry,
                "project_type": row.project_type,
                "industry_tags": row.industry_tags or [],
                "project_type_tags": row.project_type_tags or [],
                "file_name": row.file_name,
                "status": row.status,
                "total_chunks": row.total_chunks,
                "summary_chunks": row.summary_chunks,
                "total_pages": row.total_pages,
                "processing_duration": row.processing_duration,
                "error_msg": row.error_msg,
                "created_at": row.created_at,
            }
            for row in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/library/list")
def list_libraries_alias(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    industry: str | None = Query(None),
    status: str | None = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return list_libraries(
        page=page,
        page_size=page_size,
        industry=industry,
        status=status,
        current_user=current_user,
        db=db,
    )


@router.post("/classifications/bootstrap")
def bootstrap_classifications(
    payload: dict | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    force = bool((payload or {}).get("force", False))
    result = RagService.bootstrap_classification_catalog(db=db, force=force)
    return {"success": True, **result}


@router.get("/classifications")
def get_classifications(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    catalog = RagService.get_classification_catalog(db=db)
    return {"success": True, **catalog}


@router.get("/library/{library_id}/progress")
def get_library_progress(
    library_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    library = (
        db.query(TechnicalBidLibrary)
        .filter(
            TechnicalBidLibrary.id == library_id,
            TechnicalBidLibrary.user_id == current_user.id,
        )
        .first()
    )
    if not library:
        raise HTTPException(status_code=404, detail="资料库不存在")
    return {
        "library_id": library.id,
        "status": library.status,
        "progress": library.progress,
        "processed_chunks": library.processed_chunks,
        "total_chunks": library.total_chunks,
    }


@router.delete("/library/{library_id}")
def delete_library(
    library_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    library = (
        db.query(TechnicalBidLibrary)
        .filter(
            TechnicalBidLibrary.id == library_id,
            TechnicalBidLibrary.user_id == current_user.id,
        )
        .first()
    )
    if not library:
        raise HTTPException(status_code=404, detail="资料库不存在")
    RagService.delete_library_vectors(library_id=library.id, user_id=current_user.id)
    db.delete(library)
    db.commit()
    return {"success": True, "message": "删除成功"}


@router.post("/search")
def search_rag_chunks(
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = (payload.get("query") or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="query 不能为空")
    top_k_raw = payload.get("top_k")
    similarity_threshold_raw = payload.get("similarity_threshold")
    top_k = int(top_k_raw) if top_k_raw is not None else 5
    similarity_threshold = (
        float(similarity_threshold_raw)
        if similarity_threshold_raw is not None
        else get_default_rag_threshold()
    )
    items = RagService.search_chunks(
        db=db,
        user_id=current_user.id,
        query=query,
        top_k=max(1, min(top_k, 20)),
        industry=payload.get("industry"),
        project_type=payload.get("project_type"),
        similarity_threshold=max(0.0, min(similarity_threshold, 1.0)),
    )
    return {"items": items}


@router.get("/stats")
def rag_stats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    libraries = db.query(TechnicalBidLibrary).filter(TechnicalBidLibrary.user_id == current_user.id).all()
    library_ids = [item.id for item in libraries]
    total_chunks = 0
    if library_ids:
        total_chunks = (
            db.query(TechnicalBidChunk)
            .filter(TechnicalBidChunk.library_id.in_(library_ids))
            .count()
        )
    completed = [item for item in libraries if item.status == "completed"]
    return {
        "total_libraries": len(libraries),
        "completed_libraries": len(completed),
        "total_chunks": total_chunks,
    }


@router.get("/embedding-model/info")
def get_embedding_model_info(
    current_user: User = Depends(get_current_user),
):
    """
    获取当前向量嵌入模型的信息

    返回模型名称、类型、维度、是否使用真正的向量等信息
    """
    embedding_service = get_embedding_service()
    model_info = embedding_service.get_model_info()
    return {
        "success": True,
        "model_info": model_info,
    }


@router.get("/vector-index/stats")
def get_vector_index_stats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    获取向量索引统计信息

    返回当前向量模型、已索引的chunk数量、是否需要重建等信息
    """
    stats = RagService.get_vector_index_stats(db=db, user_id=current_user.id)
    return {
        "success": True,
        "stats": stats,
    }


@router.post("/vector-index/rebuild")
def rebuild_vector_index(
    payload: dict | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    重建向量索引

    参数:
    - library_id: 可选，指定资料库ID，不指定则重建所有
    - batch_size: 可选，批量处理大小，默认100
    """
    library_id = payload.get("library_id") if payload else None
    batch_size = int(payload.get("batch_size", 100)) if payload else 100

    result = RagService.start_rebuild_vector_index_task(
        db=db,
        user_id=current_user.id,
        library_id=library_id,
        batch_size=min(max(batch_size, 10), 500),  # 限制在10-500之间
    )
    return result


@router.get("/vector-index/rebuild/{task_id}")
def get_rebuild_vector_index_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    result = RagService.get_rebuild_vector_index_task_status(db=db, task_id=task_id, user_id=current_user.id)
    if not result:
        raise HTTPException(status_code=404, detail="重建任务不存在")
    return result


@router.post("/vector-index/clear")
def clear_vector_index(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    清空向量索引

    删除ChromaDB中的所有向量数据，并重置数据库中的向量信息
    """
    result = RagService.clear_vector_index(db=db, user_id=current_user.id)
    return {
        "success": result["success"],
        "cleared_libraries": result["cleared_libraries"],
        "error": result["error"],
    }


@router.post("/images/search")
def search_images(
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = (payload.get("query") or "").strip().lower()
    top_k = max(1, min(int(payload.get("top_k", 6)), 20))
    q = (
        db.query(TechnicalBidImage, TechnicalBidLibrary)
        .join(TechnicalBidLibrary, TechnicalBidImage.library_id == TechnicalBidLibrary.id)
        .filter(TechnicalBidLibrary.user_id == current_user.id)
    )
    if payload.get("library_id"):
        q = q.filter(TechnicalBidImage.library_id == int(payload["library_id"]))
    rows = q.order_by(TechnicalBidImage.id.desc()).limit(200).all()
    items = []
    for image, library in rows:
        title = (image.image_title or "").lower()
        desc = (image.image_description or "").lower()
        ocr = (image.ocr_text or "").lower()
        score = 0.0
        if query:
            if query in title:
                score += 0.45
            if query in desc:
                score += 0.35
            if query in ocr:
                score += 0.2
            if score <= 0:
                continue
        else:
            score = 0.5
        items.append({
            "image_id": image.id,
            "library_id": image.library_id,
            "library_name": library.library_name,
            "image_type": image.image_type,
            "image_title": image.image_title,
            "image_description": image.image_description,
            "thumbnail_url": image.thumbnail_url or image.original_url,
            "original_url": image.original_url,
            "chapter_path": image.chapter_path,
            "similarity": round(min(1.0, score), 4),
        })
    items.sort(key=lambda x: x["similarity"], reverse=True)
    return {"items": items[:top_k]}


@router.post("/images/{image_id}/adaptation-plan")
def create_image_adaptation_plan(
    image_id: int,
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    image_row = (
        db.query(TechnicalBidImage, TechnicalBidLibrary)
        .join(TechnicalBidLibrary, TechnicalBidImage.library_id == TechnicalBidLibrary.id)
        .filter(TechnicalBidImage.id == image_id, TechnicalBidLibrary.user_id == current_user.id)
        .first()
    )
    if not image_row:
        raise HTTPException(status_code=404, detail="图片不存在")
    image, library = image_row
    target_project_id = payload.get("project_id")
    if target_project_id:
        project = (
            db.query(TechnicalBidProject)
            .filter(TechnicalBidProject.id == target_project_id, TechnicalBidProject.user_id == current_user.id)
            .first()
        )
        if not project:
            raise HTTPException(status_code=404, detail="目标项目不存在")
    plan = {
        "retain_elements": payload.get("retain_elements", []),
        "replace_elements": payload.get("replace_elements", []),
        "new_labels": payload.get("new_labels", []),
        "style": payload.get("style", "technical-blueprint"),
        "target_resolution": payload.get("target_resolution", {"width": image.width or 1280, "height": image.height or 720}),
    }
    return {
        "image_id": image.id,
        "library_id": library.id,
        "project_id": target_project_id,
        "plan": plan,
        "estimated_marks": max(1, len(plan["replace_elements"]) + len(plan["new_labels"])),
    }


@router.post("/images/generate")
def generate_modified_image(
    payload: dict,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    source_image_id = payload.get("source_image_id")
    project_id = payload.get("project_id")
    if not source_image_id or not project_id:
        raise HTTPException(status_code=400, detail="source_image_id 和 project_id 为必填项")
    image_row = (
        db.query(TechnicalBidImage, TechnicalBidLibrary)
        .join(TechnicalBidLibrary, TechnicalBidImage.library_id == TechnicalBidLibrary.id)
        .filter(TechnicalBidImage.id == int(source_image_id), TechnicalBidLibrary.user_id == current_user.id)
        .first()
    )
    if not image_row:
        raise HTTPException(status_code=404, detail="源图片不存在")
    project = (
        db.query(TechnicalBidProject)
        .filter(TechnicalBidProject.id == project_id, TechnicalBidProject.user_id == current_user.id)
        .first()
    )
    if not project:
        raise HTTPException(status_code=404, detail="目标项目不存在")
    image, _ = image_row
    marks = payload.get("modification_marks", [])
    record = ImageModificationRecord(
        project_id=project_id,
        source_image_id=image.id,
        modification_type=payload.get("modification_type", "adaptation"),
        modification_reason=payload.get("modification_reason"),
        original_description=image.image_description,
        original_elements=image.analysis_result,
        modified_description=payload.get("modified_description") or image.image_description,
        modified_elements=payload.get("modified_elements"),
        modification_marks=marks,
        status="pending",
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return {
        "modification_id": record.id,
        "project_id": project_id,
        "source_image_id": image.id,
        "status": record.status,
        "marks_count": len(marks) if isinstance(marks, list) else 0,
        "preview_url": image.thumbnail_url or image.original_url,
    }
