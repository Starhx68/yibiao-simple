import React from 'react';
import { useNavigate } from 'react-router-dom';
import { DocumentTextIcon, FolderIcon } from '@heroicons/react/24/outline';

const HomePage: React.FC = () => {
  const navigate = useNavigate();

  const menuItems = [
    { name: '商务标', icon: DocumentTextIcon, description: '商务标编写', path: '/business' },
    { name: '技术标', icon: DocumentTextIcon, description: '技术标编写', path: '/technical' },
    { name: '资料库管理', icon: FolderIcon, description: '公司信息 / 资质 / 人员 / 财务 / 业绩', path: '/resource/company' },
  ];

  return (
    <div className="min-h-full p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-semibold text-gray-900 mb-6">海新屹AI标书</h1>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
      </div>
    </div>
  );
};

export default HomePage;
