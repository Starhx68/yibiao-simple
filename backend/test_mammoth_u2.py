import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from app.config import settings
from app.database import SessionLocal
from app.models.models import BusinessBidProject
import mammoth

db = SessionLocal()
project = db.query(BusinessBidProject).order_by(BusinessBidProject.created_at.desc()).first()

filename = project.tender_document_url.split('/')[-1]
docx_path = os.path.join(settings.upload_dir, filename)

style_map = """
p[style-name='Heading 1'] => h1:fresh
p[style-name='Heading 2'] => h2:fresh
p[style-name='Heading 3'] => h3:fresh
table => table:fresh
u => u
"""

with open(docx_path, "rb") as f:
    result = mammoth.convert_to_html(f, style_map=style_map)
    html = result.value
    
print("Has <u>?", "<u>" in html)
