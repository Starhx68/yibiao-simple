import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from app.database import SessionLocal
from app.models.models import BusinessBidProject
from app.config import settings
import json
import re
import mammoth
from bs4 import BeautifulSoup

db = SessionLocal()
project = db.query(BusinessBidProject).order_by(BusinessBidProject.created_at.desc()).first()

filename = project.tender_document_url.split('/')[-1]
docx_path = os.path.join(settings.upload_dir, filename)

with open(docx_path, "rb") as f:
    result = mammoth.convert_to_html(f)
    html = result.value
soup = BeautifulSoup(html, 'html.parser')
html_elements = soup.find_all(recursive=False)

for idx, el in enumerate(html_elements):
    text = el.get_text().strip()
    if "格式" in text and ("文件" in text or "投标" in text):
        print(f"[{idx}] {repr(text)}")
        if re.match(r"^(?:第[一二三四五六七八九十百]+[章部分][ \t]+)?.*(?:招标|投标)文件.*格式.*$", text):
            print("  -> MATCHES regex!")
        if not re.search(r"\.{3,}\s*\d+", text):
            print("  -> NOT A TOC ENTRY!")
