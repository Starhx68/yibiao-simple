import React, { useState, useEffect, useRef } from 'react';
import { renderAsync } from 'docx-preview';

interface Props {
  projectId: string | null;
  onNext: () => void;
}

interface ElementItem {
  id?: string;
  name: string;
  description: string;
}

interface SubCategory {
  id?: string;
  title: string;
  items: ElementItem[];
}

interface MainCategory {
  id?: string;
  title: string;
  subcategories: SubCategory[];
}

type ElementsData = MainCategory[];

const ElementExtraction: React.FC<Props> = ({ projectId, onNext }) => {
  const [elements, setElements] = useState<ElementsData>([]);
  const [activeMainTabId, setActiveMainTabId] = useState<string>('');
  const [activeSubTabId, setActiveSubTabId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [tenderContent, setTenderContent] = useState<string>('');
  const [tenderDocUrl, setTenderDocUrl] = useState<string>(''); // 文档预览URL
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [viewMode, setViewMode] = useState<'text' | 'file'>('file'); // 视图模式：默认文件原文
  const docxContainerRef = useRef<HTMLDivElement>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    if (projectId) {
      fetchProjectAndElements();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (viewMode === 'file' && tenderDocUrl) {
      renderDocument();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, tenderDocUrl]);

  const renderDocument = async () => {
    setPreviewError(null);
    if (!tenderDocUrl) return;

    const fileExtension = tenderDocUrl.split('.').pop()?.toLowerCase();

    if (fileExtension === 'docx') {
      try {
        const response = await fetch(tenderDocUrl);
        if (!response.ok) throw new Error('无法下载文档');
        const blob = await response.blob();
        
        if (docxContainerRef.current) {
          docxContainerRef.current.innerHTML = ''; // Clear previous content
          await renderAsync(blob, docxContainerRef.current, undefined, {
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            ignoreFonts: false,
            breakPages: true,
            ignoreLastRenderedPageBreak: true,
            experimental: false,
            trimXmlDeclaration: true,
            useBase64URL: false,
            debug: false,
          });
        }
      } catch (err) {
        console.error('Docx preview failed:', err);
        setPreviewError('文档预览失败，请尝试下载后查看。');
      }
    }
  };

  // 获取和处理原文数据
  const fetchProjectAndElements = async () => {
    try {
      const token = localStorage.getItem('hxybs_token');
      // Fetch project
      const projRes = await fetch(`/api/business-bids/${projectId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (projRes.ok) {
        const projData = await projRes.json();
        
        // 清理原文内容，去除类似“表格内容”、“表格结束”等标记
        let rawContent = projData.tender_content || '';
        rawContent = rawContent.replace(/\[表格.*?\]/g, '')
                               .replace(/\[图片.*?\]/g, '');
        
        setTenderContent(rawContent.trim());
        setTenderDocUrl(projData.tender_document_url || '');
        
        if (projData.status === 'analyzing') {
          // start analyzing
          startAnalysisStream(token);
        } else {
          // already analyzed
          if (token) {
            fetchElements(token);
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch project', error);
    }
  };

  const startAnalysisStream = async (token: string | null) => {
    setIsAnalyzing(true);
    try {
      const res = await fetch(`/api/business-bids/${projectId}/analyze-stream`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!res.ok) throw new Error('分析失败');

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
                if (data.error) {
                  console.error(data.error);
                }
              } catch (e) {}
            }
          }
        }
      }
      // fetch elements after done
      if (token) {
        await fetchElements(token);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const fetchElements = async (token: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/business-bids/${projectId}/elements`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setElements(data);
          if (data.length > 0) {
            setActiveMainTabId(data[0].id || data[0].title);
            if (data[0].subcategories && data[0].subcategories.length > 0) {
              setActiveSubTabId(data[0].subcategories[0].id || data[0].subcategories[0].title);
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch elements', error);
    } finally {
      setLoading(false);
    }
  };

  // 简单的关键词高亮（仅在文本模式下有效）
  const highlightText = (text: string, keyword: string) => {
    // 过滤掉无关的占位符内容显示
    let cleanText = text.replace(/\[表格.*?\]|\[图片.*?\]/g, '');
    
    if (!keyword) return cleanText;
    // 简单的转义，避免正则错误
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = cleanText.split(new RegExp(`(${escapedKeyword})`, 'gi'));
    return (
      <>
        {parts.map((part, i) => 
          part.toLowerCase() === keyword.toLowerCase() ? (
            <span key={i} className="highlight-match bg-yellow-200 text-gray-900 font-medium px-0.5 rounded">{part}</span>
          ) : (
            part
          )
        )}
      </>
    );
  };

  // 处理要素点击
  const [searchKeyword, setSearchKeyword] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);

  const handleElementClick = (description: string) => {
    // 提取描述中的关键部分作为搜索词（这里简单取前10个字或整个描述）
    // 实际场景可能需要更智能的关键词提取
    if (!description || description === "无相关要求") return;
    const keyword = description.length > 20 ? description.substring(0, 20) : description;
    setSearchKeyword(keyword);
    
    // 如果当前是原始文件预览模式，并且是DOCX，我们可以尝试在DOM中查找并滚动
    if (viewMode === 'file' && tenderDocUrl?.toLowerCase().endsWith('.docx')) {
      setTimeout(() => {
        if (docxContainerRef.current) {
          // 简单的DOM文本搜索
          const walker = document.createTreeWalker(docxContainerRef.current, NodeFilter.SHOW_TEXT, null);
          let node;
          while ((node = walker.nextNode())) {
            if (node.nodeValue && node.nodeValue.includes(keyword)) {
              const element = node.parentElement;
              if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // 可选：添加临时高亮效果
                const originalBg = element.style.backgroundColor;
                element.style.backgroundColor = 'yellow';
                setTimeout(() => {
                  element.style.backgroundColor = originalBg;
                }, 2000);
                break;
              }
            }
          }
        }
      }, 100);
    } else if (viewMode === 'text') {
      // 延迟一下等待渲染完成后再滚动
      setTimeout(() => {
        if (contentRef.current) {
          const highlightElements = contentRef.current.getElementsByClassName('highlight-match');
          if (highlightElements.length > 0) {
            highlightElements[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
      }, 100);
    }
  };

  const activeMainCat = elements.find(c => (c.id || c.title) === activeMainTabId);
  const activeSubCat = activeMainCat?.subcategories?.find(s => (s.id || s.title) === activeSubTabId);

  return (
    <div className="flex flex-col h-[calc(100vh-200px)]">
      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* 左侧：要素提取结果 */}
        <div className="w-1/2 bg-white shadow rounded-lg flex flex-col overflow-hidden">
          {/* Top Tabs (Main Categories) */}
          <div className="border-b border-gray-200 overflow-x-auto">
            <nav className="-mb-px flex space-x-4 px-4" aria-label="Tabs">
              {elements.map((mainCat) => (
                <button
                  key={mainCat.id || mainCat.title}
                  onClick={() => {
                    setActiveMainTabId(mainCat.id || mainCat.title);
                    if (mainCat.subcategories && mainCat.subcategories.length > 0) {
                      setActiveSubTabId(mainCat.subcategories[0].id || mainCat.subcategories[0].title);
                    } else {
                      setActiveSubTabId('');
                    }
                  }}
                  className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                    activeMainTabId === (mainCat.id || mainCat.title)
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {mainCat.title}
                </button>
              ))}
            </nav>
          </div>

          {/* Body: Sub categories and Items */}
          <div className="flex-1 flex overflow-hidden">
            {/* Left: Sub categories */}
            <div className="w-1/3 bg-gray-50 border-r border-gray-200 overflow-y-auto p-2">
              {isAnalyzing ? (
                <div className="flex items-center justify-center h-full">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                </div>
              ) : (
                <nav className="flex flex-col space-y-1">
                  {activeMainCat?.subcategories?.map((subCat) => (
                    <button
                      key={subCat.id || subCat.title}
                      onClick={() => setActiveSubTabId(subCat.id || subCat.title)}
                      className={`text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                        activeSubTabId === (subCat.id || subCat.title)
                          ? 'bg-white text-blue-600 shadow-sm'
                          : 'text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {subCat.title}
                    </button>
                  ))}
                </nav>
              )}
            </div>

            {/* Right: Items */}
            <div className="w-2/3 p-4 overflow-y-auto bg-white">
              {isAnalyzing ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <div className="text-blue-600 font-medium">正在解析全文</div>
                  <div className="text-gray-500 text-sm mt-2">大概需要1-5分钟，请耐心等待...</div>
                </div>
              ) : loading ? (
                <div className="text-center text-gray-500 mt-10">加载中...</div>
              ) : activeSubCat?.items?.length ? (
                <div className="space-y-6">
                  {activeSubCat.items.map((item, idx) => (
                    <div 
                      key={item.id || idx} 
                      className="cursor-pointer group p-2 -mx-2 rounded-md hover:bg-blue-50 transition-colors"
                      onClick={() => handleElementClick(item.description)}
                    >
                      <div className="flex items-start">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-2 mr-2 flex-shrink-0 group-hover:scale-125 transition-transform"></div>
                        <div>
                          <h4 className="text-sm font-bold text-black mb-1">{item.name}</h4>
                          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{item.description}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center text-gray-500 mt-10">
                  {elements.length === 0 ? "暂无数据" : "无相关要求"}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 右侧：招标文件原文预览 (高亮) */}
        <div className="w-1/2 bg-white shadow rounded-lg p-6 flex flex-col">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-medium">招标文件原文</h3>
            <div className="flex bg-gray-100 rounded-md p-1">
              <button
                onClick={() => setViewMode('text')}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${
                  viewMode === 'text' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                智能解析视图
              </button>
              <button
                onClick={() => setViewMode('file')}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${
                  viewMode === 'file' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                原始文件预览
              </button>
            </div>
          </div>
          
          <div className="flex-1 relative overflow-hidden bg-gray-50 p-4 rounded border border-gray-200">
            {viewMode === 'text' ? (
              <div ref={contentRef} className="absolute inset-0 overflow-y-auto p-4 whitespace-pre-wrap text-sm leading-relaxed text-gray-800 z-0 scroll-smooth">
                {tenderContent ? (
                  searchKeyword ? (
                    // 简单的高亮逻辑：将文本按行分割，对每一行进行高亮处理
                    tenderContent.split('\n').map((line, idx) => (
                      <div key={idx} className="min-h-[1em]">
                        {highlightText(line, searchKeyword)}
                      </div>
                    ))
                  ) : (
                    tenderContent
                  )
                ) : (
                  <div className="text-gray-500 italic">暂无招标文件原文。</div>
                )}
              </div>
            ) : (
              <div className="absolute inset-0 z-0 bg-white overflow-auto">
                {tenderDocUrl ? (
                  previewError ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500">
                      <p>{previewError}</p>
                      <a href={tenderDocUrl} download className="mt-2 text-blue-600 hover:underline">点击下载文件</a>
                    </div>
                  ) : tenderDocUrl.toLowerCase().endsWith('.docx') ? (
                    <div ref={docxContainerRef} className="w-full min-h-full p-8 bg-white shadow-sm" />
                  ) : tenderDocUrl.toLowerCase().endsWith('.pdf') ? (
                    <iframe 
                      src={`${tenderDocUrl}${searchKeyword ? `#search=${encodeURIComponent(searchKeyword)}` : ''}`} 
                      className="w-full h-full border-none"
                      title="PDF Preview"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500">
                      <p>暂不支持此格式预览</p>
                      <a href={tenderDocUrl} download className="mt-2 text-blue-600 hover:underline">下载查看</a>
                    </div>
                  )
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-500">
                    无法预览原始文件，请使用智能解析视图。
                  </div>
                )}
              </div>
            )}

            {isAnalyzing && (
              <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden">
                <div 
                  className="w-full h-32 bg-gradient-to-b from-transparent to-blue-400/30 border-b border-blue-400/50"
                  style={{ 
                    animation: 'scan 3s linear infinite'
                  }}
                ></div>
                <style>{`
                  @keyframes scan {
                    0% { transform: translateY(-100%); }
                    100% { transform: translateY(800px); }
                  }
                `}</style>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <button
          onClick={onNext}
          disabled={isAnalyzing}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          下一步：生成目录
        </button>
      </div>
    </div>
  );
};

export default ElementExtraction;
