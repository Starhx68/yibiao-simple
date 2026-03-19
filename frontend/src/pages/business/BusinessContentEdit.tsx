import React, { useState, useEffect, useRef } from 'react';
import { marked } from 'marked';
import '@wangeditor/editor/dist/css/style.css';
import { Editor, Toolbar } from '@wangeditor/editor-for-react';
import { IDomEditor, IEditorConfig, IToolbarConfig } from '@wangeditor/editor';
import TurndownService from 'turndown';

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
}

interface OutlineNode {
  id: string;
  title: string;
  children: OutlineNode[];
  content?: string;
}

interface VerificationResult {
  type: 'danger' | 'warning' | 'info';
  category: string; // '废标风险', '盖章签字', '信息校验'
  message: string;
  matched_text?: string;
  node_id?: string;
}

const BusinessContentEdit: React.FC<Props> = ({ projectId }) => {
  const [outline, setOutline] = useState<OutlineNode[]>([]);
  const [verifying, setVerifying] = useState(false);
  const [verificationResults, setVerificationResults] = useState<VerificationResult[]>([]);
  const [fullHtml, setFullHtml] = useState<string>('');
  
  // WangEditor instance
  const [editor, setEditor] = useState<IDomEditor | null>(null);

  useEffect(() => {
    return () => {
      if (editor == null) return;
      editor.destroy();
      setEditor(null);
    };
  }, [editor]);

  const toolbarConfig: Partial<IToolbarConfig> = {};
  const editorConfig: Partial<IEditorConfig> = {
    placeholder: '全量文档生成中...',
    MENU_CONF: {
      uploadImage: {
        base64LimitSize: 5 * 1024 * 1024 // 5MB
      }
    }
  };

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
          buildFullDocument(data.directories);
        }
      }
    } catch (error) {
      console.error('Failed to fetch directories', error);
    }
  };

  const buildFullDocument = async (nodes: OutlineNode[]) => {
    let html = '';
    const traverse = async (nodeList: OutlineNode[]) => {
      for (const node of nodeList) {
        html += `<h2 id="node-${node.id}">${node.title}</h2>`;
        if (node.content) {
          // If it's already HTML, just append it, otherwise convert markdown
          let contentHtml = node.content;
          if (!node.content.trim().startsWith('<')) {
            contentHtml = await marked.parse(node.content);
          }
          // Basic sanitize: WangEditor v5 needs proper table tags to show borders
          try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(contentHtml, 'text/html');
            
            // Fix tables
            const tables = Array.from(doc.querySelectorAll('table'));
            tables.forEach(table => {
              table.setAttribute('border', '1');
              table.setAttribute('width', '100%');
              // If it only has tr but no tbody, wrap trs in tbody
              if (!table.querySelector('tbody') && !table.querySelector('thead')) {
                const tbody = doc.createElement('tbody');
                while (table.firstChild) {
                  tbody.appendChild(table.firstChild);
                }
                table.appendChild(tbody);
              }
            });

            // Unwrap div tags which might be filtered by WangEditor
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
            
            contentHtml = doc.body.innerHTML;
          } catch (e) {
            // ignore
          }
          
          html += `${contentHtml}`;
        } else {
          html += `<p style="color: #9ca3af; font-style: italic;">【此章节暂无内容】</p>`;
        }
        
        if (node.children && node.children.length > 0) {
          await traverse(node.children);
        }
      }
    };
    await traverse(nodes);
    setFullHtml(html);
  };

  const handleVerify = async () => {
    setVerifying(true);
    setVerificationResults([]);
    try {
      const token = localStorage.getItem('hxybs_token');
      const res = await fetch(`/api/business-bids/${projectId}/verify-stream`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!res.ok) throw new Error('核验失败');

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

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
                if (data.result) {
                  setVerificationResults(prev => [...prev, data.result]);
                  highlightTextInPreview(data.result);
                }
              } catch (e) {
                // ignore
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Verification failed', error);
      alert('AI 核验失败');
    } finally {
      setVerifying(false);
    }
  };

  const highlightTextInPreview = (result: VerificationResult) => {
    if (!result.matched_text || !result.node_id) return;
    
    // Attempt to highlight the matched text in the preview HTML directly
    setFullHtml(prevHtml => {
      if (!prevHtml) return prevHtml;
      
      // Escape special characters for regex
      const escapedText = result.matched_text!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      // We need to only replace inside the specific node to avoid false positives
      // But a simple approach is to find the text and wrap it
      // Let's do a basic global replace with a red span for danger/warning
      const colorClass = result.type === 'danger' ? 'text-red-600 bg-red-100 font-bold' : 'text-yellow-600 bg-yellow-100 font-bold';
      
      try {
        const regex = new RegExp(`(${escapedText})`, 'g');
        return prevHtml.replace(regex, `<span class="${colorClass}">$1</span>`);
      } catch (e) {
        return prevHtml;
      }
    });
  };

  const scrollToNode = (nodeId?: string) => {
    if (!nodeId || !editor) return;
    try {
      // WangEditor API to scroll to element
      // However, WangEditor might strip id attributes. 
      // If id is preserved, we can use standard DOM methods:
      const el = document.getElementById(`node-${nodeId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.backgroundColor = '#fef08a';
        setTimeout(() => {
          el.style.backgroundColor = 'transparent';
        }, 2000);
      } else {
        // Fallback: Find text in editor and scroll to it
        // This is tricky without knowing the exact text, but we can try to find the title.
      }
    } catch (e) {
      console.error('Scroll failed', e);
    }
  };

  const handleExport = async () => {
    try {
      const token = localStorage.getItem('hxybs_token');
      
      // Sync editor content back to outline before export
      let exportOutline = JSON.parse(JSON.stringify(outline));
      if (editor) {
        const currentHtml = editor.getHtml();
        const parser = new DOMParser();
        const doc = parser.parseFromString(currentHtml, 'text/html');
        
        // Pre-process tables for turndown: ensure they have <thead> and <th>
        const tables = Array.from(doc.querySelectorAll('table'));
        tables.forEach(table => {
          if (!table.querySelector('th')) {
            const firstRow = table.querySelector('tr');
            if (firstRow) {
              const tds = Array.from(firstRow.querySelectorAll('td'));
              tds.forEach(td => {
                const th = doc.createElement('th');
                th.innerHTML = td.innerHTML;
                // copy attributes if any
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

        const sections = Array.from(doc.querySelectorAll('h2[id^="node-"]'));
        
        const contentMap: Record<string, string> = {};
        
        sections.forEach((h2, index) => {
          const nodeId = h2.id.replace('node-', '');
          let sectionHtml = '';
          let nextNode = h2.nextSibling;
          
          while (nextNode && (nextNode.nodeName.toLowerCase() !== 'h2' || !(nextNode as Element).id.startsWith('node-'))) {
            if (nextNode.nodeType === Node.ELEMENT_NODE) {
              sectionHtml += (nextNode as Element).outerHTML;
            } else if (nextNode.nodeType === Node.TEXT_NODE) {
              sectionHtml += nextNode.textContent;
            }
            nextNode = nextNode.nextSibling;
          }
          
          // Convert section HTML to markdown
          contentMap[nodeId] = turndownService.turndown(sectionHtml);
        });
        
        const updateOutlineContent = (nodes: OutlineNode[]) => {
          for (const node of nodes) {
            if (contentMap[node.id] !== undefined) {
              node.content = contentMap[node.id];
            }
            if (node.children) {
              updateOutlineContent(node.children);
            }
          }
        };
        updateOutlineContent(exportOutline);
      }

      const res = await fetch(`/api/document/export-word`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          project_name: '商务标文件',
          outline: exportOutline
        })
      });
      
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = '商务投标文件.docx';
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

  return (
    <div className="flex flex-col h-[calc(100vh-200px)]">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-gray-800">AI 核验与整体预览</h2>
        <div className="flex gap-3">
          <button
            onClick={handleVerify}
            disabled={verifying}
            className={`px-4 py-2 text-white rounded-md font-medium flex items-center gap-2 ${verifying ? 'bg-indigo-400' : 'bg-indigo-600 hover:bg-indigo-700'}`}
          >
            {verifying && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>}
            {verifying ? 'AI 核验中...' : '开始 AI 智能核验'}
          </button>
          <button
            onClick={handleExport}
            className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 font-medium"
          >
            一键排版并导出 Docx
          </button>
        </div>
      </div>

      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* 左侧：核验结果列表 */}
        <div className="w-1/3 bg-white shadow rounded-lg p-4 flex flex-col overflow-hidden">
          <h3 className="text-sm font-medium text-gray-900 mb-3 border-b pb-2">AI 核验结果</h3>
          <div className="flex-1 overflow-y-auto space-y-3 pr-2">
            {verificationResults.length === 0 ? (
              <div className="text-gray-500 text-sm text-center mt-10">
                点击“开始 AI 智能核验”对标书进行全面检查
              </div>
            ) : (
              verificationResults.map((res, idx) => (
                <div 
                  key={idx} 
                  className={`p-3 rounded border text-sm cursor-pointer hover:shadow-md transition-shadow ${
                    res.type === 'danger' ? 'bg-red-50 border-red-200' : 
                    res.type === 'warning' ? 'bg-yellow-50 border-yellow-200' : 
                    'bg-blue-50 border-blue-200'
                  }`}
                  onClick={() => scrollToNode(res.node_id)}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className={`font-bold ${
                      res.type === 'danger' ? 'text-red-700' : 
                      res.type === 'warning' ? 'text-yellow-700' : 
                      'text-blue-700'
                    }`}>
                      [{res.category}]
                    </span>
                    {res.node_id && <span className="text-xs text-gray-500 underline">定位</span>}
                  </div>
                  <p className="text-gray-800">{res.message}</p>
                  {res.matched_text && (
                    <div className="mt-2 p-2 bg-white bg-opacity-60 rounded text-xs text-gray-600 font-mono break-all">
                      "...{res.matched_text}..."
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* 右侧：全量文档预览 */}
        <div className="w-2/3 bg-white shadow rounded-lg p-0 overflow-hidden flex flex-col border border-gray-200">
          <Toolbar
            editor={editor}
            defaultConfig={toolbarConfig}
            mode="default"
            style={{ borderBottom: '1px solid #e5e7eb' }}
          />
          <Editor
            defaultConfig={editorConfig}
            value={fullHtml}
            onCreated={setEditor}
            onChange={(e) => {
              // We don't strictly need to save this back to fullHtml on every keystroke
              // because we are just providing a format adjustment interface before export
              // But keeping it in sync might be useful if they switch tabs.
              // For performance, we can just let WangEditor manage its internal state.
            }}
            mode="default"
            style={{ flex: 1, overflowY: 'hidden', padding: '10px' }}
          />
        </div>
      </div>
    </div>
  );
};

export default BusinessContentEdit;
