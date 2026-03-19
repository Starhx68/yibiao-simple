export interface User {
  id: number;
  username: string;
  real_name?: string;
  phone?: string;
  email?: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface CompanyInfo {
  id?: number;
  user_id?: number;
  company_name?: string;
  company_type?: string;
  legal_person?: string;
  legal_person_gender?: string;
  legal_person_birth_date?: string;
  legal_person_id_number?: string;
  legal_person_id_card_url?: string;
  legal_person_id_valid_from?: string;
  legal_person_id_valid_to?: string;
  legal_person_id_long_term?: boolean;
  legal_person_position?: string;
  registered_capital?: number;
  establish_date?: string;
  operating_period_start?: string;
  operating_period_end?: string;
  operating_period_long_term?: boolean;
  address?: string;
  business_scope?: string;
  credit_code?: string;
  contact_person?: string;
  contact_phone?: string;
  contact_email?: string;
  postal_code?: string;
  registration_authority?: string;
  authorized_person?: string;
  authorized_person_gender?: string;
  authorized_person_birth_date?: string;
  authorized_person_id_number?: string;
  authorized_person_id_card_url?: string;
  authorized_person_id_valid_from?: string;
  authorized_person_id_valid_to?: string;
  authorized_person_id_long_term?: boolean;
  authorized_person_position?: string;
  authorized_person_phone?: string;
  bank_name?: string;
  bank_branch?: string;
  bank_account_name?: string;
  bank_account?: string;
  bank_address?: string;
  bank_license_url?: string;
  bank_code?: string;
  bank_phone?: string;
  product_and_function?: string;
  brand_resource_capability?: string;
  personnel_technical_capability?: string;
  related_image_url?: string;
  logo_url?: string;
  seal_url?: string;
  business_license_url?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Qualification {
  id?: number;
  user_id?: number;
  cert_name: string;
  cert_number?: string;
  cert_level?: string;
  issue_org?: string;
  issue_date?: string;
  valid_start_date?: string;
  valid_end_date?: string;
  valid_long_term?: boolean;
  cert_image_url?: string;
  remark?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Personnel {
  id?: number;
  user_id?: number;
  name: string;
  gender?: string;
  age?: number;
  birth_date?: string;
  id_number?: string;
  id_valid_from?: string;
  id_valid_to?: string;
  id_long_term?: boolean;
  phone?: string;
  email?: string;
  department?: string;
  position?: string;
  title?: string;
  status?: string;
  start_work_date?: string;
  profile?: string;
  education?: string;
  major?: string;
  work_years?: number;
  cert_name?: string;
  cert_number?: string;
  cert_level?: string;
  cert_major?: string;
  cert_valid_from?: string;
  cert_valid_date?: string;
  cert_long_term?: boolean;
  id_card_url?: string;
  education_cert_url?: string;
  contract_url?: string;
  driver_license_url?: string;
  social_security_url?: string;
  photo_url?: string;
  cert_image_url?: string;
  resume_url?: string;
  remark?: string;
  created_at?: string;
  updated_at?: string;
}

export interface FinancialInfo {
  id?: number;
  user_id?: number;
  info_type: string;
  info_name: string;
  info_date?: string;
  amount?: number;
  file_url?: string;
  remark?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Performance {
  id?: number;
  user_id?: number;
  project_name: string;
  project_number?: string;
  project_type?: string;
  package_number?: string;
  client_name?: string;
  client_type?: string;
  client_contact?: string;
  client_phone?: string;
  project_manager?: string;
  contract_number?: string;
  contract_amount?: number;
  start_date?: string;
  end_date?: string;
  project_location?: string;
  project_scale?: string;
  project_content?: string;
  completion_status?: string;
  acceptance_status?: string;
  contract_url?: string;
  bid_notice_url?: string;
  acceptance_url?: string;
  evaluation_url?: string;
  invoice_url?: string;
  other_urls?: string;
  remark?: string;
  created_at?: string;
  updated_at?: string;
}

export interface OutlineItem {
  id: string;
  title: string;
  description: string;
  children?: OutlineItem[];
  content?: string;
}

export interface OutlineData {
  outline: OutlineItem[];
  project_name?: string;
  project_overview?: string;
  requirements?: string;
}

export interface AppState {
  projectId?: string;
  currentStep: number;
  fileContent: string;
  projectOverview: string;
  techRequirements: string;
  outlineData: OutlineData | null;
  selectedChapter: string;
}
