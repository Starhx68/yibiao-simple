/**
 * 应用状态管理Hook
 */
import { useState, useCallback } from 'react';
import { AppState, OutlineData } from '../types';
import { draftStorage } from '../utils/draftStorage';

const initialState: AppState = {
  currentStep: 0,
  fileContent: '',
  projectOverview: '',
  techRequirements: '',
  outlineData: null,
  selectedChapter: '',
};

export const useAppState = () => {
  const [state, setState] = useState<AppState>(() => {
    const draft = draftStorage.loadDraft();
    return {
      ...initialState,
      ...(draft || {}),
    };
  });

  const updateStep = useCallback((step: number) => {
    setState(prev => {
      const next = { ...prev, currentStep: step };
      draftStorage.saveDraft({ currentStep: step });
      return next;
    });
  }, []);

  const updateFileContent = useCallback((fileContent: string, projectId?: string) => {
    setState(prev => {
      const next = { ...prev, fileContent };
      if (projectId) next.projectId = projectId;
      draftStorage.saveDraft({ fileContent, projectId: next.projectId });
      return next;
    });
  }, []);

  const updateAnalysisResults = useCallback((overview: string, requirements: string) => {
    setState(prev => {
      const next = {
        ...prev,
        projectOverview: overview,
        techRequirements: requirements,
      };
      draftStorage.saveDraft({
        projectOverview: overview,
        techRequirements: requirements,
      });
      
      if (prev.projectId) {
        const token = localStorage.getItem('hxybs_token');
        fetch(`/api/technical-bids/${prev.projectId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ 
            project_overview: overview, 
            tech_requirements: requirements,
            status: 'analyzing'
          })
        }).catch(e => console.error('Failed to sync analysis results', e));
      }
      
      return next;
    });
  }, []);

  const updateOutline = useCallback((outlineData: OutlineData) => {
    setState(prev => {
      const next = { ...prev, outlineData };
      draftStorage.saveDraft({ outlineData });
      
      if (prev.projectId) {
        const token = localStorage.getItem('hxybs_token');
        fetch(`/api/technical-bids/${prev.projectId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ 
            outline_data: JSON.stringify(outlineData),
            status: 'outlined'
          })
        }).catch(e => console.error('Failed to sync outline', e));
      }
      
      return next;
    });
  }, []);

  const updateSelectedChapter = useCallback((chapterId: string) => {
    setState(prev => {
      const next = { ...prev, selectedChapter: chapterId };
      draftStorage.saveDraft({ selectedChapter: chapterId });
      return next;
    });
  }, []);

  const hydrateState = useCallback((newState: Partial<AppState>) => {
    setState(prev => {
      const next = { ...prev, ...newState };
      draftStorage.saveDraft(next);
      return next;
    });
  }, []);

  const nextStep = useCallback(() => {
    setState(prev => {
      const nextStepValue = Math.min(prev.currentStep + 1, 2);
      const next = { ...prev, currentStep: nextStepValue };
      draftStorage.saveDraft({ currentStep: nextStepValue });
      return next;
    });
  }, []);

  const prevStep = useCallback(() => {
    setState(prev => {
      const prevStepValue = Math.max(prev.currentStep - 1, 0);
      const next = { ...prev, currentStep: prevStepValue };
      draftStorage.saveDraft({ currentStep: prevStepValue });
      return next;
    });
  }, []);

  const resetState = useCallback(() => {
    setState(initialState);
    draftStorage.clearAll();
  }, []);

  return {
    state,
    updateStep,
    updateFileContent,
    updateAnalysisResults,
    updateOutline,
    updateSelectedChapter,
    hydrateState,
    nextStep,
    prevStep,
    resetState,
  };
};
