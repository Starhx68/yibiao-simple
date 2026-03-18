import React, { useState, useEffect, useCallback } from 'react';
import { userApi } from '../services/authApi';
import { User, PaginatedResponse } from '../types';

type UserForm = Partial<User> & { password?: string };

const UserManagement: React.FC = () => {
  const [data, setData] = useState<PaginatedResponse<User>>({
    items: [], total: 0, page: 1, page_size: 10, total_pages: 0
  });
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [currentItem, setCurrentItem] = useState<UserForm>({});

  const loadData = useCallback(async (page = 1, kw = '') => {
    setLoading(true);
    try {
      const result = await userApi.listUsers(page, 10, kw);
      setData(result);
    } catch (error) {
      console.error('加载用户列表失败:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(1, ''); }, [loadData]);

  const handleDelete = async (id: number) => {
    if (!window.confirm('确定要删除该用户吗？')) return;
    try {
      await userApi.deleteUser(id);
      loadData(data.page, keyword);
    } catch (error) {
      alert('删除失败');
    }
  };

  const handleSave = async () => {
    try {
      if (currentItem.id) {
        await userApi.updateUser(currentItem.id, currentItem);
      } else {
        await userApi.createUser(currentItem as any);
      }
      setShowModal(false);
      loadData(data.page, keyword);
    } catch (error) {
      alert('保存失败');
    }
  };

  if (loading) {
    return <div className="flex justify-center items-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
    </div>;
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <div className="sm:flex sm:items-center sm:justify-between mb-4">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold text-gray-900">用户管理</h1>
          <button onClick={() => { setCurrentItem({ role: 'user' }); setShowModal(true); }}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">新增</button>
        </div>
        <div className="flex gap-2">
          <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索用户..." className="px-3 py-2 border rounded-md" />
          <button onClick={() => loadData(1, keyword)} className="px-4 py-2 bg-gray-100 rounded-md">搜索</button>
        </div>
      </div>

      <div className="overflow-hidden border rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">用户名</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">姓名</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">角色</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">状态</th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {data.items.map((item) => (
              <tr key={item.id}>
                <td className="px-3 py-3 text-sm">{item.username}</td>
                <td className="px-3 py-3 text-sm">{item.real_name || '-'}</td>
                <td className="px-3 py-3 text-sm">
                  <span className={`px-2 py-1 rounded text-xs ${
                    item.role === 'admin' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'
                  }`}>
                    {item.role === 'admin' ? '管理员' : '普通用户'}
                  </span>
                </td>
                <td className="px-3 py-3 text-sm">
                  <span className={`px-2 py-1 rounded text-xs ${
                    item.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                  }`}>
                    {item.is_active ? '正常' : '禁用'}
                  </span>
                </td>
                <td className="px-3 py-3 text-sm">
                  <button onClick={() => { setCurrentItem(item); setShowModal(true); }}
                    className="text-blue-600 hover:text-blue-900 mr-2">编辑</button>
                  <button onClick={() => handleDelete(item.id)}
                    className="text-red-600 hover:text-red-900">删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 z-10">
          <div className="bg-white rounded-lg p-6 max-w-md mx-auto mt-20">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">{currentItem.id ? '编辑用户' : '新增用户'}</h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-500">✕</button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">用户名 *</label>
                <input type="text" value={currentItem.username || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, username: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md" disabled={!!currentItem.id} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">密码 {currentItem.id ? '(留空则不修改)' : '*'}</label>
                <input type="password" value={currentItem.password || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, password: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">姓名</label>
                <input type="text" value={currentItem.real_name || ''}
                  onChange={(e) => setCurrentItem({ ...currentItem, real_name: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">角色</label>
                <select value={currentItem.role || 'user'}
                  onChange={(e) => setCurrentItem({ ...currentItem, role: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border rounded-md">
                  <option value="user">普通用户</option>
                  <option value="admin">管理员</option>
                </select>
              </div>
            </div>
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

export default UserManagement;
