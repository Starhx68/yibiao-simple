/**
 * 配置面板组件
 */
import React from 'react';

const ConfigPanel: React.FC = () => {
  return (
    <div className="bg-white shadow-sm border-r border-gray-200 w-80 p-6 overflow-y-auto">
      <div className="space-y-6">
        {/* 标题 */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">海新屹AI标书</h1>
          <hr className="mt-4 border-gray-200" />
        </div>

        {/* 使用说明 */}
        <div className="border-t border-gray-200 pt-4">
          <h3 className="text-sm font-medium text-gray-900 mb-2">📋 使用说明</h3>
          <div className="text-sm text-gray-600 space-y-1">
            <p>1. 在配置文件中设置API密钥、Base URL与模型名称</p>
            <p>2. 按步骤完成标书编写流程</p>
          </div>
        </div>

        {/* 底部图标链接 */}
        <div className="border-t border-gray-200 pt-4">
          <div className="flex items-center justify-center space-x-4">       
            {/* 海新屹图标 */}
            <a
              href="https://baidu.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:opacity-75 transition-opacity"
              title="海新屹官网"
            >
              <img 
                src="/yibiao.png" 
                alt="海新屹" 
                className="w-6 h-6" 
                onError={(e) => {
                  console.log('海新屹logo加载失败');
                  e.currentTarget.style.display = 'none';
                }}
              />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfigPanel;
