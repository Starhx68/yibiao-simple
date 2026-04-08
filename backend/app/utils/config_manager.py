"""配置管理工具"""
import os
from typing import Dict, Optional
from dotenv import load_dotenv, set_key


class ConfigManager:
    """用户配置管理器"""

    def __init__(self):
        backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        self.env_path = os.path.join(backend_dir, ".env")
        self.api_key_name = "OPENAI_API_KEY"
        self.base_url_name = "OPENAI_BASE_URL"
        self.model_name_key = "OPENAI_MODEL"
        self.ocr_model_key = "OPENAI_OCR_MODEL"
        # RAG配置项
        self.rag_threshold_name = "RAG_SIMILARITY_THRESHOLD"
        self.rag_top_k_name = "RAG_TOP_K"
        load_dotenv(self.env_path, override=True)

    def load_config(self) -> Dict:
        """从.env文件加载配置"""
        load_dotenv(self.env_path, override=True)
        return {
            "api_key": os.getenv(self.api_key_name, ""),
            "base_url": os.getenv(self.base_url_name, ""),
            "model_name": os.getenv(self.model_name_key, "gpt-3.5-turbo"),
            "ocr_model": os.getenv(self.ocr_model_key, ""),
            "rag_similarity_threshold": float(os.getenv(self.rag_threshold_name, "0.15")),
            "rag_top_k": int(os.getenv(self.rag_top_k_name, "5")),
        }

    def save_config(self, api_key: str, base_url: Optional[str], model_name: Optional[str], ocr_model: Optional[str]) -> bool:
        """保存配置到.env文件"""
        try:
            if not os.path.exists(self.env_path):
                with open(self.env_path, "w", encoding="utf-8") as f:
                    f.write("")
            current_config = self.load_config()
            model_value = model_name or current_config.get("model_name", "gpt-3.5-turbo")
            base_url_value = base_url if base_url is not None else current_config.get("base_url", "")
            ocr_model_value = ocr_model or current_config.get("ocr_model", "")
            set_key(self.env_path, self.api_key_name, api_key)
            set_key(self.env_path, self.base_url_name, base_url_value)
            set_key(self.env_path, self.model_name_key, model_value)
            set_key(self.env_path, self.ocr_model_key, ocr_model_value)
            return True
        except Exception:
            return False

    def save_rag_config(self, similarity_threshold: Optional[float] = None, top_k: Optional[int] = None) -> bool:
        """保存RAG配置到.env文件"""
        try:
            if not os.path.exists(self.env_path):
                with open(self.env_path, "w", encoding="utf-8") as f:
                    f.write("")
            current_config = self.load_config()
            threshold = similarity_threshold if similarity_threshold is not None else current_config.get("rag_similarity_threshold", 0.15)
            k_value = top_k if top_k is not None else current_config.get("rag_top_k", 5)
            set_key(self.env_path, self.rag_threshold_name, str(threshold))
            set_key(self.env_path, self.rag_top_k_name, str(k_value))
            return True
        except Exception:
            return False


# 全局配置管理器实例
config_manager = ConfigManager()
