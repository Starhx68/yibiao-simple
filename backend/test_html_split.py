import mammoth
from bs4 import BeautifulSoup
import re

def split_html_by_titles(docx_path, titles):
    with open(docx_path, "rb") as f:
        result = mammoth.convert_to_html(f)
        html = result.value
        
    soup = BeautifulSoup(html, 'html.parser')
    
    # top level elements
    elements = soup.find_all(recursive=False)
    
    results = []
    
    # We want to find each title in order
    current_title_idx = 0
    current_content = []
    
    def clean_title(t):
        return re.sub(r"^[一二三四五六七八九十\d\.\s、]+", "", t).strip()
        
    for el in elements:
        text = el.get_text().strip()
        
        if current_title_idx < len(titles):
            next_title = titles[current_title_idx]
            core_title = clean_title(next_title)
            
            # If this element contains the title (as a heading or paragraph)
            if core_title and core_title in text and len(text) < len(core_title) + 20:
                # We found the title!
                # Save previous content if any
                if current_title_idx > 0:
                    results.append("".join(str(e) for e in current_content))
                
                current_content = [el]
                current_title_idx += 1
                continue
                
        # Append to current content
        if current_title_idx > 0:
            current_content.append(el)
            
    # Add the last one
    if current_content:
        results.append("".join(str(e) for e in current_content))
        
    return results

print("Script written")
