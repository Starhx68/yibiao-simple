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

const BusinessOutlineEdit: React.FC<Props> = ({ projectId, onNext }) => {
  const [outline, setOutline] = useState<OutlineNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (projectId) {
      fetchDirectories();
    }
  }, [projectId]);

  const fetchDirectories = async () => {
    setLoading(true);
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
        } else {
          // If no directories, generate them
          generateDirectories();
        }
      }
    } catch (error) {
      console.error('Failed to fetch directories', error);
    } finally {
      setLoading(false);
    }
  };

  const generateDirectories = async () => {
    setGenerating(true);
    try {
      const token = localStorage.getItem('hxybs_token');
      const res = await fetch(`/api/business-bids/${projectId}/generate-directories-stream`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!res.ok) throw new Error('生成失败');

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullJson = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
              try {
                const data = JSON.parse(line.substring(6));
                if (data.error) {
                  throw new Error(data.error);
                }
                if (data.chunk) {
                   fullJson += data.chunk;
                }
              } catch (e) {
                // ignore
              }
            }
          }
        }
        try {
          const parsed = JSON.parse(fullJson);
          setOutline(parsed);
        } catch (e) {
           console.error("JSON parse error for outline", e);
           // Fallback default
           setOutline([
             { id: '1', title: '一、投标函及投标函附录', children: [] },
             { id: '2', title: '二、法定代表人身份证明及授权委托书', children: [] },
             { id: '3', title: '三、资质证明材料', children: [] }
           ]);
        }
      }
    } catch (error) {
      console.error('Failed to generate directories', error);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="bg-white shadow rounded-lg p-6 min-h-[calc(100vh-200px)] flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-medium">商务标目录大纲</h2>
        <div className="flex gap-2">
          <button 
            onClick={generateDirectories}
            disabled={generating}
            className="px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            {generating ? '重新生成中...' : '重新生成'}
          </button>
          <button className="px-3 py-1.5 text-sm border border-blue-500 text-blue-600 rounded hover:bg-blue-50">
            + 添加同级节点
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto border border-gray-200 rounded-md p-4">
        {loading || generating ? (
          <div className="flex justify-center items-center h-full text-gray-500">
            {generating ? 'AI 正在生成目录...' : '加载中...'}
          </div>
        ) : (
          <div className="space-y-2">
            {outline.map((node) => (
              <div key={node.id} className="text-sm">
                <div className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded group">
                  <span className="text-gray-400">▼</span>
                  <span className="font-medium">{node.title}</span>
                  <div className="hidden group-hover:flex gap-2 ml-auto text-xs">
                    <button className="text-blue-600 hover:text-blue-800">编辑</button>
                    <button className="text-red-600 hover:text-red-800">删除</button>
                  </div>
                </div>
                {node.children && node.children.length > 0 && (
                  <div className="ml-6 border-l border-gray-200 pl-2 space-y-1 mt-1">
                    {node.children.map((child) => (
                      <div key={child.id} className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded group">
                        <span className="text-gray-300">-</span>
                        <span>{child.title}</span>
                        <div className="hidden group-hover:flex gap-2 ml-auto text-xs">
                          <button className="text-blue-600 hover:text-blue-800">编辑</button>
                          <button className="text-red-600 hover:text-red-800">删除</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="mt-6 flex justify-end">
        <button
          onClick={onNext}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          下一步：数据填充
        </button>
      </div>
    </div>
  );
};

export default BusinessOutlineEdit;
