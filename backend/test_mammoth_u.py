import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from app.config import settings
import mammoth

docx_path = os.path.join(settings.upload_dir, "format_1773918942.docx")

style_map = """
p[style-name='Heading 1'] => h1:fresh
p[style-name='Heading 2'] => h2:fresh
p[style-name='Heading 3'] => h3:fresh
table => table.table.table-bordered:fresh
u => u
"""

with open(docx_path, "rb") as f:
    result = mammoth.convert_to_html(f, style_map=style_map)
    html = result.value
    
print("Has <u>?", "<u>" in html)
