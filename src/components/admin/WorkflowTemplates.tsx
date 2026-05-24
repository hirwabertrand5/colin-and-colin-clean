import { useEffect, useMemo, useState } from 'react';
import {
  listAllWorkflowTemplates,
  createWorkflowTemplate,
  updateWorkflowTemplate,
  deleteWorkflowTemplate,
} from '../../services/workflowService';

type CaseType = 'Transactional Cases' | 'Litigation Cases' | 'Labor Cases';

type TemplateStageForm = { key: string; title: string; order?: number };
type TemplateStepForm = {
  key?: string;
  order?: number;
  stageKey?: string;
  title?: string;
  responsibleRole?: string;
  actionsText?: string; // one per line
  outputsText?: string; // one per line
  legalBasisText?: string; // one per line
  feeAmount?: number;
  feeCurrency?: string;
  feeText?: string;
  slaValue?: number;
  slaUnit?: 'hours' | 'days' | 'weeks';
  slaText?: string;
};

type TemplateForm = {
  name: string;
  matterType: string;
  caseType: CaseType;
  version: number;
  active: boolean;
  stages: TemplateStageForm[];
  steps: TemplateStepForm[];
};

type Template = any;

const NEW_ID = '__new__';

function splitLines(text: string | undefined) {
  return (text || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function joinLines(lines: string[] | undefined) {
  return (lines || []).filter(Boolean).join('\n');
}

function templateToForm(t: Template): TemplateForm {
  const stagesRaw = Array.isArray(t?.stages) ? t.stages : [];
  const stepsRaw = Array.isArray(t?.steps) ? t.steps : [];

  const stages: TemplateStageForm[] = stagesRaw
    .map((s: any) => ({
      key: String(s?.key || ''),
      title: String(s?.title || ''),
      order: typeof s?.order === 'number' ? s.order : undefined,
    }))
    .filter((s: TemplateStageForm) => s.key || s.title);

  const steps: TemplateStepForm[] = stepsRaw
    .map((s: any) => ({
      key: typeof s?.key === 'string' ? s.key : undefined,
      order: typeof s?.order === 'number' ? s.order : undefined,
      stageKey: typeof s?.stageKey === 'string' ? s.stageKey : undefined,
      title: typeof s?.title === 'string' ? s.title : undefined,
      responsibleRole: typeof s?.responsibleRole === 'string' ? s.responsibleRole : undefined,
      actionsText: joinLines(Array.isArray(s?.actions) ? s.actions : []),
      outputsText: joinLines(
        Array.isArray(s?.outputs)
          ? s.outputs
              .map((o: any) => {
                if (typeof o === 'string') return o;
                return o?.name || o?.title || o?.text || '';
              })
              .filter(Boolean)
          : [],
      ),
      legalBasisText: joinLines(
        Array.isArray(s?.legalBasis)
          ? s.legalBasis
              .map((b: any) => (typeof b === 'string' ? b : b?.text || b?.title || ''))
              .filter(Boolean)
          : [],
      ),
      feeAmount: typeof s?.fee?.min === 'number' ? s.fee.min : typeof s?.fee?.max === 'number' ? s.fee.max : undefined,
      feeCurrency: typeof s?.fee?.currency === 'string' ? s.fee.currency : 'RWF',
      feeText: typeof s?.fee === 'string' ? s.fee : s?.fee?.text || '',
      slaValue: typeof s?.sla?.max === 'number' ? s.sla.max : typeof s?.sla?.min === 'number' ? s.sla.min : undefined,
      slaUnit: typeof s?.sla?.unit === 'string' ? s.sla.unit : 'days',
      slaText: typeof s?.sla === 'string' ? s.sla : s?.sla?.text || '',
    }))
    .filter((s: TemplateStepForm) => s.order != null || s.title || s.stageKey);

  return {
    name: String(t?.name || ''),
    matterType: String(t?.matterType || ''),
    caseType: (t?.caseType as CaseType) || 'Transactional Cases',
    version: typeof t?.version === 'number' ? t.version : 1,
    active: Boolean(t?.active ?? true),
    stages,
    steps,
  };
}

function formToPayload(form: TemplateForm) {
  const stages = (form.stages || [])
    .map((s) => ({
      key: (s.key || '').trim(),
      title: (s.title || '').trim(),
      ...(typeof s.order === 'number' ? { order: s.order } : {}),
    }))
    .filter((s) => s.key && s.title);

  const steps = (form.steps || [])
    .map((s) => {
      const actions = splitLines(s.actionsText);
      const outputs = splitLines(s.outputsText);
      const legalBasis = splitLines(s.legalBasisText);
      const feeText = (s.feeText || '').trim();
      const feeAmount = typeof s.feeAmount === 'number' && Number.isFinite(s.feeAmount) ? s.feeAmount : undefined;
      const feeCurrency = (s.feeCurrency || '').trim();

      const slaText = (s.slaText || '').trim();
      const slaValue = typeof s.slaValue === 'number' && Number.isFinite(s.slaValue) ? s.slaValue : undefined;
      const slaUnit = s.slaUnit;

      return {
        ...(s.key ? { key: s.key } : {}),
        ...(typeof s.order === 'number' ? { order: s.order } : {}),
        ...(s.stageKey ? { stageKey: s.stageKey } : {}),
        ...(s.title ? { title: s.title } : {}),
        ...(s.responsibleRole?.trim() ? { responsibleRole: s.responsibleRole.trim() } : {}),
        ...(actions.length ? { actions } : {}),
        ...(outputs.length ? { outputs } : {}),
        ...(legalBasis.length ? { legalBasis } : {}),
        ...(feeAmount != null
          ? { fee: { type: 'fixed', min: feeAmount, currency: feeCurrency || 'RWF', ...(feeText ? { text: feeText } : {}) } }
          : feeText
            ? { fee: { type: 'text', text: feeText } }
            : {}),
        ...(slaValue != null
          ? { sla: { unit: slaUnit || 'days', max: slaValue, ...(slaText ? { text: slaText } : {}) } }
          : slaText
            ? { sla: { text: slaText } }
            : {}),
      };
    })
    .filter((s) => s.order != null || s.title || s.stageKey);

  return {
    name: (form.name || '').trim(),
    matterType: (form.matterType || '').trim(),
    caseType: form.caseType,
    version: Number.isFinite(form.version) ? form.version : 1,
    active: Boolean(form.active),
    stages,
    steps,
  };
}

export default function WorkflowTemplates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const [selected, setSelected] = useState<Template | null>(null);
  const [form, setForm] = useState<TemplateForm | null>(null);

  const load = async () => {
    setLoading(true);
    setErr('');
    try {
      const data = await listAllWorkflowTemplates();
      setTemplates(data);
    } catch (e: any) {
      setErr(e.message || 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const onSelect = (t: Template) => {
    setSelected(t);
    const nextForm = templateToForm(t);
    setForm(nextForm);
  };

  const validationError = useMemo(() => {
    if (!selected || !form) return '';
    if (!form.name.trim()) return 'Name is required.';
    if (!form.matterType.trim()) return 'Matter type is required.';
    if (!form.caseType) return 'Case type is required.';
    if (!Number.isFinite(form.version) || form.version < 1) return 'Version must be a positive number.';

    const stageKeys = new Set<string>();
    for (const s of form.stages || []) {
      const key = (s.key || '').trim();
      const title = (s.title || '').trim();
      if (!key && !title) continue;
      if (!key) return 'Every stage needs a key.';
      if (!title) return 'Every stage needs a title.';
      if (stageKeys.has(key)) return `Duplicate stage key: ${key}`;
      stageKeys.add(key);
    }

    for (const [idx, step] of (form.steps || []).entries()) {
      if (step.order == null && !step.title && !step.stageKey) continue;
      if (step.order == null || !Number.isFinite(step.order)) return `Step ${idx + 1}: order is required.`;
      if (!step.title?.trim()) return `Step ${idx + 1}: title is required.`;
      if (!step.stageKey?.trim()) return `Step ${idx + 1}: stage is required.`;
      if (stageKeys.size && !stageKeys.has(step.stageKey.trim()))
        return `Step ${idx + 1}: stageKey "${step.stageKey}" is not in stages.`;
    }

    return '';
  }, [form, selected]);

  const onSave = async () => {
    if (!selected) return;
    try {
      setErr('');
      if (!form) return;
      if (validationError) throw new Error(validationError);

      const payload = formToPayload(form);
      if (selected._id === NEW_ID) {
        const created = await createWorkflowTemplate(payload);
        await load();
        setSelected(created);
        setForm(templateToForm(created));
        alert('Template created');
      } else {
        const updated = await updateWorkflowTemplate(selected._id, payload);
        await load();
        setSelected(updated);
        setForm(templateToForm(updated));
        alert('Template saved');
      }
    } catch (e: any) {
      setErr(e.message || 'Failed to save template');
    }
  };

  const onCreate = async () => {
    try {
      setErr('');
      const draft = {
        _id: NEW_ID,
        name: 'New Template',
        matterType: 'New Matter Type',
        caseType: 'Transactional Cases' as const,
        version: 1,
        active: true,
        stages: [
          { key: 'intake', title: 'Intake', order: 1 },
          { key: 'execution', title: 'Execution', order: 2 },
        ],
        steps: [
          {
            order: 1,
            stageKey: 'intake',
            title: 'Initial review',
            actions: ['Collect documents', 'Open file'],
            outputs: ['Client ID', 'Engagement letter'],
            legalBasis: [],
            fee: { type: 'fixed', min: 0, currency: 'RWF' },
            sla: { unit: 'days', max: 1 },
          },
          {
            order: 2,
            stageKey: 'execution',
            title: 'Deliver service',
            actions: ['Prepare work product', 'Send update to client'],
            outputs: ['Deliverable'],
            legalBasis: [],
            fee: { type: 'fixed', min: 0, currency: 'RWF' },
            sla: { unit: 'days', max: 7 },
          },
        ],
      };
      setSelected(draft);
      const nextForm = templateToForm(draft);
      setForm(nextForm);
    } catch (e: any) {
      setErr(e.message || 'Failed to create template');
    }
  };

  const onDelete = async (id: string) => {
    if (!confirm('Delete this template?')) return;
    try {
      await deleteWorkflowTemplate(id);
      setSelected(null);
      setForm(null);
      await load();
    } catch (e: any) {
      setErr(e.message || 'Failed to delete template');
    }
  };

  const stageOptions = useMemo(() => {
    const stages = form?.stages || [];
    return stages
      .map((s) => ({ key: (s.key || '').trim(), title: (s.title || '').trim() }))
      .filter((s) => s.key);
  }, [form?.stages]);

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Workflow Templates</h2>
          <p className="text-sm text-gray-500">Edit SOP templates used to generate case workflows.</p>
        </div>

        <button onClick={onCreate} className="px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800">
          New Template
        </button>
      </div>

      {err && <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 text-red-700 rounded">{err}</div>}
      {loading && <div className="text-gray-500">Loading...</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="border border-gray-200 rounded p-3 space-y-2">
          {templates.map((t) => (
            <div
              key={t._id}
              onClick={() => onSelect(t)}
              className={`p-3 rounded border cursor-pointer ${
                selected?._id === t._id ? 'border-gray-900 bg-gray-50' : 'border-gray-200'
              }`}
            >
              <div className="font-medium text-gray-900">{t.matterType}</div>
              <div className="text-xs text-gray-500">
                {t.name} • {t.active ? 'Active' : 'Inactive'}
              </div>
              <div className="text-xs text-gray-500">CaseType: {t.caseType}</div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(t._id);
                }}
                className="mt-2 text-xs text-red-700 underline"
              >
                Delete
              </button>
            </div>
          ))}

          {selected?._id === NEW_ID && (
            <div className="p-3 rounded border border-gray-900 bg-gray-50">
              <div className="font-medium text-gray-900">{form?.matterType || 'New Matter Type'}</div>
              <div className="text-xs text-gray-500">{form?.name || 'New Template'} • Draft</div>
              <div className="text-xs text-gray-500">CaseType: {form?.caseType || 'Transactional Cases'}</div>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 border border-gray-200 rounded p-3">
          {!selected ? (
            <div className="text-gray-500">Select a template to edit.</div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <div className="font-semibold text-gray-900">
                  {selected._id === NEW_ID ? 'New Template' : 'Edit Template'}
                </div>
                <button onClick={onSave} className="px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800">
                  Save
                </button>
              </div>

              <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                <div className="text-sm font-semibold text-gray-900">Guided template builder</div>
                <p className="text-xs text-gray-500 mt-1">
                  Add stages, then add steps under those stages. Key actions become the checklist users complete inside each case.
                </p>
                {validationError && <div className="mt-2 text-xs text-red-700">{validationError}</div>}
              </div>

              <>
                  {!form ? (
                    <div className="text-sm text-gray-500">Loading template…</div>
                  ) : (
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Template name</label>
                          <input
                            type="text"
                            value={form.name}
                            onChange={(e) => setForm((f) => (f ? { ...f, name: e.target.value } : f))}
                            className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Matter type</label>
                          <input
                            type="text"
                            value={form.matterType}
                            onChange={(e) => setForm((f) => (f ? { ...f, matterType: e.target.value } : f))}
                            className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Case type</label>
                          <select
                            value={form.caseType}
                            onChange={(e) =>
                              setForm((f) => (f ? { ...f, caseType: e.target.value as CaseType } : f))
                            }
                            className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
                          >
                            <option value="Transactional Cases">Transactional Cases</option>
                            <option value="Litigation Cases">Litigation Cases</option>
                            <option value="Labor Cases">Labor Cases</option>
                          </select>
                        </div>
                        <div className="grid grid-cols-2 gap-4 items-end">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Version</label>
                            <input
                              type="number"
                              min={1}
                              value={form.version}
                              onChange={(e) =>
                                setForm((f) => (f ? { ...f, version: Number(e.target.value || 1) } : f))
                              }
                              className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
                            />
                          </div>
                          <label className="flex items-center gap-2 pb-2">
                            <input
                              type="checkbox"
                              checked={form.active}
                              onChange={(e) => setForm((f) => (f ? { ...f, active: e.target.checked } : f))}
                              className="w-4 h-4 rounded border-gray-300"
                            />
                            <span className="text-sm text-gray-900">Active</span>
                          </label>
                        </div>
                      </div>

                      <div className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <div className="text-sm font-semibold text-gray-900">Stages</div>
                            <div className="text-xs text-gray-500">Define stage keys used by steps.</div>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setForm((f) =>
                                f
                                  ? {
                                      ...f,
                                      stages: [...(f.stages || []), { key: '', title: '', order: (f.stages?.length || 0) + 1 }],
                                    }
                                  : f,
                              )
                            }
                            className="px-3 py-1.5 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50"
                          >
                            Add stage
                          </button>
                        </div>

                        <div className="space-y-2">
                          {(form.stages || []).length === 0 ? (
                            <div className="text-sm text-gray-500">No stages yet.</div>
                          ) : (
                            form.stages.map((s, idx) => (
                              <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                                <div className="md:col-span-3">
                                  <label className="block text-xs text-gray-600 mb-1">Key</label>
                                  <input
                                    type="text"
                                    value={s.key}
                                    onChange={(e) =>
                                      setForm((f) => {
                                        if (!f) return f;
                                        const next = [...f.stages];
                                        next[idx] = { ...next[idx], key: e.target.value };
                                        return { ...f, stages: next };
                                      })
                                    }
                                    className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                                  />
                                </div>
                                <div className="md:col-span-6">
                                  <label className="block text-xs text-gray-600 mb-1">Title</label>
                                  <input
                                    type="text"
                                    value={s.title}
                                    onChange={(e) =>
                                      setForm((f) => {
                                        if (!f) return f;
                                        const next = [...f.stages];
                                        next[idx] = { ...next[idx], title: e.target.value };
                                        return { ...f, stages: next };
                                      })
                                    }
                                    className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                                  />
                                </div>
                                <div className="md:col-span-2">
                                  <label className="block text-xs text-gray-600 mb-1">Order</label>
                                  <input
                                    type="number"
                                    min={1}
                                    value={s.order ?? ''}
                                    onChange={(e) =>
                                      setForm((f) => {
                                        if (!f) return f;
                                        const next = [...f.stages];
                                        const val = e.target.value === '' ? undefined : Number(e.target.value);
                                        next[idx] = { ...next[idx], order: Number.isFinite(val as number) ? (val as number) : undefined };
                                        return { ...f, stages: next };
                                      })
                                    }
                                    className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                                  />
                                </div>
                                <div className="md:col-span-1 flex justify-end">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setForm((f) => {
                                        if (!f) return f;
                                        const next = [...f.stages];
                                        next.splice(idx, 1);
                                        return { ...f, stages: next };
                                      })
                                    }
                                    className="text-sm text-red-700 underline"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      <div className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <div className="text-sm font-semibold text-gray-900">Steps</div>
                            <div className="text-xs text-gray-500">One step = one row in the case workflow.</div>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setForm((f) =>
                                f
                                  ? {
                                      ...f,
                                      steps: [
                                        ...(f.steps || []),
                                        {
                                          order: (f.steps?.length || 0) + 1,
                                          stageKey: stageOptions[0]?.key || '',
                                          title: '',
                                          responsibleRole: '',
                                          actionsText: '',
                                          outputsText: '',
                                          legalBasisText: '',
                                          feeAmount: undefined,
                                          feeCurrency: 'RWF',
                                          feeText: '',
                                          slaValue: undefined,
                                          slaUnit: 'days',
                                          slaText: '',
                                        },
                                      ],
                                    }
                                  : f,
                              )
                            }
                            className="px-3 py-1.5 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50"
                          >
                            Add step
                          </button>
                        </div>

                        <div className="space-y-3">
                          {(form.steps || []).length === 0 ? (
                            <div className="text-sm text-gray-500">No steps yet.</div>
                          ) : (
                            form.steps.map((s, idx) => (
                              <div key={idx} className="border border-gray-200 rounded-lg p-3">
                                <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                                  <div className="md:col-span-2">
                                    <label className="block text-xs text-gray-600 mb-1">Order</label>
                                    <input
                                      type="number"
                                      min={1}
                                      value={s.order ?? ''}
                                      onChange={(e) =>
                                        setForm((f) => {
                                          if (!f) return f;
                                          const next = [...f.steps];
                                          next[idx] = {
                                            ...next[idx],
                                            order: e.target.value === '' ? undefined : Number(e.target.value),
                                          };
                                          return { ...f, steps: next };
                                        })
                                      }
                                      className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                                    />
                                  </div>
                                  <div className="md:col-span-4">
                                    <label className="block text-xs text-gray-600 mb-1">Stage</label>
                                    <select
                                      value={s.stageKey || ''}
                                      onChange={(e) =>
                                        setForm((f) => {
                                          if (!f) return f;
                                          const next = [...f.steps];
                                          next[idx] = { ...next[idx], stageKey: e.target.value };
                                          return { ...f, steps: next };
                                        })
                                      }
                                      className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                                    >
                                      <option value="">Select stage…</option>
                                      {stageOptions.map((st) => (
                                        <option key={st.key} value={st.key}>
                                          {st.title} ({st.key})
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="md:col-span-3">
                                    <label className="block text-xs text-gray-600 mb-1">Responsible role</label>
                                    <input
                                      type="text"
                                      value={s.responsibleRole || ''}
                                      onChange={(e) =>
                                        setForm((f) => {
                                          if (!f) return f;
                                          const next = [...f.steps];
                                          next[idx] = { ...next[idx], responsibleRole: e.target.value };
                                          return { ...f, steps: next };
                                        })
                                      }
                                      placeholder="e.g., Associate / Trainee Associate"
                                      className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                                    />
                                  </div>
                                  <div className="md:col-span-5">
                                    <label className="block text-xs text-gray-600 mb-1">Title</label>
                                    <input
                                      type="text"
                                      value={s.title || ''}
                                      onChange={(e) =>
                                        setForm((f) => {
                                          if (!f) return f;
                                          const next = [...f.steps];
                                          next[idx] = { ...next[idx], title: e.target.value };
                                          return { ...f, steps: next };
                                        })
                                      }
                                      className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                                    />
                                  </div>
                                  <div className="md:col-span-1 flex justify-end">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setForm((f) => {
                                          if (!f) return f;
                                          const next = [...f.steps];
                                          next.splice(idx, 1);
                                          return { ...f, steps: next };
                                        })
                                      }
                                      className="text-sm text-red-700 underline"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                                  <div>
                                    <label className="block text-xs text-gray-600 mb-1">Key actions (one per line)</label>
                                    <textarea
                                      value={s.actionsText || ''}
                                      onChange={(e) =>
                                        setForm((f) => {
                                          if (!f) return f;
                                          const next = [...f.steps];
                                          next[idx] = { ...next[idx], actionsText: e.target.value };
                                          return { ...f, steps: next };
                                        })
                                      }
                                      rows={4}
                                      className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs text-gray-600 mb-1">Outputs (one per line)</label>
                                    <textarea
                                      value={s.outputsText || ''}
                                      onChange={(e) =>
                                        setForm((f) => {
                                          if (!f) return f;
                                          const next = [...f.steps];
                                          next[idx] = { ...next[idx], outputsText: e.target.value };
                                          return { ...f, steps: next };
                                        })
                                      }
                                      rows={4}
                                      className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-xs text-gray-600 mb-1">Legal basis (one per line)</label>
                                    <textarea
                                      value={s.legalBasisText || ''}
                                      onChange={(e) =>
                                        setForm((f) => {
                                          if (!f) return f;
                                          const next = [...f.steps];
                                          next[idx] = { ...next[idx], legalBasisText: e.target.value };
                                          return { ...f, steps: next };
                                        })
                                      }
                                      rows={3}
                                      className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                                    />
                                  </div>
                                  <div className="grid grid-cols-1 gap-3">
                                    <div>
                                      <label className="block text-xs text-gray-600 mb-1">Billing value</label>
                                      <div className="grid grid-cols-2 gap-2">
                                        <input
                                          type="number"
                                          min={0}
                                          value={s.feeAmount ?? ''}
                                          onChange={(e) =>
                                            setForm((f) => {
                                              if (!f) return f;
                                              const next = [...f.steps];
                                              next[idx] = {
                                                ...next[idx],
                                                feeAmount: e.target.value === '' ? undefined : Number(e.target.value),
                                              };
                                              return { ...f, steps: next };
                                            })
                                          }
                                          placeholder="25000"
                                          className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                                        />
                                        <input
                                          type="text"
                                          value={s.feeCurrency || ''}
                                          onChange={(e) =>
                                            setForm((f) => {
                                              if (!f) return f;
                                              const next = [...f.steps];
                                              next[idx] = { ...next[idx], feeCurrency: e.target.value };
                                              return { ...f, steps: next };
                                            })
                                          }
                                          placeholder="RWF"
                                          className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                                        />
                                      </div>
                                      <input
                                        type="text"
                                        value={s.feeText || ''}
                                        onChange={(e) =>
                                          setForm((f) => {
                                            if (!f) return f;
                                            const next = [...f.steps];
                                            next[idx] = { ...next[idx], feeText: e.target.value };
                                            return { ...f, steps: next };
                                          })
                                        }
                                        placeholder="Optional notes (e.g., Draft demand letter)"
                                        className="mt-2 w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs text-gray-600 mb-1">Timeframe / SLA</label>
                                      <div className="grid grid-cols-2 gap-2">
                                        <input
                                          type="number"
                                          min={0}
                                          value={s.slaValue ?? ''}
                                          onChange={(e) =>
                                            setForm((f) => {
                                              if (!f) return f;
                                              const next = [...f.steps];
                                              next[idx] = {
                                                ...next[idx],
                                                slaValue: e.target.value === '' ? undefined : Number(e.target.value),
                                              };
                                              return { ...f, steps: next };
                                            })
                                          }
                                          placeholder="48"
                                          className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                                        />
                                        <select
                                          value={s.slaUnit || 'days'}
                                          onChange={(e) =>
                                            setForm((f) => {
                                              if (!f) return f;
                                              const next = [...f.steps];
                                              next[idx] = { ...next[idx], slaUnit: e.target.value as any };
                                              return { ...f, steps: next };
                                            })
                                          }
                                          className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                                        >
                                          <option value="hours">Hours</option>
                                          <option value="days">Days</option>
                                          <option value="weeks">Weeks</option>
                                        </select>
                                      </div>
                                      <input
                                        type="text"
                                        value={s.slaText || ''}
                                        onChange={(e) =>
                                          setForm((f) => {
                                            if (!f) return f;
                                            const next = [...f.steps];
                                            next[idx] = { ...next[idx], slaText: e.target.value };
                                            return { ...f, steps: next };
                                          })
                                        }
                                        placeholder="Optional notes"
                                        className="mt-2 w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                                      />
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
