import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { PaginatedResponse, Qualification } from '../../types';
import { resourceApi } from '../../services/authApi';

const QUALIFICATION_UPLOAD_FIELDS: Array<keyof Qualification> = ['cert_image_url'];

const emptyItem: Qualification = {
  cert_name: '',
  cert_number: '',
  cert_level: '',
  issue_org: '',
  issue_date: '',
  valid_start_date: '',
  valid_end_date: '',
  cert_image_url: '',
  remark: '',
};

const QualificationManagement: React.FC = () => {
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PaginatedResponse<Qualification>>({
    items: [],
    total: 0,
    page: 1,
    page_size: pageSize,
    total_pages: 1,
  });

  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [smartFilling, setSmartFilling] = useState(false);
  const [ocrResult, setOcrResult] = useState<Record<string, unknown> | null>(null);
  const [current, setCurrent] = useState<Qualification>(emptyItem);

  const load = useCallback(async (targetPage: number, kw = '') => {
    setLoading(true);
    try {
      const res = await resourceApi.listQualifications(targetPage, pageSize, kw);
      setData(res);
      setPage(res.page);
      setSelectedIds([]);
    } finally {
      setLoading(false);
    }
  }, [pageSize]);

  useEffect(() => {
    load(1, '');
  }, [load]);

  const allSelected = useMemo(() => {
    const ids = data.items.map((i) => i.id).filter((v): v is number => typeof v === 'number');
    if (ids.length === 0) {
      return false;
    }
    return ids.every((id) => selectedIds.includes(id));
  }, [data.items, selectedIds]);

  const toggleSelectAll = () => {
    const ids = data.items.map((i) => i.id).filter((v): v is number => typeof v === 'number');
    setSelectedIds((prev) => (prev.length === ids.length ? [] : ids));
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const openCreate = () => {
    setCurrent(emptyItem);
    setOcrResult(null);
    setModalOpen(true);
  };

  const openEdit = (item: Qualification) => {
    setCurrent({ ...emptyItem, ...item });
    setOcrResult(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setCurrent(emptyItem);
    setOcrResult(null);
  };

  const setField = (field: keyof Qualification, value: string) => {
    setCurrent((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (current.id) {
        await resourceApi.updateQualification(current.id, current);
      } else {
        await resourceApi.createQualification(current);
      }
      closeModal();
      await load(page, keyword);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    await resourceApi.deleteQualification(id);
    await load(page, keyword);
  };

  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) {
      return;
    }
    await resourceApi.batchDeleteQualifications(selectedIds);
    await load(page, keyword);
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const url = await resourceApi.uploadFile(file);
      setField('cert_image_url', url);
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
      const result = await resourceApi.smartFill('qualification', file);
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw new Error('识别结果为空或格式异常，请在接口管理中检查OCR模型配置');
      }
      setOcrResult(result);
      const merged = { ...(result as Partial<Qualification>) };
      QUALIFICATION_UPLOAD_FIELDS.forEach((field) => {
        delete merged[field];
      });
      setCurrent((prev) => ({ ...prev, ...merged }));
    } catch (error: any) {
      const msg = error?.response?.data?.detail || error?.message || '智能填充失败';
      alert(msg);
    } finally {
      setSmartFilling(false);
    }
  };

  const handleRemoveImage = () => {
    setField('cert_image_url', '');
  };

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-gray-900">资质管理</h2>
        <div className="flex items-center gap-2">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="关键词"
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          />
          <button
            type="button"
            onClick={() => load(1, keyword)}
            className="px-3 py-2 rounded-md border border-gray-200 bg-white text-sm hover:bg-gray-50"
          >
            查询
          </button>
          <button
            type="button"
            onClick={handleBatchDelete}
            disabled={selectedIds.length === 0}
            className="px-3 py-2 rounded-md border border-gray-200 bg-white text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            批量删除
          </button>
          <button type="button" onClick={openCreate} className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700">
            新增
          </button>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-3 text-left">
                  <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">证书名称</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">证书编号</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">证书评级</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">证书有效期</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td className="px-3 py-4 text-sm text-gray-500" colSpan={6}>
                    加载中...
                  </td>
                </tr>
              ) : data.items.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-sm text-gray-500" colSpan={6}>
                    暂无数据
                  </td>
                </tr>
              ) : (
                data.items.map((item) => (
                  <tr key={item.id ?? item.cert_name}>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {typeof item.id === 'number' ? (
                        <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleSelect(item.id!)} />
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-900">{item.cert_name}</td>
                    <td className="px-3 py-3 text-sm text-gray-600">{item.cert_number || '-'}</td>
                    <td className="px-3 py-3 text-sm text-gray-600">{item.cert_level || '-'}</td>
                    <td className="px-3 py-3 text-sm text-gray-600">{item.valid_long_term ? '长期' : `${item.valid_start_date || '-'} ~ ${item.valid_end_date || '-'}`}</td>
                    <td className="px-3 py-3 text-sm text-gray-600">
                      <button type="button" onClick={() => openEdit(item)} className="text-blue-600 hover:text-blue-800 mr-3">
                        编辑
                      </button>
                      {typeof item.id === 'number' ? (
                        <button type="button" onClick={() => handleDelete(item.id!)} className="text-red-600 hover:text-red-800">
                          删除
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 bg-white">
          <div className="text-sm text-gray-600">
            共 {data.total} 条，第 {data.page}/{data.total_pages} 页
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => load(Math.max(1, page - 1), keyword)}
              disabled={page <= 1}
              className="px-3 py-2 rounded-md border border-gray-200 text-sm disabled:opacity-50"
            >
              上一页
            </button>
            <button
              type="button"
              onClick={() => load(Math.min(data.total_pages, page + 1), keyword)}
              disabled={page >= data.total_pages}
              className="px-3 py-2 rounded-md border border-gray-200 text-sm disabled:opacity-50"
            >
              下一页
            </button>
          </div>
        </div>
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white w-full max-w-3xl rounded-xl shadow-lg">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div className="text-lg font-semibold text-gray-900">{current.id ? '编辑资质' : '新增资质'}</div>
              <button type="button" onClick={closeModal} className="text-gray-600 hover:text-gray-900">
                关闭
              </button>
            </div>
            <div className="p-6">
              <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-sm font-medium text-gray-700">证书图片</div>
                  <div className="mt-2 flex items-center gap-3">
                    <label className="px-3 py-2 rounded-md border border-gray-200 text-sm cursor-pointer hover:bg-gray-50">
                      <span>{uploading ? '上传中...' : '上传图片'}</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={uploading}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (file) {
                            handleUpload(file);
                          }
                        }}
                      />
                    </label>
                    {smartFilling ? <span className="text-sm text-blue-600">识别中...</span> : null}
                  </div>
                  {current.cert_image_url ? (
                    <div className="mt-2">
                      <a
                        href={current.cert_image_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-600 hover:text-blue-800"
                      >
                        查看
                      </a>
                      <div className="relative mt-2 inline-block">
                        <img src={current.cert_image_url} alt="cert" className="h-28 w-auto rounded-md border" />
                        <button
                          type="button"
                          onClick={handleRemoveImage}
                          className="absolute right-1 top-1 rounded bg-red-600 px-2 py-0.5 text-xs text-white hover:bg-red-700"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
                <div>
                  {ocrResult ? (
                    <div>
                      <div className="text-sm font-medium text-gray-700 mb-2">智能填充结果</div>
                      <pre className="text-xs bg-gray-50 border border-gray-200 rounded-md p-3 overflow-auto whitespace-pre-wrap">
                        {JSON.stringify(ocrResult, null, 2)}
                      </pre>
                    </div>
                  ) : (
                    <div className="text-sm text-gray-500">上传证书图片后自动识别并填充</div>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">证书名称 *</label>
                  <input
                    value={current.cert_name ?? ''}
                    onChange={(e) => setField('cert_name', e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">证书编号</label>
                  <input
                    value={current.cert_number ?? ''}
                    onChange={(e) => setField('cert_number', e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">评级</label>
                  <select
                    value={current.cert_level ?? ''}
                    onChange={(e) => setField('cert_level', e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="">请选择</option>
                    <option value="一级">一级</option>
                    <option value="二级">二级</option>
                    <option value="三级">三级</option>
                    <option value="甲级">甲级</option>
                    <option value="乙级">乙级</option>
                    <option value="丙级">丙级</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">编号</label>
                  <input
                    value={current.cert_number ?? ''}
                    onChange={(e) => setField('cert_number', e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">是否长期</label>
                  <select
                    value={current.valid_long_term ? '1' : '0'}
                    onChange={(e) => setCurrent((prev) => ({ ...prev, valid_long_term: e.target.value === '1' }))}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="0">有期限</option>
                    <option value="1">长期</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">生效日期</label>
                  <input
                    type="date"
                    value={current.valid_start_date ?? ''}
                    onChange={(e) => setField('valid_start_date', e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">失效日期</label>
                  <input
                    type="date"
                    value={current.valid_end_date ?? ''}
                    onChange={(e) => setField('valid_end_date', e.target.value)}
                    disabled={!!current.valid_long_term}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md disabled:bg-gray-100"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700">备注</label>
                  <textarea
                    value={current.remark ?? ''}
                    onChange={(e) => setField('remark', e.target.value)}
                    rows={3}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
              </div>

            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button type="button" onClick={closeModal} className="px-4 py-2 rounded-md border border-gray-200 text-sm hover:bg-gray-50">
                取消
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !current.cert_name}
                className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default QualificationManagement;
