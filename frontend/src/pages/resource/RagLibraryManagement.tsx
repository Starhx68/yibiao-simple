import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowPathIcon, TrashIcon } from '@heroicons/react/24/outline';
import { ragApi, RagCategoryItem, RagLibraryItem, RagVectorIndexStats } from '../../services/api';

const normalizeText = (value?: string) => (value || '').trim().toLowerCase();

const getFileBaseName = (fileName: string) => fileName.replace(/\.[^.]+$/, '').trim().toLowerCase();

const isCoverFile = (fileName: string) => {
  const normalized = fileName.trim().toLowerCase();
  return /(封面|首页|扉页|cover|title|frontpage)/i.test(normalized);
};

const dedupeCategoryItems = (items: RagCategoryItem[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = normalizeText(item.code);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const dedupeLibraries = (items: RagLibraryItem[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${normalizeText(item.library_name)}|${normalizeText(item.file_name)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const getMessageToneClass = (line: string) => {
  if (line.includes('成功')) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (line.includes('失败')) return 'bg-red-50 text-red-700 border-red-200';
  if (line.includes('重复已跳过') || line.includes('封面已跳过') || line.includes('体积超限已跳过')) return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-gray-50 text-gray-700 border-gray-200';
};

const MAX_RAG_UPLOAD_SIZE_BYTES = 300 * 1024 * 1024;

const getUploadErrorMessage = (error: any) => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail.trim();
  if (typeof error?.message === 'string' && error.message.trim()) return error.message.trim();
  return '未知错误';
};

const RagLibraryManagement: React.FC = () => {
  const [ragLibraries, setRagLibraries] = useState<RagLibraryItem[]>([]);
  const [industryOptions, setIndustryOptions] = useState<RagCategoryItem[]>([]);
  const [projectTypeOptions, setProjectTypeOptions] = useState<RagCategoryItem[]>([]);
  const [selectedIndustryCodes, setSelectedIndustryCodes] = useState<string[]>([]);
  const [selectedProjectTypeCodes, setSelectedProjectTypeCodes] = useState<string[]>([]);
  const [ragIndustry, setRagIndustry] = useState('');
  const [ragProjectType, setRagProjectType] = useState('');
  const [autoClassifyByTitle, setAutoClassifyByTitle] = useState(true);
  const [isUploadingRag, setIsUploadingRag] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [uploadProgressText, setUploadProgressText] = useState('');
  const [messageLines, setMessageLines] = useState<string[]>([]);
  const [selectedLibraryId, setSelectedLibraryId] = useState<number | null>(null);
  const [vectorIndexStats, setVectorIndexStats] = useState<RagVectorIndexStats | null>(null);
  const [isRebuildingIndex, setIsRebuildingIndex] = useState(false);
  const [rebuildTaskId, setRebuildTaskId] = useState<string | null>(null);
  const [rebuildTaskProgress, setRebuildTaskProgress] = useState(0);
  const [rebuildTaskMessage, setRebuildTaskMessage] = useState('');
  // 后台上传任务状态
  const [pendingUploadTasks, setPendingUploadTasks] = useState<Map<number, { fileName: string; progress: number; message: string }>>(new Map());
  const ragFileInputRef = useRef<HTMLInputElement | null>(null);
  const ragFolderInputRef = useRef<HTMLInputElement | null>(null);

  const loadRagLibraries = useCallback(async () => {
    const response = await ragApi.listLibraries();
    setRagLibraries(dedupeLibraries(response.data.items || []));
  }, []);

  const loadClassificationOptions = useCallback(async () => {
    await ragApi.bootstrapClassifications(false);
    const response = await ragApi.getClassifications();
    setIndustryOptions(dedupeCategoryItems(response.data.industry_items || []));
    setProjectTypeOptions(dedupeCategoryItems(response.data.project_type_items || []));
  }, []);

  const selectedLibrary = useMemo(
    () => ragLibraries.find((item) => item.id === selectedLibraryId) || null,
    [ragLibraries, selectedLibraryId]
  );

  const refreshAll = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) {
      setIsRefreshing(true);
      setMessageLines([]);
    }
    try {
      const statsResponse = await ragApi.getVectorIndexStats();
      setVectorIndexStats(statsResponse.data.stats);
      await Promise.all([loadRagLibraries(), loadClassificationOptions()]);
    } catch (error: any) {
      if (!silent) {
        setMessageLines([error?.response?.data?.detail || error?.message || '刷新失败']);
      }
    } finally {
      if (!silent) {
        setIsRefreshing(false);
      }
    }
  }, [loadClassificationOptions, loadRagLibraries]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    // 始终轮询向量模型状态，直到加载完成或降级
    const shouldPoll = vectorIndexStats?.model_loading ||
                      vectorIndexStats?.loading_state === 'idle' ||
                      vectorIndexStats?.loading_state === 'loading';

    if (!shouldPoll) {
      return;
    }

    const timer = window.setInterval(() => {
      refreshAll({ silent: true });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [refreshAll, vectorIndexStats?.model_loading, vectorIndexStats?.loading_state]);

  useEffect(() => {
    if (!isRebuildingIndex || !rebuildTaskId) {
      return;
    }
    const timer = window.setInterval(async () => {
      try {
        const response = await ragApi.getRebuildVectorIndexTask(rebuildTaskId);
        const task = response.data;
        setRebuildTaskProgress(task.progress || 0);
        setRebuildTaskMessage(task.message || '');
        if (task.status === 'success' || task.status === 'failed' || task.status === 'cancelled') {
          setIsRebuildingIndex(false);
          await refreshAll({ silent: true });
          if (task.status === 'success' && task.result) {
            setMessageLines([
              `重建完成，已处理 ${task.result.processed_chunks} / ${task.result.total_chunks} 个 chunk`,
              task.result.is_real_embedding ? `当前使用语义向量模型：${task.result.model_name}` : `当前仍为降级方案：${task.result.model_name}`,
              ...(task.result.errors || []).slice(0, 3),
            ].filter(Boolean));
          } else {
            setMessageLines([
              task.error || task.message || '重建索引失败',
              ...((task.result?.errors || []).slice(0, 3)),
            ].filter(Boolean));
          }
        }
      } catch (error: any) {
        setIsRebuildingIndex(false);
        setMessageLines([error?.response?.data?.detail || error?.message || '获取重建任务状态失败']);
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [isRebuildingIndex, rebuildTaskId, refreshAll]);

  // 轮询待处理的上传任务进度
  useEffect(() => {
    if (pendingUploadTasks.size === 0) {
      return;
    }

    const timer = window.setInterval(async () => {
      const updatedTasks = new Map<number, { fileName: string; progress: number; message: string }>();
      const completedLibraryIds: number[] = [];
      const failedLibraryIds: number[] = [];

      // 检查每个待处理任务的进度
      for (const [libraryId, taskInfo] of Array.from(pendingUploadTasks.entries())) {
        try {
          const response = await ragApi.getLibraryProgress(libraryId);
          const progress = response.data;
          updatedTasks.set(libraryId, {
            fileName: taskInfo.fileName,
            progress: progress.progress || 0,
            message: `${progress.status || '处理中'} ${(progress.progress || 0).toFixed(0)}%`,
          });

          if (progress.status === 'completed') {
            completedLibraryIds.push(libraryId);
          } else if (progress.status === 'failed') {
            failedLibraryIds.push(libraryId);
          }
        } catch (error) {
          // 如果获取进度失败，保持原状态
          updatedTasks.set(libraryId, taskInfo);
        }
      }

      // 更新待处理任务
      setPendingUploadTasks((prev) => {
        const next = new Map(prev);
        completedLibraryIds.forEach((id) => next.delete(id));
        failedLibraryIds.forEach((id) => next.delete(id));
        return next;
      });

      // 更新进度显示
      setPendingUploadTasks(updatedTasks);

      // 如果有任务完成或失败，刷新库列表并显示消息
      if (completedLibraryIds.length > 0 || failedLibraryIds.length > 0) {
        await refreshAll({ silent: true });
        if (completedLibraryIds.length > 0) {
          const completedFiles = Array.from(pendingUploadTasks.entries())
            .filter(([id]) => completedLibraryIds.includes(id))
            .map(([, info]) => info.fileName);
          setMessageLines((prev) => [
            ...prev,
            `处理完成：${completedFiles.join('、')}`,
          ]);
        }
        if (failedLibraryIds.length > 0) {
          const failedFiles = Array.from(pendingUploadTasks.entries())
            .filter(([id]) => failedLibraryIds.includes(id))
            .map(([, info]) => info.fileName);
          setMessageLines((prev) => [
            ...prev,
            `处理失败：${failedFiles.join('、')}`,
          ]);
        }
      }
    }, 3000); // 每3秒轮询一次

    return () => window.clearInterval(timer);
  }, [pendingUploadTasks, refreshAll]);

  useEffect(() => {
    if (ragFolderInputRef.current) {
      ragFolderInputRef.current.setAttribute('webkitdirectory', '');
      ragFolderInputRef.current.setAttribute('directory', '');
    }
  }, []);

  useEffect(() => {
    if (ragLibraries.length === 0) {
      setSelectedLibraryId(null);
      return;
    }
    if (!selectedLibraryId || !ragLibraries.some((item) => item.id === selectedLibraryId)) {
      setSelectedLibraryId(ragLibraries[0].id);
    }
  }, [ragLibraries, selectedLibraryId]);

  const uploadRagFiles = async (files: File[], fromFolder = false) => {
    if (!files.length) return;
    const allowedFiles = files.filter((file) => /\.(pdf|doc|docx)$/i.test(file.name));
    if (allowedFiles.length === 0) {
      setMessageLines(['未找到可导入文件，请选择 pdf/doc/docx 文件']);
      return;
    }
    const existingNameSet = new Set<string>();
    ragLibraries.forEach((item) => {
      if (item.library_name) existingNameSet.add(normalizeText(item.library_name));
      if (item.file_name) existingNameSet.add(normalizeText(item.file_name));
      if (item.file_name) existingNameSet.add(getFileBaseName(item.file_name));
      if (item.library_name) existingNameSet.add(getFileBaseName(item.library_name));
    });
    const batchNameSet = new Set<string>();
    setIsUploadingRag(true);
    setMessageLines([]);
    let success = 0;
    let failed = 0;
    const failedFiles: string[] = [];
    const failedReasonMap = new Map<string, string[]>();
    const skippedDuplicateFiles: string[] = [];
    const skippedCoverFiles: string[] = [];
    const skippedOversizeFiles: string[] = [];
    const newPendingTasks = new Map<number, { fileName: string; progress: number; message: string }>();
    try {
      for (let index = 0; index < allowedFiles.length; index += 1) {
        const file = allowedFiles[index];
        if (fromFolder && isCoverFile(file.name)) {
          skippedCoverFiles.push(file.name);
          continue;
        }
        if (file.size > MAX_RAG_UPLOAD_SIZE_BYTES) {
          skippedOversizeFiles.push(file.name);
          continue;
        }
        const normalizedName = normalizeText(file.name);
        const normalizedBaseName = getFileBaseName(file.name);
        const isDuplicate =
          existingNameSet.has(normalizedName) ||
          existingNameSet.has(normalizedBaseName) ||
          batchNameSet.has(normalizedName) ||
          batchNameSet.has(normalizedBaseName);
        if (isDuplicate) {
          skippedDuplicateFiles.push(file.name);
          continue;
        }
        setUploadProgressText(`正在上传 ${index + 1}/${allowedFiles.length}: ${file.name}`);
        try {
          // 使用异步上传API
          const response = await ragApi.uploadLibraryFileAsync(file, {
            library_name: file.name.replace(/\.[^.]+$/, ''),
            industry: ragIndustry || undefined,
            project_type: ragProjectType || undefined,
            industry_codes: selectedIndustryCodes,
            project_type_codes: selectedProjectTypeCodes,
            auto_classify: autoClassifyByTitle,
          });

          const libraryId = response.data.library_id;
          // 添加到待处理任务列表
          newPendingTasks.set(libraryId, {
            fileName: file.name,
            progress: 0,
            message: '等待处理',
          });

          success += 1;
          batchNameSet.add(normalizedName);
          batchNameSet.add(normalizedBaseName);
        } catch (error: any) {
          failed += 1;
          failedFiles.push(file.name);
          const reason = getUploadErrorMessage(error);
          failedReasonMap.set(reason, [...(failedReasonMap.get(reason) || []), file.name]);
        }
      }

      // 设置待处理任务并启动轮询
      setPendingUploadTasks(newPendingTasks);

      const messageParts = [`上传完成，成功 ${success} 份，失败 ${failed} 份。正在后台处理中...`];
      if (skippedDuplicateFiles.length > 0) {
        messageParts.push(`重复已跳过 ${skippedDuplicateFiles.length} 份：${skippedDuplicateFiles.join('、')}`);
      }
      if (skippedCoverFiles.length > 0) {
        messageParts.push(`封面已跳过 ${skippedCoverFiles.length} 份：${skippedCoverFiles.join('、')}`);
      }
      if (skippedOversizeFiles.length > 0) {
        messageParts.push(`体积超限已跳过 ${skippedOversizeFiles.length} 份（单文件>300MB）：${skippedOversizeFiles.join('、')}`);
      }
      if (failedFiles.length > 0) {
        messageParts.push(`失败文件：${failedFiles.join('、')}`);
        Array.from(failedReasonMap.entries()).forEach(([reason, filesByReason]) => {
          messageParts.push(`失败原因（${filesByReason.length}份）：${reason}。文件：${filesByReason.join('、')}`);
        });
      }
      setMessageLines(messageParts);

      // 立即刷新库列表以显示新创建的记录
      await refreshAll({ silent: true });
    } finally {
      setUploadProgressText('');
      setIsUploadingRag(false);
    }
  };

  const handleUploadRagFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    await uploadRagFiles(files, false);
    event.target.value = '';
  };

  const handleUploadRagFolder = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    await uploadRagFiles(files, true);
    event.target.value = '';
  };

  const handleDeleteLibrary = async (libraryId: number) => {
    try {
      await ragApi.deleteLibrary(libraryId);
      await refreshAll();
      setMessageLines(['资料库已删除']);
    } catch (error: any) {
      setMessageLines([error?.response?.data?.detail || error?.message || '删除失败']);
    }
  };

  const rebuildVectorIndex = useCallback(async () => {
    if (!window.confirm('确定要重建向量索引吗？这将使用当前的向量模型重新处理已导入资料。')) {
      return;
    }
    setIsRebuildingIndex(true);
    setRebuildTaskProgress(0);
    setRebuildTaskMessage('正在创建重建任务');
    try {
      const response = await ragApi.rebuildVectorIndex();
      const result = response.data;
      setRebuildTaskId(result.task_id);
      setRebuildTaskMessage(result.message || (result.accepted ? '重建任务已启动' : '重建任务执行中'));
      setMessageLines([result.message || (result.accepted ? '重建任务已启动' : '已有重建任务在执行')]);
    } catch (error: any) {
      setRebuildTaskId(null);
      setMessageLines([error?.response?.data?.detail || error?.message || '重建索引失败']);
      setIsRebuildingIndex(false);
    }
  }, [refreshAll]);

  const loadingState = vectorIndexStats?.loading_state || 'idle';
  const loadingProgress = Math.max(0, Math.min(100, vectorIndexStats?.loading_progress || 0));
  const loadingBarClass = loadingState === 'loaded' ? 'bg-emerald-600' : loadingState === 'fallback' ? 'bg-amber-600' : loadingState === 'loading' ? 'bg-blue-600' : 'bg-slate-400';

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">RAG智能参考</h1>
            <p className="text-sm text-gray-500 mt-1">
              资料导入、向量库维护与检索参考配置入口，总计 {ragLibraries.length} 份，可用 {ragLibraries.filter((i) => i.status === 'completed').length} 份
            </p>
          </div>
          <button
            type="button"
            onClick={() => refreshAll()}
            disabled={isRefreshing}
            className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm rounded-md bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            <ArrowPathIcon className="w-4 h-4 mr-2" />
            {isRefreshing ? '刷新中...' : '刷新'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-medium text-gray-900">向量模型状态</div>
            <div className="text-xs text-gray-500 mt-1">上传资料后可在这里确认是否真实使用语义向量模型，而不是 hash 降级方案。</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => refreshAll()}
              disabled={isRefreshing}
              className="inline-flex items-center px-3 py-2 text-sm rounded-md border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              刷新状态
            </button>
            <button
              type="button"
              onClick={rebuildVectorIndex}
              disabled={isRebuildingIndex || !!vectorIndexStats?.model_loading || !vectorIndexStats?.total_chunks}
              className="inline-flex items-center px-3 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRebuildingIndex ? `重建中 ${rebuildTaskProgress}%` : '重建向量索引'}
            </button>
          </div>
        </div>
        {isRebuildingIndex ? (
          <div className="rounded-md border border-indigo-200 bg-indigo-50 p-3">
            <div className="flex items-center justify-between text-xs text-indigo-700">
              <span>{rebuildTaskMessage || '重建任务执行中'}</span>
              <span>{rebuildTaskProgress}%</span>
            </div>
            <div className="mt-2 h-2 w-full rounded-full bg-indigo-100 overflow-hidden">
              <div
                className="h-full bg-indigo-600 transition-all duration-300"
                style={{ width: `${Math.max(3, rebuildTaskProgress)}%` }}
              />
            </div>
          </div>
        ) : null}
        {vectorIndexStats ? (
          <div className={`rounded-md border p-3 ${
            loadingState === 'loaded' ? 'border-emerald-200 bg-emerald-50' :
            loadingState === 'fallback' ? 'border-amber-200 bg-amber-50' :
            loadingState === 'loading' ? 'border-blue-200 bg-blue-50' :
            'border-gray-200 bg-gray-50'
          }`}>
            <div className={`flex items-center justify-between text-xs ${
              loadingState === 'loaded' ? 'text-emerald-700' :
              loadingState === 'fallback' ? 'text-amber-700' :
              loadingState === 'loading' ? 'text-blue-700' :
              'text-gray-700'
            }`}>
              <span>{vectorIndexStats.loading_message || '等待加载'}</span>
              <span>{loadingProgress}%</span>
            </div>
            <div className={`mt-2 h-2 w-full rounded-full overflow-hidden ${
              loadingState === 'loaded' ? 'bg-emerald-100' :
              loadingState === 'fallback' ? 'bg-amber-100' :
              loadingState === 'loading' ? 'bg-blue-100' :
              'bg-gray-100'
            }`}>
              <div
                className={`h-full transition-all duration-300 ${loadingBarClass}`}
                style={{ width: `${Math.max(3, loadingProgress)}%` }}
              />
            </div>
            <div className={`mt-2 text-xs ${
              loadingState === 'loaded' ? 'text-emerald-700' :
              loadingState === 'fallback' ? 'text-amber-700' :
              loadingState === 'loading' ? 'text-blue-700' :
              'text-gray-700'
            }`}>
              状态：{loadingState} · 阶段：{vectorIndexStats.loading_stage || 'idle'}
              {vectorIndexStats?.loading_candidate ? ` · 候选模型：${vectorIndexStats.loading_candidate}` : ''}
              {vectorIndexStats.loading_started_at ? ` · 开始时间：${new Date(vectorIndexStats.loading_started_at * 1000).toLocaleTimeString()}` : ''}
            </div>
            {vectorIndexStats.loading_errors && vectorIndexStats.loading_errors.length > 0 ? (
              <div className="mt-2 text-xs text-red-700">
                最近错误：{vectorIndexStats.loading_errors.slice(-2).join(' | ')}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
            <div className="text-xs text-gray-500">当前模型</div>
            <div className="mt-1 font-medium text-gray-900 break-all">{vectorIndexStats?.model_name || '等待加载'}</div>
            <div className="mt-1 text-xs text-gray-500">{vectorIndexStats?.dimension ? `${vectorIndexStats.dimension} 维` : '等待获取维度'}</div>
          </div>
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
            <div className="text-xs text-gray-500">模型类型</div>
            <div className={`mt-1 font-medium ${vectorIndexStats?.model_loading ? 'text-blue-700' : vectorIndexStats?.is_real_embedding ? 'text-emerald-700' : 'text-amber-700'}`}>
              {vectorIndexStats?.model_loading ? '加载中' : vectorIndexStats?.is_real_embedding ? '语义向量' : '降级方案'}
            </div>
            <div className="mt-1 text-xs text-gray-500">{vectorIndexStats?.cuda_available ? 'CUDA 可用' : 'CPU 模式'}</div>
          </div>
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
            <div className="text-xs text-gray-500">索引状态</div>
            <div className="mt-1 font-medium text-gray-900">{vectorIndexStats?.indexed_chunks || 0} / {vectorIndexStats?.total_chunks || 0}</div>
            <div className="mt-1 text-xs text-gray-500">
              {vectorIndexStats?.model_loading
                ? `模型加载进度 ${vectorIndexStats?.loading_progress || 0}%`
                : vectorIndexStats?.needs_rebuild
                  ? '需要重建'
                  : '索引正常'}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input
            type="text"
            value={ragIndustry}
            onChange={(e) => setRagIndustry(e.target.value)}
            placeholder="行业（可选）"
            className="border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
          <input
            type="text"
            value={ragProjectType}
            onChange={(e) => setRagProjectType(e.target.value)}
            placeholder="项目类型（可选）"
            className="border border-gray-300 rounded-md px-3 py-2 text-sm"
          />
          <select
            value={selectedIndustryCodes[0] || ''}
            onChange={(e) => setSelectedIndustryCodes(e.target.value ? [e.target.value] : [])}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
          >
            <option value="">行业分类（下拉选择）</option>
            {industryOptions.map((option) => (
              <option key={option.code} value={option.code}>{option.code} {option.name}</option>
            ))}
          </select>
          <select
            value={selectedProjectTypeCodes[0] || ''}
            onChange={(e) => setSelectedProjectTypeCodes(e.target.value ? [e.target.value] : [])}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
          >
            <option value="">项目分类（下拉选择）</option>
            {projectTypeOptions.map((option) => (
              <option key={option.code} value={option.code}>{option.code} {option.name}</option>
            ))}
          </select>
          <label className="inline-flex items-center text-sm text-gray-700">
            <input
              type="checkbox"
              checked={autoClassifyByTitle}
              onChange={(e) => setAutoClassifyByTitle(e.target.checked)}
              className="mr-2"
            />
            标题页自动判别
          </label>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => ragFileInputRef.current?.click()}
            disabled={isUploadingRag}
            className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm rounded-md bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            导入文件
          </button>
          <button
            onClick={() => ragFolderInputRef.current?.click()}
            disabled={isUploadingRag}
            className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm rounded-md bg-white hover:bg-gray-50 disabled:opacity-50"
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
          {isUploadingRag ? <span className="text-sm text-blue-600">{uploadProgressText || '导入中...'}</span> : null}
          {pendingUploadTasks.size > 0 ? (
            <span className="text-sm text-indigo-600">
              后台处理中 {pendingUploadTasks.size} 个文件...
            </span>
          ) : null}
        </div>

        {/* 待处理任务进度显示 */}
        {pendingUploadTasks.size > 0 ? (
          <div className="space-y-2">
            <div className="text-xs font-medium text-gray-700">后台处理进度</div>
            {Array.from(pendingUploadTasks.entries()).map(([libraryId, task]) => (
              <div key={libraryId} className="rounded-md border border-indigo-200 bg-indigo-50 p-2">
                <div className="flex items-center justify-between text-xs text-indigo-700">
                  <span className="truncate max-w-[200px]">{task.fileName}</span>
                  <span>{task.progress.toFixed(0)}%</span>
                </div>
                <div className="mt-1 h-1.5 w-full rounded-full bg-indigo-100 overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 transition-all duration-300"
                    style={{ width: `${Math.max(3, task.progress)}%` }}
                  />
                </div>
                <div className="mt-1 text-xs text-indigo-600 truncate">{task.message}</div>
              </div>
            ))}
          </div>
        ) : null}

        {messageLines.length > 0 ? (
          <div className="space-y-2">
            {messageLines.map((line, idx) => (
              <div key={`${line}-${idx}`} className={`rounded-md border px-3 py-2 text-sm ${getMessageToneClass(line)}`}>
                {line}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
        <div className="text-sm font-medium text-gray-700">资料库（下拉选择）</div>
        {ragLibraries.length === 0 ? (
          <div className="text-sm text-gray-500">暂无资料</div>
        ) : (
          <>
            <select
              value={selectedLibraryId || ''}
              onChange={(e) => setSelectedLibraryId(Number(e.target.value))}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white"
            >
              {ragLibraries.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.library_name} | {item.status} | chunk {item.total_chunks}
                </option>
              ))}
            </select>
            {selectedLibrary ? (
              <div className="rounded-md border border-gray-200 bg-gray-50 p-3 flex items-center justify-between gap-3">
                <div className="min-w-0 text-sm text-gray-800">
                  <div className="font-medium truncate">{selectedLibrary.library_name}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    状态 {selectedLibrary.status} · 分块 {selectedLibrary.total_chunks}
                  </div>
                  {selectedLibrary.industry_tags && selectedLibrary.industry_tags.length > 0 ? (
                    <div className="text-xs text-blue-700 mt-1">
                      行业: {selectedLibrary.industry_tags.map((tag) => `${tag.code}-${tag.name}`).join('、')}
                    </div>
                  ) : null}
                  {selectedLibrary.project_type_tags && selectedLibrary.project_type_tags.length > 0 ? (
                    <div className="text-xs text-emerald-700 mt-1">
                      项目: {selectedLibrary.project_type_tags.map((tag) => `${tag.code}-${tag.name}`).join('、')}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteLibrary(selectedLibrary.id)}
                  className="inline-flex items-center px-2 py-1 text-xs border border-red-200 text-red-600 rounded hover:bg-red-50"
                >
                  <TrashIcon className="w-3 h-3 mr-1" />
                  删除
                </button>
              </div>
            ) : null}
          </>
        )}
        <div className="text-xs text-gray-500">
          导入规则：重复文件自动跳过；文件夹内封面文件自动跳过（封面/首页/扉页/cover/title/frontpage）
        </div>
      </div>
    </div>
  );
};

export default RagLibraryManagement;
