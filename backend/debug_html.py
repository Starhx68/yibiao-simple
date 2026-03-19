import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from app.database import SessionLocal
from app.models.models import BusinessBidProject
from app.routers.business_bid import extract_content_for_directories
import json

db = SessionLocal()
project = db.query(BusinessBidProject).order_by(BusinessBidProject.created_at.desc()).first()
if project:
    from app.config import settings
    import mammoth
    from bs4 import BeautifulSoup
    
    other_urls = {}
    if project.other_urls:
        try:
            other_urls = json.loads(project.other_urls)
        except:
            pass
    print("other_urls:", other_urls)
    
    format_doc_url = other_urls.get("format_document_url")
    if format_doc_url:
        filename = format_doc_url.split('/')[-1]
        docx_path = os.path.join(settings.upload_dir, filename)
        print("docx_path:", docx_path, "exists:", os.path.exists(docx_path))
        if os.path.exists(docx_path):
            with open(docx_path, "rb") as f:
                result = mammoth.convert_to_html(f)
                html = result.value
            soup = BeautifulSoup(html, 'html.parser')
            html_elements = soup.find_all(recursive=False)
            print("html_elements count:", len(html_elements))
            
            # Print first 5 elements text
            for i in range(min(5, len(html_elements))):
                print(f"El {i}:", repr(html_elements[i].get_text()[:100]))
    else:
        print("No format_document_url found in other_urls")
