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
        print("--- Node '开标（唱标）一览表' ---")
        print(node.get('content', ''))
        
    node = find_node(directories, "投标函")
    if node:
        print("\n--- Node '投标函' ---")
        print(node.get('content', ''))
