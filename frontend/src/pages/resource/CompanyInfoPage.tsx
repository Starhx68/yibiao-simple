import React, { useEffect, useState } from 'react';
import type { CompanyInfo } from '../../types';
import { resourceApi } from '../../services/authApi';

const emptyForm: CompanyInfo = {
  company_name: '',
  company_type: '',
  legal_person: '',
  legal_person_gender: '',
  legal_person_birth_date: '',
  legal_person_id_number: '',
  legal_person_id_card_url: '',
  legal_person_id_valid_from: '',
  legal_person_id_valid_to: '',
  legal_person_id_long_term: false,
  legal_person_position: '',
  registered_capital: undefined,
  establish_date: '',
  operating_period_start: '',
  operating_period_end: '',
  operating_period_long_term: false,
  address: '',
  business_scope: '',
  credit_code: '',
  contact_person: '',
  contact_phone: '',
  contact_email: '',
  postal_code: '',
  registration_authority: '',
  authorized_person: '',
  authorized_person_gender: '',
  authorized_person_birth_date: '',
  authorized_person_id_number: '',
  authorized_person_id_card_url: '',
  authorized_person_id_valid_from: '',
  authorized_person_id_valid_to: '',
  authorized_person_id_long_term: false,
  authorized_person_position: '',
  authorized_person_phone: '',
  bank_name: '',
  bank_branch: '',
  bank_account_name: '',
  bank_account: '',
  bank_address: '',
  bank_license_url: '',
  bank_code: '',
  bank_phone: '',
  product_and_function: '',
  brand_resource_capability: '',
  personnel_technical_capability: '',
  related_image_url: '',
  logo_url: '',
  seal_url: '',
  business_license_url: '',
};

const COMPANY_UPLOAD_FIELDS: Array<keyof CompanyInfo> = [
  'logo_url',
  'seal_url',
  'business_license_url',
  'legal_person_id_card_url',
  'authorized_person_id_card_url',
  'bank_license_url',
  'related_image_url',
];

const CompanyInfoPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingField, setUploadingField] = useState<keyof CompanyInfo | null>(null);
  const [smartFilling, setSmartFilling] = useState(false);
  const [ocrResult, setOcrResult] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<CompanyInfo>(emptyForm);

  const load = async () => {
    setLoading(true);
    try {
      const data = await resourceApi.getCompanyInfo();
      setForm({ ...emptyForm, ...(data ?? {}) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setField = (field: keyof CompanyInfo, value: string | number | boolean | undefined) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await resourceApi.saveCompanyInfo(form);
      setForm({ ...emptyForm, ...saved });
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      const msg = Array.isArray(detail)
        ? detail.map((item: any) => `${item?.loc?.[item?.loc?.length - 1] || '字段'}: ${item?.msg || '格式错误'}`).join('\n')
        : (detail || error?.message || '保存失败');
      alert(msg);
    } finally {
      setSaving(false);
    }
  };

  const normalizeGender = (v: unknown) => {
    const s = String(v ?? '').trim();
    if (!s) return '';
    if (s === '男' || s.toLowerCase() === 'm' || s.toLowerCase() === 'male') return '男';
    if (s === '女' || s.toLowerCase() === 'f' || s.toLowerCase() === 'female') return '女';
    if (s.includes('男')) return '男';
    if (s.includes('女')) return '女';
    return s;
  };

  const handleUpload = async (field: keyof CompanyInfo, file: File) => {
    setUploadingField(field);
    try {
      const url = await resourceApi.uploadFile(file);
      setField(field, url);
      if (file.type.startsWith('image/')) {
        await handleSmartFill(field, file);
      }
    } finally {
      setUploadingField(null);
    }
  };

  const handleRemoveUpload = (field: keyof CompanyInfo) => {
    setField(field, '');
  };

  const handleSmartFill = async (field: keyof CompanyInfo, file: File) => {
    setSmartFilling(true);
    try {
      if (field === 'legal_person_id_card_url' || field === 'authorized_person_id_card_url') {
        const result = await resourceApi.smartFill('idcard', file, 'image_url');
        if (!result || typeof result !== 'object' || Array.isArray(result)) {
          throw new Error('识别结果为空或格式异常，请在接口管理中检查OCR模型配置');
        }
        setOcrResult(result);
        const r = result as Record<string, unknown>;
        const nextPatch: Partial<CompanyInfo> = {};
        const name = String(r.name ?? '').trim();
        const idNumber = String(r.id_number ?? '').trim();
        const gender = normalizeGender(r.gender);
        const birthDate = String(r.birth_date ?? '').trim();
        const validFrom = String(r.valid_from ?? '').trim();
        const validTo = String(r.valid_to ?? '').trim();
        const longTerm = Boolean(r.long_term);

        if (field === 'legal_person_id_card_url') {
          if (name) nextPatch.legal_person = name;
          if (idNumber) nextPatch.legal_person_id_number = idNumber;
          if (gender) nextPatch.legal_person_gender = gender;
          if (birthDate) nextPatch.legal_person_birth_date = birthDate;
          if (validFrom) nextPatch.legal_person_id_valid_from = validFrom;
          if (longTerm) {
            nextPatch.legal_person_id_long_term = true;
            nextPatch.legal_person_id_valid_to = '';
          } else if (validTo) {
            nextPatch.legal_person_id_valid_to = validTo;
            nextPatch.legal_person_id_long_term = false;
          }
        } else {
          if (name) nextPatch.authorized_person = name;
          if (idNumber) nextPatch.authorized_person_id_number = idNumber;
          if (gender) nextPatch.authorized_person_gender = gender;
          if (birthDate) nextPatch.authorized_person_birth_date = birthDate;
          if (validFrom) nextPatch.authorized_person_id_valid_from = validFrom;
          if (longTerm) {
            nextPatch.authorized_person_id_long_term = true;
            nextPatch.authorized_person_id_valid_to = '';
          } else if (validTo) {
            nextPatch.authorized_person_id_valid_to = validTo;
            nextPatch.authorized_person_id_long_term = false;
          }
        }

        setForm((prev) => ({ ...prev, ...nextPatch }));
        return;
      }

      if (field !== 'business_license_url' && field !== 'bank_license_url') return;

      const result = await resourceApi.smartFill('company', file, String(field));
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw new Error('识别结果为空或格式异常，请在接口管理中检查OCR模型配置');
      }
      setOcrResult(result);
      const merged = { ...(result as Partial<CompanyInfo>) };
      COMPANY_UPLOAD_FIELDS.forEach((field) => {
        delete merged[field];
      });
      setForm((prev) => ({ ...prev, ...merged }));
    } catch (error: any) {
      const msg = error?.response?.data?.detail || error?.message || '智能填充失败';
      alert(msg);
    } finally {
      setSmartFilling(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-gray-500">加载中...</div>;
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-gray-900">公司信息</h2>
        <div className="flex items-center gap-3">
          {smartFilling ? <span className="text-sm text-blue-600">识别中...</span> : null}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: '公司LOGO', field: 'logo_url' as keyof CompanyInfo },
            { label: '公司公章', field: 'seal_url' as keyof CompanyInfo },
            { label: '营业执照', field: 'business_license_url' as keyof CompanyInfo },
            { label: '法人身份证', field: 'legal_person_id_card_url' as keyof CompanyInfo },
            { label: '授权委托人身份证', field: 'authorized_person_id_card_url' as keyof CompanyInfo },
            { label: '开户许可证', field: 'bank_license_url' as keyof CompanyInfo },
            { label: '相关图片', field: 'related_image_url' as keyof CompanyInfo },
          ].map((item) => (
            <div key={item.field}>
              <div className="text-sm font-medium text-gray-700">{item.label}</div>
              <div className="mt-2 flex items-center gap-3">
                <label className="px-3 py-2 rounded-md border border-gray-200 text-sm cursor-pointer hover:bg-gray-50">
                  <span>{uploadingField === item.field ? '上传中...' : '上传并自动识别'}</span>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    disabled={uploadingField !== null}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) {
                        handleUpload(item.field, file);
                      }
                    }}
                  />
                </label>
              </div>
              {form[item.field] ? (
                <div className="mt-2">
                  <a href={String(form[item.field])} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:text-blue-800">
                    查看
                  </a>
                  {/\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(String(form[item.field])) ? (
                    <div className="relative mt-2 inline-block">
                      <img src={String(form[item.field])} alt={item.label} className="h-24 w-auto rounded-md border" />
                      <button
                        type="button"
                        onClick={() => handleRemoveUpload(item.field)}
                        className="absolute right-1 top-1 rounded bg-red-600 px-2 py-0.5 text-xs text-white hover:bg-red-700"
                      >
                        删除
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">公司名称</label>
            <input
              value={form.company_name ?? ''}
              onChange={(e) => setField('company_name', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">法定代表人</label>
            <input
              value={form.legal_person ?? ''}
              onChange={(e) => setField('legal_person', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">公司性质</label>
            <input
              value={form.company_type ?? ''}
              onChange={(e) => setField('company_type', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">法人身份证号</label>
            <input
              value={form.legal_person_id_number ?? ''}
              onChange={(e) => setField('legal_person_id_number', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">统一社会信用代码</label>
            <input
              value={form.credit_code ?? ''}
              onChange={(e) => setField('credit_code', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">成立日期</label>
            <input
              type="date"
              value={form.establish_date ?? ''}
              onChange={(e) => setField('establish_date', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">经营期限生效日期</label>
            <input
              type="date"
              value={form.operating_period_start ?? ''}
              onChange={(e) => setField('operating_period_start', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">经营期限失效日期</label>
            <input
              type="date"
              value={form.operating_period_end ?? ''}
              onChange={(e) => setField('operating_period_end', e.target.value)}
              disabled={!!form.operating_period_long_term}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md disabled:bg-gray-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">经营期限</label>
            <select
              value={form.operating_period_long_term ? '1' : '0'}
              onChange={(e) => setField('operating_period_long_term', e.target.value === '1')}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="0">有期限</option>
              <option value="1">长期</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">注册资本</label>
            <input
              type="number"
              value={form.registered_capital ?? ''}
              onChange={(e) => setField('registered_capital', e.target.value ? Number(e.target.value) : undefined)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">地址</label>
            <input
              value={form.address ?? ''}
              onChange={(e) => setField('address', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700">经营范围</label>
            <textarea
              value={form.business_scope ?? ''}
              onChange={(e) => setField('business_scope', e.target.value)}
              rows={4}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">联系人</label>
            <input
              value={form.contact_person ?? ''}
              onChange={(e) => setField('contact_person', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">联系电话</label>
            <input
              value={form.contact_phone ?? ''}
              onChange={(e) => setField('contact_phone', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">电子邮箱</label>
            <input
              type="email"
              value={form.contact_email ?? ''}
              onChange={(e) => setField('contact_email', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">邮政编码</label>
            <input
              value={form.postal_code ?? ''}
              onChange={(e) => setField('postal_code', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">登记机关</label>
            <input
              value={form.registration_authority ?? ''}
              onChange={(e) => setField('registration_authority', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">法定代表人性别</label>
            <select
              value={form.legal_person_gender ?? ''}
              onChange={(e) => setField('legal_person_gender', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="">请选择</option>
              <option value="男">男</option>
              <option value="女">女</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">法定代表人出生日期</label>
            <input
              type="date"
              value={form.legal_person_birth_date ?? ''}
              onChange={(e) => setField('legal_person_birth_date', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">法定代表人职位</label>
            <input
              value={form.legal_person_position ?? ''}
              onChange={(e) => setField('legal_person_position', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">法人身份证生效日期</label>
            <input
              type="date"
              value={form.legal_person_id_valid_from ?? ''}
              onChange={(e) => setField('legal_person_id_valid_from', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">法人身份证失效日期</label>
            <input
              type="date"
              value={form.legal_person_id_valid_to ?? ''}
              onChange={(e) => setField('legal_person_id_valid_to', e.target.value)}
              disabled={!!form.legal_person_id_long_term}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md disabled:bg-gray-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">法人身份证期限</label>
            <select
              value={form.legal_person_id_long_term ? '1' : '0'}
              onChange={(e) => setField('legal_person_id_long_term', e.target.value === '1')}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="0">有期限</option>
              <option value="1">长期</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">授权委托人</label>
            <input
              value={form.authorized_person ?? ''}
              onChange={(e) => setField('authorized_person', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">授权委托人性别</label>
            <select
              value={form.authorized_person_gender ?? ''}
              onChange={(e) => setField('authorized_person_gender', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="">请选择</option>
              <option value="男">男</option>
              <option value="女">女</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">授权委托人出生日期</label>
            <input
              type="date"
              value={form.authorized_person_birth_date ?? ''}
              onChange={(e) => setField('authorized_person_birth_date', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">授权委托人职位</label>
            <input
              value={form.authorized_person_position ?? ''}
              onChange={(e) => setField('authorized_person_position', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">授权委托人身份证生效日期</label>
            <input
              type="date"
              value={form.authorized_person_id_valid_from ?? ''}
              onChange={(e) => setField('authorized_person_id_valid_from', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">授权委托人身份证失效日期</label>
            <input
              type="date"
              value={form.authorized_person_id_valid_to ?? ''}
              onChange={(e) => setField('authorized_person_id_valid_to', e.target.value)}
              disabled={!!form.authorized_person_id_long_term}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md disabled:bg-gray-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">授权委托人身份证期限</label>
            <select
              value={form.authorized_person_id_long_term ? '1' : '0'}
              onChange={(e) => setField('authorized_person_id_long_term', e.target.value === '1')}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="0">有期限</option>
              <option value="1">长期</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">授权委托人身份证号</label>
            <input
              value={form.authorized_person_id_number ?? ''}
              onChange={(e) => setField('authorized_person_id_number', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">授权委托人电话</label>
            <input
              value={form.authorized_person_phone ?? ''}
              onChange={(e) => setField('authorized_person_phone', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">开户银行</label>
            <input
              value={form.bank_name ?? ''}
              onChange={(e) => setField('bank_name', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">银行行号</label>
            <input
              value={form.bank_code ?? ''}
              onChange={(e) => setField('bank_code', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">银行电话</label>
            <input
              value={form.bank_phone ?? ''}
              onChange={(e) => setField('bank_phone', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">开户支行</label>
            <input
              value={form.bank_branch ?? ''}
              onChange={(e) => setField('bank_branch', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">开户名</label>
            <input
              value={form.bank_account_name ?? ''}
              onChange={(e) => setField('bank_account_name', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">银行账号</label>
            <input
              value={form.bank_account ?? ''}
              onChange={(e) => setField('bank_account', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700">开户行开户地址</label>
            <input
              value={form.bank_address ?? ''}
              onChange={(e) => setField('bank_address', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700">产品及功能</label>
            <textarea
              rows={3}
              value={form.product_and_function ?? ''}
              onChange={(e) => setField('product_and_function', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700">品牌资源能力</label>
            <textarea
              rows={3}
              value={form.brand_resource_capability ?? ''}
              onChange={(e) => setField('brand_resource_capability', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700">人员技术能力</label>
            <textarea
              rows={3}
              value={form.personnel_technical_capability ?? ''}
              onChange={(e) => setField('personnel_technical_capability', e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
        </div>

        {ocrResult ? (
          <div className="mt-6">
            <div className="text-sm font-medium text-gray-700 mb-2">智能填充结果</div>
            <pre className="text-xs bg-gray-50 border border-gray-200 rounded-md p-3 overflow-auto whitespace-pre-wrap">
              {JSON.stringify(ocrResult, null, 2)}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default CompanyInfoPage;
