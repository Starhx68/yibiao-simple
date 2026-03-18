"""应用配置管理"""
try:
    from pydantic_settings import BaseSettings, SettingsConfigDict
except ImportError:
    from pydantic import BaseSettings
    SettingsConfigDict = None
from typing import Optional
import os


class Settings(BaseSettings):
    """应用设置"""
    app_name: str = "海新屹AI标书"
    app_version: str = "1.0.0"
    debug: bool = False
    
    # CORS设置
    cors_origins: list = [
        "http://localhost:3000", 
        "http://127.0.0.1:3000",
        "http://localhost:3001", 
        "http://127.0.0.1:3001",
        "http://localhost:3002", 
        "http://127.0.0.1:3002",
        "http://localhost:3003", 
        "http://127.0.0.1:3003",
        "http://localhost:3004", 
        "http://127.0.0.1:3004"
    ]
    cors_origin_regex: str = r"^https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)(:\d+)?$"
    
    # 文件上传设置
    max_file_size: int = 10 * 1024 * 1024  # 10MB
    upload_dir: str = "uploads"
    
    # OpenAI默认设置
    default_model: str = "gpt-3.5-turbo"
    openai_api_key: Optional[str] = None
    openai_base_url: Optional[str] = None
    openai_model: Optional[str] = None
    minio_endpoint: str = "127.0.0.1:9000"
    minio_access_key: Optional[str] = None
    minio_secret_key: Optional[str] = None
    minio_bucket: str = "yibiao-images"
    minio_secure: bool = False
    minio_public_base_url: Optional[str] = None
    minio_presigned_expire_seconds: int = 604800
    minio_object_prefix: str = "document-images"
    
    if SettingsConfigDict:
        model_config = SettingsConfigDict(env_file=".env", extra="allow")
    else:
        class Config:
            env_file = ".env"
            extra = "allow"


# 全局设置实例
settings = Settings()

# 确保上传目录存在
os.makedirs(settings.upload_dir, exist_ok=True)
