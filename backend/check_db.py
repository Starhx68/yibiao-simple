import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from app.database import SessionLocal
from app.models.models import BusinessBidProject
import json

db = SessionLocal()
project = db.query(BusinessBidProject).order_by(BusinessBidProject.created_at.desc()).first()
if project:
    print(f"Project ID: {project.id}")
    print(f"Project Name: {project.project_name}")
    if project.directories_content:
        dirs = json.loads(project.directories_content)
        # Find "开标（唱标）一览表"
        def find_node(nodes, title):
            for n in nodes:
                if title in n.get('title', ''):
                    return n
                if n.get('children'):
                    res = find_node(n['children'], title)
                    if res: return res
            return None
        
        node = find_node(dirs, "开标")
        if node:
            print("Found node!")
            print("Content length:", len(node.get('content', '')))
            print("Content preview:", repr(node.get('content', '')[:1000]))
        else:
            print("Node not found.")
    else:
        print("No directories_content")
else:
    print("No projects found.")