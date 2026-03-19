import os
import json
import re

# Mock a project
class MockProject:
    def __init__(self, tender_content):
        self.tender_content = tender_content
        self.other_urls = None

def extract_content_for_directories(directories, project):
    from bs4 import BeautifulSoup
    import mammoth
    
    content_text = project.tender_content or ""
    # Try to extract HTML from docx
    html_elements = []
    use_html = False
    
    if project.other_urls:
        try:
            other_urls = json.loads(project.other_urls)
            format_doc_url = other_urls.get("format_document_url")
            if format_doc_url:
                filename = format_doc_url.split('/')[-1]
                # In real code: docx_path = os.path.join(settings.upload_dir, filename)
                docx_path = os.path.join(os.path.dirname(__file__), "uploads", filename)
                if os.path.exists(docx_path):
                    with open(docx_path, "rb") as f:
                        result = mammoth.convert_to_html(f)
                        html = result.value
                    soup = BeautifulSoup(html, 'html.parser')
                    html_elements = soup.find_all(recursive=False)
                    if html_elements:
                        use_html = True
        except Exception as e:
            print(f"Error parsing docx to html: {e}")

    # Fallback plain text search
    # ...
    print(f"use_html: {use_html}")

print("Test script ready")
