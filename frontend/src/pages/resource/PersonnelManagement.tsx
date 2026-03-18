import React, { useState, useEffect, useCallback } from 'react';
import { resourceApi } from '../../services/authApi';
import { Personnel, PaginatedResponse } from '../../types';

const PERSONNEL_UPLOAD_FIELDS: Array<keyof Personnel> = [
  'photo_url',
  'id_card_url',
  'education_cert_url',
  'contract_url',
  'driver_license_url',
  'social_security_url',
];

const PersonnelManagement: React.FC = () => {
  const [data, setData] = useState<PaginatedResponse<Personnel>>({
    items: [], total: 0, page: 1, page_size: 8, total_pages: 0
  });
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [currentItem, setCurrentItem] = useState<Partial<Personnel>>({});
  const [uploading, setUploading] = useState(false);
  const [smartFilling, setSmartFilling] = useState(false);
  const [ocrResult, setOcrResult] = useState<Record<string, unknown> | null>(null);

  const loadData = useCallback(async (page = 1, kw = '') => {
    setLoading(true);
    try {
      const result = await resourceApi.listPersonnel(page, 8, kw);
      setData(result);
    } catch (error) {
      console.error('加载人员列表失败:', error);
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
    if (!window.confirm('确定要删除该人员吗？')) return;
    try {
      await resourceApi.deletePersonnel(id);
      loadData(data.page, keyword);
    } catch (error) {
      alert('删除失败');
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) { alert('请选择要删除的人员'); return; }
    if (!window.confirm(`确定要删除选中的 ${selectedIds.length} 个人员吗？`)) return;
    try {
      await resourceApi.batchDeletePersonnel(selectedIds);
      loadData(data.page, keyword);
      setSelectedIds([]);
    } catch (error) {
      alert('批量删除失败');
    }
  };

  const handleSave = async () => {
    try {
      if (currentItem.id) {
        await resourceApi.updatePersonnel(currentItem.id, currentItem);
      } else {
        await resourceApi.createPersonnel(currentItem as any);
      }
      setShowModal(false);
      setOcrResult(null);
      loadData(data.page, keyword);
    } catch (error) {
      alert('保存失败');
    }
  };

  const handleUpload = async (field: keyof Personnel, file: File) => {
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
      const result = await resourceApi.smartFill('personnel', file);
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw new Error('识别结果为空或格式异常，请在接口管理中检查OCR模型配置');
      }
      setOcrResult(result);
      const merged = { ...(result as Partial<Personnel>) };
      PERSONNEL_UPLOAD_FIELDS.forEach((field) => {
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

  const handleRemoveUpload = (field: keyof Personnel) => {
    setCurrentItem((prev) => ({ ...prev, [field]: '' }));
  };

  const uploadFields: Array<{ label: string; field: keyof Personnel }> = [
    { label: '身份证', field: 'id_card_url' },
    { label: '毕业证', field: 'education_cert_url' },
    { label: '合同', field: 'contract_url' },
    { label: '驾驶证', field: 'driver_license_url' },
    { label: '社保', field: 'social_security_url' },
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
          <h1 className="text-xl font-semibold text-gray-900">人员管理</h1>
          <button onClick={() => { setCurrentItem({}); setShowModal(true); }}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">新增</button>
          <button onClick={handleBatchDelete} disabled={selectedIds.length === 0}
            className="px-4 py-2 bg-gray-400 text-white rounded-md disabled:opacity-50">批量删除</button>
        </div>
        <div className="flex gap-2">
          <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索人员..." className="px-3 py-2 border rounded-md" />
          <button onClick={() => loadData(1, keyword)} className="px-4 py-2 bg-gray-100 rounded-md">搜索</button>
        </div>
      </div>

      <div className="overflow-hidden border rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-3"><input type="checkbox" checked={allSelected}
                onChange={handleSelectAll} className="rounded" /></th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">姓名</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">性别</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">年龄</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">学历</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">职位</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">专业</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">资格证书</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {data.items.map((item) => (
              <tr key={item.id ?? item.name}>
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
                <td className="px-3 py-3 text-sm">{item.name}</td>
                <td className="px-3 py-3 text-sm">{item.gender || '-'}</td>
                <td className="px-3 py-3 text-sm">{item.age ?? '-'}</td>
                <td className="px-3 py-3 text-sm">{item.education || '-'}</td>
                <td className="px-3 py-3 text-sm">{item.position}</td>
                <td className="px-3 py-3 text-sm">{item.major || '-'}</td>
                <td className="px-3 py-3 text-sm">{item.cert_name || '-'}</td>
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
              <tr><td colSpan={9} className="px-3 py-3 text-center text-sm text-gray-500">暂无数据</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 z-10">
          <div className="bg-white rounded-lg p-6 max-w-5xl mx-auto mt-10 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">{currentItem.id ? '编辑人员' : '新增人员'}</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-500">✕</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700">证件上传</label>
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
              <div>
                <label className="block text-sm font-medium text-gray-700">姓名 *</label>
                <input type="text" value={currentItem.name || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, name: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">性别</label>
                <select value={currentItem.gender || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, gender: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md">
                  <option value="">请选择</option>
                  <option value="男">男</option>
                  <option value="女">女</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">出生日期</label>
                <input type="date" value={currentItem.birth_date || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, birth_date: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">身份证号</label>
                <input type="text" value={currentItem.id_number || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, id_number: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">身份证有效期</label>
                <select value={currentItem.id_long_term ? '1' : '0'}
                  onChange={(e) => setCurrentItem({ ...currentItem, id_long_term: e.target.value === '1' })}
                  className="mt-1 w-full px-3 py-2 border rounded-md">
                  <option value="0">有期限</option>
                  <option value="1">长期</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">生效日期</label>
                <input type="date" value={currentItem.id_valid_from || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, id_valid_from: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">失效日期</label>
                <input type="date" value={currentItem.id_valid_to || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, id_valid_to: e.target.value })}
                  disabled={!!currentItem.id_long_term}
                  className="mt-1 w-full px-3 py-2 border rounded-md disabled:bg-gray-100" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">学历</label>
                <input type="text" value={currentItem.education || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, education: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">专业</label>
                <input type="text" value={currentItem.major || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, major: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">职称</label>
                <input type="text" value={currentItem.title || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, title: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">职位</label>
                <input type="text" value={currentItem.position || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, position: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">联系电话</label>
                <input type="text" value={currentItem.phone || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, phone: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">状态</label>
                <select value={currentItem.status || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, status: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md">
                  <option value="">请选择</option>
                  <option value="在职">在职</option>
                  <option value="离职">离职</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">开始工作时间</label>
                <input type="date" value={currentItem.start_work_date || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, start_work_date: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">部门</label>
                <input type="text" value={currentItem.department || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, department: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">电子邮箱</label>
                <input type="email" value={currentItem.email || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, email: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700">个人简介</label>
                <textarea value={currentItem.profile || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, profile: e.target.value })}
                  rows={3}
                  className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div className="md:col-span-2 pt-2 border-t">
                <div className="text-base font-medium text-gray-900 mb-3">编辑资格</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">名称</label>
                <input type="text" value={currentItem.cert_name || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, cert_name: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">编号</label>
                <input type="text" value={currentItem.cert_number || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, cert_number: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">评级</label>
                <select value={currentItem.cert_level || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, cert_level: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md">
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
                <label className="block text-sm font-medium text-gray-700">专业</label>
                <input type="text" value={currentItem.cert_major || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, cert_major: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">是否长期</label>
                <select value={currentItem.cert_long_term ? '1' : '0'}
                  onChange={(e) => setCurrentItem({ ...currentItem, cert_long_term: e.target.value === '1' })}
                  className="mt-1 w-full px-3 py-2 border rounded-md">
                  <option value="0">有期限</option>
                  <option value="1">长期</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">生效日期</label>
                <input type="date" value={currentItem.cert_valid_from || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, cert_valid_from: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">失效日期</label>
                <input type="date" value={currentItem.cert_valid_date || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, cert_valid_date: e.target.value })}
                  disabled={!!currentItem.cert_long_term}
                  className="mt-1 w-full px-3 py-2 border rounded-md disabled:bg-gray-100" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700">资格证书</label>
                <label className="mt-2 inline-flex px-3 py-2 rounded-md border border-gray-200 bg-white text-sm hover:bg-gray-50 cursor-pointer">
                  {uploading ? '上传中...' : '点击上传'}
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) {
                        handleUpload('cert_image_url', file);
                      }
                    }}
                    disabled={uploading}
                  />
                </label>
                {currentItem.cert_image_url ? (
                  <div className="mt-2">
                    {/\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(currentItem.cert_image_url) ? (
                      <div className="relative inline-block">
                        <img src={currentItem.cert_image_url} alt="资格证书" className="h-24 w-auto rounded-md border" />
                        <button
                          type="button"
                          onClick={() => handleRemoveUpload('cert_image_url')}
                          className="absolute right-1 top-1 rounded bg-red-600 px-2 py-0.5 text-xs text-white hover:bg-red-700"
                        >
                          删除
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <a href={currentItem.cert_image_url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:text-blue-800">
                          查看文件
                        </a>
                        <button
                          type="button"
                          onClick={() => handleRemoveUpload('cert_image_url')}
                          className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
                        >
                          删除
                        </button>
                      </div>
                    )}
                    <div className="mt-1 text-xs text-gray-500 break-all">{currentItem.cert_image_url}</div>
                  </div>
                ) : null}
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

export default PersonnelManagement;
