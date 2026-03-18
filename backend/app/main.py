"""FastAPI应用主入口"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os
from .config import settings
from .routers import config, document, outline, content, search, expand
from .routers import auth, resource, business_bid
from . import database
from .models.models import User
from .services.auth_service import get_password_hash

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="基于FastAPI的海新屹AI标书后端API"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 挂载上传目录，用于文件预览
if not os.path.exists(settings.upload_dir):
    os.makedirs(settings.upload_dir)
app.mount("/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")

app.include_router(config.router)
app.include_router(document.router)
app.include_router(outline.router)
app.include_router(content.router)
app.include_router(search.router)
app.include_router(expand.router)
app.include_router(auth.router)
app.include_router(resource.router)
app.include_router(business_bid.router)

@app.on_event("startup")
async def startup_event():
    database.init_db()
    db = database.SessionLocal()
    try:
        admin = db.query(User).filter(User.username == "admin").first()
        if not admin:
            admin_user = User(
                username="admin",
                password_hash=get_password_hash("admin$123"),
                role="admin",
                real_name="系统管理员",
                is_active=True
            )
            db.add(admin_user)
            db.commit()
            print("管理员用户创建成功！用户名: admin, 密码: admin$123")
        else:
            should_commit = False
            if admin.role != "admin":
                admin.role = "admin"
                should_commit = True
            if not admin.is_active:
                admin.is_active = True
                should_commit = True
            if should_commit:
                db.commit()
    finally:
        db.close()

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "app_name": settings.app_name,
        "version": settings.app_version
    }

if os.path.exists("static"):
    app.mount("/static", StaticFiles(directory="static/static"), name="static")
    
    @app.get("/")
    async def read_index():
        return FileResponse("static/index.html")
    
    @app.get("/{full_path:path}")
    async def serve_react_app(full_path: str):
        if full_path.startswith("api/") or full_path.startswith("docs") or full_path == "health":
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="API endpoint not found")
        
        static_file_path = os.path.join("static", full_path)
        if os.path.exists(static_file_path) and os.path.isfile(static_file_path):
            return FileResponse(static_file_path)
        
        return FileResponse("static/index.html")
else:
    @app.get("/")
    async def read_root():
        return {
            "message": f"欢迎使用 {settings.app_name} API",
            "version": settings.app_version,
            "docs": "/docs",
            "health": "/health"
        }
