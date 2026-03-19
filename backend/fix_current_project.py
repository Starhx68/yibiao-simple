import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from app.database import SessionLocal
from app.models.models import BusinessBidProject
from app.routers.business_bid import extract_content_for_directories
import json

db = SessionLocal()
project = db.query(BusinessBidProject).order_by(BusinessBidProject.created_at.desc()).first()
if project and project.directories_content:
    print("Re-extracting content for project:", project.project_name)
    directories = json.loads(project.directories_content)
    try:
        extract_content_for_directories(directories, project)
        project.directories_content = json.dumps(directories, ensure_ascii=False)
        db.commit()
        print("Successfully updated directories_content.")
        
        # Verify
        def find_node(nodes, title):
            for n in nodes:
                if title in n.get('title', ''):
                    return n
                if n.get('children'):
                    res = find_node(n['children'], title)
                    if res: return res
            return None
        node = find_node(directories, "开标")
        if node:
            print("Content length for '开标':", len(node.get('content', '')))
            print("Content preview:", repr(node.get('content', '')[:100]))
    except Exception as e:
        print("Failed to extract:", e)
else:
    print("No project or directories found.")
