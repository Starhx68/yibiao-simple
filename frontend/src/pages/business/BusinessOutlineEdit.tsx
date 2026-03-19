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
  
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  useEffect(() => {
    if (projectId) {
      fetchDirectories();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const stripChapterPrefix = (title: string) => {
    let cleaned = (title || '').trim();
    cleaned = cleaned.replace(/^\s*第[一二三四五六七八九十百千零〇两\d]+[章节部分篇卷][\s、.．:：-]*/, '');
    cleaned = cleaned.replace(/^\s*[（(]?\d+[）)](?:\.\d+)*[、.．:：-]?\s*/, '');
    cleaned = cleaned.replace(/^\s*\d+(?:\.\d+)*[、.．:：-]?\s*/, '');
    cleaned = cleaned.replace(/^\s*[一二三四五六七八九十百千零〇两]+[、.．:：-]\s*/, '');
    cleaned = cleaned.replace(/^\s*[（(][一二三四五六七八九十百千零〇两]+[）)][、.．:：-]?\s*/, '');
    return cleaned.trim();
  };

  const toChineseNumeral = (num: number): string => {
    const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    if (num <= 10) return num === 10 ? '十' : digits[num];
    if (num < 20) return `十${digits[num - 10]}`;
    if (num < 100) {
      const tens = Math.floor(num / 10);
      const units = num % 10;
      return units === 0 ? `${digits[tens]}十` : `${digits[tens]}十${digits[units]}`;
    }
    return `${num}`;
  };

  const buildChapterPrefix = (pathIndexes: number[]) => {
    const depth = pathIndexes.length - 1;
    const current = pathIndexes[pathIndexes.length - 1];
    if (depth === 0) return `${toChineseNumeral(current)}、`;
    if (depth === 1) return `${current}.`;
    if (depth === 2) return `${pathIndexes[1]}.${current}`;
    return `(${current})`;
  };

  const ensureDirectoryNumbering = (directories: OutlineNode[]): OutlineNode[] => {
    const cloned = JSON.parse(JSON.stringify(directories || [])) as OutlineNode[];
    const walk = (nodes: OutlineNode[], pathIndexes: number[]) => {
      if (!Array.isArray(nodes)) return;
      nodes.forEach((node, index) => {
        const currentPath = [...pathIndexes, index + 1];
        const baseTitle = stripChapterPrefix(node.title || '') || (node.title || '').trim();
        node.title = `${buildChapterPrefix(currentPath)} ${baseTitle}`.trim();
        if (Array.isArray(node.children) && node.children.length > 0) {
          walk(node.children, currentPath);
        }
      });
    };
    walk(cloned, []);
    return cloned;
  };

  const saveOutline = async (newOutline: OutlineNode[]) => {
    setOutline(newOutline);
    if (!projectId) return;
    try {
      const token = localStorage.getItem('hxybs_token');
      await fetch(`/api/business-bids/${projectId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ directories_content: JSON.stringify(newOutline) })
      });
    } catch (e) {
      console.error('Failed to save outline', e);
    }
  };

  const handleAddSibling = (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newOutline = [...outline];
    let added = false;

    const traverseAndAdd = (nodes: OutlineNode[], parentChildren?: OutlineNode[]) => {
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].id === nodeId) {
          const newNode = {
            id: `node_${Date.now()}`,
            title: '新节点',
            children: []
          };
          if (parentChildren) {
            parentChildren.splice(i + 1, 0, newNode);
          } else {
            newOutline.splice(i + 1, 0, newNode);
          }
          added = true;
          setSelectedNodeId(newNode.id);
          setEditingNodeId(newNode.id);
          setEditTitle(newNode.title);
          return;
        }
        if (nodes[i].children && nodes[i].children.length > 0) {
          traverseAndAdd(nodes[i].children, nodes[i].children);
          if (added) return;
        }
      }
    };
    traverseAndAdd(newOutline);
    if (added) saveOutline(newOutline);
  };

  const handleEdit = (node: OutlineNode, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingNodeId(node.id);
    setEditTitle(node.title);
  };

  const handleSaveEdit = (e?: React.MouseEvent | React.KeyboardEvent) => {
    if (e) e.stopPropagation();
    if (!editingNodeId) return;

    const newOutline = JSON.parse(JSON.stringify(outline));
    const updateTitle = (nodes: OutlineNode[]) => {
      for (const node of nodes) {
        if (node.id === editingNodeId) {
          node.title = editTitle;
          return true;
        }
        if (node.children && updateTitle(node.children)) return true;
      }
      return false;
    };
    updateTitle(newOutline);
    saveOutline(newOutline);
    setEditingNodeId(null);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("确定要删除此节点吗？")) return;

    const newOutline = JSON.parse(JSON.stringify(outline));
    const removeNode = (nodes: OutlineNode[]) => {
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].id === id) {
          nodes.splice(i, 1);
          return true;
        }
        if (nodes[i].children && removeNode(nodes[i].children)) return true;
      }
      return false;
    };
    removeNode(newOutline);
    saveOutline(newOutline);
    if (selectedNodeId === id) setSelectedNodeId(null);
  };

  const fetchDirectories = async (generateIfEmpty: boolean = true) => {
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
          const normalized = ensureDirectoryNumbering(data.directories as OutlineNode[]);
          setOutline(normalized);
          return normalized;
        } else {
          if (generateIfEmpty) {
            generateDirectories();
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch directories', error);
    } finally {
      setLoading(false);
    }
    return [];
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
          const savedDirectories = await fetchDirectories(false);
          if (savedDirectories.length > 0) {
            setOutline(savedDirectories);
          } else {
            const normalized = ensureDirectoryNumbering(parsed as OutlineNode[]);
            await saveOutline(normalized);
          }
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

  const renderNode = (node: OutlineNode, level: number = 0) => {
    const isSelected = selectedNodeId === node.id;
    const isEditing = editingNodeId === node.id;

    return (
      <div key={node.id} className="text-sm">
        <div 
          className={`flex items-center gap-2 p-2 rounded group cursor-pointer ${isSelected ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50 border border-transparent'}`}
          onClick={() => setSelectedNodeId(node.id)}
        >
          {node.children && node.children.length > 0 ? (
            <span className="text-gray-400">▼</span>
          ) : (
            <span className="text-gray-300">-</span>
          )}
          
          {isEditing ? (
            <div className="flex-1 flex gap-2" onClick={e => e.stopPropagation()}>
              <input
                autoFocus
                type="text"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(e); }}
                className="flex-1 border border-blue-400 rounded px-2 py-0.5 text-sm outline-none"
              />
              <button onClick={handleSaveEdit} className="text-green-600 hover:text-green-800 text-xs px-2">保存</button>
              <button onClick={(e) => { e.stopPropagation(); setEditingNodeId(null); }} className="text-gray-500 hover:text-gray-700 text-xs px-2">取消</button>
            </div>
          ) : (
            <>
              <span className={`font-medium flex-1 ${isSelected ? 'text-blue-700' : ''}`}>{node.title}</span>
              <div className="hidden group-hover:flex gap-2 ml-auto text-xs">
                <button onClick={(e) => handleAddSibling(node.id, e)} className="text-green-600 hover:text-green-800">添加同级</button>
                <button onClick={(e) => handleEdit(node, e)} className="text-blue-600 hover:text-blue-800">编辑</button>
                <button onClick={(e) => handleDelete(node.id, e)} className="text-red-600 hover:text-red-800">删除</button>
              </div>
            </>
          )}
        </div>
        
        {node.children && node.children.length > 0 && (
          <div className="ml-6 border-l border-gray-200 pl-2 space-y-1 mt-1">
            {node.children.map(child => renderNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  const handleNext = async () => {
    if (projectId) {
      try {
        const token = localStorage.getItem('hxybs_token');
        await fetch(`/api/business-bids/${projectId}`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ status: 'filling' })
        });
      } catch (e) {
        console.error('Failed to update project status', e);
      }
    }
    onNext();
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
        </div>
      </div>
      <div className="flex-1 overflow-y-auto border border-gray-200 rounded-md p-4" onClick={() => setSelectedNodeId(null)}>
        {loading || generating ? (
          <div className="flex justify-center items-center h-full text-gray-500">
            {generating ? 'AI 正在生成目录...' : '加载中...'}
          </div>
        ) : (
          <div className="space-y-2">
            {outline.map((node) => renderNode(node))}
          </div>
        )}
      </div>
      <div className="mt-6 flex justify-end">
        <button
          onClick={handleNext}
          disabled={generating}
          className={`px-4 py-2 text-white rounded-md ${generating ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
        >
          下一步：数据填充
        </button>
      </div>
    </div>
  );
};

export default BusinessOutlineEdit;
