/**
 * API服务
 */
import axios from 'axios';

import { getApiBaseUrl } from '../utils/api';
import { getStoredToken } from '../utils/auth';

const API_BASE_URL = getApiBaseUrl();

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 600000, // 调整为10分钟，支持RAG大文件导入
});

api.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截器
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const requestUrl = `${error?.config?.baseURL || ''}${error?.config?.url || ''}`;
    console.error('API请求错误:', requestUrl, error);
    return Promise.reject(error);
  }
);

export interface FileUploadResponse {
  success: boolean;
  message: string;
  file_content?: string;
  old_outline?: string;
}

export interface AnalysisRequest {
  file_content: string;
  analysis_type: 'overview' | 'requirements';
}

export interface OutlineRequest {
  overview: string;
  requirements: string;
  uploaded_expand?: boolean;
  old_outline?: string;
  old_document?: string;
}

export interface ContentGenerationRequest {
  outline: { outline: any[] };
  project_overview: string;
}

export interface ChapterContentRequest {
  chapter: any;
  parent_chapters?: any[];
  sibling_chapters?: any[];
  project_overview: string;
  project_id?: string;
  use_rag?: boolean;
  rag_top_k?: number;
  rag_similarity_threshold?: number;
  industry?: string;
  project_type?: string;
}

export interface RagLibraryItem {
  id: number;
  library_name: string;
  industry?: string;
  project_type?: string;
  industry_tags?: Array<{ code: string; name: string; source?: string; score?: number }>;
  project_type_tags?: Array<{ code: string; name: string; source?: string; score?: number }>;
  file_name?: string;
  status: string;
  total_chunks: number;
  summary_chunks?: number;
  total_pages?: number;
  processing_duration?: number;
  error_msg?: string;
  created_at: string;
}

export interface ConstraintPayload {
  category: string;
  key: string;
  value: string;
  is_mandatory?: boolean;
  source_chapter?: string;
}

export interface RagCategoryItem {
  code: string;
  name: string;
  keywords?: string[];
}

export interface RagModelInfo {
  model_name: string;
  model_type: string;
  dimension: number;
  is_real_embedding: boolean;
  description: string;
  max_length: number;
  cuda_available: boolean;
  model_loading: boolean;
  loading_state: string;
  loading_progress: number;
  loading_stage: string;
  loading_message: string;
  loading_candidate?: string;
  loading_errors?: string[];
  loading_started_at?: number | null;
  loading_finished_at?: number | null;
}

export interface RagVectorIndexStats {
  model_name: string;
  model_type: string;
  dimension: number;
  is_real_embedding: boolean;
  cuda_available: boolean;
  model_loading: boolean;
  loading_state: string;
  loading_progress: number;
  loading_stage: string;
  loading_message: string;
  loading_candidate?: string;
  loading_errors?: string[];
  loading_started_at?: number | null;
  loading_finished_at?: number | null;
  total_libraries: number;
  total_chunks: number;
  indexed_chunks: number;
  chroma_count: number;
  needs_rebuild: boolean;
}

export interface RagRebuildTaskStatus {
  success: boolean;
  task_id: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
  progress: number;
  message: string;
  stage: string;
  total_chunks: number;
  processed_chunks: number;
  failed_chunks: number;
  started_at: number;
  finished_at?: number | null;
  result?: {
    success: boolean;
    model_name: string;
    dimension: number;
    is_real_embedding: boolean;
    total_libraries: number;
    total_chunks: number;
    processed_chunks: number;
    failed_chunks: number;
    elapsed_seconds: number;
    errors: string[];
  } | null;
  error?: string | null;
}

export interface ConsistencyIssue {
  type: string;
  severity: string;
  dimension?: string;
  message: string;
}

export interface ConsistencyReportDetail {
  check_id: number;
  check_type: string;
  result: string;
  severity?: string;
  violations: ConsistencyIssue[];
  warnings: ConsistencyIssue[];
  checked_at: string;
}

export interface CitationChapterSummary {
  chapter_id: string;
  chapter_title: string;
  citation_ratio: number;
  cited_sentences: number;
  total_sentences: number;
  risk_level: string;
  sources_count: number;
}

export interface CitationSourceDetail {
  library_name: string;
  chapter_title: string;
  contribution: number;
  sentences_count: number;
  similarity_avg: number;
  paragraph_samples?: string[];
}

export interface ChapterCitationDetail {
  chapter_id: string;
  chapter_title: string;
  citation_ratio: number;
  total_sentences: number;
  cited_sentences: number;
  risk_level: string;
  risk_reasons: string[];
  sources: CitationSourceDetail[];
}

