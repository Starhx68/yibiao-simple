import React, { useState } from 'react';
import BusinessDocumentAnalysis from './BusinessDocumentAnalysis';
import ElementExtraction from './ElementExtraction';
import BusinessOutlineEdit from './BusinessOutlineEdit';
import DataFilling from './DataFilling';
import BusinessContentEdit from './BusinessContentEdit';

const BusinessBidEditor: React.FC = () => {
  const [currentStep, setCurrentStep] = useState(0);
  const [projectId, setProjectId] = useState<string | null>(null);

  const stepTitles = [
    '文档解析',
    '要素提取',
    '目录生成',
    '数据填充',
    '内容生成与导出'
  ];

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <BusinessDocumentAnalysis
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
      <div id="app-main-scroll">{renderStep()}</div>
    </div>
  );
};

export default BusinessBidEditor;
