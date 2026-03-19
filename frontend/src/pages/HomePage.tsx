import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DocumentTextIcon, FolderIcon, ClockIcon, CheckCircleIcon } from '@heroicons/react/24/outline';

interface Project {
  id: string;
  project_name: string;
  status: string;
  created_at: string;
  type: 'business' | 'technical';
}

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);

  const menuItems = [
    { name: '商务标', icon: DocumentTextIcon, description: '商务标编写', path: '/business' },
    { name: '技术标', icon: DocumentTextIcon, description: '技术标编写', path: '/technical' },
    { name: '资料库管理', icon: FolderIcon, description: '公司信息 / 资质 / 人员 / 财务 / 业绩', path: '/resource/company' },
  ];

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const token = localStorage.getItem('hxybs_token');
        const headers = { 'Authorization': `Bearer ${token}` };
        
        const [businessRes, technicalRes] = await Promise.all([
          fetch('/api/business-bids/', { headers }),
          fetch('/api/technical-bids/', { headers })
        ]);

        let allProjects: Project[] = [];
        
        if (businessRes.ok) {
          const data = await businessRes.json();
          allProjects = [...allProjects, ...data.items.map((p: any) => ({ ...p, type: 'business' }))];
        }
        
        if (technicalRes.ok) {
          const data = await technicalRes.json();
          allProjects = [...allProjects, ...data.items.map((p: any) => ({ ...p, type: 'technical' }))];
        }

        allProjects.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setProjects(allProjects);
      } catch (e) {
        console.error('Failed to fetch projects', e);
      }
    };
    
    fetchProjects();
  }, []);

  const getStatusDisplay = (status: string) => {
    if (status === 'completed') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-green-50 text-green-700 border border-green-200">
          <CheckCircleIcon className="w-3.5 h-3.5" />
          已完成
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-yellow-50 text-yellow-700 border border-yellow-200">
        <ClockIcon className="w-3.5 h-3.5" />
        未完成
      </span>
    );
  };

  return (
    <div className="min-h-full p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-semibold text-gray-900 mb-6">海新屹AI标书</h1>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.name}
                type="button"
                onClick={() => navigate(item.path)}
                className="text-left bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md hover:border-gray-200 transition"
              >
                <div className="flex items-start gap-4">
                  <div className="h-12 w-12 rounded-lg bg-blue-50 flex items-center justify-center">
                    <Icon className="h-6 w-6 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <div className="text-lg font-semibold text-gray-900">{item.name}</div>
                    <div className="mt-1 text-sm text-gray-600">{item.description}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <h2 className="text-xl font-semibold text-gray-900 mb-4">我的标书</h2>
        <div className="bg-white shadow-sm border border-gray-100 rounded-xl overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">标书名称</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">类型</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">创建时间</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {projects.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-sm text-gray-500">
                    暂无标书记录
                  </td>
                </tr>
              ) : (
                projects.map((project) => (
                  <tr 
                    key={project.id} 
                    className={`hover:bg-gray-50 ${project.status !== 'completed' ? 'cursor-pointer' : ''}`}
                    onClick={() => {
                      if (project.status !== 'completed') {
                        navigate(`/${project.type}/${project.id}`);
                      }
                    }}
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {project.project_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {project.type === 'business' ? '商务标' : '技术标'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusDisplay(project.status)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(project.created_at).toLocaleString('zh-CN')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default HomePage;
