import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import DocumentAnalysis from './DocumentAnalysis';
import OutlineEdit from './OutlineEdit';
import ContentEdit from './ContentEdit';
import { useAppState } from '../hooks/useAppState';

type BidType = 'business' | 'technical';

interface BidEditorProps {
  type: BidType;
}

const BidEditor: React.FC<BidEditorProps> = ({ type }) => {
  const { projectId: routeProjectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);

  const {
    state,
    updateFileContent,
    updateAnalysisResults,
    updateOutline,
    updateSelectedChapter,
    hydrateState,
    nextStep,
    prevStep,
    resetState,
  } = useAppState();

  useEffect(() => {
    if (routeProjectId) {
      if (routeProjectId !== state.projectId) {
        fetchProjectData(routeProjectId);
      }
    } else if (!routeProjectId && state.projectId) {
      // If we navigate to /technical without ID, but state has ID, reset state
      resetState();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeProjectId]);

  const fetchProjectData = async (id: string) => {
    setIsLoading(true);
    try {
      const token = localStorage.getItem('hxybs_token');
      const res = await fetch(`/api/technical-bids/${id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        
        let step = 0;
        if (data.status === 'analyzing') {
          step = 1;
        } else if (data.status === 'outlined' || data.status === 'generated') {
          step = 2;
        } else if (data.status === 'completed') {
          step = 2;
        } else {
          step = 0;
        }
        
        hydrateState({
          projectId: id,
          currentStep: step,
          fileContent: data.file_content || '',
          projectOverview: data.project_overview || '',
          techRequirements: data.tech_requirements || '',
          outlineData: data.outline_data || null,
        });
      } else {
        navigate('/technical');
      }
    } catch (e) {
      console.error('Failed to fetch technical project', e);
      navigate('/technical');
    } finally {
      setIsLoading(false);
    }
  };

  const renderStep = () => {
    if (state.currentStep === 0) {
      return (
        <DocumentAnalysis
          key={state.fileContent === '' ? 'empty' : 'filled'}
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
        projectId={state.projectId}
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
            {state.currentStep === 0 && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('确定要重新制作标书吗？这将清空当前的进度。')) {
                    resetState();
                    navigate('/technical');
                  }
                }}
                className="px-3 py-2 rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              >
                新增标书
              </button>
            )}
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

export default BidEditor;
