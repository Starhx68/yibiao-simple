import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from app.database import SessionLocal
from app.models.models import BusinessBidProject
from app.routers.business_bid import get_format_chapter_info
import json

db = SessionLocal()
project = db.query(BusinessBidProject).order_by(BusinessBidProject.created_at.desc()).first()
if project:
    print("Project ID:", project.id)
    print("Project tender_content length:", len(project.tender_content) if project.tender_content else 0)
    print("Has format chapter?")
    if project.tender_content:
        pos, end, text = get_format_chapter_info(project.tender_content)
        print("pos:", pos, "end:", end, "text len:", len(text) if text else 0)
    else:
        print("No tender content")
    print("other_urls:", project.other_urls)
else:
    print("No project")
