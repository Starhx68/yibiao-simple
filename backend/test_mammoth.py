import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from app.config import settings
import mammoth
import traceback

docx_path = os.path.join(settings.upload_dir, "format_1773918153.docx")
print("Reading", docx_path)
with open(docx_path, "rb") as f:
    try:
        style_map = """
        p[style-name='Heading 1'] => h1:fresh
        p[style-name='Heading 2'] => h2:fresh
        p[style-name='Heading 3'] => h3:fresh
        table => table.table.table-bordered:fresh
        """
        result = mammoth.convert_to_html(f, style_map=style_map)
        print("Success!")
    except Exception as e:
        traceback.print_exc()
