"""配置相关API路由"""
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from ..models.schemas import ConfigRequest, ConfigResponse, ModelListResponse
from ..models.models import User
from ..services.openai_service import OpenAIService
from ..services.auth_service import require_admin
from ..utils.config_manager import config_manager
from pydantic import BaseModel

router = APIRouter(prefix="/api/config", tags=["配置管理"])


class RagConfigRequest(BaseModel):
    """RAG配置请求"""
    similarity_threshold: Optional[float] = None
    top_k: Optional[int] = None


class RagConfigResponse(BaseModel):
    """RAG配置响应"""
    similarity_threshold: float
    top_k: int


@router.post("/save", response_model=ConfigResponse)
async def save_config(
    config: ConfigRequest,
    current_user: User = Depends(require_admin),
):
    """保存OpenAI配置"""
    try:
        success = config_manager.save_config(
            api_key=config.api_key,
            base_url=config.base_url,
            model_name=config.model_name,
            ocr_model=config.ocr_model
        )
        
        if success:
            return ConfigResponse(success=True, message="配置保存成功")
        else:
            return ConfigResponse(success=False, message="配置保存失败")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"保存配置时发生错误: {str(e)}")


@router.get("/load", response_model=dict)
async def load_config(
    current_user: User = Depends(require_admin),
):
    """加载保存的配置"""
    try:
        config = config_manager.load_config()
        return config
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"加载配置时发生错误: {str(e)}")


@router.post("/models", response_model=ModelListResponse)
async def get_available_models(
    config: ConfigRequest,
    current_user: User = Depends(require_admin),
):
    """获取可用的模型列表"""
    try:
        if not config.api_key:
            return ModelListResponse(
                models=[],
                success=False,
                message="请先输入API Key"
            )

        # 临时保存配置以供OpenAI服务使用
        existing_config = config_manager.load_config()
        temp_saved = config_manager.save_config(
            api_key=config.api_key,
            base_url=config.base_url,
            model_name=config.model_name or existing_config.get("model_name"),
            ocr_model=config.ocr_model or existing_config.get("ocr_model")
        )

        if not temp_saved:
            return ModelListResponse(
                models=[],
                success=False,
                message="保存临时配置失败"
            )

        # 创建OpenAI服务实例
        openai_service = OpenAIService()
        
        # 获取模型列表
        models = await openai_service.get_available_models()
        
        return ModelListResponse(
            models=models,
            success=True,
            message=f"获取到 {len(models)} 个模型"
        )
        
    except Exception as e:
        return ModelListResponse(
            models=[],
            success=False,
            message=f"获取模型列表失败: {str(e)}"
        )


@router.post("/rag/save", response_model=ConfigResponse)
async def save_rag_config(
    config: RagConfigRequest,
    current_user: User = Depends(require_admin),
):
    """保存RAG配置"""
    try:
        # 参数验证
        if config.similarity_threshold is not None:
            if not (0.0 <= config.similarity_threshold <= 1.0):
                return ConfigResponse(success=False, message="相似度阈值必须在 0.0 到 1.0 之间")
        if config.top_k is not None:
            if not (1 <= config.top_k <= 20):
                return ConfigResponse(success=False, message="检索数量必须在 1 到 20 之间")

        success = config_manager.save_rag_config(
            similarity_threshold=config.similarity_threshold,
            top_k=config.top_k
        )

        if success:
            return ConfigResponse(success=True, message="RAG配置保存成功")
        else:
            return ConfigResponse(success=False, message="RAG配置保存失败")

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"保存RAG配置时发生错误: {str(e)}")


@router.get("/rag/load", response_model=RagConfigResponse)
async def load_rag_config(
    current_user: User = Depends(require_admin),
):
    """加载RAG配置"""
    try:
        config = config_manager.load_config()
        return RagConfigResponse(
            similarity_threshold=config.get("rag_similarity_threshold", 0.15),
            top_k=config.get("rag_top_k", 5)
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"加载RAG配置时发生错误: {str(e)}")
