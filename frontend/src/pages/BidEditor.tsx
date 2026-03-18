import React from 'react';
import DocumentAnalysis from './DocumentAnalysis';
import OutlineEdit from './OutlineEdit';
import ContentEdit from './ContentEdit';
import { useAppState } from '../hooks/useAppState';

type BidType = 'business' | 'technical';

interface BidEditorProps {
  type: BidType;
}

const BidEditor: React.FC<BidEditorProps> = ({ type }) => {
  const {
    state,
    updateFileContent,
    updateAnalysisResults,
    updateOutline,
    updateSelectedChapter,
    nextStep,
    prevStep,
  } = useAppState();

  const renderStep = () => {
    if (state.currentStep === 0) {
      return (
        <DocumentAnalysis
          fileContent={state.fileContent}
          projectOverview={state.projectOverview}
          techRequirements={state.techRequirements}
          onFileUpload={updateFileContent}
          onAnalysisComplete={(o, r) => {
            updateAnalysisResults(o, r);
            nextStep();
          }}
        />
      );
    }
    if (state.currentStep === 1) {
      return (
        <OutlineEdit
          projectOverview={state.projectOverview}
          techRequirements={state.techRequirements}
          outlineData={state.outlineData}
          onOutlineGenerated={(outline) => {
            updateOutline(outline);
            nextStep();
          }}
        />
      );
    }
    return (
      <ContentEdit
        outlineData={state.outlineData}
        selectedChapter={state.selectedChapter}
        onChapterSelect={updateSelectedChapter}
      />
    );
  };

  const stepTitles = ['标书解析', '目录编辑', '内容编辑'];

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              {type === 'business' ? '商务标编写' : '技术标编写'}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              第 {state.currentStep + 1} 步：{stepTitles[state.currentStep]}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {state.currentStep > 0 && (
              <button
                type="button"
                onClick={prevStep}
                className="px-3 py-2 rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              >
                上一步
              </button>
            )}
            {state.currentStep < 2 && (
              <button
                type="button"
                onClick={nextStep}
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
                i <= state.currentStep ? 'bg-blue-600' : 'bg-gray-200',
              ].join(' ')}
            />
          ))}
        </div>
      </div>
      <div id="app-main-scroll">{renderStep()}</div>
    </div>
  );
};

export default BidEditor;
