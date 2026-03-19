import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import BusinessDocumentAnalysis from './BusinessDocumentAnalysis';
import ElementExtraction from './ElementExtraction';
import BusinessOutlineEdit from './BusinessOutlineEdit';
import DataFilling from './DataFilling';
import BusinessContentEdit from './BusinessContentEdit';

const BusinessBidEditor: React.FC = () => {
  const { projectId: routeProjectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (routeProjectId) {
      if (routeProjectId !== projectId) {
        fetchProjectData(routeProjectId);
      }
    } else {
      setProjectId(null);
      setCurrentStep(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeProjectId]);

  const fetchProjectData = async (id: string) => {
    setIsLoading(true);
    try {
      const token = localStorage.getItem('hxybs_token');
      const res = await fetch(`/api/business-bids/${id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setProjectId(id);
        
        // Determine the step based on status or data availability
        let step = 0;
        if (data.status === 'analyzing' || data.status === 'analyzed' || data.status === 'analyzed_with_error') {
          step = 1;
        } else if (data.status === 'generating') {
          step = 2;
        } else if (data.status === 'filling') {
          step = 3;
        } else if (data.status === 'filled') {
          step = 4;
        } else if (data.status === 'completed') {
          step = 4;
        } else if (data.status === 'draft') {
          step = 0;
        } else {
          step = 1;
        }
        
        setCurrentStep(step);
      } else {
        // Project not found or error, reset route
        navigate('/business');
      }
    } catch (error) {
      console.error('Failed to fetch project data', error);
      navigate('/business');
    } finally {
      setIsLoading(false);
    }
  };

  const stepTitles = [
    '文档解析',
    '要素提取',
    '目录生成',
    '数据填充',
    'AI核验与导出'
  ];

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <BusinessDocumentAnalysis
            key={projectId || 'new'}
            projectId={projectId}
            onAnalysisComplete={(id) => {
              setProjectId(id);
              setCurrentStep(1);
            }}
          />
        );
      case 1:
        return (
          <ElementExtraction
            projectId={projectId}
            onNext={() => setCurrentStep(2)}
          />
        );
      case 2:
        return (
          <BusinessOutlineEdit
            projectId={projectId}
            onNext={() => setCurrentStep(3)}
          />
        );
      case 3:
        return (
          <DataFilling
            projectId={projectId}
            onNext={() => setCurrentStep(4)}
          />
        );
      case 4:
        return (
          <BusinessContentEdit
            projectId={projectId}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">商务标编写</h1>
            <p className="text-sm text-gray-500 mt-1">
              第 {currentStep + 1} 步：{stepTitles[currentStep]}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {currentStep === 0 && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('确定要重新制作标书吗？这将清空当前的进度。')) {
                    setProjectId(null);
                    setCurrentStep(0);
                    navigate('/business');
                  }
                }}
                className="px-3 py-2 rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              >
                新增标书
              </button>
            )}
            {currentStep > 0 && (
              <button
                type="button"
                onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
                className="px-3 py-2 rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              >
                上一步
              </button>
            )}
            {currentStep < 4 && currentStep > 0 && (
              <button
                type="button"
                onClick={() => setCurrentStep(Math.min(4, currentStep + 1))}
                className="px-3 py-2 rounded-md border border-transparent bg-blue-600 text-white hover:bg-blue-700"
              >
                下一步
              </button>
            )}
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          {stepTitles.map((t, i) => (
            <div
              key={t}
              className={[
                'flex-1 h-1.5 rounded',
                i <= currentStep ? 'bg-blue-600' : 'bg-gray-200',
              ].join(' ')}
            />
          ))}
        </div>
      </div>
      <div id="app-main-scroll">
        {isLoading ? (
          <div className="flex justify-center items-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <span className="ml-2 text-gray-500">加载标书数据中...</span>
          </div>
        ) : (
          renderStep()
        )}
      </div>
    </div>
  );
};

export default BusinessBidEditor;
