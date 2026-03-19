import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from app.database import SessionLocal
from app.models.models import BusinessBidProject
import json

db = SessionLocal()
project = db.query(BusinessBidProject).order_by(BusinessBidProject.created_at.desc()).first()

if project and project.directories_content:
    directories = json.loads(project.directories_content)
    print("Project ID:", project.id)
    print("Top level directories:")
    for d in directories:
        print(f"  - {d.get('title')}")
else:
    print("No project or directories found.")
