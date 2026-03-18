"""数据模型定义"""
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any
from enum import Enum
from datetime import datetime, date
from decimal import Decimal


class ConfigRequest(BaseModel):
    """OpenAI配置请求"""
    model_config = {"protected_namespaces": ()}
    
    api_key: str = Field(..., description="OpenAI API密钥")
    base_url: Optional[str] = Field(None, description="Base URL")
    model_name: Optional[str] = Field(None, description="模型名称")
    ocr_model: Optional[str] = Field(None, description="OCR模型名称")


class ConfigResponse(BaseModel):
    """配置响应"""
    success: bool
    message: str


class ModelListResponse(BaseModel):
    """模型列表响应"""
    models: List[str]
    success: bool
    message: str = ""


class FileUploadResponse(BaseModel):
    """文件上传响应"""
    success: bool
    message: str
    file_content: Optional[str] = None
    old_outline: Optional[str] = None


class AnalysisType(str, Enum):
    """分析类型"""
    OVERVIEW = "overview"
    REQUIREMENTS = "requirements"


class AnalysisRequest(BaseModel):
    """文档分析请求"""
    file_content: str = Field(..., description="文档内容")
    analysis_type: AnalysisType = Field(..., description="分析类型")


class OutlineItem(BaseModel):
    """目录项"""
    id: str
    title: str
    description: str
    children: Optional[List['OutlineItem']] = None
    content: Optional[str] = None


# 解决循环引用
OutlineItem.model_rebuild()


class OutlineResponse(BaseModel):
    """目录响应"""
    outline: List[OutlineItem]


class OutlineRequest(BaseModel):
    """目录生成请求"""
    overview: str = Field(..., description="项目概述")
    requirements: str = Field(..., description="技术评分要求")
    uploaded_expand: Optional[bool] = Field(False, description="是否已上传方案扩写文件")
    old_outline: Optional[str] = Field(None, description="上传的方案扩写文件解析出的旧目录JSON")
    old_document: Optional[str] = Field(None, description="上传的方案扩写文件解析出的旧文档")

class ContentGenerationRequest(BaseModel):
    """内容生成请求"""
    outline: Dict[str, Any] = Field(..., description="目录结构")
    project_overview: str = Field("", description="项目概述")


class ChapterContentRequest(BaseModel):
    """单章节内容生成请求"""
    chapter: Dict[str, Any] = Field(..., description="章节信息")
    parent_chapters: Optional[List[Dict[str, Any]]] = Field(None, description="上级章节列表")
    sibling_chapters: Optional[List[Dict[str, Any]]] = Field(None, description="同级章节列表")
    project_overview: str = Field("", description="项目概述")


class ErrorResponse(BaseModel):
    """错误响应"""
    error: str
    detail: Optional[str] = None


class WordExportRequest(BaseModel):
    """Word导出请求"""
    project_name: Optional[str] = Field(None, description="项目名称")
    project_overview: Optional[str] = Field(None, description="项目概述")
    outline: List[OutlineItem] = Field(..., description="目录结构，包含内容")


class UserBase(BaseModel):
    username: str
    real_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None


class UserCreate(UserBase):
    password: str
    role: str = "user"


class UserUpdate(BaseModel):
    real_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None


