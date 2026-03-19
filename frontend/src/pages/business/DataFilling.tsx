import React, { useState, useEffect } from 'react';
import '@wangeditor/editor/dist/css/style.css';
import { Editor, Toolbar } from '@wangeditor/editor-for-react';
import { IDomEditor, IEditorConfig, IToolbarConfig } from '@wangeditor/editor';
import TurndownService from 'turndown';
import { marked } from 'marked';

// Initialize turndown service
const turndownService = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
});
// eslint-disable-next-line @typescript-eslint/no-var-requires
const turndownPluginGfm = require('turndown-plugin-gfm');
turndownService.use(turndownPluginGfm.tables);

interface Props {
  projectId: string | null;
  onNext: () => void;
}

interface OutlineNode {
  id: string;
  title: string;
  children: OutlineNode[];
  content?: string;
}

interface ResourceItem {
  id: string;
  type: string;
  title: string;
  content: string;
  image_url?: string;
}

interface NodeData {
  text: string;
  selectedResources: ResourceItem[];
}

const DataFilling: React.FC<Props> = ({ projectId, onNext }) => {
  const [outline, setOutline] = useState<OutlineNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<OutlineNode | null>(null);
  const [nodeDataMap, setNodeDataMap] = useState<Record<string, NodeData>>({});
  const [matchingResources, setMatchingResources] = useState<ResourceItem[]>([]);
  const [isLoadingResource, setIsLoadingResource] = useState(false);

  // WangEditor instance
  const [editor, setEditor] = useState<IDomEditor | null>(null);

  // Destroy editor on unmount
  useEffect(() => {
    return () => {
      if (editor == null) return;
      editor.destroy();
      setEditor(null);
    };
  }, [editor]);

  const toolbarConfig: Partial<IToolbarConfig> = {};
  const editorConfig: Partial<IEditorConfig> = {
    placeholder: '在此输入或粘贴内容（支持原样复制Word/网页内容并保留格式）...',
    MENU_CONF: {
      uploadImage: {
        base64LimitSize: 5 * 1024 * 1024 // 5MB
      }
    }
  };

  const handleEditorChange = (editor: IDomEditor) => {
    if (!selectedNode) return;
    const html = editor.getHtml();
    setNodeDataMap(prev => ({
      ...prev,
      [selectedNode.id]: {
        ...prev[selectedNode.id],
        text: html
      }
    }));
  };

  useEffect(() => {
    if (projectId) {
      fetchDirectories();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (selectedNode && projectId) {
      fetchMatchingResources(selectedNode);
      
      // Load content from node if empty
      setNodeDataMap(prev => {
                    const existing = prev[selectedNode.id] || { text: '', selectedResources: [] };
                    if (!existing.text || existing.text.trim() === '') {
                        const contentStr = selectedNode.content || '';
                        let contentHtml = '';
                        if (contentStr.trim().startsWith('<')) {
                            contentHtml = contentStr;
                        } else {
                            contentHtml = contentStr ? contentStr.split('\n').map((line: string) => `<p>${line}</p>`).join('') : '';
                        }
                        return { ...prev, [selectedNode.id]: { ...existing, text: contentHtml } };
                    }
                    return prev;
                });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode, projectId]);

  const fetchMatchingResources = async (node: OutlineNode) => {
    setIsLoadingResource(true);
    setMatchingResources([]);
    try {
      const token = localStorage.getItem('hxybs_token');
      const res = await fetch(`/api/business-bids/${projectId}/match-resource?node_title=${encodeURIComponent(node.title)}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.results && data.results.length > 0) {
          setMatchingResources(data.results);
          
          setNodeDataMap(prev => {
            const existing = prev[node.id] || { text: '', selectedResources: [] };
            if (data.results.length === 1 && existing.selectedResources.length === 0) {
              const matchedRes = data.results[0];
              return {
                ...prev,
                [node.id]: {
                  ...existing,
                  selectedResources: [matchedRes],
                  text: existing.text ? existing.text : `【${matchedRes.title}】\n${matchedRes.content}\n\n`
                }
              };
            }
            return prev;
          });
        }
      }
    } catch (error) {
      console.error('Failed to match resources', error);
    } finally {
      setIsLoadingResource(false);
    }
  };

  const handleToggleResource = (res: ResourceItem) => {
    if (!selectedNode) return;
    const nodeId = selectedNode.id;
    setNodeDataMap(prev => {
      const existing = prev[nodeId] || { text: '', selectedResources: [] };
      const isSelected = existing.selectedResources.some(r => r.id === res.id);
      let newSelected;
      let newText = existing.text || '';
      
      const resHtml = `<p><strong>【${res.title}】</strong></p><p>${res.content.replace(/\n/g, '<br/>')}</p><p><br/></p>`;
      const resPlain = `【${res.title}】\n${res.content}\n\n`;
      
      if (isSelected) {
        newSelected = existing.selectedResources.filter(r => r.id !== res.id);
        // Try to remove both HTML and plain text versions
        newText = newText.replace(resHtml, '').replace(resPlain, '');
      } else {
        newSelected = [...existing.selectedResources, res];
        // If it looks like HTML, append HTML, else append plain
        if (newText.includes('<p>') || newText.includes('<div>')) {
          newText += resHtml;
        } else {
          newText += resPlain;
        }
      }
      
      return {
        ...prev,
        [nodeId]: { ...existing, selectedResources: newSelected, text: newText }
      };
    });
  };

  const handleRemoveResource = (res: ResourceItem) => {
    if (!selectedNode) return;
    const nodeId = selectedNode.id;
    setNodeDataMap(prev => {
      const existing = prev[nodeId] || { text: '', selectedResources: [] };
      const newSelected = existing.selectedResources.filter(r => r.id !== res.id);
      
      const resHtml = `<p><strong>【${res.title}】</strong></p><p>${res.content.replace(/\n/g, '<br/>')}</p><p><br/></p>`;
      const resPlain = `【${res.title}】\n${res.content}\n\n`;
      const newText = (existing.text || '').replace(resHtml, '').replace(resPlain, '');
      
      return {
        ...prev,
        [nodeId]: { ...existing, selectedResources: newSelected, text: newText }
      };
    });
  };


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
          
          // 初始化 nodeDataMap
          const initialMap: Record<string, NodeData> = {};
          const initNodeData = async (nodes: OutlineNode[]) => {
            for (const node of nodes) {
              if (node.content) {
                // node.content from backend is markdown, we convert it to HTML for WangEditor
                const htmlContent = await marked.parse(node.content);
                initialMap[node.id] = { text: htmlContent, selectedResources: [] };
              }
              if (node.children) {
                await initNodeData(node.children);
              }
            }
          };
          await initNodeData(data.directories);
          setNodeDataMap(prev => ({ ...initialMap, ...prev }));

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

  const handleNext = async () => {
    // 将 nodeDataMap 中的内容保存到 outline 中
    const newOutline = JSON.parse(JSON.stringify(outline));
    const updateNodeContent = (nodes: OutlineNode[]) => {
      for (const node of nodes) {
        if (nodeDataMap[node.id] && nodeDataMap[node.id].text) {
          // nodeDataMap[node.id].text is HTML from WangEditor, convert back to Markdown for backend
          node.content = turndownService.turndown(nodeDataMap[node.id].text);
        }
        if (node.children) {
          updateNodeContent(node.children);
        }
      }
    };
    updateNodeContent(newOutline);

    try {
      const token = localStorage.getItem('hxybs_token');
      await fetch(`/api/business-bids/${projectId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          directories_content: JSON.stringify(newOutline),
          status: 'filled'
        })
      });
    } catch (e) {
      console.error('Failed to save directories content', e);
    }
    
    onNext();
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
              </div>
              
              {/* 智能填充内容区 */}
              {isLoadingResource ? (
                <div className="text-gray-500 mb-4 flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                  正在从资料库获取匹配内容...
                </div>
              ) : matchingResources.length > 0 ? (
                <div className="mb-6">
                  <h4 className="font-medium text-gray-800 mb-3 border-l-4 border-blue-500 pl-2">智能填充资料库</h4>
                  
                  {matchingResources.length > 1 && (
                    <div className="mb-4 bg-gray-50 p-3 rounded border border-gray-200">
                      <p className="text-sm text-gray-600 mb-2 font-medium">发现多条匹配资料，请选择要添加的内容：</p>
                      <div className="flex flex-col gap-2">
                        {matchingResources.map(res => (
                          <label key={res.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-100 p-1 rounded">
                            <input 
                              type="checkbox" 
                              checked={nodeDataMap[selectedNode.id]?.selectedResources.some(r => r.id === res.id) || false}
                              onChange={() => handleToggleResource(res)}
                              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 w-4 h-4"
                            />
                            {res.title}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 已添加内容展示 */}
                  {(nodeDataMap[selectedNode.id]?.selectedResources || []).length > 0 && (
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-gray-700">已添加的资料：</p>
                      {nodeDataMap[selectedNode.id].selectedResources.map(res => (
                        <div key={res.id} className="border border-blue-200 bg-blue-50/50 p-4 rounded-md relative group">
                          <button 
                            onClick={() => handleRemoveResource(res)}
                            className="absolute top-2 right-2 text-red-500 hover:text-red-700 text-sm opacity-0 group-hover:opacity-100 transition-opacity bg-white px-2 py-1 rounded shadow-sm border border-red-100"
                          >
                            删除
                          </button>
                          <h5 className="font-medium text-blue-900 mb-1 pr-12">{res.title}</h5>
                          <p className="text-sm text-blue-800 whitespace-pre-wrap mb-2">{res.content}</p>
                          {res.image_url && (
                            <div className="mt-2">
                              <img src={res.image_url} alt={res.title} className="max-h-48 object-contain border rounded bg-white shadow-sm" />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-gray-50 border-l-4 border-gray-400 p-4 mb-6 text-sm text-gray-600 rounded-r">
                  未从资料库找到【{selectedNode.title}】的匹配项，请手动填写。
                </div>
              )}

              {/* 文本框区 */}
              <div className="flex-1 flex flex-col gap-2 min-h-[400px]">
                <label className="text-sm font-medium text-gray-700 border-l-4 border-green-500 pl-2">目录内容（支持富文本编辑，可原样保持格式）</label>
                <div style={{ border: '1px solid #ccc', zIndex: 100 }} className="flex-1 flex flex-col">
                  <Toolbar
                    editor={editor}
                    defaultConfig={toolbarConfig}
                    mode="default"
                    style={{ borderBottom: '1px solid #ccc' }}
                  />
                  <Editor
                    defaultConfig={editorConfig}
                    value={nodeDataMap[selectedNode.id]?.text || ''}
                    onCreated={setEditor}
                    onChange={handleEditorChange}
                    mode="default"
                    style={{ flex: 1, overflowY: 'hidden' }}
                  />
                </div>
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
          onClick={handleNext}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          下一步：AI 撰写与导出
        </button>
      </div>
    </div>
  );
};

export default DataFilling;
