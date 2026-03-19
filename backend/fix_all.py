import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from app.database import SessionLocal
from app.models.models import BusinessBidProject
from app.routers.business_bid import generate_format_word_file, extract_content_for_directories
import json

db = SessionLocal()
project = db.query(BusinessBidProject).order_by(BusinessBidProject.created_at.desc()).first()
if project:
    print("Generating format word file...")
    generate_format_word_file(project, db)
    db.commit()
    print("other_urls after generation:", project.other_urls)
    
    if project.directories_content:
        directories = json.loads(project.directories_content)
        extract_content_for_directories(directories, project)
        project.directories_content = json.dumps(directories, ensure_ascii=False)
        db.commit()
        print("Updated directories_content.")
        
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
            print("Content preview:", repr(node.get('content', '')[:200]))
