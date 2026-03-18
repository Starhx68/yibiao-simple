from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from ..models.schemas import FileUploadResponse
from ..models.models import User
from ..services.file_service import FileService
from ..utils import prompt_manager
from ..services.openai_service import OpenAIService
from ..services.auth_service import get_current_user

router = APIRouter(prefix="/api/expand", tags=["标书扩写"])


@router.post("/upload", response_model=FileUploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """上传文档文件并提取文本内容"""
    try:
        content_type = (file.content_type or "").lower()
        filename = (file.filename or "").lower()
        is_pdf = content_type == "application/pdf" or filename.endswith(".pdf")
        is_docx = (
            content_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            or filename.endswith(".docx")
        )
        if not is_pdf and not is_docx:
            return FileUploadResponse(
                success=False,
                message="不支持的文件类型，请上传PDF或Word文档"
            )
        
        # 处理文件并提取文本
        file_content = await FileService.process_uploaded_file(file)
        
        # 提取目录
        openai_service = OpenAIService()
        messages = [
            {"role": "system", "content": prompt_manager.read_expand_outline_prompt()},
            {"role": "user", "content": file_content}
        ]
        full_content = ""
        async for chunk in openai_service.stream_chat_completion(messages, temperature=0.7, response_format={"type": "json_object"}):
            full_content += chunk
        return FileUploadResponse(
            success=True,
            message=f"文件 {file.filename} 上传成功",
            file_content=file_content,
            old_outline=full_content
        )
        
    except Exception as e:
        return FileUploadResponse(
            success=False,
            message=f"文件处理失败: {str(e)}"
        )
