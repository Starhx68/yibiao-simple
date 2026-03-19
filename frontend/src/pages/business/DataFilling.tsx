import React, { useState, useEffect, useRef } from 'react';
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

// WangEditor 5 strictly filters HTML tags. It does not support <div> by default.
// We must unwrap <div> tags (like the template-region from backend) so inner <p> and <table> are kept.
const sanitizeHtmlForEditor = (html: string) => {
  if (!html || typeof html !== 'string') return html;
  
  // Try to clean up mammoth HTML for WangEditor.
  // WangEditor might strip some tags or complain if things are too deeply nested in unrecognized tags.
  // 1. We keep standard tags.
  // 2. We remove <a> tags if they are just empty anchors used for ToC
  html = html.replace(/<a id="[^"]+"><\/a>/g, '');
  
  if (!html.includes('<div')) return html;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const divs = Array.from(doc.querySelectorAll('div'));
    divs.forEach(div => {
      const fragment = document.createDocumentFragment();
      while (div.firstChild) {
        fragment.appendChild(div.firstChild);
      }
      if (div.parentNode) {
        div.parentNode.replaceChild(fragment, div);
      }
    });
    return doc.body.innerHTML;
  } catch (e) {
    return html;
  }
};

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

const DataFilling: React.FC<Props> = ({ projectId, onNext }) => {
  const [outline, setOutline] = useState<OutlineNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<OutlineNode | null>(null);
  const [nodeDataMap, setNodeDataMap] = useState<Record<string, NodeData>>({});
  const [matchingResources, setMatchingResources] = useState<ResourceItem[]>([]);
  const [isLoadingResource, setIsLoadingResource] = useState(false);
  const [isSmartFilling, setIsSmartFilling] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  // WangEditor instance
  const [editor, setEditor] = useState<IDomEditor | null>(null);

  // Refs for auto-save on blur
  const nodeDataMapRef = useRef(nodeDataMap);
  const outlineRef = useRef(outline);
  const projectIdRef = useRef(projectId);
  const selectedNodeRef = useRef(selectedNode);

  useEffect(() => {
    nodeDataMapRef.current = nodeDataMap;
  }, [nodeDataMap]);

  useEffect(() => {
    outlineRef.current = outline;
  }, [outline]);

  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  useEffect(() => {
    selectedNodeRef.current = selectedNode;
  }, [selectedNode]);

  const autoSave = async () => {
    const currentProjectId = projectIdRef.current;
    if (!currentProjectId) return;

    const currentOutline = outlineRef.current;
    const currentDataMap = { ...nodeDataMapRef.current };
    
    // Grab absolute latest text from editor to avoid React state batching race conditions
    if (editor && selectedNodeRef.current) {
      currentDataMap[selectedNodeRef.current.id] = {
        ...currentDataMap[selectedNodeRef.current.id],
        text: editor.getHtml()
      };
    }

    const newOutline = JSON.parse(JSON.stringify(currentOutline));
    const updateNodeContent = (nodes: OutlineNode[]) => {
      for (const node of nodes) {
        if (currentDataMap[node.id] && currentDataMap[node.id].text !== undefined) {
          let htmlToConvert = currentDataMap[node.id].text;
          
          // Pre-process tables for turndown to ensure proper Markdown conversion
          try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlToConvert, 'text/html');
            const tables = Array.from(doc.querySelectorAll('table'));
            tables.forEach(table => {
              if (!table.querySelector('th')) {
                const firstRow = table.querySelector('tr');
                if (firstRow) {
                  const tds = Array.from(firstRow.querySelectorAll('td'));
                  tds.forEach(td => {
                    const th = doc.createElement('th');
                    th.innerHTML = td.innerHTML;
                    Array.from(td.attributes).forEach(attr => th.setAttribute(attr.name, attr.value));
                    td.parentNode?.replaceChild(th, td);
                  });
                  let thead = table.querySelector('thead');
                  if (!thead) {
                    thead = doc.createElement('thead');
                    table.insertBefore(thead, table.firstChild);
                    thead.appendChild(firstRow);
                  }
                }
              }
            });
            htmlToConvert = doc.body.innerHTML;
          } catch (e) {
            // ignore
          }
          
          try {
            node.content = turndownService.turndown(htmlToConvert);
          } catch (e) {
            console.error('Turndown conversion failed', e);
            node.content = htmlToConvert;
          }
        }
        if (node.children) {
          updateNodeContent(node.children);
        }
      }
    };
    updateNodeContent(newOutline);
    const normalizedOutline = ensureDirectoryNumbering(newOutline);
    setOutline(normalizedOutline); // <-- Add this to update local state too

    try {
      setSaveStatus('saving');
      const token = localStorage.getItem('hxybs_token');
      await fetch(`/api/business-bids/${currentProjectId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          directories_content: JSON.stringify(normalizedOutline)
          // Intentionally omitting 'status: filled' to not alter workflow state unexpectedly during autosave
        })
      });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
      console.log('[DataFilling] Auto-saved successfully on blur');
    } catch (e) {
      console.error('[DataFilling] Failed to auto-save directories content', e);
      setSaveStatus('idle');
    }
  };

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
    },
    onBlur: (editor: IDomEditor) => {
      console.log('[DataFilling] Editor blurred, triggering auto-save');
      autoSave();
    }
  };

  const handleEditorChange = (editor: IDomEditor) => {
    if (!selectedNode) return;
    const html = editor.getHtml();
    
    // Prevent infinite loop if the change was triggered by our own setNodeDataMap
    // Also avoid overwriting with empty content if we just switched nodes
    if (nodeDataMap[selectedNode.id]?.text === html) return;
    
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
      console.log(`[DataFilling] Node selected: ${selectedNode.title}, ID: ${selectedNode.id}`);
      fetchMatchingResources(selectedNode);
      
      // Force update the editor text when selectedNode changes
      const existingData = nodeDataMap[selectedNode.id];
      if (existingData && existingData.text !== undefined) {
          console.log(`[DataFilling] Node already has data. Setting editor to existing text length: ${existingData.text.length}`);
          console.log(`[DataFilling] Content preview:`, existingData.text.substring(0, 100));
          if (editor) {
             // Forcibly set the editor HTML to ensure it displays the content
             try {
               // Ignore if it's identical to prevent cursor jump
               if (editor.getHtml() !== existingData.text) {
                 editor.setHtml(existingData.text || '<p><br></p>');
               }
             } catch (e) {
               console.error('[DataFilling] Error setting editor html:', e);
             }
          }
      } else {
          const contentStr = selectedNode.content || '';
          console.log(`[DataFilling] Node has NO existing data in map. Using outline content. Length: ${contentStr.length}`);
          let contentHtml = '';
          if (contentStr.trim().startsWith('<')) {
              contentHtml = sanitizeHtmlForEditor(contentStr);
          } else {
              contentHtml = contentStr ? contentStr.split('\n').map((line: string) => `<p>${line}</p>`).join('') : '';
          }
          console.log(`[DataFilling] Node content preview after sanitize:`, contentHtml.substring(0, 100));
          
          setNodeDataMap(prev => ({
              ...prev,
              [selectedNode.id]: {
                  text: contentHtml,
                  selectedResources: []
              }
          }));

          if (editor) {
             try {
               editor.setHtml(contentHtml || '<p><br></p>');
             } catch (e) {
               console.error('[DataFilling] Error setting editor html:', e);
             }
          }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode, projectId, editor]);

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
          
          const existing = nodeDataMapRef.current[node.id] || { text: '', selectedResources: [] };
          if (data.results.length === 1 && existing.selectedResources.length === 0) {
            const matchedRes = data.results[0];
            const newText = existing.text ? existing.text : `【${matchedRes.title}】\n${matchedRes.content}\n\n`;
            
            if (editor && selectedNodeRef.current?.id === node.id) {
              editor.setHtml(newText || '<p><br></p>');
            }
            
            setNodeDataMap(prev => ({
              ...prev,
              [node.id]: {
                ...(prev[node.id] || { text: '', selectedResources: [] }),
                selectedResources: [matchedRes],
                text: newText
              }
            }));
          }
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
    
    const existing = nodeDataMap[nodeId] || { text: '', selectedResources: [] };
    const isSelected = existing.selectedResources.some(r => r.id === res.id);
    let newSelected: ResourceItem[];
    let newText = existing.text || '';
    
    const resHtml = `<p><strong>【${res.title}】</strong></p><p>${res.content.replace(/\n/g, '<br/>')}</p><p><br/></p>`;
    const resPlain = `【${res.title}】\n${res.content}\n\n`;
    
    if (isSelected) {
      newSelected = existing.selectedResources.filter(r => r.id !== res.id);
      newText = newText.replace(resHtml, '').replace(resPlain, '');
    } else {
      newSelected = [...existing.selectedResources, res];
      if (newText.includes('<p>') || newText.includes('<div>')) {
        newText += resHtml;
      } else {
        newText += resPlain;
      }
    }
    
    if (editor) {
      editor.setHtml(newText || '<p><br></p>');
    }
    
    setNodeDataMap(prev => ({
      ...prev,
      [nodeId]: { ...existing, selectedResources: newSelected, text: newText }
    }));
  };

  const handleRemoveResource = (res: ResourceItem) => {
    if (!selectedNode) return;
    const nodeId = selectedNode.id;
    const existing = nodeDataMap[nodeId] || { text: '', selectedResources: [] };
    const newSelected = existing.selectedResources.filter(r => r.id !== res.id);
    
    const resHtml = `<p><strong>【${res.title}】</strong></p><p>${res.content.replace(/\n/g, '<br/>')}</p><p><br/></p>`;
    const resPlain = `【${res.title}】\n${res.content}\n\n`;
    const newText = (existing.text || '').replace(resHtml, '').replace(resPlain, '');
    
    if (editor) {
      editor.setHtml(newText || '<p><br></p>');
    }
    
    setNodeDataMap(prev => ({
      ...prev,
      [nodeId]: { ...existing, selectedResources: newSelected, text: newText }
    }));
  };

  const handleSmartFill = async () => {
    if (!selectedNode) return;
    const nodeId = selectedNode.id;
    const currentData = nodeDataMap[nodeId];
    if (!currentData || !currentData.text) return;

    setIsSmartFilling(true);
    try {
      const token = localStorage.getItem('hxybs_token');
      const res = await fetch(`/api/business-bids/${projectId}/smart-fill`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          html_content: currentData.text,
          resources: currentData.selectedResources
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.filled_content) {
          if (editor) {
            editor.setHtml(data.filled_content || '<p><br></p>');
          }
          setNodeDataMap(prev => ({
            ...prev,
            [nodeId]: { ...currentData, text: data.filled_content }
          }));
        }
      } else {
        console.error('Smart fill failed');
      }
    } catch (error) {
      console.error('Smart fill request error', error);
    } finally {
      setIsSmartFilling(false);
    }
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
          const normalizedDirectories = ensureDirectoryNumbering(data.directories as OutlineNode[]);
          setOutline(normalizedDirectories);
          
          // 初始化 nodeDataMap
          const initialMap: Record<string, NodeData> = {};
          const initNodeData = async (nodes: OutlineNode[]) => {
            for (const node of nodes) {
              if (node.content) {
                console.log(`[DataFilling] Init node data for ${node.id} (${node.title}). Content starts with:`, node.content.substring(0, 20));
                // node.content from backend is HTML now (or markdown fallback), check before parsing
                let htmlContent = node.content;
                if (!node.content.trim().startsWith('<')) {
                  htmlContent = await marked.parse(node.content);
                } else {
                  htmlContent = sanitizeHtmlForEditor(htmlContent);
                }
                initialMap[node.id] = { text: htmlContent, selectedResources: [] };
              } else {
                 initialMap[node.id] = { text: '', selectedResources: [] };
              }
              if (node.children) {
                await initNodeData(node.children);
              }
            }
          };
          await initNodeData(normalizedDirectories);
          console.log('[DataFilling] Initial map generated, keys:', Object.keys(initialMap).length);
          setNodeDataMap(prev => {
             // To prevent existing selected resources or edits from being wiped if we re-fetch,
             // we merge, but prefer initialMap for empty ones. Actually, if we just fetched,
             // it's better to use initialMap and only keep selectedResources from prev if any.
             const merged = { ...initialMap };
             for (const key in prev) {
                 if (merged[key]) {
                     merged[key].selectedResources = prev[key].selectedResources;
                     // Only overwrite text if prev actually has text and initialMap has none?
                     // No, if user edited, we should probably keep user edits, but fetchDirectories 
                     // usually runs once on mount.
                     if (prev[key].text) {
                         merged[key].text = prev[key].text;
                     }
                 } else {
                     merged[key] = prev[key];
                 }
             }
             return merged;
          });

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
          findLeaf(normalizedDirectories);
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
    const currentDataMap = { ...nodeDataMap };
    
    // Grab absolute latest text from editor to avoid React state batching race conditions
    if (editor && selectedNode) {
      currentDataMap[selectedNode.id] = {
        ...currentDataMap[selectedNode.id],
        text: editor.getHtml()
      };
    }

    const updateNodeContent = (nodes: OutlineNode[]) => {
      for (const node of nodes) {
        if (currentDataMap[node.id] && currentDataMap[node.id].text !== undefined) {
          let htmlToConvert = currentDataMap[node.id].text;
          
          try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlToConvert, 'text/html');
            const tables = Array.from(doc.querySelectorAll('table'));
            tables.forEach(table => {
              if (!table.querySelector('th')) {
                const firstRow = table.querySelector('tr');
                if (firstRow) {
                  const tds = Array.from(firstRow.querySelectorAll('td'));
                  tds.forEach(td => {
                    const th = doc.createElement('th');
                    th.innerHTML = td.innerHTML;
                    Array.from(td.attributes).forEach(attr => th.setAttribute(attr.name, attr.value));
                    td.parentNode?.replaceChild(th, td);
                  });
                  let thead = table.querySelector('thead');
                  if (!thead) {
                    thead = doc.createElement('thead');
                    table.insertBefore(thead, table.firstChild);
                    thead.appendChild(firstRow);
                  }
                }
              }
            });
            htmlToConvert = doc.body.innerHTML;
          } catch (e) {
            // ignore
          }
          
          try {
            node.content = turndownService.turndown(htmlToConvert);
          } catch (e) {
            console.error('Turndown conversion failed', e);
            node.content = htmlToConvert;
          }
        }
        if (node.children) {
          updateNodeContent(node.children);
        }
      }
    };
    updateNodeContent(newOutline);
    const normalizedOutline = ensureDirectoryNumbering(newOutline);

    try {
      const token = localStorage.getItem('hxybs_token');
      await fetch(`/api/business-bids/${projectId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          directories_content: JSON.stringify(normalizedOutline),
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
                  未从资料库找到【{selectedNode.title}】的匹配项，请直接在下方原样模板中手动填写。
                </div>
              )}

              {/* 文本框区 */}
              <div className="flex-1 flex flex-col gap-2 min-h-[400px]">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <label className="text-sm font-medium text-gray-700 border-l-4 border-green-500 pl-2">目录内容（支持富文本编辑，可原样保持格式）</label>
                    {saveStatus === 'saving' && <span className="text-xs text-gray-400">保存中...</span>}
                    {saveStatus === 'saved' && <span className="text-xs text-green-500">已自动保存</span>}
                  </div>
                  <button
                    onClick={handleSmartFill}
                    disabled={isSmartFilling}
                    className={`px-3 py-1.5 text-sm text-white rounded-md flex items-center gap-1 ${isSmartFilling ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 shadow-sm'}`}
                  >
                    {isSmartFilling && <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>}
                    AI智能格式填充
                  </button>
                </div>
                <div style={{ border: '1px solid #ccc', zIndex: 100 }} className="flex-1 flex flex-col">
                  <Toolbar
                    editor={editor}
                    defaultConfig={toolbarConfig}
                    mode="default"
                    style={{ borderBottom: '1px solid #ccc' }}
                  />
                  <Editor
                    defaultConfig={editorConfig}
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
          下一步：AI 核验与导出
        </button>
      </div>
    </div>
  );
};

export default DataFilling;