const buildAuthHeaders = (headers: Record<string, string>) => {
  const token = getStoredToken();
  if (token) {
    return { ...headers, Authorization: `Bearer ${token}` };
  }
  return headers;
};

// 文档相关API
export const documentApi = {
  // 上传文件
  uploadFile: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<FileUploadResponse>('/api/document/upload', formData);
  },


  // 流式分析文档
  analyzeDocumentStream: (data: AnalysisRequest) =>
    fetch(`${API_BASE_URL}/api/document/analyze-stream`, {
      method: 'POST',
      headers: {
        ...buildAuthHeaders({ 'Content-Type': 'application/json' }),
      },
      body: JSON.stringify(data),
    }),

  // 导出Word文档
  exportWord: (data: any) =>
    fetch(`${API_BASE_URL}/api/document/export-word`, {
      method: 'POST',
      headers: {
        ...buildAuthHeaders({ 'Content-Type': 'application/json' }),
      },
      body: JSON.stringify(data),
    }),
};

// 目录相关API
export const outlineApi = {
  // 生成目录
  generateOutline: (data: OutlineRequest) =>
    api.post('/api/outline/generate', data),

  // 流式生成目录
  generateOutlineStream: (data: OutlineRequest) =>
    fetch(`${API_BASE_URL}/api/outline/generate-stream`, {
      method: 'POST',
      headers: {
        ...buildAuthHeaders({ 'Content-Type': 'application/json' }),
      },
      body: JSON.stringify(data),
    }),

};

// 内容相关API
export const contentApi = {
  // 生成单章节内容
  generateChapterContent: (data: ChapterContentRequest) =>
    api.post('/api/content/generate-chapter', data),

  // 流式生成单章节内容
  generateChapterContentStream: (data: ChapterContentRequest) =>
    fetch(`${API_BASE_URL}/api/content/generate-chapter-stream`, {
      method: 'POST',
      headers: {
        ...buildAuthHeaders({ 'Content-Type': 'application/json' }),
      },
      body: JSON.stringify(data),
    }),
};

export const ragApi = {
  // 同步上传（已弃用，建议使用uploadLibraryFileAsync）
  uploadLibraryFile: (
    file: File,
    payload?: {
      library_name?: string;
      industry?: string;
      project_type?: string;
      industry_codes?: string[];
      project_type_codes?: string[];
      auto_classify?: boolean;
    }
  ) => {
    const formData = new FormData();
    formData.append('file', file);
    if (payload?.library_name) formData.append('library_name', payload.library_name);
    if (payload?.industry) formData.append('industry', payload.industry);
    if (payload?.project_type) formData.append('project_type', payload.project_type);
    (payload?.industry_codes || []).forEach((code) => formData.append('industry_codes', code));
    (payload?.project_type_codes || []).forEach((code) => formData.append('project_type_codes', code));
    if (typeof payload?.auto_classify === 'boolean') {
      formData.append('auto_classify', String(payload.auto_classify));
    }
    return api.post('/api/rag/library/upload', formData, {
      timeout: 600000, // 10分钟超时，支持大文件导入
    });
  },
  // 异步上传（推荐）：立即返回，文件在后台处理
  uploadLibraryFileAsync: (
    file: File,
    payload?: {
      library_name?: string;
      industry?: string;
      project_type?: string;
      industry_codes?: string[];
      project_type_codes?: string[];
      auto_classify?: boolean;
    }
  ) => {
    const formData = new FormData();
    formData.append('file', file);
    if (payload?.library_name) formData.append('library_name', payload.library_name);
    if (payload?.industry) formData.append('industry', payload.industry);
    if (payload?.project_type) formData.append('project_type', payload.project_type);
    (payload?.industry_codes || []).forEach((code) => formData.append('industry_codes', code));
    (payload?.project_type_codes || []).forEach((code) => formData.append('project_type_codes', code));
    if (typeof payload?.auto_classify === 'boolean') {
      formData.append('auto_classify', String(payload.auto_classify));
    }
    return api.post<{
      success: boolean;
      library_id: number;
      library_name: string;
      status: string;
      message: string;
    }>('/api/rag/library/upload-async', formData, {
      timeout: 60000, // 异步上传只需等待文件保存完成，60秒足够
    });
  },
  bootstrapClassifications: (force = false) =>
    api.post<{
      success: boolean;
      industry_created: number;
      project_type_created: number;
      industry_total: number;
      project_type_total: number;
    }>('/api/rag/classifications/bootstrap', { force }),
  getClassifications: () =>
    api.get<{ success: boolean; industry_items: RagCategoryItem[]; project_type_items: RagCategoryItem[] }>('/api/rag/classifications'),
  listLibraries: () =>
    api.get<{ items: RagLibraryItem[] }>('/api/rag/library'),
  getLibraryProgress: (libraryId: number) =>
    api.get<{ library_id: number; status: string; progress: number; processed_chunks: number; total_chunks: number }>(`/api/rag/library/${libraryId}/progress`),
  deleteLibrary: (libraryId: number) =>
    api.delete<{ success: boolean; message: string }>(`/api/rag/library/${libraryId}`),
  stats: () =>
    api.get<{ total_libraries: number; completed_libraries: number; total_chunks: number }>('/api/rag/stats'),
  getModelInfo: () =>
    api.get<{ success: boolean; model_info: RagModelInfo }>('/api/rag/embedding-model/info'),
  getVectorIndexStats: () =>
    api.get<{ success: boolean; stats: RagVectorIndexStats }>('/api/rag/vector-index/stats'),
  rebuildVectorIndex: (data?: { library_id?: number; batch_size?: number }) =>
    api.post<{
      success: boolean;
      accepted: boolean;
      task_id: string;
      status: string;
      message: string;
    }>('/api/rag/vector-index/rebuild', data, {
      timeout: 600000,
    }),
  getRebuildVectorIndexTask: (taskId: string) =>
    api.get<RagRebuildTaskStatus>(`/api/rag/vector-index/rebuild/${taskId}`),
  clearVectorIndex: () =>
    api.post<{ success: boolean; cleared_libraries: number; error?: string }>('/api/rag/vector-index/clear', {}, {
      timeout: 300000,
    }),
  search: (data: { query: string; top_k?: number; industry?: string; project_type?: string; similarity_threshold?: number }) =>
    api.post('/api/rag/search', data),
  searchImages: (data: { query: string; top_k?: number; library_id?: number }) =>
    api.post('/api/rag/images/search', data),
  createImageAdaptationPlan: (imageId: number, data: Record<string, any>) =>
    api.post(`/api/rag/images/${imageId}/adaptation-plan`, data),
  generateModifiedImage: (data: Record<string, any>) =>
    api.post('/api/rag/images/generate', data),
};

