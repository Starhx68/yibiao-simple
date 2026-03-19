import os
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List, Optional
from pydantic import BaseModel
from ..services.auth_service import get_current_user
from ..models.models import (
    User, BusinessBidProject, BusinessBidDirectory, BusinessBidElement,
    CompanyInfo, Qualification, Personnel, FinancialInfo, Performance
)
from ..database import get_db
from sqlalchemy.orm import Session
from ..services.file_service import FileService
from ..services.openai_service import OpenAIService
from ..utils.config_manager import config_manager
from ..utils.sse import sse_response
import uuid
import json
import logging
import re
import time
import docx
from docx.shared import Pt, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from app.config import settings

# 配置日志
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

router = APIRouter(prefix="/api/business-bids", tags=["商务标管理"])

class BusinessProjectCreate(BaseModel):
    project_name: str

@router.post("/")
def create_business_project(data: BusinessProjectCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project_id = str(uuid.uuid4())
    project = BusinessBidProject(
        id=project_id,
        user_id=current_user.id,
        project_name=data.project_name,
        status="draft"
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return {"id": project.id, "project_name": project.project_name, "status": project.status}

@router.get("/")
def list_business_projects(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    projects = db.query(BusinessBidProject).filter(BusinessBidProject.user_id == current_user.id).all()
    return {"items": [{"id": p.id, "project_name": p.project_name, "status": p.status, "created_at": p.created_at} for p in projects]}

@router.post("/{project_id}/upload-tender")
async def upload_tender_document(project_id: str, file: UploadFile = File(...), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(BusinessBidProject).filter(BusinessBidProject.id == project_id, BusinessBidProject.user_id == current_user.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    try:
        # 复用 FileService 读取文件内容，并获取保存路径
        file_content, file_path = await FileService.process_uploaded_file(file)
        
        # 计算相对路径，用于前端访问
        # 假设 settings.upload_dir 是绝对路径或相对于项目根目录的路径
        # 我们需要将其转换为相对于 static mount point 的路径
        # app.mount("/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")
        # file_path e.g. "D:/Temp/bsdoc-sw/hxybs-js/backend/uploads/filename_timestamp.docx"
        # relative_path should be "filename_timestamp.docx"
        
        filename = os.path.basename(file_path)
        # 构造可访问的URL (假设后端服务运行在同域或已配置代理)
        # 前端可以通过 /uploads/{filename} 访问
        tender_document_url = f"/uploads/{filename}"

        # 保存到数据库
        project.tender_document_name = file.filename
        project.tender_document_url = tender_document_url
        project.tender_content = file_content
        project.status = "analyzing"
        db.commit()
        return {"success": True, "message": "File uploaded and parsed successfully", "file_content": file_content[:1000] + "..."}
    except Exception as e:
        logger.error(f"File upload failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{project_id}")
def get_business_project(project_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(BusinessBidProject).filter(BusinessBidProject.id == project_id, BusinessBidProject.user_id == current_user.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    # 构建文件的可访问URL
    tender_document_url = None
    if project.tender_document_name:
        # 假设文件保存在 settings.upload_dir 目录下，并且文件名中包含时间戳
        # 我们需要找到实际的文件名。但在 upload_tender_document 中我们只存了原始文件名到 tender_document_name
        # 实际上 FileService.save_uploaded_file 生成了新的文件名。
        # 这里为了简化，我们暂时只返回原始文件名，前端可能需要适配。
        # 更好的做法是在数据库中存储实际保存的文件路径或文件名。
        # 暂时 workaround: 我们需要让 upload 接口把实际路径存下来。
        pass

    return {
        "id": project.id,
        "project_name": project.project_name,
        "status": project.status,
        "tender_document_name": project.tender_document_name,
        "tender_document_url": project.tender_document_url, # 新增字段
        "tender_content": project.tender_content,
        "created_at": project.created_at
    }

@router.post("/{project_id}/analyze-stream")
async def analyze_business_bid_stream(project_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(BusinessBidProject).filter(BusinessBidProject.id == project_id, BusinessBidProject.user_id == current_user.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    if not project.tender_content:
        raise HTTPException(status_code=400, detail="Tender document not uploaded or content is empty")

    config = config_manager.load_config()
    if not config.get('api_key'):
        raise HTTPException(status_code=400, detail="请先配置OpenAI API密钥")

    openai_service = OpenAIService()

    async def generate():
        from app.database import SessionLocal
        import asyncio
        system_prompt = """你是一名专业的招标文件商务标分析师，擅长从复杂的招标文档中提取关键信息。
请你严格按照以下一级分类、二级分类，从提供的招标文件中，精准提取对应二级分类下的全部关键信息，要求信息完整、表述精准、层次分明，若招标文件中某分类下无相关信息，需明确标注“无相关要求”：

# 一、投标人资格要求
- 主体资格要求：投标人主体类型、主体证明文件要求、营业执照相关要求、外资/合资企业相关备案证明要求、关联企业投标限制条件。
- 资质与许可要求：核心资质要求、安全生产相关许可要求、行业专项资质要求、所有资质证书的有效性要求。
- 财务状况要求：财务报表要求、财务指标要求、银行资信证明/资金证明要求、纳税证明要求、社保缴纳证明要求、履约能力相关限制。
- 信誉要求：失信记录要求、近3-5年重大违法记录要求、履约评价要求、法定代表人及项目负责人行贿犯罪记录要求。
- 业绩要求：类似项目要求、业绩数量要求、业绩质量要求、业绩证明材料要求、业绩限制条件。
- 人员配置要求：项目负责人要求、技术负责人要求、核心团队成员要求、人员稳定性要求。
- 其他资格要求：联合体投标要求、代理商投标要求、本地化服务要求、合规投标承诺要求。

# 二、投标费用与投标保证金
- 投标费用：投标相关费用承担方、招标文件售价、缴纳方式、售后是否可退、踏勘现场等其他费用承担方。
- 投标保证金：保证金具体金额、缴纳方式、指定缴纳账户、缴纳截止时间、保证金退还规则、保证金不予退还情形。

# 三、投标文件商务部分编制要求
- 编制原则：响应性要求、真实性要求、完整性要求。
- 编制内容与格式：商务部分组成内容及排列顺序、纸张规格、装订要求、签署盖章要求、正副本份数、电子版要求。
- 报价相关编制要求：报价货币、报价范围、报价形式、最高/最低限价要求、投标有效期、报价是否可修改。

# 四、开标与评标中的商务评审要点
- 开标阶段商务核查：投标文件密封核查要求、资格初步核查内容、报价核查内容。
- 评标阶段商务评审：资格详细评审规则、商务评分项具体内容及分值设置、商务偏离评审规则。

# 五、中标与合同相关商务条款
- 中标相关商务要求：中标公示期限、异议处理方式、中标通知书发放、履约保证金要求、中标人义务。
- 合同主要商务条款：合同范围与内容、合同价款形式及金额、付款方式、质保金、价格调整、交付要求、验收标准、质保期、违约责任、争议解决。

# 六、商务部分其他关键要求
- 保密要求：保密范围、保密责任。
- 投标文件的修改与撤回：修改规则、撤回规则。
- 废标相关商务情形：所有商务类废标情形。
- 特殊项目商务补充要求：工程类/服务类/货物类的专项商务要求。

必须严格输出为JSON数组格式，结构如下：
[
  {
    "title": "投标人资格要求",
    "subcategories": [
      {
        "title": "主体资格要求",
        "items": [
          {"name": "投标人主体类型", "description": "..."},
          {"name": "营业执照相关要求", "description": "..."}
        ]
      }
    ]
  }
]

必须直接输出JSON字符串，不能包含 ```json 等任何Markdown代码块标记，也不要包含任何其他说明文字。
"""
        # 使用切片后的文本，但为了避免截断关键信息，建议尽量使用全文。
        # 如果文本过长，可能需要分段处理或使用支持长上下文的模型。
        # 这里假设 150k 字符对于大多数标书足够，且模型支持。
        user_prompt = f"请分析以下招标文件内容，提取商务相关要素：\n\n{project.tender_content[:150000]}"
        
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
        
        db_gen = SessionLocal()
        try:
            full_response = ""
            try:
                async for chunk in openai_service.stream_chat_completion(messages, temperature=0.1):
                    full_response += chunk
                    yield f"data: {json.dumps({'chunk': chunk}, ensure_ascii=False)}\n\n"
            except asyncio.CancelledError:
                logger.warning("Client disconnected during streaming. Saving partial result.")
                # We will still try to save the partial result below
            except Exception as inner_e:
                logger.error(f"Error during OpenAI stream: {inner_e}")
                full_response += f"\n[Error: {str(inner_e)}]"
                yield f"data: {json.dumps({'error': str(inner_e)}, ensure_ascii=False)}\n\n"

            logger.info(f"Analysis result for project {project_id}: {full_response}")

            # 尝试修复可能的JSON格式错误（例如包含Markdown标记）
            cleaned_response = full_response.strip()
            if cleaned_response.startswith("```json"):
                cleaned_response = cleaned_response[7:]
            if cleaned_response.endswith("```"):
                cleaned_response = cleaned_response[:-3]
            cleaned_response = cleaned_response.strip()

            project_gen = db_gen.query(BusinessBidProject).filter(BusinessBidProject.id == project_id).first()
            if project_gen:
                # 验证JSON合法性
                try:
                    json.loads(cleaned_response)
                    # Save the result to DB
                    project_gen.elements_content = cleaned_response
                    project_gen.status = "analyzed"
                    db_gen.commit()
                    logger.info("Successfully saved analyzed elements to DB.")
                except json.JSONDecodeError as e:
                    logger.error(f"JSON decode error: {e}, response: {cleaned_response}")
                    # 即使解析失败，也保存原始响应以便排查，或者标记为失败
                    project_gen.elements_content = cleaned_response 
                    project_gen.status = "analyzed_with_error"
                    db_gen.commit()
                    logger.info("Saved analyzed_with_error to DB.")
            
            yield "data: [DONE]\n\n"
        except asyncio.CancelledError:
            logger.warning("Client disconnected. Analysis aborted in outer block.")
        except Exception as e:
            logger.error(f"Analysis failed: {e}")
            yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        finally:
            db_gen.close()

    return sse_response(generate())

@router.get("/{project_id}/elements")
def get_business_elements(project_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(BusinessBidProject).filter(BusinessBidProject.id == project_id, BusinessBidProject.user_id == current_user.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    default_elements = []
    
    if project.elements_content:
        try:
            elements = json.loads(project.elements_content)
            # 确保每个项都有id
            if isinstance(elements, list):
                for cat_idx, category in enumerate(elements):
                    category["id"] = f"cat_{cat_idx}"
                    if "subcategories" in category:
                        for sub_idx, subcat in enumerate(category["subcategories"]):
                            subcat["id"] = f"sub_{cat_idx}_{sub_idx}"
                            if "items" in subcat:
                                for item_idx, item in enumerate(subcat["items"]):
                                    item["id"] = f"item_{cat_idx}_{sub_idx}_{item_idx}"
            return elements
        except json.JSONDecodeError:
            pass
            
    return default_elements

from app.database import SessionLocal

def find_title_pos(text: str, search_title: str, start_pos: int = 0, end_pos: int = -1) -> int:
    if not search_title:
        return -1
    if end_pos == -1:
        end_pos = len(text)
        
    search_text = text[start_pos:end_pos]
    
    # 去除标题中可能包含的编号（如 "1. ", "1.1 ", "一、" 等）提取核心部分
    core_title = re.sub(r"^[一二三四五六七八九十\d\.\s、]+", "", search_title).strip()
    if not core_title:
        core_title = search_title
        
    # 尝试精确匹配带有核心标题的行
    pattern = re.compile(rf"(?m)^[ \t]*[一二三四五六七八九十\d\.\s、]*{re.escape(core_title)}[ \t]*$")
    m = pattern.search(search_text)
    if m:
        return start_pos + m.start()
        
    # 降级：部分匹配
    idx = search_text.find(core_title)
    if idx != -1:
        # 尝试回退到该行的行首
        last_newline = search_text.rfind('\n', 0, idx)
        return start_pos + (last_newline + 1 if last_newline != -1 else idx)
        
    return -1

def get_format_chapter_info(content_text: str):
    """
    提取“投标文件格式”或“招标文件格式”的章节文本和位置
    返回: (format_chapter_pos, format_chapter_end, chapter_text)
    如果没有找到，返回 (-1, -1, None)
    """
    if not content_text:
        return -1, -1, None
        
    format_chapter_pos = -1
    format_chapter_end = len(content_text)
    
    format_match = re.search(r"(?m)^[ \t]*(?:第[一二三四五六七八九十百]+[章部分][ \t]+)?.*(?:招标|投标)文件.*格式.*[ \t]*$", content_text)
    if format_match:
        format_chapter_pos = format_match.start()
    else:
        fallback_idx = content_text.find("投标文件格式")
        if fallback_idx == -1:
            fallback_idx = content_text.find("招标文件格式")
        if fallback_idx != -1:
            format_chapter_pos = fallback_idx

    if format_chapter_pos >= 0:
        next_chapter_match = re.search(r"(?m)^[ \t]*第[一二三四五六七八九十百]+[章部分][ \t]+", content_text[format_chapter_pos + 10:])
        if next_chapter_match:
            format_chapter_end = format_chapter_pos + 10 + next_chapter_match.start()
        return format_chapter_pos, format_chapter_end, content_text[format_chapter_pos:format_chapter_end]
        
    return -1, -1, None

def generate_format_word_file(project, db: Session):
    """
    根据项目的招标文档，截取“投标文件格式”章节，并生成新的Word文件。
    将新生成的Word文件URL保存到 project.other_urls (以JSON形式)。
    """
    if not project.tender_content:
        return

    content_text = project.tender_content
    pos, end, chapter_text = get_format_chapter_info(content_text)
    
    if not chapter_text:
        return
    
    # 确定输出路径
    import time
    filename = f"format_{int(time.time())}.docx"
    output_path = os.path.join(settings.upload_dir, filename)
    os.makedirs(settings.upload_dir, exist_ok=True)
    
    # 如果原文件是 docx，尝试直接裁剪原文件以保留真实格式
    original_url = project.tender_document_url
    if original_url and original_url.endswith('.docx'):
        original_filename = original_url.split('/')[-1]
        original_path = os.path.join(settings.upload_dir, original_filename)
        if os.path.exists(original_path):
            try:
                import docx
                doc = docx.Document(original_path)
                in_chapter = False
                format_chapter_found = False
                
                # 遍历所有 block-level 元素
                for element in list(doc.element.body):
                    if element.tag.endswith('sectPr'):
                        continue
                        
                    if element.tag.endswith('p'):
                        from docx.text.paragraph import Paragraph
                        p = Paragraph(element, doc)
                        text = p.text.strip()
                        
                        if not in_chapter:
                            if re.match(r"^(?:第[一二三四五六七八九十百]+[章部分][ \t]+)?.*(?:招标|投标)文件.*格式.*$", text):
                                in_chapter = True
                                format_chapter_found = True
                            else:
                                element.getparent().remove(element)
                        else:
                            if re.match(r"^第[一二三四五六七八九十百]+[章部分][ \t]+", text):
                                in_chapter = False
                                element.getparent().remove(element)
                    else:
                        if not in_chapter:
                            element.getparent().remove(element)
                
                if format_chapter_found:
                    doc.save(output_path)
                    new_url = f"/uploads/{filename}"
                    try:
                        other_urls = json.loads(project.other_urls) if project.other_urls else {}
                    except:
                        other_urls = {}
                    other_urls["format_document_url"] = new_url
                    project.other_urls = json.dumps(other_urls, ensure_ascii=False)
                    db.commit()
                    return
            except Exception as e:
                logger.error(f"Failed to crop original docx: {e}")

    # 降级：从提取的纯文本创建一个新的 Word 文档
    doc = docx.Document()
    try:
        styles = doc.styles
        base_styles = ["Normal", "Heading 1", "Heading 2", "Heading 3", "Title"]
        for style_name in base_styles:
            if style_name in styles:
                style = styles[style_name]
                font = style.font
                font.name = "宋体"
                if style._element.rPr is None:
                    style._element._add_rPr()
                rpr = style._element.rPr
                rpr.rFonts.set(qn("w:eastAsia"), "宋体")
                if style_name == "Normal":
                    font.bold = False
    except Exception:
        pass

    # 简单的 Markdown 解析插入段落
    lines = chapter_text.split('\n')
    for line in lines:
        if not line.strip():
            continue
        p = doc.add_paragraph()
        run = p.add_run(line.strip())
        run.font.name = "宋体"
        r = run._element.rPr
        if r is not None and r.rFonts is not None:
            r.rFonts.set(qn("w:eastAsia"), "宋体")
            
    # 保存新的 Word 文档
    doc.save(output_path)
    
    # 更新 project 的 other_urls
    new_url = f"/uploads/{filename}"
    
    try:
        other_urls = json.loads(project.other_urls) if project.other_urls else {}
    except:
        other_urls = {}
        
    other_urls["format_document_url"] = new_url
    project.other_urls = json.dumps(other_urls, ensure_ascii=False)
    db.commit()


def extract_content_for_directories(directories, project):
    from bs4 import BeautifulSoup
    import mammoth
    import os
    import json
    import re
    from app.core.config import settings

    content_text = project.tender_content or ""
    format_chapter_pos, format_chapter_end, chapter_text = get_format_chapter_info(content_text)
    
    # 尝试加载 HTML 格式的格式章节
    html_elements = []
    use_html = False
    
    if project.other_urls:
        try:
            other_urls = json.loads(project.other_urls)
            format_doc_url = other_urls.get("format_document_url")
            if format_doc_url:
                filename = format_doc_url.split('/')[-1]
                docx_path = os.path.join(settings.upload_dir, filename)
                if os.path.exists(docx_path):
                    with open(docx_path, "rb") as f:
                        result = mammoth.convert_to_html(f)
                        html = result.value
                    soup = BeautifulSoup(html, 'html.parser')
                    html_elements = soup.find_all(recursive=False)
                    if html_elements:
                        use_html = True
        except Exception as e:
            logger.error(f"Failed to parse docx to HTML with mammoth: {e}")

    flat_nodes = []
    def flatten(nodes):
        for n in nodes:
            flat_nodes.append(n)
            if n.get("children"):
                flatten(n["children"])
    flatten(directories)
    
    def clean_title(t):
        t = re.sub(r"^[一二三四五六七八九十\d\.\s、]+", "", t).strip()
        return t

    for i, node in enumerate(flat_nodes):
        title = node.get("title", "")
        next_title = None
        if i + 1 < len(flat_nodes):
            next_title = flat_nodes[i + 1].get("title", "")
            
        core_title = clean_title(title)
        
        if use_html:
            core_next_title = clean_title(next_title) if next_title else None
            
            start_idx = -1
            for idx, el in enumerate(html_elements):
                text = el.get_text().strip()
                # 寻找包含核心标题的段落，且不要太长
                if core_title and core_title in text and len(text) < len(core_title) + 50:
                    start_idx = idx
                    break
            
            if start_idx != -1:
                end_idx = len(html_elements)
                if core_next_title:
                    for idx in range(start_idx + 1, len(html_elements)):
                        text = html_elements[idx].get_text().strip()
                        if core_next_title in text and len(text) < len(core_next_title) + 50:
                            end_idx = idx
                            break
                
                # 拼接 HTML
                html_parts = []
                for idx in range(start_idx, end_idx):
                    html_parts.append(str(html_elements[idx]))
                    
                node["content"] = "".join(html_parts)
                continue  # 成功提取 HTML，跳过纯文本提取
        
        # 降级或未匹配到 HTML，使用原有的纯文本提取逻辑
        start = find_title_pos(content_text, title, format_chapter_pos, format_chapter_end)
        
        if start < 0:
            if format_chapter_pos > 0:
                node["content"] = "【未精确匹配到该标题，以下为投标文件格式章节内容参考】\n\n" + content_text[format_chapter_pos:min(format_chapter_pos+2000, format_chapter_end)]
            else:
                node["content"] = ""
        else:
            end = format_chapter_end
            if next_title:
                found = find_title_pos(content_text, next_title, start + len(title), format_chapter_end)
                if found > start:
                    end = found
            extracted = content_text[start:end].strip("\n")
            node["content"] = extracted

@router.post("/{project_id}/generate-directories-stream")
async def generate_business_directories_stream(project_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(BusinessBidProject).filter(BusinessBidProject.id == project_id, BusinessBidProject.user_id == current_user.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    config = config_manager.load_config()
    if not config.get('api_key'):
        raise HTTPException(status_code=400, detail="请先配置OpenAI API密钥")

    openai_service = OpenAIService()

    async def generate():
        from app.database import SessionLocal
        import asyncio
        
        chapter_text = None
        if project.tender_content:
            _, _, chapter_text = get_format_chapter_info(project.tender_content)
            
        if chapter_text:
            system_prompt = """你是一名专业的标书编写专家。请根据提供的【投标文件格式】或【招标文件格式】章节内容，按其原本的目录层次生成一份标准的商务标目录大纲。
请严格输出JSON格式，格式如下：
[
  {
    "id": "1",
    "title": "法定代表人身份证明",
    "description": "提供法定代表人身份证正反面复印件及身份证明书",
    "children": []
  },
  ...
]
请确保直接输出JSON，不要包含任何其他说明文字、Markdown代码块标记。"""
            
            # 截取前8000字，避免超出token限制，通常目录结构在章节开头
            user_prompt = f"请根据以下提取的格式章节内容，提取其目录层次生成商务标目录大纲：\n\n{chapter_text[:8000]}"
        else:
            system_prompt = """你是一名专业的标书编写专家。请根据提供的商务要求要素，生成一份标准的商务标目录大纲。
请严格输出JSON格式，格式如下：
[
  {
    "id": "1",
    "title": "法定代表人身份证明",
    "description": "提供法定代表人身份证正反面复印件及身份证明书",
    "children": []
  },
  ...
]
目录结构通常包括：投标函、法定代表人身份证明、授权委托书、营业执照、资质证书、财务状况、业绩证明、人员证明等。
请确保直接输出JSON，不要包含任何其他说明文字、Markdown代码块标记。"""
            
            elements_str = project.elements_content or "{}"
            user_prompt = f"请根据以下商务要素，生成商务标目录大纲：\n\n{elements_str}"
        
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
        
        db_gen = SessionLocal()
        try:
            full_response = ""
            try:
                async for chunk in openai_service.stream_chat_completion(messages, temperature=0.3):
                    full_response += chunk
                    yield f"data: {json.dumps({'chunk': chunk}, ensure_ascii=False)}\n\n"
            except asyncio.CancelledError:
                logger.warning("Client disconnected during directory streaming. Saving partial result.")
            except Exception as inner_e:
                logger.error(f"Error during directory stream: {inner_e}")
                yield f"data: {json.dumps({'error': str(inner_e)}, ensure_ascii=False)}\n\n"
            
            project_gen = db_gen.query(BusinessBidProject).filter(BusinessBidProject.id == project_id).first()
            if project_gen:
                # 尝试清理可能存在的Markdown代码块标记
                cleaned_response = full_response.strip()
                if cleaned_response.startswith("```json"):
                    cleaned_response = cleaned_response[7:]
                if cleaned_response.endswith("```"):
                    cleaned_response = cleaned_response[:-3]
                cleaned_response = cleaned_response.strip()

                try:
                    generate_format_word_file(project_gen, db_gen)
                    logger.info("Successfully generated format word document.")
                except Exception as ex:
                    logger.error(f"Failed to generate format word document: {ex}")

                try:
                    directories = json.loads(cleaned_response)
                    
                    if project_gen.tender_content:
                        extract_content_for_directories(directories, project_gen)
                                
                    cleaned_response = json.dumps(directories, ensure_ascii=False)
                except Exception as ex:
                    logger.error(f"Failed to pre-extract content for directories: {ex}")

                # Save the result to DB
                project_gen.directories_content = cleaned_response
                project_gen.status = "generating"
                db_gen.commit()
                
                logger.info("Successfully saved directories to DB.")
            
            yield "data: [DONE]\n\n"
        except asyncio.CancelledError:
            logger.warning("Client disconnected. Directory generation aborted.")
        except Exception as e:
            logger.error(f"Directory generation failed: {e}")
            yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        finally:
            db_gen.close()

    return sse_response(generate())

@router.get("/{project_id}/directories")
def get_business_directories(project_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(BusinessBidProject).filter(BusinessBidProject.id == project_id, BusinessBidProject.user_id == current_user.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    if project.directories_content:
        try:
            directories = json.loads(project.directories_content)
            return {"directories": directories}
        except json.JSONDecodeError:
            pass
            
    return {
        "directories": []
    }

@router.get("/{project_id}/directory-source")
def get_directory_source_content(project_id: str, node_title: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(BusinessBidProject).filter(BusinessBidProject.id == project_id, BusinessBidProject.user_id == current_user.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not project.tender_content:
        raise HTTPException(status_code=400, detail="Tender document not uploaded or content is empty")

    title = (node_title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="node_title is required")

    directories = []
    if project.directories_content:
        try:
            directories = json.loads(project.directories_content) or []
        except json.JSONDecodeError:
            directories = []

    flat: List[tuple[str, int]] = []

    def flatten(nodes, depth: int = 0):
        if not isinstance(nodes, list):
            return
        for n in nodes:
            if not isinstance(n, dict):
                continue
            t = str(n.get("title") or "")
            flat.append((t, depth))
            children = n.get("children") or []
            flatten(children, depth + 1)

    flatten(directories, 0)

    idx: Optional[int] = None
    current_depth = 0
    for i, (t, d) in enumerate(flat):
        if t == title:
            idx = i
            current_depth = d
            break

    next_title: Optional[str] = None
    if idx is not None:
        for j in range(idx + 1, len(flat)):
            t, d = flat[j]
            if d <= current_depth and t:
                next_title = t
                break
        if next_title is None and idx + 1 < len(flat):
            t, _ = flat[idx + 1]
            if t:
                next_title = t

    content_text = project.tender_content

    # 1. 定位“投标文件格式”大章节
    format_chapter_pos = 0
    format_chapter_end = len(content_text)
    
    # 匹配可能的章节标题，如 "第八章 投标文件格式", "第六章 投标文件相关格式", 或单独的 "投标文件格式"
    # 同时匹配 "投标文件" 和 "格式"
    format_match = re.search(r"(?m)^[ \t]*(?:第[一二三四五六七八九十百]+[章部分][ \t]+)?.*投标文件.*格式.*[ \t]*$", content_text)
    if format_match:
        format_chapter_pos = format_match.start()
    else:
        # 降级：如果找不到严格的标题行，尝试找全文中的"投标文件格式"
        fallback_idx = content_text.find("投标文件格式")
        if fallback_idx != -1:
            format_chapter_pos = fallback_idx

    if format_chapter_pos > 0:
        # 寻找下一个大章节标题，作为本章节的结束
        # 假设大章节格式为 "第X章" 或 "第X部分"
        next_chapter_match = re.search(r"(?m)^[ \t]*第[一二三四五六七八九十百]+[章部分][ \t]+", content_text[format_chapter_pos + 10:])
        if next_chapter_match:
            format_chapter_end = format_chapter_pos + 10 + next_chapter_match.start()

    # 只在“投标文件格式”章节内查找对应的目录节点
    start = find_title_pos(content_text, title, format_chapter_pos, format_chapter_end)

    # 尝试读取新生成的格式文件 URL
    document_url = project.tender_document_url
    if project.other_urls:
        try:
            other_urls = json.loads(project.other_urls)
            if "format_document_url" in other_urls:
                document_url = other_urls["format_document_url"]
        except Exception:
            pass

    if start < 0:
        # 如果在格式章节内没找到，直接返回格式章节的开头部分供用户参考
        if format_chapter_pos > 0:
            page_num = 1
            matches = list(re.finditer(r'--- 第 (\d+) 页 ---', content_text[:format_chapter_pos]))
            if matches:
                page_num = int(matches[-1].group(1))
            return {
                "success": True, 
                "matched": False, 
                "node_title": title, 
                "content": "【未精确匹配到该标题，以下为投标文件格式章节内容参考】\n\n" + content_text[format_chapter_pos:min(format_chapter_pos+2000, format_chapter_end)],
                "page_num": page_num,
                "document_url": document_url
            }
        return {"success": True, "matched": False, "node_title": title, "content": ""}

    # 尝试寻找页码 (向后查找最近的页码标记)
    page_num = 1
    page_marker_pattern = re.compile(r'--- 第 (\d+) 页 ---')
    matches = list(page_marker_pattern.finditer(content_text[:start]))
    if matches:
        page_num = int(matches[-1].group(1))

    end = format_chapter_end
    if next_title:
        found = find_title_pos(content_text, next_title, start + len(title), format_chapter_end)
        if found > start:
            end = found

    extracted = content_text[start:end].strip("\n")
    
    # 尝试读取新生成的格式文件 URL
    document_url = project.tender_document_url
    if project.other_urls:
        try:
            other_urls = json.loads(project.other_urls)
            if "format_document_url" in other_urls:
                document_url = other_urls["format_document_url"]
        except Exception:
            pass

    return {
        "success": True, 
        "matched": True, 
        "node_title": title, 
        "next_title": next_title, 
        "content": extracted,
        "page_num": page_num,
        "document_url": document_url
    }

class BusinessProjectUpdate(BaseModel):
    status: str | None = None
    tender_document_name: str | None = None
    tender_content: str | None = None
    elements_content: str | None = None
    directories_content: str | None = None

@router.put("/{project_id}")
def update_business_project(project_id: str, data: BusinessProjectUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(BusinessBidProject).filter(BusinessBidProject.id == project_id, BusinessBidProject.user_id == current_user.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    if data.status is not None:
        project.status = data.status
    if data.tender_document_name is not None:
        project.tender_document_name = data.tender_document_name
    if data.tender_content is not None:
        project.tender_content = data.tender_content
    if data.elements_content is not None:
        project.elements_content = data.elements_content
    if data.directories_content is not None:
        if project.tender_content:
            try:
                directories = json.loads(data.directories_content)
                extract_content_for_directories(directories, project)
                project.directories_content = json.dumps(directories, ensure_ascii=False)
            except Exception as e:
                logger.error(f"Failed to extract content on PUT update: {e}")
                project.directories_content = data.directories_content
        else:
            project.directories_content = data.directories_content
        
    db.commit()
    return {"success": True, "message": "Project updated"}

@router.post("/{project_id}/mark-completed")
def mark_business_project_completed(project_id: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(BusinessBidProject).filter(BusinessBidProject.id == project_id, BusinessBidProject.user_id == current_user.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    project.status = "completed"
    db.commit()
    
    return {"success": True, "message": "Project marked as completed", "status": project.status}

@router.get("/{project_id}/match-resource")
def match_business_resource(project_id: str, node_title: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(BusinessBidProject).filter(BusinessBidProject.id == project_id, BusinessBidProject.user_id == current_user.id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
        
    results = []
    
    # 简单的基于关键词的匹配逻辑
    title = node_title.lower()

    def s(v):
        return v or ""

    if any(k in title for k in ["授权委托", "被授权", "委托人身份证", "授权人身份证", "授权身份证", "受托人身份证"]):
        info = db.query(CompanyInfo).filter(CompanyInfo.user_id == current_user.id).first()
        if info:
            results.append({
                "id": f"auth_idcard_{info.id}",
                "type": "company",
                "title": "授权委托人身份证",
                "content": "\n".join([
                    f"姓名: {s(info.authorized_person)}",
                    f"性别: {s(info.authorized_person_gender)}",
                    f"出生日期: {s(info.authorized_person_birth_date)}",
                    f"身份证号: {s(info.authorized_person_id_number)}",
                    f"有效期自: {s(info.authorized_person_id_valid_from)}",
                    f"有效期至: {s(info.authorized_person_id_valid_to)}",
                    f"长期有效: {'是' if info.authorized_person_id_long_term else '否'}" if info.authorized_person_id_long_term is not None else "",
                ]).strip(),
                "image_url": info.authorized_person_id_card_url,
            })

    if any(k in title for k in ["法人身份证", "法定代表人身份证", "法人代表身份证"]) or ("法人" in title and "身份证" in title):
        info = db.query(CompanyInfo).filter(CompanyInfo.user_id == current_user.id).first()
        if info:
            results.append({
                "id": f"legal_idcard_{info.id}",
                "type": "company",
                "title": "法定代表人身份证",
                "content": "\n".join([
                    f"姓名: {s(info.legal_person)}",
                    f"性别: {s(info.legal_person_gender)}",
                    f"出生日期: {s(info.legal_person_birth_date)}",
                    f"身份证号: {s(info.legal_person_id_number)}",
                    f"有效期自: {s(info.legal_person_id_valid_from)}",
                    f"有效期至: {s(info.legal_person_id_valid_to)}",
                    f"长期有效: {'是' if info.legal_person_id_long_term else '否'}" if info.legal_person_id_long_term is not None else "",
                ]).strip(),
                "image_url": info.legal_person_id_card_url,
            })
    
    if any(k in title for k in ["营业执照", "法人", "公司", "主体"]):
        info = db.query(CompanyInfo).filter(CompanyInfo.user_id == current_user.id).first()
        if info:
            results.append({
                "id": f"company_{info.id}",
                "type": "company",
                "title": info.company_name or "公司信息",
                "content": f"公司名称: {s(info.company_name)}\n法定代表人: {s(info.legal_person)}\n注册资本: {s(info.registered_capital)}\n成立日期: {s(info.establish_date)}",
                "image_url": info.business_license_url
            })
            
    if any(k in title for k in ["资质", "许可", "证书"]):
        quals = db.query(Qualification).filter(Qualification.user_id == current_user.id).all()
        for q in quals:
            results.append({
                "id": f"qual_{q.id}",
                "type": "qualification",
                "title": q.cert_name,
                "content": f"证书名称: {q.cert_name}\n证书编号: {q.cert_number}\n发证机关: {q.issue_org}\n有效期至: {q.valid_end_date}",
                "image_url": q.cert_image_url
            })
            
    if any(k in title for k in ["人员", "经理", "负责人", "团队"]):
        personnel = db.query(Personnel).filter(Personnel.user_id == current_user.id).all()
        for p in personnel:
            results.append({
                "id": f"person_{p.id}",
                "type": "personnel",
                "title": f"{p.name} - {p.position or p.title or '人员'}",
                "content": f"姓名: {p.name}\n职务: {p.position}\n职称: {p.title}\n学历: {p.education}",
                "image_url": p.cert_image_url or p.id_card_url
            })
            
    if any(k in title for k in ["财务", "审计", "报表", "资信"]):
        fins = db.query(FinancialInfo).filter(FinancialInfo.user_id == current_user.id).all()
        for f in fins:
            results.append({
                "id": f"fin_{f.id}",
                "type": "financial",
                "title": f.info_name,
                "content": f"财务信息名称: {f.info_name}\n类型: {f.info_type}\n金额: {f.amount}",
                "image_url": f.file_url
            })
            
    if any(k in title for k in ["业绩", "合同", "项目", "经验"]):
        perfs = db.query(Performance).filter(Performance.user_id == current_user.id).all()
        for p in perfs:
            results.append({
                "id": f"perf_{p.id}",
                "type": "performance",
                "title": p.project_name,
                "content": f"项目名称: {p.project_name}\n客户名称: {p.client_name}\n合同金额: {p.contract_amount}\n项目时间: {p.start_date} 至 {p.end_date}",
                "image_url": p.contract_url or p.acceptance_url
            })
            
    # 如果没有匹配到任何数据，返回空列表
    return {"success": True, "results": results}
