import React, { useState, useEffect } from 'react';

interface Props {
  projectId: string | null;
}

interface OutlineNode {
  id: string;
  title: string;
  children: OutlineNode[];
  content?: string;
}

const BusinessContentEdit: React.FC<Props> = ({ projectId }) => {
  const [outline, setOutline] = useState<OutlineNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<OutlineNode | null>(null);
  const [generating, setGenerating] = useState(false);

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

  const handleGenerate = async () => {
    if (!selectedNode) return;
    setGenerating(true);
    try {
      const token = localStorage.getItem('hxybs_token');
      const res = await fetch('/api/document/analyze-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          file_content: `请为商务标章节【${selectedNode.title}】生成标准的招投标文件内容。直接输出正文。`,
          analysis_type: 'overview' // 复用现有接口，仅作演示
        })
      });

      if (!res.ok) throw new Error('生成失败');

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let generatedContent = '';

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
                if (data.chunk) {
                  generatedContent += data.chunk;
                  updateNodeContent(selectedNode.id, generatedContent);
                }
              } catch (e) {
                // ignore
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Generation failed', error);
      alert('生成失败');
    } finally {
      setGenerating(false);
    }
  };

  const updateNodeContent = (id: string, newContent: string) => {
    setOutline(prev => {
      const newOutline = JSON.parse(JSON.stringify(prev));
      const updateNode = (nodes: OutlineNode[]) => {
        for (const node of nodes) {
          if (node.id === id) {
            node.content = newContent;
            return true;
          }
          if (node.children && updateNode(node.children)) {
            return true;
          }
        }
        return false;
      };
      updateNode(newOutline);
      return newOutline;
    });

    if (selectedNode?.id === id) {
      setSelectedNode(prev => prev ? { ...prev, content: newContent } : null);
    }
  };

  const handleExport = async () => {
    try {
      const token = localStorage.getItem('hxybs_token');
      const res = await fetch('/api/document/export-word', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          project_name: '商务标文件',
          outline: outline
        })
      });
      
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = '商务标文件.docx';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        alert('导出失败');
      }
    } catch (error) {
      console.error('Export failed', error);
      alert('导出失败');
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

        {/* 右侧：编辑器 */}
        <div className="w-3/4 bg-white shadow rounded-lg p-6 flex flex-col">
          {selectedNode ? (
            <>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium">{selectedNode.title}</h3>
                <div className="flex gap-2">
                  <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className="px-3 py-1.5 bg-indigo-50 text-indigo-600 border border-indigo-200 text-sm rounded hover:bg-indigo-100 disabled:opacity-50"
                  >
                    {generating ? 'AI 撰写中...' : 'AI 辅助撰写'}
                  </button>
                </div>
              </div>
              
              <div className="flex-1 border rounded-md border-gray-300">
                <textarea
                  className="w-full h-full p-4 resize-none outline-none focus:ring-2 focus:ring-blue-500 rounded-md"
                  value={selectedNode.content || ''}
                  onChange={(e) => updateNodeContent(selectedNode.id, e.target.value)}
                  placeholder={`在此输入或让 AI 撰写【${selectedNode.title}】的正文内容...`}
                />
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              请在左侧选择需要编辑的目录项
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-3">
        <button
          onClick={handleExport}
          className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 font-medium"
        >
          导出格式化 Docx
        </button>
      </div>
    </div>
  );
};

export default BusinessContentEdit;
