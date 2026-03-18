import React, { useState, useEffect, useCallback } from 'react';
import { resourceApi } from '../../services/authApi';
import { Performance, PaginatedResponse } from '../../types';

const PERFORMANCE_UPLOAD_FIELDS: Array<keyof Performance> = [
  'contract_url',
  'bid_notice_url',
  'acceptance_url',
  'evaluation_url',
  'invoice_url',
];

const PerformanceManagement: React.FC = () => {
  const [data, setData] = useState<PaginatedResponse<Performance>>({
    items: [], total: 0, page: 1, page_size: 8, total_pages: 0
  });
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [currentItem, setCurrentItem] = useState<Partial<Performance>>({});
  const [uploading, setUploading] = useState(false);
  const [smartFilling, setSmartFilling] = useState(false);
  const [ocrResult, setOcrResult] = useState<Record<string, unknown> | null>(null);

  const loadData = useCallback(async (page = 1, kw = '') => {
    setLoading(true);
    try {
      const result = await resourceApi.listPerformances(page, 8, kw);
      setData(result);
    } catch (error) {
      console.error('加载业绩列表失败:', error);
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
    if (!window.confirm('确定要删除该业绩吗？')) return;
    try {
      await resourceApi.deletePerformance(id);
      loadData(data.page, keyword);
    } catch (error) {
      alert('删除失败');
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) { alert('请选择要删除的业绩'); return; }
    if (!window.confirm(`确定要删除选中的 ${selectedIds.length} 个业绩吗？`)) return;
    try {
      await resourceApi.batchDeletePerformances(selectedIds);
      loadData(data.page, keyword);
      setSelectedIds([]);
    } catch (error) {
      alert('批量删除失败');
    }
  };

  const handleSave = async () => {
    try {
      if (currentItem.id) {
        await resourceApi.updatePerformance(currentItem.id, currentItem);
      } else {
        await resourceApi.createPerformance(currentItem as any);
      }
      setShowModal(false);
      setOcrResult(null);
      loadData(data.page, keyword);
    } catch (error) {
      alert('保存失败');
    }
  };

  const handleUpload = async (field: keyof Performance, file: File) => {
    setUploading(true);
    try {
      const url = await resourceApi.uploadFile(file);
      setCurrentItem((prev) => ({ ...prev, [field]: url }));
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
      const result = await resourceApi.smartFill('performance', file);
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw new Error('识别结果为空或格式异常，请在接口管理中检查OCR模型配置');
      }
      setOcrResult(result);
      const merged = { ...(result as Partial<Performance>) };
      PERFORMANCE_UPLOAD_FIELDS.forEach((field) => {
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

  const handleRemoveUpload = (field: keyof Performance) => {
    setCurrentItem((prev) => ({ ...prev, [field]: '' }));
  };

  const uploadFields: Array<{ label: string; field: keyof Performance }> = [
    { label: '合同', field: 'contract_url' },
    { label: '中标通知书', field: 'bid_notice_url' },
    { label: '竣工验收', field: 'acceptance_url' },
    { label: '用户评议', field: 'evaluation_url' },
    { label: '回款发票', field: 'invoice_url' },
  ];

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
          <h1 className="text-xl font-semibold text-gray-900">业绩管理</h1>
          <button onClick={() => { setCurrentItem({}); setShowModal(true); }}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">新增</button>
          <button onClick={handleBatchDelete} disabled={selectedIds.length === 0}
            className="px-4 py-2 bg-gray-400 text-white rounded-md disabled:opacity-50">批量删除</button>
        </div>
        <div className="flex gap-2">
          <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索业绩..." className="px-3 py-2 border rounded-md" />
          <button onClick={() => loadData(1, keyword)} className="px-4 py-2 bg-gray-100 rounded-md">搜索</button>
        </div>
      </div>

      <div className="overflow-hidden border rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-3"><input type="checkbox" checked={allSelected}
                onChange={handleSelectAll} className="rounded" /></th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">项目名称</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">项目类型</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">甲方名称</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">项目金额(万元)</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">合同起止时间</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {data.items.map((item) => (
              <tr key={item.id ?? item.project_name}>
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
                <td className="px-3 py-3 text-sm">{item.project_name}</td>
                <td className="px-3 py-3 text-sm">{item.project_type || '-'}</td>
                <td className="px-3 py-3 text-sm">{item.client_name || '-'}</td>
                <td className="px-3 py-3 text-sm">{item.contract_amount ?? '-'}</td>
                <td className="px-3 py-3 text-sm">{item.start_date || '-'} ~ {item.end_date || '-'}</td>
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
              <tr><td colSpan={6} className="px-3 py-3 text-center text-sm text-gray-500">暂无数据</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 z-10">
          <div className="bg-white rounded-lg p-6 max-w-5xl mx-auto mt-10 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">{currentItem.id ? '编辑业绩' : '新增业绩'}</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-500">✕</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700">附件上传</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {uploadFields.map((item) => (
                    <label key={item.field} className="px-3 py-2 rounded-md border border-gray-200 bg-white text-sm hover:bg-gray-50 cursor-pointer">
                      {uploading ? '上传中...' : item.label}
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (file) {
                            handleUpload(item.field, file);
                          }
                        }}
                        disabled={uploading}
                      />
                    </label>
                  ))}
                  {smartFilling ? <span className="px-3 py-2 text-sm text-blue-600">识别中...</span> : null}
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                  {uploadFields.map((item) => {
                    const url = currentItem[item.field];
                    if (!url || typeof url !== 'string') {
                      return null;
                    }
                    const isImage = /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(url);
                    return (
                      <div key={`${item.field}-preview`} className="rounded-md border border-gray-200 p-2">
                        <div className="text-xs text-gray-600">{item.label}</div>
                        {isImage ? (
                          <div className="relative mt-2 inline-block">
                            <img src={url} alt={item.label} className="h-20 w-auto rounded-md border" />
                            <button
                              type="button"
                              onClick={() => handleRemoveUpload(item.field)}
                              className="absolute right-1 top-1 rounded bg-red-600 px-2 py-0.5 text-xs text-white hover:bg-red-700"
                            >
                              删除
                            </button>
                          </div>
                        ) : (
                          <div className="mt-2 flex items-center gap-2">
                            <a href={url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:text-blue-800">
                              查看文件
                            </a>
                            <button
                              type="button"
                              onClick={() => handleRemoveUpload(item.field)}
                              className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
                            >
                              删除
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700">项目名称 *</label>
                <input type="text" value={currentItem.project_name || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, project_name: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">项目编号</label>
                <input type="text" value={currentItem.project_number || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, project_number: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">项目类型</label>
                <select value={currentItem.project_type || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, project_type: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md">
                  <option value="">请选择</option>
                  <option value="房建">房建</option>
                  <option value="市政">市政</option>
                  <option value="电力">电力</option>
                  <option value="服务">服务</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">项目包号</label>
                <input type="text" value={currentItem.package_number || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, package_number: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">甲方名称</label>
                <input type="text" value={currentItem.client_name || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, client_name: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">甲方类型</label>
                <select value={currentItem.client_type || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, client_type: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md">
                  <option value="">请选择</option>
                  <option value="政府单位">政府单位</option>
                  <option value="国企">国企</option>
                  <option value="民企">民企</option>
                  <option value="事业单位">事业单位</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">项目金额(万元)</label>
                <input type="number" value={currentItem.contract_amount || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, contract_amount: Number(e.target.value) })}
                  className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">项目负责人</label>
                <input type="text" value={currentItem.project_manager || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, project_manager: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">甲方联系人</label>
                <input type="text" value={currentItem.client_contact || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, client_contact: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">联系电话</label>
                <input type="text" value={currentItem.client_phone || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, client_phone: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">合同生效日期</label>
                <input type="date" value={currentItem.start_date || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, start_date: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">合同失效日期</label>
                <input type="date" value={currentItem.end_date || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, end_date: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700">项目内容</label>
                <textarea value={currentItem.project_content || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, project_content: e.target.value })}
                  rows={3} className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700">备注</label>
                <textarea value={currentItem.remark || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, remark: e.target.value })}
                  rows={2} className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div className="md:col-span-2 text-xs text-gray-600 space-y-1">
                {currentItem.contract_url ? <div>合同：{currentItem.contract_url}</div> : null}
                {currentItem.bid_notice_url ? <div>中标通知书：{currentItem.bid_notice_url}</div> : null}
                {currentItem.acceptance_url ? <div>竣工验收：{currentItem.acceptance_url}</div> : null}
                {currentItem.evaluation_url ? <div>用户评议：{currentItem.evaluation_url}</div> : null}
                {currentItem.invoice_url ? <div>回款发票：{currentItem.invoice_url}</div> : null}
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

export default PerformanceManagement;
