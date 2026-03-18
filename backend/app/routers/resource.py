"""资料库管理路由"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date
import ast
import json
import io
import uuid
import re
import logging
import tempfile
import os
from PIL import Image, ImageOps

from ..database import get_db
from ..models.models import User, CompanyInfo, Qualification, Personnel, FinancialInfo, Performance
from ..models.schemas import (
    CompanyInfoCreate, CompanyInfoUpdate, CompanyInfoResponse,
    QualificationCreate, QualificationUpdate, QualificationResponse,
    PersonnelCreate, PersonnelUpdate, PersonnelResponse,
    FinancialInfoCreate, FinancialInfoUpdate, FinancialInfoResponse,
    PerformanceCreate, PerformanceUpdate, PerformanceResponse,
    PaginatedResponse
)
from ..services.auth_service import get_current_user, require_admin
from ..services.minio_service import MinioService
from ..services.openai_service import OpenAIService
from ..utils.config_manager import config_manager
from ..config import settings

router = APIRouter(prefix="/api/resource", tags=["资料库管理"])
logger = logging.getLogger(__name__)
_paddle_ocr_engine = None


def check_permission(current_user: User, target_user_id: int) -> bool:
    if current_user.role == "admin":
        return True
    return current_user.id == target_user_id


def extract_balanced_json_segment(text: str) -> Optional[str]:
    if not text:
        return None
    n = len(text)
    for start in range(n):
        ch = text[start]
        if ch not in "{[":
            continue
        stack: List[str] = []
        in_str = False
        quote = ""
        escape = False
        for i in range(start, n):
            c = text[i]
            if in_str:
                if escape:
                    escape = False
                elif c == "\\":
                    escape = True
                elif c == quote:
                    in_str = False
                continue
            if c == '"' or c == "'":
                in_str = True
                quote = c
            elif c == "{":
                stack.append("}")
            elif c == "[":
                stack.append("]")
            elif stack and c == stack[-1]:
                stack.pop()
                if not stack:
                    return text[start:i + 1]
    return None


def parse_ai_json_content(content: str):
    text = (content or "").strip()
    if not text:
        raise ValueError("empty")
    candidates = [text]
    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, flags=re.IGNORECASE)
    if fence_match:
        candidates.append(fence_match.group(1).strip())
    balanced = extract_balanced_json_segment(text)
    if balanced:
        candidates.append(balanced.strip())
    for candidate in candidates:
        try:
            return json.loads(candidate)
        except Exception:
            pass
        decoder = json.JSONDecoder()
        for idx, ch in enumerate(candidate):
            if ch not in "{[":
                continue
            try:
                parsed, _ = decoder.raw_decode(candidate[idx:])
                return parsed
            except Exception:
                continue
        try:
            parsed = ast.literal_eval(candidate)
            if isinstance(parsed, (dict, list)):
                return parsed
        except Exception:
            pass
    raise ValueError("invalid-json")


def normalize_ocr_data_to_dict(data):
    if isinstance(data, dict):
        return data
    if isinstance(data, str):
        try:
            nested = parse_ai_json_content(data)
            return normalize_ocr_data_to_dict(nested)
        except Exception:
            return {}
    if isinstance(data, list):
        if len(data) == 0:
            return {}
        if all(isinstance(item, dict) for item in data):
            merged = {}
            for item in data:
                merged.update(item)
            return merged
        obj = {}
        for item in data:
            if isinstance(item, dict):
                obj.update(item)
            elif isinstance(item, (list, tuple)) and len(item) == 2 and isinstance(item[0], str):
                obj[item[0]] = item[1]
        return obj
    return {}


def auto_orient_image(image_bytes: bytes, content_type: Optional[str], filename: Optional[str]):
    mime = (content_type or "").lower()
    name = (filename or "").lower()
    if not (mime.startswith("image/") or any(name.endswith(ext) for ext in [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"])):
        return image_bytes, content_type, (filename or "").split(".")[-1] if "." in (filename or "") else "bin"
    try:
        image = Image.open(io.BytesIO(image_bytes))
        oriented = ImageOps.exif_transpose(image)
        source_format = (oriented.format or image.format or "").upper()
        if source_format in {"JPG", "JPEG"}:
            save_format = "JPEG"
            save_ext = "jpg"
            save_mime = "image/jpeg"
            if oriented.mode not in ("RGB", "L"):
                oriented = oriented.convert("RGB")
        elif source_format == "PNG":
            save_format = "PNG"
            save_ext = "png"
            save_mime = "image/png"
        elif source_format == "WEBP":
            save_format = "WEBP"
            save_ext = "webp"
            save_mime = "image/webp"
        elif source_format in {"BMP"}:
            save_format = "BMP"
            save_ext = "bmp"
            save_mime = "image/bmp"
        elif source_format in {"TIFF", "TIF"}:
            save_format = "TIFF"
            save_ext = "tiff"
            save_mime = "image/tiff"
        else:
            save_format = "PNG"
            save_ext = "png"
            save_mime = "image/png"
        output = io.BytesIO()
        oriented.save(output, format=save_format)
        processed = output.getvalue()
        return processed, save_mime, save_ext
    except Exception as e:
        logger.warning(f"图片自动纠偏失败，继续使用原图: {str(e)}")
        return image_bytes, content_type, (filename or "").split(".")[-1] if "." in (filename or "") else "bin"


def count_filled_fields(data: dict, fields: List[str]) -> int:
    count = 0
    for key in fields:
        if key not in data:
            continue
        value = data.get(key)
        if value is None:
            continue
        if isinstance(value, str):
            text = value.strip()
            if not text:
                continue
            if text.lower() in {"null", "none", "n/a", "na", "unknown"}:
                continue
        count += 1
    return count


def keep_allowed_ocr_fields(data: dict, allowed_fields: List[str], url_field: str, uploaded_url: str) -> dict:
    result = {}
    for key in allowed_fields:
        if key not in data:
            continue
        value = data.get(key)
        if isinstance(value, str):
            text = value.strip()
            if not text:
                continue
            if text.lower() in {"null", "none", "n/a", "na", "unknown", "无法识别", "未识别"}:
                continue
            result[key] = text
        elif value is not None:
            result[key] = value
    result[url_field] = uploaded_url
    return result


def get_paddle_ocr_engine():
    global _paddle_ocr_engine
    if _paddle_ocr_engine is not None:
        return _paddle_ocr_engine
    try:
        from paddleocr import PaddleOCR
        import paddle
    except Exception as e:
        raise RuntimeError(f"未安装PaddleOCR依赖，请安装 paddleocr 与 paddlepaddle: {str(e)}")
    use_gpu = paddle.device.is_compiled_with_cuda()
    _paddle_ocr_engine = PaddleOCR(use_angle_cls=True, lang="ch", use_gpu=use_gpu)
    logger.info(f"PaddleOCR初始化完成，use_gpu={use_gpu}")
    return _paddle_ocr_engine


def extract_text_with_paddle_ocr(image_bytes: bytes, image_ext: str) -> str:
    ocr_engine = get_paddle_ocr_engine()
    suffix = f".{image_ext}" if image_ext else ".png"
    temp_path = ""
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(image_bytes)
            temp_path = tmp.name
        result = ocr_engine.ocr(temp_path, cls=True)
    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
    texts = []
    if isinstance(result, list):
        for page in result:
            if not isinstance(page, list):
                continue
            for item in page:
                if not isinstance(item, (list, tuple)) or len(item) < 2:
                    continue
                text_with_score = item[1]
                if not isinstance(text_with_score, (list, tuple)) or len(text_with_score) == 0:
                    continue
                text = str(text_with_score[0]).strip()
                if text:
                    texts.append(text)
    return "\n".join(texts)


@router.get("/company-info", response_model=Optional[CompanyInfoResponse])
def get_company_info(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    user_id = current_user.id if current_user.role != "admin" else None
    query = db.query(CompanyInfo)
    if user_id:
        query = query.filter(CompanyInfo.user_id == user_id)
    info = query.first()
    if not info:
        return None
    return CompanyInfoResponse.model_validate(info)


@router.post("/company-info", response_model=CompanyInfoResponse)
def create_or_update_company_info(
    data: CompanyInfoCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    existing = db.query(CompanyInfo).filter(CompanyInfo.user_id == current_user.id).first()
    
    if existing:
        update_data = data.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(existing, key, value)
        db.commit()
        db.refresh(existing)
        return CompanyInfoResponse.model_validate(existing)
    else:
        info = CompanyInfo(user_id=current_user.id, **data.model_dump())
        db.add(info)
        db.commit()
        db.refresh(info)
        return CompanyInfoResponse.model_validate(info)


@router.get("/qualifications", response_model=PaginatedResponse)
def list_qualifications(
    page: int = 1,
    page_size: int = 8,
    keyword: str = "",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(Qualification)
    
    if current_user.role != "admin":
        query = query.filter(Qualification.user_id == current_user.id)
    
    if keyword:
        query = query.filter(
            (Qualification.cert_name.contains(keyword)) |
            (Qualification.cert_number.contains(keyword))
        )
    
    total = query.count()
    items = query.order_by(Qualification.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    
    return PaginatedResponse(
        items=[QualificationResponse.model_validate(i) for i in items],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size
    )


@router.post("/qualifications", response_model=QualificationResponse)
def create_qualification(
    data: QualificationCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    item = Qualification(user_id=current_user.id, **data.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return QualificationResponse.model_validate(item)


@router.put("/qualifications/{item_id}", response_model=QualificationResponse)
def update_qualification(
    item_id: int,
    data: QualificationUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    item = db.query(Qualification).filter(Qualification.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="记录不存在")
    
    if not check_permission(current_user, item.user_id):
        raise HTTPException(status_code=403, detail="无权限操作")
    
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(item, key, value)
    
    db.commit()
    db.refresh(item)
    return QualificationResponse.model_validate(item)


@router.delete("/qualifications/{item_id}")
def delete_qualification(
    item_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    item = db.query(Qualification).filter(Qualification.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="记录不存在")
    
    if not check_permission(current_user, item.user_id):
        raise HTTPException(status_code=403, detail="无权限操作")
    
    db.delete(item)
    db.commit()
    return {"success": True, "message": "删除成功"}


@router.post("/qualifications/batch-delete")
def batch_delete_qualifications(
    ids: List[int],
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(Qualification).filter(Qualification.id.in_(ids))
    if current_user.role != "admin":
        query = query.filter(Qualification.user_id == current_user.id)
    
    query.delete(synchronize_session=False)
    db.commit()
    return {"success": True, "message": "批量删除成功"}


@router.get("/personnel", response_model=PaginatedResponse)
def list_personnel(
    page: int = 1,
    page_size: int = 8,
    keyword: str = "",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(Personnel)
    
    if current_user.role != "admin":
        query = query.filter(Personnel.user_id == current_user.id)
    
    if keyword:
        query = query.filter(
            (Personnel.name.contains(keyword)) |
            (Personnel.department.contains(keyword)) |
            (Personnel.position.contains(keyword))
        )
    
    total = query.count()
    items = query.order_by(Personnel.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    
    return PaginatedResponse(
        items=[PersonnelResponse.model_validate(i) for i in items],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size
    )


@router.post("/personnel", response_model=PersonnelResponse)
def create_personnel(
    data: PersonnelCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    item = Personnel(user_id=current_user.id, **data.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return PersonnelResponse.model_validate(item)


@router.put("/personnel/{item_id}", response_model=PersonnelResponse)
def update_personnel(
    item_id: int,
    data: PersonnelUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    item = db.query(Personnel).filter(Personnel.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="记录不存在")
    
    if not check_permission(current_user, item.user_id):
        raise HTTPException(status_code=403, detail="无权限操作")
    
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(item, key, value)
    
    db.commit()
    db.refresh(item)
    return PersonnelResponse.model_validate(item)


@router.delete("/personnel/{item_id}")
def delete_personnel(
    item_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    item = db.query(Personnel).filter(Personnel.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="记录不存在")
    
    if not check_permission(current_user, item.user_id):
        raise HTTPException(status_code=403, detail="无权限操作")
    
    db.delete(item)
    db.commit()
    return {"success": True, "message": "删除成功"}


@router.post("/personnel/batch-delete")
def batch_delete_personnel(
    ids: List[int],
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(Personnel).filter(Personnel.id.in_(ids))
    if current_user.role != "admin":
        query = query.filter(Personnel.user_id == current_user.id)
    
    query.delete(synchronize_session=False)
    db.commit()
    return {"success": True, "message": "批量删除成功"}


@router.get("/financial-info", response_model=PaginatedResponse)
def list_financial_info(
    page: int = 1,
    page_size: int = 8,
    keyword: str = "",
    info_type: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(FinancialInfo)
    
    if current_user.role != "admin":
        query = query.filter(FinancialInfo.user_id == current_user.id)
    
    if keyword:
        query = query.filter(FinancialInfo.info_name.contains(keyword))
    
    if info_type:
        query = query.filter(FinancialInfo.info_type == info_type)
    
    total = query.count()
    items = query.order_by(FinancialInfo.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    
    return PaginatedResponse(
        items=[FinancialInfoResponse.model_validate(i) for i in items],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size
    )


@router.post("/financial-info", response_model=FinancialInfoResponse)
def create_financial_info(
    data: FinancialInfoCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    item = FinancialInfo(user_id=current_user.id, **data.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return FinancialInfoResponse.model_validate(item)


@router.put("/financial-info/{item_id}", response_model=FinancialInfoResponse)
def update_financial_info(
    item_id: int,
    data: FinancialInfoUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    item = db.query(FinancialInfo).filter(FinancialInfo.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="记录不存在")
    
    if not check_permission(current_user, item.user_id):
        raise HTTPException(status_code=403, detail="无权限操作")
    
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(item, key, value)
    
    db.commit()
    db.refresh(item)
    return FinancialInfoResponse.model_validate(item)


@router.delete("/financial-info/{item_id}")
def delete_financial_info(
    item_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    item = db.query(FinancialInfo).filter(FinancialInfo.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="记录不存在")
    
    if not check_permission(current_user, item.user_id):
        raise HTTPException(status_code=403, detail="无权限操作")
    
    db.delete(item)
    db.commit()
    return {"success": True, "message": "删除成功"}


@router.post("/financial-info/batch-delete")
def batch_delete_financial_info(
    ids: List[int],
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(FinancialInfo).filter(FinancialInfo.id.in_(ids))
    if current_user.role != "admin":
        query = query.filter(FinancialInfo.user_id == current_user.id)
    
    query.delete(synchronize_session=False)
    db.commit()
    return {"success": True, "message": "批量删除成功"}


@router.get("/performances", response_model=PaginatedResponse)
def list_performances(
    page: int = 1,
    page_size: int = 8,
    keyword: str = "",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(Performance)
    
    if current_user.role != "admin":
        query = query.filter(Performance.user_id == current_user.id)
    
    if keyword:
        query = query.filter(
            (Performance.project_name.contains(keyword)) |
            (Performance.client_name.contains(keyword))
        )
    
    total = query.count()
    items = query.order_by(Performance.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    
    return PaginatedResponse(
        items=[PerformanceResponse.model_validate(i) for i in items],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size
    )


@router.post("/performances", response_model=PerformanceResponse)
def create_performance(
    data: PerformanceCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    item = Performance(user_id=current_user.id, **data.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return PerformanceResponse.model_validate(item)


@router.put("/performances/{item_id}", response_model=PerformanceResponse)
def update_performance(
    item_id: int,
    data: PerformanceUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    item = db.query(Performance).filter(Performance.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="记录不存在")
    
    if not check_permission(current_user, item.user_id):
        raise HTTPException(status_code=403, detail="无权限操作")
    
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(item, key, value)
    
    db.commit()
    db.refresh(item)
    return PerformanceResponse.model_validate(item)


@router.delete("/performances/{item_id}")
def delete_performance(
    item_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    item = db.query(Performance).filter(Performance.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="记录不存在")
    
    if not check_permission(current_user, item.user_id):
        raise HTTPException(status_code=403, detail="无权限操作")
    
    db.delete(item)
    db.commit()
    return {"success": True, "message": "删除成功"}


@router.post("/performances/batch-delete")
def batch_delete_performances(
    ids: List[int],
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    query = db.query(Performance).filter(Performance.id.in_(ids))
    if current_user.role != "admin":
        query = query.filter(Performance.user_id == current_user.id)
    
    query.delete(synchronize_session=False)
    db.commit()
    return {"success": True, "message": "批量删除成功"}


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user)
):
    minio_service = MinioService()
    file_url = await minio_service.upload_file(file, current_user.id)
    return {"success": True, "url": file_url}


@router.post("/ocr/{scene}")
async def smart_fill_from_image(
    scene: str,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    allowed_scenes = {"company", "qualification", "personnel", "financial", "performance"}
    if scene not in allowed_scenes:
        raise HTTPException(status_code=400, detail="不支持的识别场景")

    config = config_manager.load_config()
    if not config.get("api_key"):
        raise HTTPException(status_code=400, detail="请先配置OpenAI API密钥")

    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="图片内容为空")
    image_bytes, image_content_type, image_ext = auto_orient_image(image_bytes, file.content_type, file.filename)

    minio_service = MinioService()
    object_name = f"{settings.minio_object_prefix}/{current_user.id}/{uuid.uuid4()}.{image_ext}"
    minio_service.client.put_object(
        minio_service.bucket_name,
        object_name,
        io.BytesIO(image_bytes),
        len(image_bytes),
        content_type=image_content_type,
    )
    if settings.minio_public_base_url:
        uploaded_url = f"{settings.minio_public_base_url}/{minio_service.bucket_name}/{object_name}"
    else:
        uploaded_url = minio_service.get_file_url(object_name)

    try:
        local_ocr_text = extract_text_with_paddle_ocr(image_bytes, image_ext)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"本地PaddleOCR识别失败: {str(e)}")
    if not local_ocr_text.strip():
        raise HTTPException(status_code=422, detail="本地PaddleOCR未识别到文本，请上传更清晰且正向的图片")

    field_map = {
        "company": {
            "image_url_field": "business_license_url",
            "fields": [
                "company_name",
                "legal_person",
                "legal_person_id_number",
                "registered_capital",
                "establish_date",
                "address",
                "business_scope",
                "credit_code",
                "contact_person",
                "contact_phone",
                "contact_email",
                "authorized_person",
                "authorized_person_id_number",
                "authorized_person_phone",
                "bank_name",
                "bank_branch",
                "bank_account_name",
                "bank_account",
                "bank_address",
            ],
            "hint": "营业执照/公司基本信息",
        },
        "qualification": {
            "image_url_field": "cert_image_url",
            "fields": [
                "cert_name",
                "cert_number",
                "cert_level",
                "issue_org",
                "issue_date",
                "valid_start_date",
                "valid_end_date",
                "remark",
            ],
            "hint": "资质证书",
        },
        "personnel": {
            "image_url_field": "photo_url",
            "fields": [
                "name",
                "gender",
                "id_number",
                "phone",
                "email",
                "department",
                "position",
                "education",
                "major",
                "work_years",
                "cert_name",
                "cert_number",
                "cert_valid_date",
                "remark",
            ],
            "hint": "人员证件/简历/证书/照片",
        },
        "financial": {
            "image_url_field": "file_url",
            "fields": ["info_type", "info_name", "info_date", "amount", "remark"],
            "hint": "财务资料（审计/社保/纳税等证明）",
        },
        "performance": {
            "image_url_field": "contract_url",
            "fields": [
                "project_name",
                "project_type",
                "client_name",
                "client_contact",
                "client_phone",
                "contract_number",
                "contract_amount",
                "start_date",
                "end_date",
                "project_location",
                "project_scale",
                "project_content",
                "completion_status",
                "acceptance_status",
                "remark",
            ],
            "hint": "业绩资料（合同/验收等）",
        },
    }

    scene_def = field_map[scene]
    output_fields = scene_def["fields"]
    url_field = scene_def["image_url_field"]

    openai_service = OpenAIService()

    async def infer_fields_with_llm(raw_text: str, prefer_model: Optional[str] = None, strict_mode: bool = False):
        if not raw_text or not raw_text.strip():
            return {}, 0
        candidate_models = []
        if prefer_model:
            candidate_models.append(prefer_model)
        if openai_service.model_name not in candidate_models:
            candidate_models.append(openai_service.model_name)
        last_error = ""
        for model_name in candidate_models:
            try:
                infer_system_prompt = (
                    "你是资料字段推理助手。你会收到OCR原始输出，内容可能是自然语言、键值碎片、数组、坐标或混杂文本。"
                    "请结合上下文智能推理，提取可确认的结构化字段。"
                    "只输出一个JSON对象，不要输出解释、Markdown或代码块。"
                    "严格限制字段范围，不允许返回范围外字段。"
                    "日期统一为YYYY-MM-DD；金额/数值输出数字。无法确认的字段不要输出。"
                )
                if strict_mode:
                    infer_user_prompt = (
                        f"识别场景：{scene_def['hint']}\n"
                        f"必须输出字段：{', '.join(output_fields)}，以及字段 {url_field}\n"
                        f"{url_field} 的值固定为：{uploaded_url}\n"
                        f"OCR原始输出：\n{raw_text}\n"
                        "请基于原始输出智能推理，尽可能填充字段；无法确认的字段可省略。"
                    )
                else:
                    infer_user_prompt = (
                        f"识别场景：{scene_def['hint']}\n"
                        f"允许输出字段：{', '.join(output_fields)}，以及字段 {url_field}\n"
                        f"{url_field} 的值固定为：{uploaded_url}\n"
                        f"OCR原始输出：\n{raw_text}\n"
                        "请基于原始输出进行智能推理并返回JSON对象。"
                    )
                infer_resp = await openai_service.client.chat.completions.create(
                    model=model_name,
                    messages=[
                        {"role": "system", "content": infer_system_prompt},
                        {"role": "user", "content": infer_user_prompt},
                    ],
                    temperature=0,
                    response_format={"type": "json_object"},
                )
                infer_content = (infer_resp.choices[0].message.content or "").strip()
                parsed = parse_ai_json_content(infer_content)
                normalized = normalize_ocr_data_to_dict(parsed)
                if not isinstance(normalized, dict):
                    normalized = {}
                filtered = keep_allowed_ocr_fields(normalized, output_fields, url_field, uploaded_url)
                filled_count = count_filled_fields(filtered, output_fields)
                if filled_count > 0:
                    return filtered, filled_count
            except Exception as e:
                last_error = str(e)
                continue
        if last_error:
            logger.warning(f"OCR二次推理失败，scene={scene}, err={last_error[:600]}")
        return {}, 0

    try:
        data, filled_count = await infer_fields_with_llm(local_ocr_text, openai_service.model_name, False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"智能填充失败: {str(e)}")

    if filled_count == 0:
        logger.warning(f"PaddleOCR识别后未提取出有效字段，scene={scene}, text={local_ocr_text[:1200]}")
        try:
            strict_data, strict_count = await infer_fields_with_llm(local_ocr_text, openai_service.model_name, True)
            data = strict_data
            filled_count = strict_count
        except Exception as strict_error:
            logger.warning(f"字段严格推理失败，scene={scene}, err={str(strict_error)[:600]}")
        if filled_count == 0:
            raise HTTPException(status_code=422, detail="本地PaddleOCR已识别文本，但未提取到可填充字段，请检查图片内容或补充手动填写")

    return data
