import api from './api';
import type {
  CompanyInfo,
  FinancialInfo,
  LoginRequest,
  PaginatedResponse,
  Performance,
  Personnel,
  Qualification,
  TokenResponse,
  User,
} from '../types';
import { removeToken, setStoredToken } from '../utils/auth';

const RESOURCE_DATE_FIELDS = new Set<string>([
  'legal_person_birth_date',
  'legal_person_id_valid_from',
  'legal_person_id_valid_to',
  'establish_date',
  'operating_period_start',
  'operating_period_end',
  'authorized_person_birth_date',
  'authorized_person_id_valid_from',
  'authorized_person_id_valid_to',
  'issue_date',
  'valid_start_date',
  'valid_end_date',
  'birth_date',
  'id_valid_from',
  'id_valid_to',
  'start_work_date',
  'cert_valid_from',
  'cert_valid_date',
  'info_date',
  'start_date',
  'end_date',
]);

const RESOURCE_NUMBER_FIELDS = new Set<string>([
  'registered_capital',
  'age',
  'work_years',
  'amount',
  'contract_amount',
]);

const RESOURCE_BOOLEAN_FIELDS = new Set<string>([
  'legal_person_id_long_term',
  'operating_period_long_term',
  'authorized_person_id_long_term',
  'valid_long_term',
  'id_long_term',
  'cert_long_term',
]);

const REQUIRED_STRING_FIELDS = new Set<string>([
  'cert_name',
  'name',
  'info_type',
  'info_name',
  'project_name',
]);

function sanitizeResourcePayload<T extends Record<string, any>>(data: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, rawValue] of Object.entries(data || {})) {
    let value: unknown = rawValue;
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === 'string') {
      const text = value.trim();
      const lower = text.toLowerCase();
      if (text === '' || lower === 'null' || lower === 'none' || lower === 'undefined' || lower === 'n/a' || lower === 'na') {
        if (REQUIRED_STRING_FIELDS.has(key)) {
          result[key] = '';
        }
        continue;
      }
      if (RESOURCE_DATE_FIELDS.has(key)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
          result[key] = text;
        }
        continue;
      }
      if (RESOURCE_NUMBER_FIELDS.has(key)) {
        const numberValue = Number(text.replace(/,/g, ''));
        if (Number.isFinite(numberValue)) {
          result[key] = numberValue;
        }
        continue;
      }
      if (RESOURCE_BOOLEAN_FIELDS.has(key)) {
        if (lower === 'true' || lower === '1') {
          result[key] = true;
        } else if (lower === 'false' || lower === '0') {
          result[key] = false;
        }
        continue;
      }
      result[key] = text;
      continue;
    }
    if (typeof value === 'number') {
      if (!Number.isNaN(value)) {
        result[key] = value;
      }
      continue;
    }
    result[key] = value;
  }
  return result as T;
}

export const authApi = {
  async login(data: LoginRequest): Promise<TokenResponse> {
    const response = await api.post<TokenResponse>('/api/auth/login', data);
    if (response.data.access_token) {
      setStoredToken(response.data.access_token);
    }
    return response.data;
  },

  logout(): void {
    removeToken();
  },

  async getCurrentUser(): Promise<User> {
    const response = await api.get<User>('/api/auth/me');
    return response.data;
  },
};

export const userApi = {
  async listUsers(page: number, pageSize: number, keyword: string): Promise<PaginatedResponse<User>> {
    const response = await api.get<PaginatedResponse<User>>('/api/auth/users', {
      params: { page, page_size: pageSize, keyword },
    });
    return response.data;
  },

  async createUser(data: { username: string; password: string; role: string; real_name?: string; phone?: string; email?: string }): Promise<User> {
    const response = await api.post<User>('/api/auth/users', data);
    return response.data;
  },

  async updateUser(id: number, data: Partial<User> & { password?: string }): Promise<User> {
    const response = await api.put<User>(`/api/auth/users/${id}`, data);
    return response.data;
  },

  async deleteUser(id: number): Promise<void> {
    await api.delete(`/api/auth/users/${id}`);
  },

  async batchDeleteUsers(ids: number[]): Promise<void> {
    await api.post('/api/auth/users/batch-delete', ids);
  },
};