class UserResponse(UserBase):
    id: int
    role: str
    is_active: bool
    created_at: datetime
    
    class Config:
        from_attributes = True


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class CompanyInfoBase(BaseModel):
    company_name: Optional[str] = None
    company_type: Optional[str] = None
    legal_person: Optional[str] = None
    legal_person_gender: Optional[str] = None
    legal_person_birth_date: Optional[date] = None
    legal_person_id_number: Optional[str] = None
    legal_person_id_card_url: Optional[str] = None
    legal_person_id_valid_from: Optional[date] = None
    legal_person_id_valid_to: Optional[date] = None
    legal_person_id_long_term: Optional[bool] = None
    legal_person_position: Optional[str] = None
    registered_capital: Optional[Decimal] = None
    establish_date: Optional[date] = None
    operating_period_start: Optional[date] = None
    operating_period_end: Optional[date] = None
    operating_period_long_term: Optional[bool] = None
    address: Optional[str] = None
    business_scope: Optional[str] = None
    credit_code: Optional[str] = None
    contact_person: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[str] = None
    postal_code: Optional[str] = None
    registration_authority: Optional[str] = None
    authorized_person: Optional[str] = None
    authorized_person_gender: Optional[str] = None
    authorized_person_birth_date: Optional[date] = None
    authorized_person_id_number: Optional[str] = None
    authorized_person_id_card_url: Optional[str] = None
    authorized_person_id_valid_from: Optional[date] = None
    authorized_person_id_valid_to: Optional[date] = None
    authorized_person_id_long_term: Optional[bool] = None
    authorized_person_position: Optional[str] = None
    authorized_person_phone: Optional[str] = None
    bank_name: Optional[str] = None
    bank_branch: Optional[str] = None
    bank_account_name: Optional[str] = None
    bank_account: Optional[str] = None
    bank_address: Optional[str] = None
    bank_license_url: Optional[str] = None
    bank_code: Optional[str] = None
    bank_phone: Optional[str] = None
    product_and_function: Optional[str] = None
    brand_resource_capability: Optional[str] = None
    personnel_technical_capability: Optional[str] = None
    related_image_url: Optional[str] = None
    logo_url: Optional[str] = None
    seal_url: Optional[str] = None
    business_license_url: Optional[str] = None


class CompanyInfoCreate(CompanyInfoBase):
    pass


class CompanyInfoUpdate(CompanyInfoBase):
    pass


class CompanyInfoResponse(CompanyInfoBase):
    id: int
    user_id: int
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class QualificationBase(BaseModel):
    cert_name: str
    cert_number: Optional[str] = None
    cert_level: Optional[str] = None
    issue_org: Optional[str] = None
    issue_date: Optional[date] = None
    valid_start_date: Optional[date] = None
    valid_end_date: Optional[date] = None
    valid_long_term: Optional[bool] = None
    cert_image_url: Optional[str] = None
    remark: Optional[str] = None


class QualificationCreate(QualificationBase):
    pass


class QualificationUpdate(BaseModel):
    cert_name: Optional[str] = None
    cert_number: Optional[str] = None
    cert_level: Optional[str] = None
    issue_org: Optional[str] = None
    issue_date: Optional[date] = None
    valid_start_date: Optional[date] = None
    valid_end_date: Optional[date] = None
    valid_long_term: Optional[bool] = None
    cert_image_url: Optional[str] = None
    remark: Optional[str] = None


class QualificationResponse(QualificationBase):
    id: int
    user_id: int
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class PersonnelBase(BaseModel):
    name: str
    gender: Optional[str] = None
    age: Optional[int] = None
    birth_date: Optional[date] = None
    id_number: Optional[str] = None
    id_valid_from: Optional[date] = None
    id_valid_to: Optional[date] = None
    id_long_term: Optional[bool] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    department: Optional[str] = None
    position: Optional[str] = None
    title: Optional[str] = None
    status: Optional[str] = None
    start_work_date: Optional[date] = None
    profile: Optional[str] = None
    education: Optional[str] = None
    major: Optional[str] = None
    work_years: Optional[int] = None
    cert_name: Optional[str] = None
    cert_number: Optional[str] = None
    cert_level: Optional[str] = None
    cert_major: Optional[str] = None
    cert_valid_from: Optional[date] = None
    cert_valid_date: Optional[date] = None
    cert_long_term: Optional[bool] = None
    id_card_url: Optional[str] = None
    education_cert_url: Optional[str] = None
    contract_url: Optional[str] = None
    driver_license_url: Optional[str] = None
    social_security_url: Optional[str] = None
    photo_url: Optional[str] = None
    cert_image_url: Optional[str] = None
    resume_url: Optional[str] = None
    remark: Optional[str] = None


class PersonnelCreate(PersonnelBase):
    pass


