import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bars3Icon,
  HomeIcon,
  UserIcon,
  FolderIcon,
  ArrowRightStartOnRectangleIcon,
  Cog6ToothIcon,
} from '@heroicons/react/24/outline';
import { authApi } from '../services/authApi';
import type { User } from '../types';

type MenuItem = { label: string; to: string; icon?: React.ComponentType<{ className?: string }> };

const MainLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  useEffect(() => {
    let cancelled = false;
    authApi
      .getCurrentUser()
      .then((u) => {
        if (!cancelled) {
          setCurrentUser(u);
        }
      })
      .catch(() => {
        navigate('/login', { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const menuItems = useMemo((): Array<MenuItem | { group: string; items: MenuItem[] }> => {
    const base: Array<MenuItem | { group: string; items: MenuItem[] }> = [
      { label: '首页', to: '/', icon: HomeIcon },
      {
        group: '标书编辑',
        items: [
          { label: '商务标编写', to: '/business' },
          { label: '技术标编写', to: '/technical' },
        ],
      },
      {
        group: '资料库管理',
        items: [
          { label: '公司信息', to: '/resource/company' },
          { label: '资质管理', to: '/resource/qualifications' },
          { label: '人员管理', to: '/resource/personnel' },
          { label: '财务管理', to: '/resource/financial' },
          { label: '业绩管理', to: '/resource/performance' },
        ],
      },
    ];

    if (currentUser?.role === 'admin') {
      base.push({
        group: '人员管理',
        items: [{ label: '用户管理', to: '/users', icon: UserIcon }],
      });
      base.push({
        group: '接口管理',
        items: [{ label: 'OpenAI配置', to: '/interfaces', icon: Cog6ToothIcon }],
      });
    }
    return base;
  }, [currentUser?.role]);

  const handleLogout = () => {
    authApi.logout();
    navigate('/login', { replace: true });
  };

  const renderNavItem = (item: MenuItem) => {
    const Icon = item.icon;
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.to === '/'}
        className={({ isActive }) =>
          [
            'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition',
            isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50',
          ].join(' ')
        }
      >
        {Icon ? <Icon className="h-5 w-5" /> : <FolderIcon className="h-5 w-5" />}
        {sidebarCollapsed ? null : <span>{item.label}</span>}
      </NavLink>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside className={['bg-white border-r border-gray-200', sidebarCollapsed ? 'w-16' : 'w-64'].join(' ')}>
        <div className="h-14 px-3 flex items-center justify-between border-b border-gray-200">
          <button
            type="button"
            onClick={() => setSidebarCollapsed((v) => !v)}
            className="h-9 w-9 rounded-md hover:bg-gray-100 flex items-center justify-center"
            aria-label="Toggle sidebar"
          >
            <Bars3Icon className="h-5 w-5 text-gray-700" />
          </button>
          {sidebarCollapsed ? null : <div className="text-sm font-semibold text-gray-900">海新屹AI标书</div>}
        </div>

        <nav className="p-3 space-y-1">
          {menuItems.map((entry) => {
            if ('group' in entry) {
              return (
                <div key={entry.group} className="pt-2">
                  {sidebarCollapsed ? null : (
                    <div className="px-3 pb-2 text-xs font-medium text-gray-500">{entry.group}</div>
                  )}
                  <div className="space-y-1">{entry.items.map(renderNavItem)}</div>
                </div>
              );
            }
            return renderNavItem(entry);
          })}
        </nav>
      </aside>

      <div className="flex-1 min-w-0">
        <header className="h-14 bg-white border-b border-gray-200 px-4 flex items-center justify-between">
          <div className="text-sm text-gray-500 truncate">{location.pathname}</div>
          <div className="flex items-center gap-3">
            {currentUser ? (
              <div className="text-sm text-gray-700">
                {currentUser.real_name || currentUser.username} <span className="text-gray-400">({currentUser.role})</span>
              </div>
            ) : (
              <div className="text-sm text-gray-400">...</div>
            )}
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200"
            >
              <ArrowRightStartOnRectangleIcon className="h-5 w-5" />
              <span>退出</span>
            </button>
          </div>
        </header>

        <main className="p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default MainLayout;
