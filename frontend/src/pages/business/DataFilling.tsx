import React, { useState, useEffect } from 'react';

interface Props {
  projectId: string | null;
  onNext: () => void;
}

interface OutlineNode {
  id: string;
  title: string;
  children: OutlineNode[];
}

const DataFilling: React.FC<Props> = ({ projectId, onNext }) => {
  const [outline, setOutline] = useState<OutlineNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<OutlineNode | null>(null);

  useEffect(() => {
    if (projectId) {
      fetchDirectories();
    }
  }, [projectId]);

  const fetchDirectories = async () => {
    try {
      const token = localStorage.getItem('hxybs_token');
      const res = await fetch(`/api/business-bids/${projectId}/directories`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.directories && data.directories.length > 0) {
          setOutline(data.directories);
          // 默认选中第一个没有子节点的节点
          let firstLeaf: OutlineNode | null = null;
          const findLeaf = (nodes: OutlineNode[]) => {
            for (const node of nodes) {
              if (!node.children || node.children.length === 0) {
                firstLeaf = node;
                return;
              }
              if (node.children) {
                findLeaf(node.children);
              }
              if (firstLeaf) return;
            }
          };
          findLeaf(data.directories);
          if (firstLeaf) setSelectedNode(firstLeaf);
        }
      }
    } catch (error) {
      console.error('Failed to fetch directories', error);
    }
  };

  const renderTree = (nodes: OutlineNode[], depth = 0) => {
    return nodes.map(node => {
      const isLeaf = !node.children || node.children.length === 0;
      return (
        <div key={node.id}>
          <div
            className={`py-1.5 px-2 rounded cursor-pointer text-sm ${
              selectedNode?.id === node.id ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
            }`}
            style={{ paddingLeft: `${depth * 1 + 0.5}rem` }}
            onClick={() => {
              if (isLeaf) setSelectedNode(node);
            }}
          >
            {node.title}
          </div>
          {node.children && node.children.length > 0 && renderTree(node.children, depth + 1)}
        </div>
      );
    });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-200px)]">
      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* 左侧：目录导航 */}
        <div className="w-1/4 bg-white shadow rounded-lg p-4 overflow-y-auto">
          <h3 className="text-sm font-medium text-gray-900 mb-3 border-b pb-2">商务标目录</h3>
          <div className="space-y-1">
            {renderTree(outline)}
          </div>
        </div>

        {/* 右侧：数据填充与资料选择 */}
        <div className="w-3/4 bg-white shadow rounded-lg p-6 flex flex-col overflow-y-auto">
          {selectedNode ? (
            <>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium">{selectedNode.title}</h3>
                <button className="px-3 py-1.5 bg-blue-50 text-blue-600 text-sm rounded hover:bg-blue-100">
                  从资料库选择
                </button>
              </div>
              
              <div className="bg-blue-50 border-l-4 border-blue-400 p-4 mb-6">
                <div className="flex">
                  <div className="ml-3">
                    <p className="text-sm text-blue-700">
                      系统已自动为您匹配部分资料，请核对并补充填写。
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex-1 flex flex-col gap-4">
                <textarea 
                  className="w-full h-full p-4 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 resize-none"
                  placeholder={`在此输入或粘贴【${selectedNode.title}】的内容...`}
                  defaultValue={`【智能填充内容】\n在此处展示系统自动从企业资料库中提取的相关文本或图片链接...`}
                />
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              请在左侧选择需要填写的目录项
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <button
          onClick={onNext}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          下一步：AI 撰写与导出
        </button>
      </div>
    </div>
  );
};

export default DataFilling;
