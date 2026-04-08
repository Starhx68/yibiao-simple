"""数据库模型定义"""
from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, ForeignKey, Date, DECIMAL, JSON, Float
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base

# 直接使用 bcrypt
import bcrypt


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), default="user")
    real_name = Column(String(50))
    phone = Column(String(20))
    email = Column(String(100))
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    def set_password(self, password: str):
        self.password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

    def verify_password(self, password: str) -> bool:
        """验证密码，使用 bcrypt"""
        try:
            return bcrypt.checkpw(password.encode('utf-8'), self.password_hash.encode('utf-8'))
        except Exception:
            return False


class CompanyInfo(Base):
    __tablename__ = "company_info"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    company_name = Column(String(200))
    company_type = Column(String(100))
    legal_person = Column(String(50))
    legal_person_gender = Column(String(10))
    legal_person_birth_date = Column(Date)
    legal_person_id_number = Column(String(50))
    legal_person_id_card_url = Column(String(500))
    legal_person_id_valid_from = Column(Date)
    legal_person_id_valid_to = Column(Date)
    legal_person_id_long_term = Column(Boolean, default=False)
    legal_person_position = Column(String(100))
    registered_capital = Column(DECIMAL(15, 2))
    establish_date = Column(Date)
    operating_period_start = Column(Date)
    operating_period_end = Column(Date)
    operating_period_long_term = Column(Boolean, default=False)
    address = Column(String(500))
    business_scope = Column(Text)
    credit_code = Column(String(50))
    contact_person = Column(String(50))
    contact_phone = Column(String(30))
    contact_email = Column(String(100))
    postal_code = Column(String(20))
    registration_authority = Column(String(200))
    authorized_person = Column(String(50))
    authorized_person_gender = Column(String(10))
    authorized_person_birth_date = Column(Date)
    authorized_person_id_number = Column(String(50))
    authorized_person_id_card_url = Column(String(500))
    authorized_person_id_valid_from = Column(Date)
    authorized_person_id_valid_to = Column(Date)
    authorized_person_id_long_term = Column(Boolean, default=False)
    authorized_person_position = Column(String(100))
    authorized_person_phone = Column(String(30))
    bank_name = Column(String(100))
    bank_branch = Column(String(200))
    bank_account_name = Column(String(200))
    bank_account = Column(String(50))
    bank_address = Column(String(500))
    bank_license_url = Column(String(500))
    bank_code = Column(String(50))
    bank_phone = Column(String(30))
    product_and_function = Column(Text)
    brand_resource_capability = Column(Text)
    personnel_technical_capability = Column(Text)
    related_image_url = Column(String(500))
    logo_url = Column(String(500))
    seal_url = Column(String(500))
    business_license_url = Column(String(500))
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class Qualification(Base):
    __tablename__ = "qualifications"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    cert_name = Column(String(200), nullable=False)
    cert_number = Column(String(100))
    cert_level = Column(String(50))
    issue_org = Column(String(200))
    issue_date = Column(Date)
    valid_start_date = Column(Date)
    valid_end_date = Column(Date)
    valid_long_term = Column(Boolean, default=False)
    cert_image_url = Column(String(500))
    remark = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class Personnel(Base):
    __tablename__ = "personnel"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String(50), nullable=False)
    gender = Column(String(10))
    age = Column(Integer)
    birth_date = Column(Date)
    id_number = Column(String(30))
    id_valid_from = Column(Date)
    id_valid_to = Column(Date)
    id_long_term = Column(Boolean, default=False)
    phone = Column(String(30))
    email = Column(String(100))
    department = Column(String(100))
    position = Column(String(100))
    title = Column(String(100))
    status = Column(String(50))
    start_work_date = Column(Date)
    profile = Column(Text)
    education = Column(String(50))
    major = Column(String(100))
    work_years = Column(Integer)
    cert_name = Column(String(200))
    cert_number = Column(String(100))
    cert_level = Column(String(50))
    cert_major = Column(String(100))
    cert_valid_from = Column(Date)
    cert_valid_date = Column(Date)
    cert_long_term = Column(Boolean, default=False)
    id_card_url = Column(String(500))
    education_cert_url = Column(String(500))
    contract_url = Column(String(500))
    driver_license_url = Column(String(500))
    social_security_url = Column(String(500))
    photo_url = Column(String(500))
    cert_image_url = Column(String(500))
    resume_url = Column(String(500))
    remark = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class FinancialInfo(Base):
    __tablename__ = "financial_info"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    info_type = Column(String(50), nullable=False)
    info_name = Column(String(200), nullable=False)
    info_date = Column(Date)
    amount = Column(DECIMAL(15, 2))
    file_url = Column(String(500))
    remark = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class Performance(Base):
    __tablename__ = "performances"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    project_name = Column(String(200), nullable=False)
    project_number = Column(String(100))
    project_type = Column(String(100))
    package_number = Column(String(100))
    client_name = Column(String(200))
    client_type = Column(String(100))
    client_contact = Column(String(50))
    client_phone = Column(String(30))
    project_manager = Column(String(50))
    contract_number = Column(String(100))
    contract_amount = Column(DECIMAL(15, 2))
    start_date = Column(Date)
    end_date = Column(Date)
    project_location = Column(String(200))
    project_scale = Column(String(200))
    project_content = Column(Text)
    completion_status = Column(Text)
    acceptance_status = Column(Text)
    contract_url = Column(String(500))
    bid_notice_url = Column(String(500))
    acceptance_url = Column(String(500))
    evaluation_url = Column(String(500))
    invoice_url = Column(String(500))
    other_urls = Column(Text)
    remark = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

