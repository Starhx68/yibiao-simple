"""
向量嵌入服务 - 支持真正的语义向量模型

支持多种模型：
1. bge-large-zh-v1.5 (推荐) - 1024维，GPU加速
2. bge-small-zh-v1.5 - 512维，轻量级
3. text2vec-base-chinese - 768维，CPU友好
4. 降级方案：hash embedding（当模型不可用时）
"""

import os
import hashlib
import math
import logging
import threading
import time
from functools import lru_cache
from pathlib import Path
from typing import List, Optional, Tuple

from ..config import settings

logger = logging.getLogger(__name__)


class EmbeddingService:
    """
    向量嵌入服务 - 单例模式

    支持延迟加载和线程安全的模型初始化
    """

    _instance = None
    _lock = threading.Lock()
    _model = None
    _model_name = None
    _model_type = None  # 'sentence_transformer', 'flag_embedding', 'hash'

    # 模型配置
    MODEL_CONFIGS = {
        "bge-large-zh-v1.5": {
            "dimension": 1024,
            "type": "sentence_transformer",
            "repo": "BAAI/bge-large-zh-v1.5",
            "max_length": 512,
            "description": "最佳中文语义模型，推荐GPU环境",
        },
        "bge-small-zh-v1.5": {
            "dimension": 512,
            "type": "sentence_transformer",
            "repo": "BAAI/bge-small-zh-v1.5",
            "max_length": 512,
            "description": "轻量级中文模型，CPU友好",
        },
        "text2vec-base-chinese": {
            "dimension": 768,
            "type": "sentence_transformer",
            "repo": "shibing624/text2vec-base-chinese",
            "max_length": 256,
            "description": "中文文本向量化模型",
        },
        "bge-m3": {
            "dimension": 1024,
            "type": "flag_embedding",
            "repo": "BAAI/bge-m3",
            "max_length": 8192,
            "description": "多语言多粒度模型，支持8192上下文",
        },
    }

    @classmethod
    def get_instance(cls) -> "EmbeddingService":
        """获取单例实例"""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def __init__(self):
        """初始化嵌入服务"""
        self._status_lock = threading.Lock()
        self._loading_thread: Optional[threading.Thread] = None
        self._loading_state = "idle"
        self._loading_progress = 0
        self._loading_stage = "idle"
        self._loading_message = "等待加载"
        self._loading_started_at = None
        self._loading_finished_at = None
        self._loading_errors: List[str] = []
        self._current_candidate = None
        configured_model = os.getenv("RAG_EMBEDDING_MODEL")
        self.model_name = configured_model or ("bge-large-zh-v1.5" if self._is_cuda_available() else "bge-small-zh-v1.5")
        self.requested_model_name = self.model_name
        self.cache_dir = os.getenv(
            "RAG_MODEL_CACHE_DIR",
            os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data", "models"))
        )
        os.makedirs(self.cache_dir, exist_ok=True)
        self._start_model_loading_async()

    @property
    def dimension(self) -> int:
        """获取当前模型的向量维度"""
        config = self.MODEL_CONFIGS.get(self.model_name, self.MODEL_CONFIGS["bge-large-zh-v1.5"])
        return config["dimension"]

    @property
    def model_type(self) -> str:
        """获取当前模型类型"""
        if self._model_type:
            return self._model_type
        config = self.MODEL_CONFIGS.get(self.model_name, {})
        return config.get("type", "hash")

    @property
    def is_real_embedding(self) -> bool:
        """是否使用真正的向量嵌入（而非hash降级）"""
        return self.model_type in ("sentence_transformer", "flag_embedding")

    def _ensure_model_loaded(self, timeout: float = 600.0):
        """确保模型已加载

        Args:
            timeout: 最长等待时间（秒），默认10分钟
        """
        if self._model is not None or self._loading_state in ("loaded", "fallback"):
            return

        with self._lock:
            if self._model is not None or self._loading_state in ("loaded", "fallback"):
                return
            loading_thread = self._loading_thread
            should_sync_load = loading_thread is None or not loading_thread.is_alive()

        if should_sync_load:
            with self._lock:
                if self._model is None and self._loading_state not in ("loaded", "fallback"):
                    self._load_model()
            return

        # 等待异步加载完成，带超时
        loading_thread.join(timeout=timeout)

        # 超时后检查状态，如果还没加载完成则强制同步加载
        if self._model is None and self._loading_state not in ("loaded", "fallback"):
            logger.warning(f"[RAG] 模型加载超时（{timeout}秒），尝试同步加载")
            with self._lock:
                if self._model is None and self._loading_state not in ("loaded", "fallback"):
                    self._load_model()

    def _start_model_loading_async(self):
        """异步触发模型加载，便于前端轮询进度"""
        with self._lock:
            if self._loading_thread is not None and self._loading_thread.is_alive():
                return
            if self._loading_state in ("loaded", "fallback"):
                return
            self._loading_thread = threading.Thread(
                target=self._load_model,
                name="rag-embedding-loader",
                daemon=True,
            )
            self._loading_thread.start()

    def _set_loading_status(
        self,
        *,
        state: Optional[str] = None,
        progress: Optional[int] = None,
        stage: Optional[str] = None,
        message: Optional[str] = None,
        candidate: Optional[str] = None,
        append_error: Optional[str] = None,
        finished: bool = False,
    ):
        with self._status_lock:
            if state is not None:
                self._loading_state = state
                if state == "loading" and self._loading_started_at is None:
                    self._loading_started_at = time.time()
            if progress is not None:
                self._loading_progress = max(0, min(100, int(progress)))
            if stage is not None:
                self._loading_stage = stage
            if message is not None:
                self._loading_message = message
            if candidate is not None:
                self._current_candidate = candidate
            if append_error:
                self._loading_errors.append(append_error)
            if finished:
                self._loading_finished_at = time.time()

    def _load_model(self):
        requested = self.requested_model_name or self.model_name
        logger.info("[RAG] ===== 向量模型加载开始 =====")
        logger.info("[RAG] 请求模型: %s", requested)
        logger.info("[RAG] 缓存目录: %s", self.cache_dir)
        logger.info("[RAG] CUDA可用: %s", self._is_cuda_available())
        self._set_loading_status(
            state="loading",
            progress=2,
            stage="prepare",
            message="准备加载向量模型",
            candidate=self.requested_model_name,
        )
        errors = []
        candidates = self._get_model_candidates()
        logger.info("[RAG] 候选模型列表: %s", ", ".join(candidates))
        logger.info("[RAG] 总候选数: %d", len(candidates))
        total_candidates = max(1, len(candidates))
        for index, candidate in enumerate(candidates):
            logger.info("[RAG] [%d/%d] 尝试候选模型: %s", index + 1, total_candidates, candidate)
            config = self.MODEL_CONFIGS.get(candidate)
            if not config:
                continue

            model_type = config["type"]
            repo = config["repo"]
            start_progress = 5 + int((index / total_candidates) * 70)
            self._set_loading_status(
                state="loading",
                progress=start_progress,
                stage="loading",
                message=f"正在加载模型 {candidate}（{index + 1}/{total_candidates}）",
                candidate=candidate,
            )
            logger.info(
                "[RAG] 尝试加载模型 candidate=%s type=%s repo=%s index=%s/%s",
                candidate,
                model_type,
                repo,
                index + 1,
                total_candidates,
            )
            try:
                if model_type == "sentence_transformer":
                    self._load_sentence_transformer(repo)
                elif model_type == "flag_embedding":
                    self._load_flag_embedding(repo)
                else:
                    raise ValueError(f"未知模型类型: {model_type}")

                self.model_name = candidate
                self._model_name = candidate
                self._model_type = model_type
                self._set_loading_status(
                    state="loaded",
                    progress=100,
                    stage="ready",
                    message=f"模型已就绪：{candidate}",
                    candidate=candidate,
                    finished=True,
                )
                logger.info("[RAG] ===== 向量模型加载成功 =====")
                logger.info("[RAG] 成功模型: %s", candidate)
                logger.info("[RAG] 向量维度: %s", config["dimension"])
                logger.info("[RAG] 模型类型: %s", model_type)
                logger.info("[RAG] ===== 加载完成 =====")
                return
            except Exception as e:
                error_text = f"{candidate}: {e}"
                errors.append(error_text)
                logger.warning("[RAG] 模型加载失败 candidate=%s error=%s", candidate, e, exc_info=True)
                self._set_loading_status(
                    state="loading",
                    progress=min(95, start_progress + 8),
                    stage="retrying",
                    message=f"模型 {candidate} 加载失败，尝试下一个候选模型",
                    candidate=candidate,
                    append_error=error_text,
                )
                self._model = None

        logger.error("[RAG] ===== 向量模型加载失败 =====")
        logger.error("[RAG] 请求模型: %s", requested)
        logger.error("[RAG] 已尝试模型: %s", ", ".join(self._get_model_candidates()))
        logger.error("[RAG] 失败详情: %s", " | ".join(errors) if errors else "无可用模型配置")
        logger.warning("[RAG] 使用hash embedding作为降级方案")
        logger.warning("[RAG] 降级原因: 所有语义向量模型加载失败")
        self._model_type = "hash"
        self._model = None
        self._set_loading_status(
            state="fallback",
            progress=100,
            stage="fallback",
            message="语义模型加载失败，已降级到 hash embedding",
            candidate="hash_embedding",
            finished=True,
        )

    def _get_model_candidates(self) -> List[str]:
        configured_priority = [
            item.strip()
            for item in os.getenv("RAG_EMBEDDING_MODEL_PRIORITY", "").split(",")
            if item.strip()
        ]
        default_priority = (
            ["bge-large-zh-v1.5", "bge-small-zh-v1.5", "bge-m3", "text2vec-base-chinese"]
            if self._is_cuda_available()
            else ["bge-small-zh-v1.5", "text2vec-base-chinese", "bge-large-zh-v1.5", "bge-m3"]
        )
        candidates: List[str] = []
        for name in [self.requested_model_name, *configured_priority, *default_priority]:
            if not name or name in candidates or name not in self.MODEL_CONFIGS:
                continue
            candidates.append(name)
        return candidates

    def _load_sentence_transformer(self, repo: str):
        """加载Sentence Transformer模型"""
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError:
            raise ImportError(
                "未安装sentence-transformers库。"
                "请运行: pip install sentence-transformers"
            )

        try:
            logger.info(f"[RAG] 开始从 {repo} 加载模型，缓存目录: {self.cache_dir}")
            self._model = SentenceTransformer(
                repo,
                cache_folder=self.cache_dir,
                device="cuda" if self._is_cuda_available() else "cpu"
            )
            logger.info(f"[RAG] 模型 {repo} 加载成功")
        except Exception as e:
            logger.error(f"[RAG] 模型 {repo} 加载失败: {e}")
            # 检查是否是网络或下载问题
            error_msg = str(e).lower()
            if any(keyword in error_msg for keyword in ["connection", "timeout", "network", "download", "ssl", "certificate"]):
                raise Exception(f"模型下载失败，请检查网络连接或使用已缓存的模型: {e}")
            elif "out of memory" in error_msg or "cuda" in error_msg:
                raise Exception(f"GPU内存不足，尝试使用CPU模式: {e}")
            else:
                raise e

    def _load_flag_embedding(self, repo: str):
        """加载FlagEmbedding模型"""
        try:
            from FlagEmbedding import BGEM3FlagModel
        except ImportError:
            raise ImportError(
                "未安装FlagEmbedding库。"
                "请运行: pip install FlagEmbedding"
            )

        self._model = BGEM3FlagModel(
            repo,
            cache_dir=self.cache_dir,
            device="cuda" if self._is_cuda_available() else "cpu",
            use_fp16=self._is_cuda_available()
        )

    @staticmethod
    def _is_cuda_available() -> bool:
        """检测CUDA是否可用"""
        try:
            import torch
            return torch.cuda.is_available()
        except ImportError:
            return False

    def encode(self, text: str, normalize: bool = True) -> List[float]:
        """
        对单个文本进行向量编码

        Args:
            text: 输入文本
            normalize: 是否归一化向量（推荐用于余弦相似度）

        Returns:
            向量列表
        """
        if not text or not text.strip():
            return [0.0] * self.dimension

        self._ensure_model_loaded()

        if self._model_type == "hash":
            return self._hash_embedding(text)

        elif self._model_type == "sentence_transformer":
            return self._encode_sentence_transformer(text, normalize)

        elif self._model_type == "flag_embedding":
            return self._encode_flag_embedding(text, normalize)

        else:
            return self._hash_embedding(text)

    def encode_batch(self, texts: List[str], normalize: bool = True) -> List[List[float]]:
        """
        批量编码文本

        Args:
            texts: 文本列表
            normalize: 是否归一化向量

        Returns:
            向量列表
        """
        if not texts:
            return []

        self._ensure_model_loaded()

        if self._model_type == "hash":
            return [self._hash_embedding(t) for t in texts]

        elif self._model_type == "sentence_transformer":
            embeddings = self._model.encode(
                texts,
                normalize_embeddings=normalize,
                show_progress_bar=False
            )
            return embeddings.tolist()

        elif self._model_type == "flag_embedding":
            embeddings = self._model.encode(
                texts,
                return_dense=True,
                normalize=normalize
            )["dense_vecs"]
            return embeddings.tolist()

        else:
            return [self._hash_embedding(t) for t in texts]

    def _encode_sentence_transformer(self, text: str, normalize: bool) -> List[float]:
        """使用Sentence Transformer编码单个文本"""
        embedding = self._model.encode(
            text,
            normalize_embeddings=normalize,
            show_progress_bar=False
        )
        return embedding.tolist()

    def _encode_flag_embedding(self, text: str, normalize: bool) -> List[float]:
        """使用FlagEmbedding编码单个文本"""
        result = self._model.encode(
            [text],
            return_dense=True,
            normalize=normalize
        )
        return result["dense_vecs"][0].tolist()

    def _hash_embedding(self, text: str) -> List[float]:
        """
        Hash embedding降级方案

        使用SHA256哈希生成伪向量，仅作为降级方案使用
        """
        dim = self.dimension
        tokens = self._tokenize(text)
        if not tokens:
            return [0.0] * dim

        vec = [0.0] * dim
        for token in tokens:
            digest = hashlib.sha256(token.encode("utf-8", errors="ignore")).hexdigest()
            idx = int(digest[:8], 16) % dim
            sign = 1.0 if int(digest[8:10], 16) % 2 == 0 else -1.0
            vec[idx] += sign

        # 归一化
        norm = math.sqrt(sum(v * v for v in vec))
        if norm > 0:
            vec = [v / norm for v in vec]

        return vec

    @staticmethod
    def _tokenize(text: str) -> List[str]:
        """简单的中文分词"""
        import re
        if not text:
            return []
        raw_tokens = re.findall(r"[\u4e00-\u9fa5A-Za-z0-9_]+", text.lower())
        return [t for t in raw_tokens if len(t) > 1]

    @staticmethod
    def cosine_similarity(v1: List[float], v2: List[float]) -> float:
        """计算余弦相似度"""
        if not v1 or not v2 or len(v1) != len(v2):
            return 0.0
        dot_product = sum(a * b for a, b in zip(v1, v2))
        norm1 = math.sqrt(sum(a * a for a in v1))
        norm2 = math.sqrt(sum(b * b for b in v2))
        if norm1 == 0 or norm2 == 0:
            return 0.0
        return max(0.0, min(1.0, dot_product / (norm1 * norm2)))

    def get_model_info(self) -> dict:
        """获取当前模型信息"""
        config = self.MODEL_CONFIGS.get(self.model_name, {})
        with self._status_lock:
            loading_state = self._loading_state
            loading_progress = self._loading_progress
            loading_stage = self._loading_stage
            loading_message = self._loading_message
            loading_started_at = self._loading_started_at
            loading_finished_at = self._loading_finished_at
            current_candidate = self._current_candidate
            loading_errors = self._loading_errors[-5:]
        return {
            "model_name": self.model_name if self.is_real_embedding else "hash_embedding",
            "model_type": self.model_type,
            "dimension": self.dimension,
            "is_real_embedding": self.is_real_embedding,
            "description": config.get("description", "Hash embedding降级方案"),
            "max_length": config.get("max_length", 0),
            "cuda_available": self._is_cuda_available(),
            "model_loading": loading_state == "loading",
            "loading_state": loading_state,
            "loading_progress": loading_progress,
            "loading_stage": loading_stage,
            "loading_message": loading_message,
            "loading_started_at": loading_started_at,
            "loading_finished_at": loading_finished_at,
            "loading_candidate": current_candidate,
            "loading_errors": loading_errors,
        }


# 全局单例实例
_embedding_service: Optional[EmbeddingService] = None


def get_embedding_service() -> EmbeddingService:
    """获取嵌入服务单例"""
    global _embedding_service
    if _embedding_service is None:
        _embedding_service = EmbeddingService.get_instance()
    return _embedding_service


def encode_text(text: str, normalize: bool = True) -> List[float]:
    """便捷函数：编码单个文本"""
    return get_embedding_service().encode(text, normalize)


def encode_texts_batch(texts: List[str], normalize: bool = True) -> List[List[float]]:
    """便捷函数：批量编码文本"""
    return get_embedding_service().encode_batch(texts, normalize)


def get_model_info() -> dict:
    """便捷函数：获取模型信息"""
    return get_embedding_service().get_model_info()
