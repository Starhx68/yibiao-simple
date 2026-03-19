import os
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from pydantic import BaseModel
from ..services.auth_service import get_current_user
from ..models.models import User, TechnicalBidProject
from ..database import get_db
from sqlalchemy.orm import Session
import uuid
import json

router = APIRouter(prefix="/api/technical-bids", tags=["技术标管理"])

class TechnicalProjectCreate(BaseModel):
    project_name: str

class TechnicalProjectUpdate(BaseModel):
    file_content: str | None = None
    project_overview: str | None = None
    tech_requirements: str | None = None
    outline_data: str | None = None
    status: str | None = None

@router.post("/")
def create_technical_project(data: TechnicalProjectCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project_id = str(uuid.uuid4())
    project = TechnicalBidProject(
        id=project_id,
        user_id=current_user.id,
        project_name=data.project_name,
        status="draft"
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return {"id": project.id, "project_name": project.project_name, "status": project.status}

@router.get("/")
def list_technical_projects(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    projects = db.query(TechnicalBidProject).filter(TechnicalBidProject.user_id == current_user.id).all()
    return {"items": [{"id": p.id, "project_name": p.project_name, "status": p.status, "created_at": p.created_at} for p in projects]}

@router.get("/{project_id}")
def get_technical_project(project_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(TechnicalBidProject).filter(TechnicalBidProject.id == project_id, TechnicalBidProject.user_id == current_user.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    return {
        "id": project.id,
        "project_name": project.project_name,
        "status": project.status,
        "file_content": project.file_content,
        "project_overview": project.project_overview,
        "tech_requirements": project.tech_requirements,
        "outline_data": json.loads(project.outline_data) if project.outline_data else None,
        "created_at": project.created_at
    }

@router.put("/{project_id}")
def update_technical_project(project_id: str, data: TechnicalProjectUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(TechnicalBidProject).filter(TechnicalBidProject.id == project_id, TechnicalBidProject.user_id == current_user.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    if data.file_content is not None:
        project.file_content = data.file_content
    if data.project_overview is not None:
        project.project_overview = data.project_overview
    if data.tech_requirements is not None:
        project.tech_requirements = data.tech_requirements
    if data.outline_data is not None:
        project.outline_data = data.outline_data
    if data.status is not None:
        project.status = data.status
        
    db.commit()
    return {"success": True, "message": "Project updated"}

@router.post("/{project_id}/mark-completed")
def mark_technical_project_completed(project_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(TechnicalBidProject).filter(TechnicalBidProject.id == project_id, TechnicalBidProject.user_id == current_user.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    project.status = "completed"
    db.commit()
    return {"success": True, "message": "Project marked as completed", "status": project.status}
