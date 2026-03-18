import os
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from typing import List
from pydantic import BaseModel
from ..services.auth_service import get_current_user
from ..models.models import User, BusinessBidProject
from ..database import get_db
from sqlalchemy.orm import Session
from ..services.file_service import FileService
from ..services.openai_service import OpenAIService
from ..utils.config_manager import config_manager
from ..utils.sse import sse_response
import uuid
import json
import logging

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

                # Save the result to DB
                project_gen.directories_content = cleaned_response
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