class BusinessBidProject(Base):
    __tablename__ = "business_bid_projects"
    
    id = Column(String(36), primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    project_name = Column(String(200), nullable=False)
    status = Column(String(20), default="draft") # draft, analyzing, generating, completed
    tender_document_url = Column(String(500))
    tender_document_name = Column(String(200))
    tender_content = Column(Text(16777215)) # 存储解析后的文本
    elements_content = Column(Text(16777215)) # 存储解析后的商务要素JSON
    directories_content = Column(Text(16777215)) # 存储生成的目录JSON
    other_urls = Column(Text) # 存储其他生成的URL，例如 format_document_url
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

class BusinessBidElement(Base):
    __tablename__ = "business_bid_elements"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    project_id = Column(String(36), ForeignKey("business_bid_projects.id", ondelete="CASCADE"), nullable=False)
    category = Column(String(50))
    key_name = Column(String(100))
    extracted_value = Column(Text)
    source_text = Column(Text)
    page_number = Column(Integer)
    bounding_box = Column(String(100)) # "x1,y1,x2,y2"
    created_at = Column(DateTime, server_default=func.now())

class BusinessBidDirectory(Base):
    __tablename__ = "business_bid_directories"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    project_id = Column(String(36), ForeignKey("business_bid_projects.id", ondelete="CASCADE"), nullable=False)
    parent_id = Column(Integer, ForeignKey("business_bid_directories.id", ondelete="CASCADE"), nullable=True)
    title = Column(String(200))
    level = Column(Integer)
    sort_order = Column(Integer)
    content_type = Column(String(50)) # text, richtext, form, image, auto
    content = Column(Text(16777215))
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

class TechnicalBidProject(Base):
    __tablename__ = "technical_bid_projects"
    
    id = Column(String(36), primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    project_name = Column(String(200), nullable=False)
    status = Column(String(20), default="draft") # draft, analyzing, outlined, generated, completed
    file_content = Column(Text(16777215)) # 招标文件内容
    project_overview = Column(Text(16777215)) # 项目概述
    tech_requirements = Column(Text(16777215)) # 技术要求
    outline_data = Column(Text(16777215)) # 目录结构及内容 JSON
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class TechnicalBidLibrary(Base):
    __tablename__ = "technical_bid_library"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    library_name = Column(String(200), nullable=False)
    library_type = Column(String(50), default="technical")
    industry = Column(String(100))
    project_type = Column(String(100))
    industry_tags = Column(JSON)
    project_type_tags = Column(JSON)
    file_url = Column(String(500))
    file_name = Column(String(200))
    file_size = Column(Integer, default=0)
    file_hash = Column(String(64))
    file_format = Column(String(20))
    total_pages = Column(Integer, default=0)
    total_words = Column(Integer, default=0)
    total_chapters = Column(Integer, default=0)
    total_chunks = Column(Integer, default=0)
    summary_chunks = Column(Integer, default=0)
    status = Column(String(20), default="pending")
    progress = Column(Float, default=0)
    processed_chunks = Column(Integer, default=0)
    error_msg = Column(Text)
    processing_started_at = Column(DateTime)
    processing_completed_at = Column(DateTime)
    processing_duration = Column(Integer)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class RagIndustryCategory(Base):
    __tablename__ = "rag_industry_categories"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    code = Column(String(20), nullable=False, index=True)
    name = Column(String(100), nullable=False, index=True)
    keywords = Column(JSON)
    sort_order = Column(Integer, default=0, index=True)
    enabled = Column(Boolean, default=True, index=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class RagProjectTypeCategory(Base):
    __tablename__ = "rag_project_type_categories"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    code = Column(String(30), nullable=False, index=True)
    name = Column(String(100), nullable=False, index=True)
    keywords = Column(JSON)
    sort_order = Column(Integer, default=0, index=True)
    enabled = Column(Boolean, default=True, index=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class TechnicalBidChunk(Base):
    __tablename__ = "technical_bid_chunks"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    library_id = Column(Integer, ForeignKey("technical_bid_library.id", ondelete="CASCADE"), nullable=False, index=True)
    chunk_index = Column(Integer, nullable=False)
    chunk_type = Column(String(20), default="content")
    chapter_path = Column(String(500))
    chapter_level = Column(Integer)
    chapter_title = Column(String(200))
    parent_chapter_path = Column(String(500))
    chunk_content = Column(Text, nullable=False)
    content_length = Column(Integer, default=0)
    content_hash = Column(String(64))
    vector_id = Column(String(100))
    embedding_model = Column(String(100))
    embedding_dimension = Column(Integer)
    meta_json = Column("metadata", JSON)
    is_summary_chunk = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())


class RagGenerationLog(Base):
    __tablename__ = "rag_generation_log"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    project_id = Column(String(36), ForeignKey("technical_bid_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    chapter_id = Column(String(100), index=True)
    query_text = Column(Text)
    query_embedding_model = Column(String(100))
    retrieved_count = Column(Integer, default=0)
    retrieved_chunks = Column(JSON)
    used_rag = Column(Boolean, default=False)
    rag_sources = Column(JSON)
    llm_model = Column(String(100))
    llm_response = Column(Text)
    response_tokens = Column(Integer)
    retrieval_time = Column(Integer)
    generation_time = Column(Integer)
    total_time = Column(Integer)
    created_at = Column(DateTime, server_default=func.now())


class RagRebuildTask(Base):
    __tablename__ = "rag_rebuild_tasks"

    task_id = Column(String(32), primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    library_id = Column(Integer, ForeignKey("technical_bid_library.id", ondelete="SET NULL"), nullable=True, index=True)
    batch_size = Column(Integer, default=100)
    status = Column(String(20), default="pending", index=True)
    progress = Column(Float, default=0)
    stage = Column(String(50), default="pending")
    message = Column(String(255))
    total_chunks = Column(Integer, default=0)
    processed_chunks = Column(Integer, default=0)
    failed_chunks = Column(Integer, default=0)
    result = Column(JSON)
    error = Column(Text)
    started_at = Column(DateTime, server_default=func.now(), index=True)
    finished_at = Column(DateTime)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), index=True)


class TechnicalBidConstraint(Base):
    __tablename__ = "technical_bid_constraints"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    project_id = Column(String(36), ForeignKey("technical_bid_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    category = Column(String(100), nullable=False)
    key_name = Column(String(100), nullable=False)
    value = Column(Text, nullable=False)
    is_mandatory = Column(Boolean, default=True)
    source_chapter = Column(String(200))
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class TechnicalBidConsistencyCheck(Base):
    __tablename__ = "technical_bid_consistency_checks"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    project_id = Column(String(36), ForeignKey("technical_bid_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    chapter_id = Column(String(100), index=True)
    check_type = Column(String(50), default="global")
    check_result = Column(String(20), nullable=False, index=True)
    severity = Column(String(20), default="medium", index=True)
    violations = Column(JSON)
    checked_at = Column(DateTime, server_default=func.now())
    resolved_at = Column(DateTime)
    resolved_by = Column(Integer, ForeignKey("users.id"), nullable=True)


class ChapterCitation(Base):
    __tablename__ = "chapter_citations"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    project_id = Column(String(36), ForeignKey("technical_bid_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    chapter_id = Column(String(100), nullable=False, index=True)
    chapter_title = Column(String(200))
    total_sentences = Column(Integer, default=0)
    cited_sentences = Column(Integer, default=0)
    citation_ratio = Column(Float, default=0)
    risk_level = Column(String(20), default="low", index=True)
    generated_at = Column(DateTime, server_default=func.now())
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class CitationSource(Base):
    __tablename__ = "citation_sources"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    citation_id = Column(Integer, ForeignKey("chapter_citations.id", ondelete="CASCADE"), nullable=False, index=True)
    library_id = Column(Integer, ForeignKey("technical_bid_library.id", ondelete="SET NULL"), nullable=True)
    library_name = Column(String(200))
    chapter_title = Column(String(200))
    contribution = Column(Float, default=0)
    sentences_count = Column(Integer, default=0)
    similarity_avg = Column(Float, default=0)
    created_at = Column(DateTime, server_default=func.now())


class TechnicalBidImage(Base):
    __tablename__ = "technical_bid_images"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    library_id = Column(Integer, ForeignKey("technical_bid_library.id", ondelete="CASCADE"), nullable=False, index=True)
    chunk_id = Column(Integer, ForeignKey("technical_bid_chunks.id", ondelete="SET NULL"), nullable=True)
    image_type = Column(String(50), index=True)
    image_title = Column(String(200))
    image_description = Column(Text)
    original_url = Column(String(500))
    thumbnail_url = Column(String(500))
    file_format = Column(String(20))
    file_size = Column(Integer)
    width = Column(Integer)
    height = Column(Integer)
    embedding_model = Column(String(100))
    image_vector_id = Column(String(100))
    text_vector_id = Column(String(100))
    ocr_text = Column(Text)
    analysis_result = Column(JSON)
    page_number = Column(Integer)
    chapter_path = Column(String(500), index=True)
    meta_json = Column("metadata", JSON)
    created_at = Column(DateTime, server_default=func.now())


class ImageModificationRecord(Base):
    __tablename__ = "image_modification_records"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    project_id = Column(String(36), ForeignKey("technical_bid_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    source_image_id = Column(Integer, ForeignKey("technical_bid_images.id", ondelete="SET NULL"), nullable=True, index=True)
    modification_type = Column(String(50))
    modification_reason = Column(Text)
    original_description = Column(Text)
    original_elements = Column(JSON)
    modified_description = Column(Text)
    modified_elements = Column(JSON)
    modification_marks = Column(JSON)
    status = Column(String(20), default="pending", index=True)
    confirmed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    confirmed_at = Column(DateTime)
    feedback = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