export const resourceApi = {
  async getCompanyInfo(): Promise<CompanyInfo | null> {
    const response = await api.get<CompanyInfo | null>('/api/resource/company-info');
    return response.data;
  },

  async saveCompanyInfo(data: Partial<CompanyInfo>): Promise<CompanyInfo> {
    const response = await api.post<CompanyInfo>('/api/resource/company-info', sanitizeResourcePayload(data as Record<string, any>));
    return response.data;
  },

  async listQualifications(page: number, pageSize: number, keyword: string): Promise<PaginatedResponse<Qualification>> {
    const response = await api.get<PaginatedResponse<Qualification>>('/api/resource/qualifications', {
      params: { page, page_size: pageSize, keyword },
    });
    return response.data;
  },

  async createQualification(data: Partial<Qualification>): Promise<Qualification> {
    const response = await api.post<Qualification>('/api/resource/qualifications', sanitizeResourcePayload(data as Record<string, any>));
    return response.data;
  },

  async updateQualification(id: number, data: Partial<Qualification>): Promise<Qualification> {
    const response = await api.put<Qualification>(`/api/resource/qualifications/${id}`, sanitizeResourcePayload(data as Record<string, any>));
    return response.data;
  },

  async deleteQualification(id: number): Promise<void> {
    await api.delete(`/api/resource/qualifications/${id}`);
  },

  async batchDeleteQualifications(ids: number[]): Promise<void> {
    await api.post('/api/resource/qualifications/batch-delete', ids);
  },

  async listPersonnel(page: number, pageSize: number, keyword: string): Promise<PaginatedResponse<Personnel>> {
    const response = await api.get<PaginatedResponse<Personnel>>('/api/resource/personnel', {
      params: { page, page_size: pageSize, keyword },
    });
    return response.data;
  },

  async createPersonnel(data: Partial<Personnel>): Promise<Personnel> {
    const response = await api.post<Personnel>('/api/resource/personnel', sanitizeResourcePayload(data as Record<string, any>));
    return response.data;
  },

  async updatePersonnel(id: number, data: Partial<Personnel>): Promise<Personnel> {
    const response = await api.put<Personnel>(`/api/resource/personnel/${id}`, sanitizeResourcePayload(data as Record<string, any>));
    return response.data;
  },

  async deletePersonnel(id: number): Promise<void> {
    await api.delete(`/api/resource/personnel/${id}`);
  },

  async batchDeletePersonnel(ids: number[]): Promise<void> {
    await api.post('/api/resource/personnel/batch-delete', ids);
  },

  async listFinancialInfo(page: number, pageSize: number, keyword: string, infoType?: string): Promise<PaginatedResponse<FinancialInfo>> {
    const response = await api.get<PaginatedResponse<FinancialInfo>>('/api/resource/financial-info', {
      params: { page, page_size: pageSize, keyword, ...(infoType ? { info_type: infoType } : {}) },
    });
    return response.data;
  },

  async createFinancialInfo(data: Partial<FinancialInfo>): Promise<FinancialInfo> {
    const response = await api.post<FinancialInfo>('/api/resource/financial-info', sanitizeResourcePayload(data as Record<string, any>));
    return response.data;
  },

  async updateFinancialInfo(id: number, data: Partial<FinancialInfo>): Promise<FinancialInfo> {
    const response = await api.put<FinancialInfo>(`/api/resource/financial-info/${id}`, sanitizeResourcePayload(data as Record<string, any>));
    return response.data;
  },

  async deleteFinancialInfo(id: number): Promise<void> {
    await api.delete(`/api/resource/financial-info/${id}`);
  },

  async batchDeleteFinancialInfo(ids: number[]): Promise<void> {
    await api.post('/api/resource/financial-info/batch-delete', ids);
  },

  async listPerformances(page: number, pageSize: number, keyword: string): Promise<PaginatedResponse<Performance>> {
    const response = await api.get<PaginatedResponse<Performance>>('/api/resource/performances', {
      params: { page, page_size: pageSize, keyword },
    });
    return response.data;
  },

  async createPerformance(data: Partial<Performance>): Promise<Performance> {
    const response = await api.post<Performance>('/api/resource/performances', sanitizeResourcePayload(data as Record<string, any>));
    return response.data;
  },

  async updatePerformance(id: number, data: Partial<Performance>): Promise<Performance> {
    const response = await api.put<Performance>(`/api/resource/performances/${id}`, sanitizeResourcePayload(data as Record<string, any>));
    return response.data;
  },

  async deletePerformance(id: number): Promise<void> {
    await api.delete(`/api/resource/performances/${id}`);
  },

  async batchDeletePerformances(ids: number[]): Promise<void> {
    await api.post('/api/resource/performances/batch-delete', ids);
  },

  async uploadFile(file: File): Promise<string> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post<{ success: boolean; url: string }>('/api/resource/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data.url;
  },

  async smartFill(
    scene: 'company' | 'qualification' | 'personnel' | 'financial' | 'performance' | 'idcard',
    file: File,
    targetField?: string,
  ): Promise<Record<string, unknown>> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post<Record<string, unknown>>(`/api/resource/ocr/${scene}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      params: targetField ? { target_field: targetField } : undefined,
    });
    return response.data;
  },
};

export type OpenAIConfig = {
  api_key: string;
  base_url: string;
  model_name: string;
  ocr_model?: string;
};

export const configApi = {
  async load(): Promise<Partial<OpenAIConfig>> {
    const response = await api.get('/api/config/load');
    return response.data;
  },

  async save(data: OpenAIConfig): Promise<{ success: boolean; message: string }> {
    const response = await api.post<{ success: boolean; message: string }>('/api/config/save', data);
    return response.data;
  },

  async models(data: OpenAIConfig): Promise<{ success: boolean; message: string; models: string[] }> {
    const response = await api.post<{ success: boolean; message: string; models: string[] }>('/api/config/models', data);
    return response.data;
  },
};
