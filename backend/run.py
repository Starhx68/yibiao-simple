"""后端服务启动脚本"""
import copy
import os
import multiprocessing
from pathlib import Path

import uvicorn
from uvicorn.config import LOGGING_CONFIG


def build_log_config():
    backend_dir = Path(__file__).resolve().parent
    log_dir = backend_dir / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "app.log"

    log_config = copy.deepcopy(LOGGING_CONFIG)
    log_config["handlers"]["file_default"] = {
        "class": "logging.FileHandler",
        "formatter": "default",
        "filename": str(log_file),
        "encoding": "utf-8",
    }
    log_config["handlers"]["file_access"] = {
        "class": "logging.FileHandler",
        "formatter": "access",
        "filename": str(log_file),
        "encoding": "utf-8",
    }
    log_config["root"] = {
        "level": "INFO",
        "handlers": ["default", "file_default"],
    }
    for logger_name in ("uvicorn", "uvicorn.error"):
        handlers = log_config["loggers"][logger_name].get("handlers", [])
        if "file_default" not in handlers:
            handlers.append("file_default")
        log_config["loggers"][logger_name]["handlers"] = handlers
    access_handlers = log_config["loggers"]["uvicorn.access"].get("handlers", [])
    if "file_access" not in access_handlers:
        access_handlers.append("file_access")
    log_config["loggers"]["uvicorn.access"]["handlers"] = access_handlers
    return log_config

if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    workers = int(os.getenv("WORKERS", "1"))

    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        reload=False,
        log_level="info",
        workers=workers,
        log_config=build_log_config(),
        timeout_keep_alive=600,  # 10分钟连接保持，支持RAG大文件导入
        limit_concurrency=None,  # 不限制并发
        limit_max_requests=None,  # 不限制请求数量
    )
