/**
 * 内容编辑页面 - 完整标书预览和生成
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { OutlineData, OutlineItem } from '../types';
import { DocumentTextIcon, PlayIcon, DocumentArrowDownIcon, CheckCircleIcon, ExclamationCircleIcon, ArrowUpIcon, TrashIcon, ShieldExclamationIcon } from '@heroicons/react/24/outline';
import { contentApi, ChapterCitationDetail, ChapterContentRequest, CitationChapterSummary, ConsistencyIssue, ConsistencyReportDetail, documentApi, ragApi, ragConfigApi, RagCategoryItem, RagLibraryItem, technicalBidApi } from '../services/api';
import { saveAs } from 'file-saver';
import { draftStorage } from '../utils/draftStorage';

interface ContentEditProps {
  projectId?: string;
  outlineData: OutlineData | null;
  selectedChapter: string;
  onChapterSelect: (chapterId: string) => void;
}

interface GenerationProgress {
  total: number;
  completed: number;
  current: string;
  failed: string[];
  generating: Set<string>; // 正在生成的项目ID集合
}

interface GovernanceMessage {
  tone: 'success' | 'warning' | 'error';
  text: string;
}

interface RebuildProgressState {
  task_id: string;
  status: string;
  progress: number;
  processed_chunks: number;
  total_chunks: number;
  failed_chunks: number;
  elapsed_seconds: number;
  message: string;
}

const MAX_RAG_UPLOAD_SIZE_BYTES = 300 * 1024 * 1024;

const STATUS_LABELS: Record<string, string> = {
  passed: '通过',
  failed: '存在红线问题',
  warning: '存在提醒',
  unknown: '尚未检查',
};

const STATUS_STYLES: Record<string, string> = {
  passed: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  failed: 'text-red-700 bg-red-50 border-red-200',
  warning: 'text-amber-700 bg-amber-50 border-amber-200',
  unknown: 'text-slate-600 bg-slate-50 border-slate-200',
};

const RISK_LABELS: Record<string, string> = {
  high: '高风险',
  medium: '中风险',
  low: '低风险',
};

const RISK_STYLES: Record<string, string> = {
  high: 'text-red-700 bg-red-50 border-red-200',
  medium: 'text-amber-700 bg-amber-50 border-amber-200',
  low: 'text-emerald-700 bg-emerald-50 border-emerald-200',
};

const MESSAGE_STYLES: Record<GovernanceMessage['tone'], string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
  error: 'border-red-200 bg-red-50 text-red-700',
};

const CONSTRAINT_CATEGORY_OPTIONS = [
  { value: 'tech_stack', label: '技术栈', helper: '统一数据库、中间件、开发框架等技术选型口径。' },
  { value: 'architecture', label: '架构设计', helper: '统一微服务、分层、云原生等总体架构表达。' },
  { value: 'deployment', label: '部署方式', helper: '统一本地部署、私有云、容器化等部署方案。' },
  { value: 'integration', label: '系统集成', helper: '统一接口协议、对接系统、数据交换方式。' },
  { value: 'security', label: '安全要求', helper: '统一等保、加密、权限、审计等安全约束。' },
];

const formatPercent = (value: number | undefined) => `${Number(value || 0).toFixed(2).replace(/\.00$/, '')}%`;

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
};


const ContentEdit: React.FC<ContentEditProps> = ({
  projectId,
  outlineData,
  selectedChapter,
  onChapterSelect,
}) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<GenerationProgress>({
    total: 0,
    completed: 0,
    current: '',
    failed: [],
    generating: new Set<string>()
  });
  const [leafItems, setLeafItems] = useState<OutlineItem[]>([]);
  const [showScrollToTop, setShowScrollToTop] = useState(false);
  const [useRag, setUseRag] = useState(true);
  const [ragThreshold, setRagThreshold] = useState(0.15);
  const [ragTopK, setRagTopK] = useState(5);
  const [ragIndustry, setRagIndustry] = useState('');
  const [ragProjectType, setRagProjectType] = useState('');
  const [ragLibraries, setRagLibraries] = useState<RagLibraryItem[]>([]);
  const [isUploadingRag, setIsUploadingRag] = useState(false);
  const [uploadProgressText, setUploadProgressText] = useState('');
  const [industryOptions, setIndustryOptions] = useState<RagCategoryItem[]>([]);
  const [projectTypeOptions, setProjectTypeOptions] = useState<RagCategoryItem[]>([]);
  const [selectedIndustryCodes, setSelectedIndustryCodes] = useState<string[]>([]);
  const [selectedProjectTypeCodes, setSelectedProjectTypeCodes] = useState<string[]>([]);
  const [autoClassifyByTitle, setAutoClassifyByTitle] = useState(true);

  // 向量库管理状态
  const [vectorIndexStats, setVectorIndexStats] = useState<any>(null);
  const [isRebuildingIndex, setIsRebuildingIndex] = useState(false);
  const [rebuildProgress, setRebuildProgress] = useState<RebuildProgressState | null>(null);
  const [showVectorIndexModal, setShowVectorIndexModal] = useState(false);
  const [constraintsMap, setConstraintsMap] = useState<Record<string, Record<string, string>>>({});
  const [constraintSources, setConstraintSources] = useState<Record<string, string>>({});
  const [consistencyStatus, setConsistencyStatus] = useState<string>('unknown');
  const [consistencyIssues, setConsistencyIssues] = useState<number>(0);
  const [consistencyDetails, setConsistencyDetails] = useState<ConsistencyReportDetail[]>([]);
  const [governanceMessage, setGovernanceMessage] = useState<GovernanceMessage | null>(null);
  const [citationSummary, setCitationSummary] = useState<{ total_chapters: number; avg_citation_ratio: number; total_sentences: number; total_cited: number }>({
    total_chapters: 0,
    avg_citation_ratio: 0,
    total_sentences: 0,
    total_cited: 0,
  });
  const [citationRiskSummary, setCitationRiskSummary] = useState<Record<string, number>>({ high: 0, medium: 0, low: 0 });
  const [citationChapters, setCitationChapters] = useState<CitationChapterSummary[]>([]);
  const [selectedCitationChapterId, setSelectedCitationChapterId] = useState('');
  const [citationDetail, setCitationDetail] = useState<ChapterCitationDetail | null>(null);
  const [isCitationDetailLoading, setIsCitationDetailLoading] = useState(false);
  const [constraintCategory, setConstraintCategory] = useState('tech_stack');
  const [constraintKey, setConstraintKey] = useState('');
  const [constraintValue, setConstraintValue] = useState('');
  const [constraintSourceChapter, setConstraintSourceChapter] = useState('');
  const [isConstraintMandatory, setIsConstraintMandatory] = useState(true);
  const [isExtractingConstraints, setIsExtractingConstraints] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipFirstSaveRef = useRef(true);
  const ragFileInputRef = useRef<HTMLInputElement | null>(null);
  const ragFolderInputRef = useRef<HTMLInputElement | null>(null);

  // 收集所有叶子节点
  const collectLeafItems = useCallback((items: OutlineItem[]): OutlineItem[] => {
    let leaves: OutlineItem[] = [];
    items.forEach(item => {
      if (!item.children || item.children.length === 0) {
        leaves.push(item);
      } else {
        leaves = leaves.concat(collectLeafItems(item.children));
      }
    });
    return leaves;
  }, []);

  // 获取章节的上级章节信息
  const getParentChapters = useCallback((targetId: string, items: OutlineItem[], parents: OutlineItem[] = []): OutlineItem[] => {
    for (const item of items) {
      if (item.id === targetId) {
        return parents;
      }
      if (item.children && item.children.length > 0) {
        const found = getParentChapters(targetId, item.children, [...parents, item]);
        if (found.length > 0 || item.children.some(child => child.id === targetId)) {
          return found.length > 0 ? found : [...parents, item];
        }
      }
    }
    return [];
  }, []);

  // 获取章节的同级章节信息
  const getSiblingChapters = useCallback((targetId: string, items: OutlineItem[]): OutlineItem[] => {
    // 直接在当前级别查找
    if (items.some(item => item.id === targetId)) {
      return items;
    }
    
    // 递归在子级别查找
    for (const item of items) {
      if (item.children && item.children.length > 0) {
        const siblings = getSiblingChapters(targetId, item.children);
        if (siblings.length > 0) {
          return siblings;
        }
      }
    }
    
    return [];
  }, []);

  useEffect(() => {
    if (outlineData) {
      skipFirstSaveRef.current = true;
      const leaves = collectLeafItems(outlineData.outline);
      // 恢复本地缓存的正文内容（仅对叶子节点生效）
      const filtered = draftStorage.filterContentByOutlineLeaves(outlineData.outline);
      const mergedLeaves = leaves.map((leaf) => {
        const cached = filtered[leaf.id];
        return cached ? { ...leaf, content: cached } : leaf;
      });

      // 目录变更时，顺手清理掉无效的旧缓存（只保留当前叶子节点）
      draftStorage.saveContentById(filtered);

      setLeafItems(mergedLeaves);
      setProgress(prev => ({ ...prev, total: leaves.length }));
    }
  }, [outlineData, collectLeafItems]);

  const loadRagLibraries = useCallback(async () => {
    try {
      const response = await ragApi.listLibraries();
      setRagLibraries(response.data.items || []);
    } catch (error) {
      console.error('加载RAG资料库失败:', error);
    }
  }, []);

  const loadRagConfig = useCallback(async () => {
    try {
      const response = await ragConfigApi.load();
      setRagThreshold(response.data.similarity_threshold || 0.15);
      setRagTopK(response.data.top_k || 5);
    } catch (error) {
      console.error('加载RAG配置失败:', error);
    }
  }, []);

  const saveRagConfig = useCallback(async () => {
    try {
      await ragConfigApi.save({
        similarity_threshold: ragThreshold,
        top_k: ragTopK,
      });
      alert('RAG配置已保存');
    } catch (error) {
      console.error('保存RAG配置失败:', error);
      alert('保存失败，请重试');
    }
  }, [ragThreshold, ragTopK]);

  // 向量库管理函数
  const loadVectorIndexStats = useCallback(async () => {
    try {
      const response = await ragApi.getVectorIndexStats();
      setVectorIndexStats(response.data.stats);
    } catch (error) {
      console.error('加载向量库统计失败:', error);
    }
  }, []);

  const rebuildVectorIndex = useCallback(async (libraryId?: number) => {
    if (!window.confirm('确定要重建向量索引吗？这将使用当前的向量模型重新处理所有资料库。')) {
      return;
    }
    setIsRebuildingIndex(true);
    setRebuildProgress(null);
    try {
      const response = await ragApi.rebuildVectorIndex({
        library_id: libraryId,
        batch_size: 100,
      });
      if (!response.data.success || !response.data.task_id) {
        alert('重建失败：' + (response.data.message || '未知错误'));
        setIsRebuildingIndex(false);
        return;
      }
      setRebuildProgress({
        task_id: response.data.task_id,
        status: response.data.status || 'pending',
        progress: 0,
        processed_chunks: 0,
        total_chunks: 0,
        failed_chunks: 0,
        elapsed_seconds: 0,
        message: response.data.message || '',
      });
    } catch (error: any) {
      console.error('重建向量索引失败:', error);
      alert('重建失败：' + (error?.response?.data?.detail || error?.message || '未知错误'));
      setIsRebuildingIndex(false);
    }
  }, []);

  useEffect(() => {
    if (!isRebuildingIndex || !rebuildProgress?.task_id) {
      return;
    }
    const timer = window.setInterval(async () => {
      try {
        const response = await ragApi.getRebuildVectorIndexTask(rebuildProgress.task_id);
        const task = response.data;
        setRebuildProgress((prev) => prev ? {
          ...prev,
          status: task.status,
          progress: task.progress || 0,
          processed_chunks: task.processed_chunks || 0,
          total_chunks: task.total_chunks || 0,
          failed_chunks: task.failed_chunks || 0,
          elapsed_seconds: task.result?.elapsed_seconds || prev.elapsed_seconds || 0,
          message: task.message || '',
        } : prev);
        if (task.status === 'success' || task.status === 'failed' || task.status === 'cancelled') {
          setIsRebuildingIndex(false);
          if (task.status === 'success') {
            alert(`向量索引重建完成！\n处理了 ${task.result?.processed_chunks || task.processed_chunks} 个chunk\n耗时 ${task.result?.elapsed_seconds || 0} 秒`);
          } else {
            alert('重建失败：' + (task.error || task.message || '未知错误'));
          }
          await loadVectorIndexStats();
        }
      } catch (error: any) {
        setIsRebuildingIndex(false);
        alert('获取重建任务状态失败：' + (error?.response?.data?.detail || error?.message || '未知错误'));
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [isRebuildingIndex, rebuildProgress?.task_id, loadVectorIndexStats]);

  const clearVectorIndex = useCallback(async () => {
    if (!window.confirm('确定要清空向量索引吗？这不会删除资料库，但需要重新索引才能使用RAG功能。')) {
      return;
    }
    try {
      const response = await ragApi.clearVectorIndex();
      if (response.data.success) {
        alert(`已清空 ${response.data.cleared_libraries} 个资料库的向量索引`);
        await loadVectorIndexStats();
      }
    } catch (error: any) {
      console.error('清空向量索引失败:', error);
      alert('清空失败：' + (error?.response?.data?.detail || error?.message || '未知错误'));
    }
  }, [loadVectorIndexStats]);

  const loadClassificationOptions = useCallback(async () => {
    try {
      await ragApi.bootstrapClassifications(false);
      const response = await ragApi.getClassifications();
      setIndustryOptions(response.data.industry_items || []);
      setProjectTypeOptions(response.data.project_type_items || []);
    } catch (error) {
      console.error('加载分类清单失败:', error);
    }
  }, []);

  const loadGovernanceData = useCallback(async () => {
    if (!projectId) return;
    try {
      const [constraintsRes, consistencyRes, citationsRes] = await Promise.all([
        technicalBidApi.getConstraints(projectId),
        technicalBidApi.getConsistencyReport(projectId),
        technicalBidApi.getCitations(projectId),
      ]);
      setConstraintsMap(constraintsRes.data.constraints || {});
      setConstraintSources(constraintsRes.data.constraint_sources || {});
      setConsistencyStatus(consistencyRes.data.overall_status || 'unknown');
      setConsistencyIssues((consistencyRes.data.critical_issues || 0) + (consistencyRes.data.failed || 0));
      setConsistencyDetails(consistencyRes.data.details || []);
      setCitationSummary({
        total_chapters: citationsRes.data.total_chapters || 0,
        avg_citation_ratio: citationsRes.data.avg_citation_ratio || 0,
        total_sentences: citationsRes.data.total_sentences || 0,
        total_cited: citationsRes.data.total_cited || 0,
      });
      setCitationRiskSummary(citationsRes.data.risk_summary || { high: 0, medium: 0, low: 0 });
      setCitationChapters(citationsRes.data.chapters || []);
    } catch (error) {
      console.error('加载一致性与引用数据失败:', error);
    }
  }, [projectId]);

  useEffect(() => {
    loadRagLibraries();
  }, [loadRagLibraries]);

  useEffect(() => {
    loadRagConfig();
  }, [loadRagConfig]);

  useEffect(() => {
    loadClassificationOptions();
  }, [loadClassificationOptions]);

  useEffect(() => {
    loadVectorIndexStats();
  }, [loadVectorIndexStats]);

  useEffect(() => {
    if (ragFolderInputRef.current) {
      ragFolderInputRef.current.setAttribute('webkitdirectory', '');
      ragFolderInputRef.current.setAttribute('directory', '');
    }
  }, []);

  useEffect(() => {
    loadGovernanceData();
  }, [loadGovernanceData]);

  useEffect(() => {
    const hasCompletedLibraries = ragLibraries.some((item) => item.status === 'completed' && (item.total_chunks || 0) > 0);
    if (hasCompletedLibraries) {
      setUseRag(true);
    }
  }, [ragLibraries]);

  useEffect(() => {
    const availableChapterIds = new Set(citationChapters.map((item) => item.chapter_id));
    if (selectedChapter && availableChapterIds.has(selectedChapter)) {
      setSelectedCitationChapterId(selectedChapter);
      return;
    }
    if (!selectedCitationChapterId || !availableChapterIds.has(selectedCitationChapterId)) {
      setSelectedCitationChapterId(citationChapters[0]?.chapter_id || '');
    }
  }, [citationChapters, selectedChapter, selectedCitationChapterId]);

  useEffect(() => {
    if (!projectId || !selectedCitationChapterId) {
      setCitationDetail(null);
      return;
    }
    let cancelled = false;
    setIsCitationDetailLoading(true);
    technicalBidApi.getChapterCitation(projectId, selectedCitationChapterId)
      .then((response) => {
        if (!cancelled) {
          setCitationDetail(response.data);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setCitationDetail(null);
          console.error('加载章节引用明细失败:', error);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsCitationDetailLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, selectedCitationChapterId]);

  const applyLeafContents = useCallback((items: OutlineItem[], contentById: Record<string, string>): OutlineItem[] => {
    return items.map(item => {
      if (!item.children || item.children.length === 0) {
        return { ...item, content: contentById[item.id] ?? (item.content || '') };
      }
      return {
        ...item,
        children: applyLeafContents(item.children, contentById),
      };
    });
  }, []);

  useEffect(() => {
    if (!projectId || !outlineData) return;
    if (leafItems.length === 0) return;
    if (skipFirstSaveRef.current) {
      skipFirstSaveRef.current = false;
      return;
    }

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        const contentById: Record<string, string> = {};
        for (const item of leafItems) {
          contentById[item.id] = item.content || '';
        }

        const updatedOutlineData: OutlineData = {
          ...outlineData,
          outline: applyLeafContents(outlineData.outline, contentById),
        };

        const hasAnyContent = leafItems.some(i => (i.content || '').trim().length > 0);
        const token = localStorage.getItem('hxybs_token');
        await fetch(`/api/technical-bids/${projectId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            outline_data: JSON.stringify(updatedOutlineData),
            status: hasAnyContent ? 'generated' : 'outlined'
          })
        });
      } catch (e) {
        console.error('Failed to sync outline content', e);
      }
    }, 1000);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [leafItems, outlineData, projectId, applyLeafContents]);

  // 监听页面滚动，控制回到顶部按钮的显示
  useEffect(() => {
    // 现在主内容区为内部滚动容器（App.tsx: #app-main-scroll），不能只监听 window
    const scrollContainer = document.getElementById('app-main-scroll');

    const handleScroll = () => {
      const scrollTop = scrollContainer
        ? scrollContainer.scrollTop
        : (window.pageYOffset || document.documentElement.scrollTop);
      setShowScrollToTop(scrollTop > 300);
    };

    // 初始化计算一次，避免刷新后位置不对
    handleScroll();

    const target: any = scrollContainer || window;
    target.addEventListener('scroll', handleScroll);
    return () => target.removeEventListener('scroll', handleScroll);
  }, []);

  // 获取叶子节点的实时内容
  const getLeafItemContent = (itemId: string): string | undefined => {
    const leafItem = leafItems.find(leaf => leaf.id === itemId);
    return leafItem?.content;
  };

  // 检查是否为叶子节点
  const isLeafNode = (item: OutlineItem): boolean => {
    return !item.children || item.children.length === 0;
  };

  // 渲染目录结构
  const renderOutline = (items: OutlineItem[], level: number = 1): React.ReactElement[] => {
    return items.map((item) => {
      const isLeaf = isLeafNode(item);
      const currentContent = isLeaf ? getLeafItemContent(item.id) : item.content;
      
      return (
        <div key={item.id} className={`mb-${level === 1 ? '8' : '4'}`}>
          {/* 标题 */}
          <div className={`text-${level === 1 ? 'xl' : level === 2 ? 'lg' : 'base'} font-${level === 1 ? 'bold' : 'semibold'} text-gray-900 mb-2`}>
            {item.id} {item.title}
          </div>
          
          {/* 描述 */}
          <div className="text-sm text-gray-600 mb-4">
            {item.description}
          </div>

          {/* 内容（仅叶子节点） */}
          {isLeaf && (
            <div className="border-l-4 border-blue-200 pl-4 mb-6">
              {currentContent ? (
                <div className="prose max-w-none">
                  <ReactMarkdown>{currentContent}</ReactMarkdown>
                </div>
              ) : (
                <div className="text-gray-400 italic py-4">
                  <DocumentTextIcon className="inline w-4 h-4 mr-2" />
                  {progress.generating.has(item.id) ? (
                    <span className="text-blue-600">正在生成内容...</span>
                  ) : (
                    '内容待生成...'
                  )}
                </div>
              )}
            </div>
          )}

          {/* 子章节 */}
          {item.children && item.children.length > 0 && (
            <div className={`ml-${level * 4} mt-4`}>
              {renderOutline(item.children, level + 1)}
            </div>
          )}
        </div>
      );
    });
  };

  // 生成单个章节内容
  const generateItemContent = async (item: OutlineItem, projectOverview: string): Promise<OutlineItem> => {
    if (!outlineData) throw new Error('缺少目录数据');
    
    // 将当前项目添加到正在生成的集合中
    setProgress(prev => ({ 
      ...prev, 
      current: item.title,
      generating: new Set([...Array.from(prev.generating), item.id])
    }));
    
    try {
      // 获取上级章节和同级章节信息
      const parentChapters = getParentChapters(item.id, outlineData.outline);
      const siblingChapters = getSiblingChapters(item.id, outlineData.outline);

      const request: ChapterContentRequest = {
        chapter: item,
        parent_chapters: parentChapters,
        sibling_chapters: siblingChapters,
        project_overview: projectOverview,
        project_id: projectId,
        use_rag: hasAvailableRagLibraries ? true : useRag,
        rag_top_k: ragTopK,
        rag_similarity_threshold: ragThreshold,
        industry: ragIndustry || undefined,
        project_type: ragProjectType || undefined,
      };

      const response = await contentApi.generateChapterContentStream(request);

      if (!response.ok) throw new Error('生成失败');

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应');

      let content = '';
      const updatedItem = { ...item };
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = new TextDecoder().decode(value);
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            
            try {
              const parsed = JSON.parse(data);
              
              if (parsed.status === 'streaming' && parsed.full_content) {
                // 实时更新内容
                content = parsed.full_content;
                updatedItem.content = content;
                // 本地持久化（刷新后可恢复）
                draftStorage.upsertChapterContent(item.id, content);
                
                // 实时更新叶子节点数据以触发重新渲染
                setLeafItems(prevItems => {
                  const newItems = [...prevItems];
                  const index = newItems.findIndex(i => i.id === item.id);
                  if (index !== -1) {
                    newItems[index] = { ...updatedItem };
                  }
                  return newItems;
                });
              } else if (parsed.status === 'completed' && parsed.content) {
                content = parsed.content;
                updatedItem.content = content;
                // 本地持久化（最终结果）
                draftStorage.upsertChapterContent(item.id, content);
              } else if (parsed.status === 'error') {
                throw new Error(parsed.message);
              }
            } catch (e) {
              // 忽略JSON解析错误
            }
          }
        }
      }

      if (projectId) {
        loadGovernanceData();
      }
      return updatedItem;
    } catch (error) {
      setProgress(prev => ({
        ...prev,
        failed: [...prev.failed, item.title]
      }));
      throw error;
    } finally {
      // 从正在生成的集合中移除当前项目
      setProgress(prev => {
        const newGenerating = new Set(Array.from(prev.generating));
        newGenerating.delete(item.id);
        return {
          ...prev,
          generating: newGenerating
        };
      });
    }
  };

  // 开始生成所有内容
  const handleGenerateContent = async () => {
    if (!outlineData || leafItems.length === 0) return;

    setIsGenerating(true);
    setProgress({
      total: leafItems.length,
      completed: 0,
      current: '',
      failed: [],
      generating: new Set<string>()
    });

    try {
      // 使用5个并发线程生成内容
      const concurrency = 5;
      const updatedItems = [...leafItems];
      
      for (let i = 0; i < leafItems.length; i += concurrency) {
        const batch = leafItems.slice(i, i + concurrency);
        const promises = batch.map(item => 
          generateItemContent(item, outlineData.project_overview || '')
            .then(updatedItem => {
              const index = updatedItems.findIndex(ui => ui.id === updatedItem.id);
              if (index !== -1) {
                updatedItems[index] = updatedItem;
              }
              setProgress(prev => ({ ...prev, completed: prev.completed + 1 }));
              return updatedItem;
            })
            .catch(error => {
              console.error(`生成内容失败 ${item.title}:`, error);
              setProgress(prev => ({ ...prev, completed: prev.completed + 1 }));
              return item; // 返回原始项目
            })
        );

        await Promise.all(promises);
      }

      // 更新状态
      setLeafItems(updatedItems);
      
      // 这里需要更新整个outlineData，但由于我们只有props，需要通过回调通知父组件
      // 暂时只更新本地状态
      
    } catch (error) {
      console.error('生成内容时出错:', error);
    } finally {
      setIsGenerating(false);
      setProgress(prev => ({ ...prev, current: '', generating: new Set<string>() }));
    }
  };

  const uploadRagFiles = async (files: File[]) => {
    if (!files.length) return;
    const allowedFiles = files.filter((file) => /\.(pdf|doc|docx)$/i.test(file.name));
    if (allowedFiles.length === 0) {
      alert('未找到可导入文件，请选择 pdf/doc/docx 文件');
      return;
    }
    const oversizeFiles = allowedFiles.filter((file) => file.size > MAX_RAG_UPLOAD_SIZE_BYTES).map((file) => file.name);
    const uploadableFiles = allowedFiles.filter((file) => file.size <= MAX_RAG_UPLOAD_SIZE_BYTES);
    if (uploadableFiles.length === 0) {
      alert(`所选文件均超过300MB，无法导入。\n超限文件：${oversizeFiles.join('、')}`);
      return;
    }
    setIsUploadingRag(true);
    let success = 0;
    let failed = oversizeFiles.length;
    const failedFiles: string[] = [...oversizeFiles];
    try {
      for (let index = 0; index < uploadableFiles.length; index += 1) {
        const file = uploadableFiles[index];
        setUploadProgressText(`正在导入 ${index + 1}/${uploadableFiles.length}: ${file.name}`);
        try {
          await ragApi.uploadLibraryFile(file, {
            library_name: file.name.replace(/\.[^.]+$/, ''),
            industry: ragIndustry || undefined,
            project_type: ragProjectType || undefined,
            industry_codes: selectedIndustryCodes,
            project_type_codes: selectedProjectTypeCodes,
            auto_classify: autoClassifyByTitle,
          });
          success += 1;
        } catch (error) {
          failed += 1;
          failedFiles.push(file.name);
        }
      }
      await loadRagLibraries();
      if (failedFiles.length > 0) {
        const oversizeNotice = oversizeFiles.length > 0 ? `\n超限文件（单文件>300MB）：${oversizeFiles.join('、')}` : '';
        alert(`导入完成，成功 ${success} 份，失败 ${failed} 份。\n失败文件：${failedFiles.join('、')}${oversizeNotice}`);
      } else {
        alert(`导入完成，成功 ${success} 份，失败 ${failed} 份`);
      }
    } finally {
      setUploadProgressText('');
      setIsUploadingRag(false);
    }
  };

  const handleUploadRagFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    await uploadRagFiles(files);
    event.target.value = '';
  };

  const handleUploadRagFolder = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    await uploadRagFiles(files);
    event.target.value = '';
  };

  const handleDeleteLibrary = async (libraryId: number) => {
    try {
      await ragApi.deleteLibrary(libraryId);
      await loadRagLibraries();
      alert('资料库已删除');
    } catch (error: any) {
      const message = error?.response?.data?.detail || error?.message || '删除失败';
      alert(message);
    }
  };

  const handleRunConsistencyCheck = async () => {
    if (!projectId) {
      setGovernanceMessage({ tone: 'warning', text: '请先保存项目后再执行一致性检查。' });
      return;
    }
    try {
      const response = await technicalBidApi.runConsistencyCheck(projectId);
      const blocked = response.data.blocked;
      await loadGovernanceData();
      const violationsCount = response.data.violations?.length || 0;
      const warningsCount = response.data.warnings?.length || 0;
      setGovernanceMessage({
        tone: blocked ? 'error' : warningsCount > 0 ? 'warning' : 'success',
        text: blocked
          ? `检测到 ${violationsCount} 项红线/冲突问题，请根据下方明细逐项修正。`
          : warningsCount > 0
            ? `一致性检查完成，当前有 ${warningsCount} 项提醒建议进一步确认。`
            : '一致性检查通过，当前未发现红线冲突。',
      });
    } catch (error: any) {
      const message = error?.response?.data?.detail || error?.message || '一致性检查失败';
      setGovernanceMessage({ tone: 'error', text: message });
    }
  };

  const handleSaveConstraint = async () => {
    if (!projectId) {
      setGovernanceMessage({ tone: 'warning', text: '请先保存项目后再维护技术约束。' });
      return;
    }
    if (!constraintKey.trim() || !constraintValue.trim()) {
      setGovernanceMessage({ tone: 'warning', text: '请填写完整的约束键和值。' });
      return;
    }
    try {
      await technicalBidApi.upsertConstraint(projectId, {
        category: constraintCategory,
        key: constraintKey.trim(),
        value: constraintValue.trim(),
        is_mandatory: isConstraintMandatory,
        source_chapter: constraintSourceChapter.trim() || undefined,
      });
      setConstraintKey('');
      setConstraintValue('');
      setConstraintSourceChapter('');
      await loadGovernanceData();
      setGovernanceMessage({ tone: 'success', text: '技术约束已保存，并已刷新一致性基线。' });
    } catch (error: any) {
      const message = error?.response?.data?.detail || error?.message || '保存约束失败';
      setGovernanceMessage({ tone: 'error', text: message });
    }
  };

  const handleExtractConstraints = async () => {
    if (!projectId) {
      setGovernanceMessage({ tone: 'warning', text: '请先保存项目后再提取技术约束。' });
      return;
    }
    setIsExtractingConstraints(true);
    setGovernanceMessage(null);
    try {
      const response = await technicalBidApi.extractConstraintsFromTender(projectId, false);
      if (response.data.success) {
        await loadGovernanceData();
        setGovernanceMessage({
          tone: 'success',
          text: response.data.message || '技术约束提取成功',
        });
      } else {
        setGovernanceMessage({
          tone: 'warning',
          text: response.data.message || '提取失败',
        });
      }
    } catch (error: any) {
      const message = error?.response?.data?.detail || error?.message || '提取约束失败';
      setGovernanceMessage({ tone: 'error', text: message });
    } finally {
      setIsExtractingConstraints(false);
    }
  };

  // 获取叶子节点的最新内容（包括生成的内容）
  const getLatestContent = (item: OutlineItem): string => {
    if (!item.children || item.children.length === 0) {
      // 叶子节点，从 leafItems 获取最新内容
      const leafItem = leafItems.find(leaf => leaf.id === item.id);
      return leafItem?.content || item.content || '';
    }
    return item.content || '';
  };

  // 解析Markdown内容为Word段落
  // （已提取到文件顶层，供后续导出Word等复用）

  // 滚动到页面顶部
  const scrollToTop = () => {
    const scrollContainer = document.getElementById('app-main-scroll');
    if (scrollContainer) {
      scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // 导出Word文档
  const handleExportWord = async () => {
    if (!outlineData) return;

    try {
      // 构建带有最新内容的导出数据（leafItems 中存的是实时内容）
      const buildExportOutline = (items: OutlineItem[]): OutlineItem[] => {
        return items.map(item => {
          const latestContent = getLatestContent(item);
          const exportedItem: OutlineItem = {
            ...item,
            content: latestContent,
          };
          if (item.children && item.children.length > 0) {
            exportedItem.children = buildExportOutline(item.children);
          }
          return exportedItem;
        });
      };

      const exportPayload = {
        project_name: outlineData.project_name,
        project_overview: outlineData.project_overview,
        outline: buildExportOutline(outlineData.outline),
      };

      const response = await documentApi.exportWord(exportPayload);
      if (!response.ok) {
        throw new Error('导出失败');
      }
      const blob = await response.blob();
      saveAs(blob, `${outlineData.project_name || '标书文档'}.docx`);
      
      if (projectId) {
        try {
          const token = localStorage.getItem('hxybs_token');
          await fetch(`/api/technical-bids/${projectId}/mark-completed`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
        } catch (e) {
          console.error('Failed to mark project as completed', e);
        }
      }
      
    } catch (error) {
      console.error('导出失败:', error);
      alert('导出失败，请重试');
    }
  };

  if (!outlineData) {
    return (
      <div className="w-full max-w-[1680px] mx-auto px-4 sm:px-6 xl:px-8">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <div className="text-center py-12">
            <DocumentTextIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">暂无内容</h3>
            <p className="mt-1 text-sm text-gray-500">
              请先在"目录编辑"步骤中生成目录结构
            </p>
          </div>
        </div>
      </div>
    );
  }

  const completedItems = leafItems.filter(item => item.content).length;
  const latestConsistencyDetail = consistencyDetails[0];
  const latestViolations: ConsistencyIssue[] = latestConsistencyDetail?.violations || [];
  const latestWarnings: ConsistencyIssue[] = latestConsistencyDetail?.warnings || [];
  const selectedConstraintMeta = CONSTRAINT_CATEGORY_OPTIONS.find((item) => item.value === constraintCategory) || CONSTRAINT_CATEGORY_OPTIONS[0];
  const selectedCitationSummary = citationChapters.find((item) => item.chapter_id === selectedCitationChapterId);
  const highlightedCitationChapters = [...citationChapters]
    .sort((a, b) => (b.citation_ratio || 0) - (a.citation_ratio || 0))
    .slice(0, 5);
  const availableRagLibraries = ragLibraries.filter((item) => item.status === 'completed' && (item.total_chunks || 0) > 0);
  const hasAvailableRagLibraries = availableRagLibraries.length > 0;

  return (
    <div className="w-full max-w-[1680px] mx-auto px-4 sm:px-6 xl:px-8">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 mb-6 overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-200">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-xl font-semibold text-slate-900">标书内容编辑</h2>
                <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${STATUS_STYLES[consistencyStatus] || STATUS_STYLES.unknown}`}>
                  一致性：{STATUS_LABELS[consistencyStatus] || STATUS_LABELS.unknown}
                </span>
              </div>
              <p className="text-sm text-slate-600 mt-2">
                当前共 {leafItems.length} 个章节，已生成 {completedItems} 个，引用分析覆盖 {citationSummary.total_chapters} 个章节。
                {progress.failed.length > 0 && (
                  <span className="text-red-500 ml-2">失败 {progress.failed.length} 个</span>
                )}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                行业用于限定资料来源所属业务场景，项目类型用于限定方案交付形态，两者都会影响资料检索与引用判断。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => ragFileInputRef.current?.click()}
                disabled={isUploadingRag}
                className="inline-flex items-center px-3 py-2 border border-slate-300 text-sm rounded-md bg-white hover:bg-slate-50 disabled:opacity-50"
              >
                导入文件
              </button>
              <button
                onClick={() => ragFolderInputRef.current?.click()}
                disabled={isUploadingRag}
                className="inline-flex items-center px-3 py-2 border border-slate-300 text-sm rounded-md bg-white hover:bg-slate-50 disabled:opacity-50"
              >
                导入文件夹
              </button>
              <input
                ref={ragFileInputRef}
                type="file"
                accept=".pdf,.doc,.docx"
                className="hidden"
                disabled={isUploadingRag}
                multiple
                onChange={handleUploadRagFile}
              />
              <input
                ref={ragFolderInputRef}
                type="file"
                className="hidden"
                disabled={isUploadingRag}
                multiple
                onChange={handleUploadRagFolder}
              />
              <button
                onClick={handleGenerateContent}
                disabled={isGenerating}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <PlayIcon className="w-4 h-4 mr-2" />
                {isGenerating ? '生成中...' : '生成标书'}
              </button>
              <button
                onClick={handleExportWord}
                disabled={isGenerating}
                className="inline-flex items-center px-4 py-2 border border-slate-300 text-sm font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <DocumentArrowDownIcon className="w-4 h-4 mr-2" />
                导出Word
              </button>
            </div>
          </div>
          {isGenerating && (
            <div className="mt-4">
              <div className="flex items-center justify-between text-sm text-slate-600 mb-2">
                <span>正在生成：{progress.current}</span>
                <span>{progress.completed} / {progress.total}</span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${(progress.completed / progress.total) * 100}%` }}
                />
              </div>
            </div>
          )}
          {isUploadingRag && (
            <div className="mt-3 text-xs text-blue-700">{uploadProgressText || '正在导入资料库文件...'}</div>
          )}
          {governanceMessage && (
            <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${MESSAGE_STYLES[governanceMessage.tone]}`}>
              {governanceMessage.text}
            </div>
          )}
        </div>
        <div className="px-6 py-5 bg-slate-50/70">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <div className="text-sm font-medium text-slate-900">生成参数</div>
                  <div className="text-xs text-slate-500 mt-1">控制 RAG 检索范围与生成语境，避免内容风格与项目背景偏离。</div>
                </div>
                <label className="inline-flex items-center text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={useRag}
                    onChange={(e) => setUseRag(e.target.checked)}
                    disabled={hasAvailableRagLibraries}
                    className="mr-2"
                  />
                  {hasAvailableRagLibraries ? '已强制启用RAG' : '启用RAG'}
                </label>
              </div>
              <div className={`mb-4 rounded-lg border px-3 py-2 text-xs ${hasAvailableRagLibraries ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                {hasAvailableRagLibraries
                  ? `当前检测到 ${availableRagLibraries.length} 份可用资料，系统将优先使用RAG；仅当无可检索资料命中时才会退回通用生成。`
                  : '当前未检测到可用资料库，可按需开启或关闭RAG。'}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <label className="block">
                  <span className="block text-xs font-medium text-slate-600 mb-1">检索条数</span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={ragTopK}
                    onChange={(e) => setRagTopK(Math.max(1, Math.min(20, Number(e.target.value) || 5)))}
                    className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
                    title="检索条数"
                  />
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-slate-600 mb-1">
                    相似度阈值: {ragThreshold.toFixed(2)}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={ragThreshold}
                    onChange={(e) => setRagThreshold(Number(e.target.value))}
                    className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                    title="相似度阈值：越低越容易命中，但可能匹配度较低；越高越精确，但可能匹配不到"
                  />
                  <div className="flex justify-between text-xs text-slate-400 mt-1">
                    <span>0.0 (宽松)</span>
                    <span>1.0 (严格)</span>
                  </div>
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-slate-600 mb-1">行业关键词</span>
                  <input
                    type="text"
                    value={ragIndustry}
                    onChange={(e) => setRagIndustry(e.target.value)}
                    placeholder="例如：水利、政务、制造"
                    className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-slate-600 mb-1">项目类型关键词</span>
                  <input
                    type="text"
                    value={ragProjectType}
                    onChange={(e) => setRagProjectType(e.target.value)}
                    placeholder="例如：平台建设、系统集成"
                    className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
                  />
                </label>
              </div>
              <div className="flex items-center justify-end gap-2 mt-2">
                <button
                  onClick={saveRagConfig}
                  className="text-xs text-blue-600 hover:text-blue-700 underline"
                >
                  保存RAG配置为默认值
                </button>
              </div>
            </div>
            {/* 向量库管理 */}
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <div className="text-sm font-medium text-slate-900">向量库管理</div>
                  <div className="text-xs text-slate-500 mt-1">管理向量嵌入模型和索引，确保RAG检索使用最新的语义向量。</div>
                </div>
                <button
                  onClick={() => setShowVectorIndexModal(true)}
                  className="text-xs text-blue-600 hover:text-blue-700 underline"
                >
                  查看详情
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="text-slate-500 mb-1">当前模型</div>
                  <div className="font-medium text-slate-900">{vectorIndexStats?.model_name || '加载中...'}</div>
                  <div className="text-slate-400 mt-1">
                    {vectorIndexStats?.is_real_embedding ? '语义向量' : '降级方案'}
                  </div>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="text-slate-500 mb-1">索引状态</div>
                  <div className="font-medium text-slate-900">
                    {vectorIndexStats?.indexed_chunks || 0} / {vectorIndexStats?.total_chunks || 0}
                  </div>
                  <div className="text-slate-400 mt-1">
                    {vectorIndexStats?.needs_rebuild ? '需要重建' : '正常'}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 mt-3">
                <button
                  onClick={() => rebuildVectorIndex()}
                  disabled={isRebuildingIndex || !vectorIndexStats?.total_chunks}
                  className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isRebuildingIndex ? `重建中 ${rebuildProgress?.progress || 0}%` : '重建索引'}
                </button>
                <button
                  onClick={clearVectorIndex}
                  className="text-xs px-3 py-1.5 border border-slate-300 text-slate-700 rounded-md hover:bg-slate-50"
                >
                  清空索引
                </button>
              </div>
              {rebuildProgress && (
                <div className="mt-3 p-2 bg-blue-50 rounded-lg text-xs">
                  <div className="text-blue-900">重建进度：</div>
                  <div className="text-blue-700 mt-1">
                    已处理 {rebuildProgress.processed_chunks} / {rebuildProgress.total_chunks} 个chunk
                    {rebuildProgress.failed_chunks > 0 && ` (${rebuildProgress.failed_chunks} 失败)`}
                  </div>
                  <div className="text-blue-600">状态：{rebuildProgress.message || rebuildProgress.status}</div>
                  {rebuildProgress.elapsed_seconds > 0 && (
                    <div className="text-blue-600">耗时 {rebuildProgress.elapsed_seconds} 秒</div>
                  )}
                </div>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <div className="text-sm font-medium text-slate-900">资料分类标注</div>
                  <div className="text-xs text-slate-500 mt-1">“类别/行业”表示资料归属标签，系统据此判断哪些样例更适合当前技术标。</div>
                </div>
                <label className="inline-flex items-center text-xs text-slate-700 whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={autoClassifyByTitle}
                    onChange={(e) => setAutoClassifyByTitle(e.target.checked)}
                    className="mr-2"
                  />
                  标题页自动判别
                </label>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-xs font-medium text-slate-600 mb-1">行业标签</span>
                  <select
                    multiple
                    value={selectedIndustryCodes}
                    onChange={(e) => setSelectedIndustryCodes(Array.from(e.target.selectedOptions).map((option) => option.value))}
                    className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm h-28"
                    title="导入时手动行业分类（可多选）"
                  >
                    {industryOptions.map((option) => (
                      <option key={option.code} value={option.code}>{option.code} {option.name}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-slate-600 mb-1">项目类型标签</span>
                  <select
                    multiple
                    value={selectedProjectTypeCodes}
                    onChange={(e) => setSelectedProjectTypeCodes(Array.from(e.target.selectedOptions).map((option) => option.value))}
                    className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm h-28"
                    title="导入时手动项目分类（可多选）"
                  >
                    {projectTypeOptions.map((option) => (
                      <option key={option.code} value={option.code}>{option.code} {option.name}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1.15fr)_minmax(420px,0.85fr)] gap-6 mb-6">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h3 className="text-lg font-semibold text-slate-900">一致性检查与技术约束</h3>
                <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${STATUS_STYLES[consistencyStatus] || STATUS_STYLES.unknown}`}>
                  {STATUS_LABELS[consistencyStatus] || STATUS_LABELS.unknown}
                </span>
              </div>
              <p className="text-sm text-slate-500 mt-2">
                一致性检查用于识别章节之间的技术选型冲突；技术约束是你希望全文必须保持一致的硬性口径。
              </p>
            </div>
            <button
              onClick={handleRunConsistencyCheck}
              className="inline-flex items-center justify-center px-4 py-2 border border-red-200 text-red-700 rounded-md bg-red-50 hover:bg-red-100 text-sm"
            >
              <ShieldExclamationIcon className="w-4 h-4 mr-2" />
              执行一致性检查
            </button>
          </div>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mt-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-xs text-slate-500">当前状态</div>
              <div className="mt-1 text-base font-semibold text-slate-900">{STATUS_LABELS[consistencyStatus] || STATUS_LABELS.unknown}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-xs text-slate-500">红线/失败项</div>
              <div className="mt-1 text-base font-semibold text-slate-900">{consistencyIssues}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-xs text-slate-500">最近检查时间</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">{formatDateTime(latestConsistencyDetail?.checked_at)}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-xs text-slate-500">累计检查次数</div>
              <div className="mt-1 text-base font-semibold text-slate-900">{consistencyDetails.length}</div>
            </div>
          </div>
          <div className="mt-5 rounded-xl border border-slate-200">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-slate-900">最近一次检查明细</div>
                <div className="text-xs text-slate-500 mt-1">红线问题会阻断继续使用冲突方案，提醒项表示暂未找到足够证据或需要补充说明。</div>
              </div>
            </div>
            <div className="p-4 space-y-3">
              {latestViolations.length === 0 && latestWarnings.length === 0 ? (
                <div className="text-sm text-slate-500">暂无明细，请先执行一次一致性检查。</div>
              ) : (
                <>
                  {latestViolations.map((item, index) => (
                    <div key={`violation-${index}`} className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700">红线问题</span>
                        {item.dimension && (
                          <span className="inline-flex items-center rounded-full bg-white px-2.5 py-1 text-xs text-slate-600 border border-red-100">{item.dimension}</span>
                        )}
                      </div>
                      <div className="mt-2 text-sm text-red-800">{item.message}</div>
                    </div>
                  ))}
                  {latestWarnings.map((item, index) => (
                    <div key={`warning-${index}`} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">提醒</span>
                        {item.dimension && (
                          <span className="inline-flex items-center rounded-full bg-white px-2.5 py-1 text-xs text-slate-600 border border-amber-100">{item.dimension}</span>
                        )}
                      </div>
                      <div className="mt-2 text-sm text-amber-800">{item.message}</div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
          <div className="mt-5 rounded-xl border border-slate-200">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-slate-900">维护技术约束</div>
                <div className="text-xs text-slate-500 mt-1">技术约束用于声明全文统一口径，例如数据库、中间件、部署方式、安全等级等。</div>
              </div>
              <button
                onClick={handleExtractConstraints}
                disabled={isExtractingConstraints}
                className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isExtractingConstraints ? '提取中...' : '从招标文件提取约束'}
              </button>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-1 xl:grid-cols-6 gap-3">
                <label className="block xl:col-span-1">
                  <span className="block text-xs font-medium text-slate-600 mb-1">约束类别</span>
                  <select value={constraintCategory} onChange={(e) => setConstraintCategory(e.target.value)} className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm">
                    {CONSTRAINT_CATEGORY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="block xl:col-span-1">
                  <span className="block text-xs font-medium text-slate-600 mb-1">约束键</span>
                  <input value={constraintKey} onChange={(e) => setConstraintKey(e.target.value)} placeholder="如 database" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm" />
                </label>
                <label className="block xl:col-span-2">
                  <span className="block text-xs font-medium text-slate-600 mb-1">约束值</span>
                  <input value={constraintValue} onChange={(e) => setConstraintValue(e.target.value)} placeholder="如 PostgreSQL / 微服务 / 私有云" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm" />
                </label>
                <label className="block xl:col-span-1">
                  <span className="block text-xs font-medium text-slate-600 mb-1">来源章节</span>
                  <input value={constraintSourceChapter} onChange={(e) => setConstraintSourceChapter(e.target.value)} placeholder="如 3.2 总体架构" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm" />
                </label>
                <div className="flex items-end xl:col-span-1">
                  <button onClick={handleSaveConstraint} className="w-full px-3 py-2 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700">保存约束</button>
                </div>
              </div>
              <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <label className="inline-flex items-center text-sm text-slate-700">
                  <input type="checkbox" checked={isConstraintMandatory} onChange={(e) => setIsConstraintMandatory(e.target.checked)} className="mr-2" />
                  作为强制约束（冲突时按红线处理）
                </label>
                <div className="text-xs text-slate-500">{selectedConstraintMeta.helper}</div>
              </div>
              <div className="mt-4 max-h-60 overflow-auto rounded-xl border border-slate-200">
                {Object.keys(constraintsMap).length === 0 ? (
                  <div className="p-4 text-sm text-slate-500">暂无约束，可先把招标文件明确要求的关键技术口径录入进来。</div>
                ) : (
                  Object.entries(constraintsMap).map(([category, obj]) =>
                    Object.entries(obj).map(([key, value]) => {
                      const source = constraintSources[`${category}.${key}`] || '未填写来源章节';
                      const meta = CONSTRAINT_CATEGORY_OPTIONS.find((item) => item.value === category);
                      return (
                        <div key={`${category}.${key}`} className="px-4 py-3 border-b border-slate-100 last:border-b-0 flex items-start justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">{meta?.label || category}</span>
                              <span className="text-sm font-medium text-slate-900">{key}</span>
                            </div>
                            <div className="mt-2 text-sm text-slate-700">{value}</div>
                          </div>
                          <span className="text-xs text-slate-500 whitespace-nowrap">{source}</span>
                        </div>
                      );
                    })
                  )
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">引用分析</h3>
              <p className="text-sm text-slate-500 mt-1">这里展示需求要求中关注的引用比例、段落来源和可疑复用情况。</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {(['high', 'medium', 'low'] as const).map((riskKey) => (
                <span key={riskKey} className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${RISK_STYLES[riskKey]}`}>
                  {RISK_LABELS[riskKey]} {citationRiskSummary[riskKey] || 0}
                </span>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-xs text-slate-500">平均引用比例</div>
              <div className="mt-1 text-base font-semibold text-slate-900">{formatPercent(citationSummary.avg_citation_ratio)}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-xs text-slate-500">引用句 / 总句</div>
              <div className="mt-1 text-base font-semibold text-slate-900">{citationSummary.total_cited}/{citationSummary.total_sentences}</div>
            </div>
          </div>
          <div className="mt-5">
            <label className="block">
              <span className="block text-xs font-medium text-slate-600 mb-1">查看章节引用明细</span>
              <select
                value={selectedCitationChapterId}
                onChange={(e) => {
                  setSelectedCitationChapterId(e.target.value);
                  onChapterSelect(e.target.value);
                }}
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
              >
                {citationChapters.length === 0 ? (
                  <option value="">暂无引用分析数据</option>
                ) : (
                  citationChapters.map((item) => (
                    <option key={item.chapter_id} value={item.chapter_id}>
                      {item.chapter_title} | {formatPercent(item.citation_ratio)} | {RISK_LABELS[item.risk_level] || item.risk_level}
                    </option>
                  ))
                )}
              </select>
            </label>
          </div>
          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
            {isCitationDetailLoading ? (
              <div className="text-sm text-slate-500">正在加载章节引用明细...</div>
            ) : !citationDetail ? (
              <div className="text-sm text-slate-500">
                暂无可展示的章节引用数据。这不一定表示完全没有走 RAG，也可能是历史生成内容未写入引用统计；重新生成相关章节后会补齐引用分析。
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="text-base font-semibold text-slate-900">{citationDetail.chapter_title}</div>
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${RISK_STYLES[citationDetail.risk_level] || RISK_STYLES.low}`}>
                      {RISK_LABELS[citationDetail.risk_level] || citationDetail.risk_level}
                    </span>
                  </div>
                  <div className="text-sm text-slate-600 mt-2">
                    引用比例 {formatPercent(citationDetail.citation_ratio)}，引用句 {citationDetail.cited_sentences}/{citationDetail.total_sentences}，涉及来源 {selectedCitationSummary?.sources_count || citationDetail.sources.length} 个。
                  </div>
                </div>
                {citationDetail.risk_reasons.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <div className="text-xs font-medium text-amber-700 mb-2">风险提示</div>
                    <div className="space-y-1">
                      {citationDetail.risk_reasons.map((reason, index) => (
                        <div key={`${reason}-${index}`} className="text-sm text-amber-800">{reason}</div>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-sm font-medium text-slate-900 mb-2">主要引用来源与段落</div>
                  <div className="space-y-3 max-h-[520px] overflow-auto pr-1">
                    {citationDetail.sources.length === 0 ? (
                      <div className="text-sm text-slate-500">未检测到明确引用来源。</div>
                    ) : (
                      citationDetail.sources.map((source, index) => (
                        <div key={`${source.library_name}-${source.chapter_title}-${index}`} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-medium text-slate-900">{source.library_name || '未命名资料'}</div>
                              <div className="text-xs text-slate-500 mt-1">{source.chapter_title || '未定位章节'}</div>
                            </div>
                            <div className="text-right text-xs text-slate-500 whitespace-nowrap">
                              <div>贡献度 {formatPercent(source.contribution)}</div>
                              <div className="mt-1">命中句数 {source.sentences_count}</div>
                            </div>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-slate-500">
                            <div>平均相似度 {formatPercent(source.similarity_avg)}</div>
                            <div>段落样本 {source.paragraph_samples?.filter(Boolean).length || 0} 条</div>
                          </div>
                          {source.paragraph_samples && source.paragraph_samples.length > 0 && (
                            <div className="mt-3 space-y-2">
                              {source.paragraph_samples.filter(Boolean).map((sample, sampleIndex) => (
                                <div key={`${sampleIndex}-${sample.slice(0, 16)}`} className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-700 leading-6">
                                  {sample}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
          {highlightedCitationChapters.length > 0 && (
            <div className="mt-5">
              <div className="text-sm font-medium text-slate-900 mb-2">高引用章节速览</div>
              <div className="space-y-2">
                {highlightedCitationChapters.map((item) => (
                  <button
                    key={item.chapter_id}
                    onClick={() => {
                      setSelectedCitationChapterId(item.chapter_id);
                      onChapterSelect(item.chapter_id);
                    }}
                    className={`w-full rounded-xl border px-4 py-3 text-left transition ${item.chapter_id === selectedCitationChapterId ? 'border-blue-300 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-slate-900">{item.chapter_title}</div>
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${RISK_STYLES[item.risk_level] || RISK_STYLES.low}`}>
                        {formatPercent(item.citation_ratio)}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">引用句 {item.cited_sentences}/{item.total_sentences} · 来源 {item.sources_count} 个</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200">
        <div className="p-8">
          <div className="prose max-w-none">
            <h1 className="text-3xl font-bold text-gray-900 mb-8">
              {outlineData.project_name || '投标技术文件'}
            </h1>
            {outlineData.project_overview && (
              <div className="bg-blue-50 border-l-4 border-blue-400 p-6 mb-8">
                <h2 className="text-lg font-semibold text-blue-900 mb-2">项目概述</h2>
                <p className="text-blue-800">{outlineData.project_overview}</p>
              </div>
            )}
            <div className="space-y-8">
              {renderOutline(outlineData.outline)}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
        <div className="flex items-center justify-between text-sm text-gray-600">
          <div className="flex items-center space-x-6">
            <div className="flex items-center">
              <CheckCircleIcon className="w-4 h-4 text-green-500 mr-1" />
              <span>已完成: {completedItems}</span>
            </div>
            <div className="flex items-center">
              <DocumentTextIcon className="w-4 h-4 text-gray-400 mr-1" />
              <span>待生成: {leafItems.length - completedItems}</span>
            </div>
            {progress.failed.length > 0 && (
              <div className="flex items-center">
                <ExclamationCircleIcon className="w-4 h-4 text-red-500 mr-1" />
                <span className="text-red-600">失败: {progress.failed.length}</span>
              </div>
            )}
          </div>
          <div>
            <span>总字数: {leafItems.reduce((sum, item) => sum + (item.content?.length || 0), 0)}</span>
          </div>
        </div>
        <div className="mt-3 border-t border-gray-100 pt-3">
          <div className="text-xs text-gray-500 mb-2">RAG资料库管理</div>
          <div className="space-y-1 max-h-36 overflow-auto">
            {ragLibraries.map((item) => (
              <div key={item.id} className="flex items-center justify-between text-xs px-2 py-1 bg-gray-50 rounded">
                <div className="truncate">
                  {item.library_name} | {item.status} | chunk {item.total_chunks}
                  {item.industry_tags && item.industry_tags.length > 0 && (
                    <span className="ml-2 text-blue-700">行业: {item.industry_tags.map((tag) => `${tag.code}-${tag.name}`).join('、')}</span>
                  )}
                  {item.project_type_tags && item.project_type_tags.length > 0 && (
                    <span className="ml-2 text-emerald-700">项目: {item.project_type_tags.map((tag) => `${tag.code}-${tag.name}`).join('、')}</span>
                  )}
                </div>
                <button onClick={() => handleDeleteLibrary(item.id)} className="text-red-600 hover:text-red-700 inline-flex items-center">
                  <TrashIcon className="w-3 h-3 mr-1" />
                  删除
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 回到顶部按钮 */}
      {showScrollToTop && (
        <button
          onClick={scrollToTop}
          className="fixed bottom-24 right-6 bg-blue-600 hover:bg-blue-700 text-white rounded-full p-3 shadow-lg transition-all duration-300 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 z-[60]"
          aria-label="回到顶部"
        >
          <ArrowUpIcon className="w-5 h-5" />
        </button>
      )}
    </div>
  );
};

export default ContentEdit;