class PersonnelUpdate(BaseModel):
    name: Optional[str] = None
    gender: Optional[str] = None
    age: Optional[int] = None
    birth_date: Optional[date] = None
    id_number: Optional[str] = None
    id_valid_from: Optional[date] = None
    id_valid_to: Optional[date] = None
    id_long_term: Optional[bool] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    department: Optional[str] = None
    position: Optional[str] = None
    title: Optional[str] = None
    status: Optional[str] = None
    start_work_date: Optional[date] = None
    profile: Optional[str] = None
    education: Optional[str] = None
    major: Optional[str] = None
    work_years: Optional[int] = None
    cert_name: Optional[str] = None
    cert_number: Optional[str] = None
    cert_level: Optional[str] = None
    cert_major: Optional[str] = None
    cert_valid_from: Optional[date] = None
    cert_valid_date: Optional[date] = None
    cert_long_term: Optional[bool] = None
    id_card_url: Optional[str] = None
    education_cert_url: Optional[str] = None
    contract_url: Optional[str] = None
    driver_license_url: Optional[str] = None
    social_security_url: Optional[str] = None
    photo_url: Optional[str] = None
    cert_image_url: Optional[str] = None
    resume_url: Optional[str] = None
    remark: Optional[str] = None


class PersonnelResponse(PersonnelBase):
    id: int
    user_id: int
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class FinancialInfoBase(BaseModel):
    info_type: str
    info_name: str
    info_date: Optional[date] = None
    amount: Optional[Decimal] = None
    file_url: Optional[str] = None
    remark: Optional[str] = None


class FinancialInfoCreate(FinancialInfoBase):
    pass


class FinancialInfoUpdate(BaseModel):
    info_type: Optional[str] = None
    info_name: Optional[str] = None
    info_date: Optional[date] = None
    amount: Optional[Decimal] = None
    file_url: Optional[str] = None
    remark: Optional[str] = None


class FinancialInfoResponse(FinancialInfoBase):
    id: int
    user_id: int
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class PerformanceBase(BaseModel):
    project_name: str
    project_number: Optional[str] = None
    project_type: Optional[str] = None
    package_number: Optional[str] = None
    client_name: Optional[str] = None
    client_type: Optional[str] = None
    client_contact: Optional[str] = None
    client_phone: Optional[str] = None
    project_manager: Optional[str] = None
    contract_number: Optional[str] = None
    contract_amount: Optional[Decimal] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    project_location: Optional[str] = None
    project_scale: Optional[str] = None
    project_content: Optional[str] = None
    completion_status: Optional[str] = None
    acceptance_status: Optional[str] = None
    contract_url: Optional[str] = None
    bid_notice_url: Optional[str] = None
    acceptance_url: Optional[str] = None
    evaluation_url: Optional[str] = None
    invoice_url: Optional[str] = None
    other_urls: Optional[str] = None
    remark: Optional[str] = None


class PerformanceCreate(PerformanceBase):
    pass


class PerformanceUpdate(BaseModel):
    project_name: Optional[str] = None
    project_number: Optional[str] = None
    project_type: Optional[str] = None
    package_number: Optional[str] = None
    client_name: Optional[str] = None
    client_type: Optional[str] = None
    client_contact: Optional[str] = None
    client_phone: Optional[str] = None
    project_manager: Optional[str] = None
    contract_number: Optional[str] = None
    contract_amount: Optional[Decimal] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    project_location: Optional[str] = None
    project_scale: Optional[str] = None
    project_content: Optional[str] = None
    completion_status: Optional[str] = None
    acceptance_status: Optional[str] = None
    contract_url: Optional[str] = None
    bid_notice_url: Optional[str] = None
    acceptance_url: Optional[str] = None
    evaluation_url: Optional[str] = None
    invoice_url: Optional[str] = None
    other_urls: Optional[str] = None
    remark: Optional[str] = None


class PerformanceResponse(PerformanceBase):
    id: int
    user_id: int
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True


class PaginatedResponse(BaseModel):
    items: List
    total: int
    page: int
    page_size: int
    total_pages: int
