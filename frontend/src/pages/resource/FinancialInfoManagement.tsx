import React, { useState, useEffect, useCallback } from 'react';
import { resourceApi } from '../../services/authApi';
import { FinancialInfo, PaginatedResponse } from '../../types';

const FINANCIAL_UPLOAD_FIELDS: Array<keyof FinancialInfo> = ['file_url'];

const FinancialInfoManagement: React.FC = () => {
  const [data, setData] = useState<PaginatedResponse<FinancialInfo>>({
    items: [], total: 0, page: 1, page_size: 8, total_pages: 0
  });
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [currentItem, setCurrentItem] = useState<Partial<FinancialInfo>>({});
  const [uploading, setUploading] = useState(false);
  const [smartFilling, setSmartFilling] = useState(false);
  const [ocrResult, setOcrResult] = useState<Record<string, unknown> | null>(null);

  const loadData = useCallback(async (page = 1, kw = '') => {
    setLoading(true);
    try {
      const result = await resourceApi.listFinancialInfo(page, 8, kw);
      setData(result);
    } catch (error) {
      console.error('加载财务信息失败:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(1, ''); }, [loadData]);

  const handleSelect = (id: number) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleSelectAll = () => {
    const ids = data.items.map((i) => i.id).filter((v): v is number => typeof v === 'number');
    setSelectedIds(selectedIds.length === ids.length ? [] : ids);
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('确定要删除该记录吗？')) return;
    try {
      await resourceApi.deleteFinancialInfo(id);
      loadData(data.page, keyword);
    } catch (error) {
      alert('删除失败');
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) { alert('请选择要删除的记录'); return; }
    if (!window.confirm(`确定要删除选中的 ${selectedIds.length} 条记录吗？`)) return;
    try {
      await resourceApi.batchDeleteFinancialInfo(selectedIds);
      loadData(data.page, keyword);
      setSelectedIds([]);
    } catch (error) {
      alert('批量删除失败');
    }
  };

  const handleSave = async () => {
    try {
      if (currentItem.id) {
        await resourceApi.updateFinancialInfo(currentItem.id, currentItem);
      } else {
        await resourceApi.createFinancialInfo(currentItem as any);
      }
      setShowModal(false);
      setOcrResult(null);
      loadData(data.page, keyword);
    } catch (error) {
      alert('保存失败');
    }
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const url = await resourceApi.uploadFile(file);
      setCurrentItem((prev) => ({ ...prev, file_url: url }));
      if (file.type.startsWith('image/')) {
        await handleSmartFill(file);
      }
    } catch (error: any) {
      const msg = error?.response?.data?.detail || error?.message || '上传失败';
      alert(msg);
    } finally {
      setUploading(false);
    }
  };

  const handleSmartFill = async (file: File) => {
    setSmartFilling(true);
    try {
      const result = await resourceApi.smartFill('financial', file, 'file_url');
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw new Error('识别结果为空或格式异常，请在接口管理中检查OCR模型配置');
      }
      setOcrResult(result);
      const merged = { ...(result as Partial<FinancialInfo>) };
      FINANCIAL_UPLOAD_FIELDS.forEach((field) => {
        delete merged[field];
      });
      setCurrentItem((prev) => ({ ...prev, ...merged }));
    } catch (error: any) {
      const msg = error?.response?.data?.detail || error?.message || '智能填充失败';
      alert(msg);
    } finally {
      setSmartFilling(false);
    }
  };

  const handleRemoveFile = () => {
    setCurrentItem((prev) => ({ ...prev, file_url: '' }));
  };

  const infoTypeLabels: Record<string, string> = {
    '财务审计报告': '财务审计报告',
    '缴纳社保证明': '缴纳社保证明',
    '缴纳税收证明': '缴纳税收证明'
  };

  if (loading) {
    return <div className="flex justify-center items-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
    </div>;
  }

  const selectableIds = data.items.map((i) => i.id).filter((v): v is number => typeof v === 'number');
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.includes(id));

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <div className="sm:flex sm:items-center sm:justify-between mb-4">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold text-gray-900">财务信息</h1>
          <button onClick={() => { setCurrentItem({}); setShowModal(true); }}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">新增</button>
          <button onClick={handleBatchDelete} disabled={selectedIds.length === 0}
            className="px-4 py-2 bg-gray-400 text-white rounded-md disabled:opacity-50">批量删除</button>
        </div>
        <div className="flex gap-2">
          <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索文件..." className="px-3 py-2 border rounded-md" />
          <button onClick={() => loadData(1, keyword)} className="px-4 py-2 bg-gray-100 rounded-md">搜索</button>
        </div>
      </div>

      <div className="overflow-hidden border rounded-lg">
        <div className="px-4 py-3 text-sm font-medium text-gray-700 border-b bg-gray-50">近三年财务分析列表</div>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-3"><input type="checkbox" checked={allSelected}
                onChange={handleSelectAll} className="rounded" /></th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">信息名称</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">信息类型</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">信息时间</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {data.items.map((item) => (
              <tr key={item.id ?? item.info_name}>
                <td className="px-3 py-3">
                  {(() => {
                    if (typeof item.id !== 'number') return null;
                    const id = item.id;
                    return (
                      <input type="checkbox" checked={selectedIds.includes(id)}
                        onChange={() => handleSelect(id)} className="rounded" />
                    );
                  })()}
                </td>
                <td className="px-3 py-3 text-sm">{item.info_name}</td>
                <td className="px-3 py-3 text-sm">{infoTypeLabels[item.info_type] || item.info_type}</td>
                <td className="px-3 py-3 text-sm">{item.info_date}</td>
                <td className="px-3 py-3 text-sm">
                  <button onClick={() => { setCurrentItem(item); setShowModal(true); }}
                    className="text-blue-600 hover:text-blue-900 mr-2">编辑</button>
                  {(() => {
                    if (typeof item.id !== 'number') return null;
                    const id = item.id;
                    return (
                      <button onClick={() => handleDelete(id)}
                        className="text-red-600 hover:text-red-900">删除</button>
                    );
                  })()}
                </td>
              </tr>
            ))}
            {data.items.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-3 text-center text-sm text-gray-500">暂无数据</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 z-10">
          <div className="bg-white rounded-lg p-6 max-w-md mx-auto mt-20">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">{currentItem.id ? '编辑财务信息' : '新增财务信息'}</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-500">✕</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">文件</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  <label className="px-3 py-2 rounded-md border border-gray-200 bg-white text-sm hover:bg-gray-50 cursor-pointer">
                    {uploading ? '上传中...' : '上传文件'}
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) {
                          handleUpload(file);
                        }
                      }}
                      disabled={uploading}
                    />
                  </label>
                  {smartFilling ? <span className="px-3 py-2 text-sm text-blue-600">识别中...</span> : null}
                </div>
                {currentItem.file_url ? (
                  <div className="mt-2">
                    <a href={currentItem.file_url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:text-blue-800">
                      查看文件
                    </a>
                    {/\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(currentItem.file_url) ? (
                      <div className="relative mt-2 inline-block">
                        <img src={currentItem.file_url} alt="file" className="h-24 w-auto rounded-md border" />
                        <button
                          type="button"
                          onClick={handleRemoveFile}
                          className="absolute right-1 top-1 rounded bg-red-600 px-2 py-0.5 text-xs text-white hover:bg-red-700"
                        >
                          删除
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={handleRemoveFile}
                        className="ml-3 rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
                      >
                        删除
                      </button>
                    )}
                    <div className="mt-2 text-xs text-gray-500 break-all">{currentItem.file_url}</div>
                  </div>
                ) : null}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">信息类型 *</label>
                <select value={currentItem.info_type || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, info_type: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md">
                  <option value="">请选择</option>
                  <option value="财务审计报告">财务审计报告</option>
                  <option value="缴纳社保证明">缴纳社保证明</option>
                  <option value="缴纳税收证明">缴纳税收证明</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">信息名称 *</label>
                <input type="text" value={currentItem.info_name || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, info_name: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">信息时间</label>
                <input type="date" value={currentItem.info_date || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, info_date: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">备注</label>
                <textarea
                  value={currentItem.remark || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, remark: e.target.value })}
                  rows={2}
                  className="mt-1 w-full px-3 py-2 border rounded-md"
                />
              </div>
            </div>
            {ocrResult ? (
              <div className="mt-4 border rounded-md bg-gray-50 p-3">
                <div className="text-sm font-medium text-gray-700 mb-2">识别结果</div>
                <pre className="text-xs text-gray-700 whitespace-pre-wrap break-words">{JSON.stringify(ocrResult, null, 2)}</pre>
              </div>
            ) : null}
            <div className="flex justify-end gap-4 mt-6">
              <button onClick={() => setShowModal(false)}
                className="px-4 py-2 border rounded-md">取消</button>
              <button onClick={handleSave}
                className="px-4 py-2 bg-blue-600 text-white rounded-md">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FinancialInfoManagement;
