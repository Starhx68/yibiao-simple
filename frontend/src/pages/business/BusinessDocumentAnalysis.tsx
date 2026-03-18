import React, { useState } from 'react';
import { ArrowUpTrayIcon } from '@heroicons/react/24/outline';

interface Props {
  projectId: string | null;
  onAnalysisComplete: (projectId: string) => void;
}

const BusinessDocumentAnalysis: React.FC<Props> = ({ projectId, onAnalysisComplete }) => {
  const [file, setFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      const validExtensions = ['.pdf', '.doc', '.docx'];
      const isValid = validExtensions.some(ext => 
        droppedFile.name.toLowerCase().endsWith(ext)
      );
      
      if (isValid) {
        setFile(droppedFile);
      } else {
        alert('仅支持 PDF 和 Word 文档格式');
      }
    }
  };

  const handleUploadAndAnalyze = async () => {
    if (!file) return;
    setAnalyzing(true);
    setProgressText('正在创建项目...');
    
    try {
      const token = localStorage.getItem('hxybs_token');
      const headers = {
        'Authorization': `Bearer ${token}`
      };

      // 1. Create project
      let currentProjectId = projectId;
      if (!currentProjectId) {
        const createRes = await fetch('/api/business-bids/', {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ project_name: file.name.split('.')[0] })
        });
        if (!createRes.ok) {
          const errData = await createRes.json().catch(() => ({}));
          throw new Error(errData.detail || '创建项目失败');
        }
        const createData = await createRes.json();
        currentProjectId = createData.id;
      }

      // 2. Upload tender document
      setProgressText('正在上传并解析文件...');
      const formData = new FormData();
      formData.append('file', file);
      const uploadRes = await fetch(`/api/business-bids/${currentProjectId}/upload-tender`, {
        method: 'POST',
        headers,
        body: formData
      });
      if (!uploadRes.ok) {
        const errData = await uploadRes.json().catch(() => ({}));
        throw new Error(errData.detail || '上传文件失败');
      }

      // 分析流调用已移至下一步 (ElementExtraction) 以优化UX
      setAnalyzing(false);
      onAnalysisComplete(currentProjectId!);
    } catch (error: any) {
      alert(error.message || '操作失败');
      setAnalyzing(false);
    }
  };

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <h2 className="text-lg font-medium mb-4">上传商务招标文件</h2>
      <div 
        className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
          isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-500'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <ArrowUpTrayIcon className={`mx-auto h-12 w-12 ${isDragging ? 'text-blue-500' : 'text-gray-400'}`} />
        <div className="mt-4 flex text-sm leading-6 text-gray-600 justify-center">
          <label className="relative cursor-pointer rounded-md bg-transparent font-semibold text-blue-600 focus-within:outline-none focus-within:ring-2 focus-within:ring-blue-600 focus-within:ring-offset-2 hover:text-blue-500">
            <span>选择文件</span>
            <input type="file" className="sr-only" onChange={handleFileChange} accept=".pdf,.doc,.docx" />
          </label>
          <p className="pl-1">或拖拽文件到这里</p>
        </div>
        <p className="text-xs leading-5 text-gray-500">支持 PDF 和 Word 文档，最大 10MB</p>
        {file && (
          <div className="mt-4 text-sm text-gray-900 font-medium">
            已选择: {file.name}
          </div>
        )}
      </div>

      <div className="mt-6 flex justify-end items-center gap-4">
        {analyzing && <span className="text-sm text-blue-600">{progressText}</span>}
        <button
          onClick={handleUploadAndAnalyze}
          disabled={!file || analyzing}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {analyzing ? '正在处理...' : '开始解析'}
        </button>
      </div>
    </div>
  );
};

export default BusinessDocumentAnalysis;
