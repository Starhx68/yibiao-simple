import React, { useEffect, useState } from 'react';
import { configApi, type OpenAIConfig } from '../services/authApi';

const InterfaceManagement: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [form, setForm] = useState<OpenAIConfig>({
    api_key: '',
    base_url: '',
    model_name: '',
    ocr_model: '',
  });

  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    configApi
      .load()
      .then((cfg) => {
        if (cancelled) return;
        setForm({
          api_key: cfg.api_key || '',
          base_url: cfg.base_url || '',
          model_name: cfg.model_name || '',
          ocr_model: cfg.ocr_model || '',
        });
      })
      .catch((e: any) => {
        if (cancelled) return;
        setMessage({ type: 'error', text: e?.response?.data?.detail || e?.message || '加载配置失败' });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await configApi.save(form);
      if (res.success) {
        setMessage({ type: 'success', text: res.message || '保存成功' });
      } else {
        setMessage({ type: 'error', text: res.message || '保存失败' });
      }
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.response?.data?.detail || e?.message || '保存失败' });
    } finally {
      setSaving(false);
    }
  };

  const handleLoadModels = async () => {
    setLoadingModels(true);
    setMessage(null);
    try {
      const res = await configApi.models(form);
      if (res.success) {
        setModels(res.models || []);
        setMessage({ type: 'success', text: res.message || '获取模型成功' });
      } else {
        setModels([]);
        setMessage({ type: 'error', text: res.message || '获取模型失败' });
      }
    } catch (e: any) {
      setModels([]);
      setMessage({ type: 'error', text: e?.response?.data?.detail || e?.message || '获取模型失败' });
    } finally {
      setLoadingModels(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-gray-500">加载中...</div>;
  }

  return (
    <div className="max-w-3xl">
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">接口管理</h2>
            <p className="text-sm text-gray-500 mt-1">配置大模型 API Key、Base URL 与模型名称</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleLoadModels}
              disabled={loadingModels}
              className="px-3 py-2 rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {loadingModels ? '获取中...' : '获取模型列表'}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-2 rounded-md border border-transparent bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? '保存中...' : '保存配置'}
            </button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">API Key</label>
            <input
              value={form.api_key}
              onChange={(e) => setForm((p) => ({ ...p, api_key: e.target.value }))}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              placeholder="sk-..."
              type="password"
              autoComplete="off"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Base URL</label>
            <input
              value={form.base_url}
              onChange={(e) => setForm((p) => ({ ...p, base_url: e.target.value }))}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              placeholder="https://api.openai.com/v1 或兼容地址"
              autoComplete="off"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">模型名称</label>
            <input
              value={form.model_name}
              onChange={(e) => setForm((p) => ({ ...p, model_name: e.target.value }))}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              placeholder="gpt-4.1-mini / gpt-4o-mini / ..."
              autoComplete="off"
            />
            {models.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {models.slice(0, 30).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, model_name: m }))}
                    className="px-2 py-1 rounded border border-gray-200 text-xs text-gray-700 hover:bg-gray-50"
                    title="点击填入模型名称"
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">OCR模型名称</label>
            <input
              value={form.ocr_model}
              onChange={(e) => setForm((p) => ({ ...p, ocr_model: e.target.value }))}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              placeholder="deepseek-ai/DeepSeek-OCR"
              autoComplete="off"
            />
            <p className="mt-1 text-xs text-gray-500">用于图片智能填充的专用模型，留空则使用默认模型</p>
          </div>
        </div>
      </div>

      {message && (
        <div
          className={[
            'mt-4 p-4 rounded-md border',
            message.type === 'success'
              ? 'bg-green-50 border-green-200 text-green-700'
              : 'bg-red-50 border-red-200 text-red-700',
          ].join(' ')}
        >
          {message.text}
        </div>
      )}
    </div>
  );
};

export default InterfaceManagement;