export const technicalBidApi = {
  getConstraints: (projectId: string) =>
    api.get<{ project_id: string; constraints: Record<string, Record<string, string>>; constraint_sources: Record<string, string> }>(`/api/technical-bids/${projectId}/constraints`),
  upsertConstraint: (projectId: string, data: ConstraintPayload) =>
    api.post<{ success: boolean; message: string }>(`/api/technical-bids/${projectId}/constraints`, data),
  extractConstraintsFromTender: (projectId: string, force = false) =>
    api.post<{ success: boolean; message: string; constraints_count?: number; added_count?: number; constraints?: any[] }>(`/api/technical-bids/${projectId}/constraints/extract-from-tender`, { force }),
  runConsistencyCheck: (projectId: string) =>
    api.post<{ check_id: number; result: string; violations: ConsistencyIssue[]; warnings: ConsistencyIssue[]; blocked: boolean }>(`/api/technical-bids/${projectId}/consistency-check`),
  getConsistencyReport: (projectId: string) =>
    api.get<{ project_id: string; total_checks: number; passed: number; failed: number; warnings: number; critical_issues: number; overall_status: string; details: ConsistencyReportDetail[] }>(`/api/technical-bids/${projectId}/consistency-report`),
  getCitations: (projectId: string) =>
    api.get<{ project_id: string; total_chapters: number; total_sentences: number; total_cited: number; avg_citation_ratio: number; risk_summary: Record<string, number>; chapters: CitationChapterSummary[] }>(`/api/technical-bids/${projectId}/citations`),
  getChapterCitation: (projectId: string, chapterId: string) =>
    api.get<ChapterCitationDetail>(`/api/technical-bids/${projectId}/citations/${chapterId}`),
  exportCitations: (projectId: string) =>
    api.get<string>(`/api/technical-bids/${projectId}/citations/export`, { responseType: 'text' as any }),
  getImageModifications: (projectId: string) =>
    api.get<{ project_id: string; total_images: number; pending_confirmation: number; confirmed: number; rejected: number; modifications: any[] }>(`/api/technical-bids/${projectId}/image-modifications`),
};

// 方案扩写相关API
export const expandApi = {
  // 上传方案扩写文件
  uploadExpandFile: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<FileUploadResponse>('/api/expand/upload', formData, {
      timeout: 300000, // 文件上传专用超时设置：5分钟
    });
  },
};

export default api;

// RAG配置API
export const ragConfigApi = {
  load: () =>
    api.get<{ similarity_threshold: number; top_k: number }>('/api/config/rag/load'),
  save: (data: { similarity_threshold?: number; top_k?: number }) =>
    api.post<{ success: boolean; message: string }>('/api/config/rag/save', data),
};
