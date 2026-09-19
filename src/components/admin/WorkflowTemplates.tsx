import { useEffect, useMemo, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import {
  createWorkflowTemplate,
  deleteWorkflowTemplate,
  listAllWorkflowTemplates,
  updateWorkflowTemplate,
} from '../../services/workflowService';

type CaseType = 'Transactional Cases' | 'Litigation Cases' | 'Labor Cases';
type FeeType = 'none' | 'fixed' | 'range' | 'percentage' | 'text' | 'included';
type SlaUnit = 'hours' | 'days' | 'weeks';
type Template = any;

type Output = { id: string; key: string; name: string; category: string; required: boolean };
type LegalBasis = { id: string; text: string };
type Fee = { type: FeeType; min: string; max: string; currency: string; percentage: string; text: string };
type Timeline = { min: string; max: string; unit: SlaUnit; text: string };
type WorkflowAction = {
  id: string;
  key: string;
  stageKey: string;
  title: string;
  order: number;
  percentageText: string;
  responsibleRole: string;
  checklistText: string;
  outputs: Output[];
  legalBasis: LegalBasis[];
  fee: Fee;
  timeline: Timeline;
  legacy: boolean;
};
type Stage = { id: string; key: string; title: string; description: string; order: number; legacyPercentage?: number };
type Form = { name: string; matterType: string; caseType: CaseType; active: boolean; stages: Stage[]; actions: WorkflowAction[] };

const NEW_ID = '__new__';
let sequence = 0;
const id = (prefix: string) => `${prefix}_${Date.now()}_${++sequence}`;
const input = 'w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400';
const smallInput = 'w-full rounded border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400';
const secondary = 'rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50';
const splitLines = (value: string) => value.split('\n').map((item) => item.trim()).filter(Boolean);
const toNumber = (value: string) => /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value.trim()) : undefined;
const toPercentage = (value: string) => toNumber(value.trim().replace(/%$/, '').trim());
const percent = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value) ? `${value}%` : '—';

function uniqueKey(raw: string, used: Set<string>) {
  const base = raw.trim().replace(/\s+/g, '_') || 'item';
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}_${suffix++}`;
  return candidate;
}

function newAction(stageKey: string, order: number, key: string): WorkflowAction {
  return {
    id: id('action'), key, stageKey, title: '', order, percentageText: '', responsibleRole: '', checklistText: '', outputs: [], legalBasis: [],
    fee: { type: 'none', min: '', max: '', currency: 'RWF', percentage: '', text: '' },
    timeline: { min: '', max: '', unit: 'days', text: '' }, legacy: false,
  };
}

function blankForm(): Form {
  return { name: '', matterType: '', caseType: 'Transactional Cases', active: true, stages: [], actions: [] };
}

function templateToForm(template: Template): Form {
  const stages = (Array.isArray(template?.stages) ? template.stages : [])
    .map((stage: any, index: number): Stage => ({
      id: id('stage'), key: String(stage?.key || ''), title: String(stage?.title || stage?.name || ''), description: String(stage?.description || ''),
      order: typeof stage?.order === 'number' ? stage.order : index + 1,
      legacyPercentage: typeof stage?.percentage === 'number' ? stage.percentage : undefined,
    }))
    .sort((a: Stage, b: Stage) => a.order - b.order);

  const actions = (Array.isArray(template?.steps) ? template.steps : [])
    .map((step: any, index: number): WorkflowAction => {
      const fee = typeof step?.fee === 'object' && step.fee ? step.fee : {};
      const timeline = typeof step?.sla === 'object' && step.sla ? step.sla : {};
      const feeType: FeeType = ['fixed', 'range', 'percentage', 'text', 'included'].includes(fee.type) ? fee.type : fee.text ? 'text' : 'none';
      return {
        id: id('action'), key: String(step?.key || ''), stageKey: String(step?.stageKey || ''), title: String(step?.title || ''),
        order: typeof step?.order === 'number' ? step.order : index + 1,
        percentageText: typeof step?.percentage === 'number' ? String(step.percentage) : '',
        responsibleRole: String(step?.responsibleRole || ''),
        checklistText: Array.isArray(step?.actions) ? step.actions.map(String).join('\n') : '',
        outputs: Array.isArray(step?.outputs) ? step.outputs.map((output: any, outputIndex: number): Output => ({
          id: id('output'), key: String(typeof output === 'object' ? output?.key || '' : ''), name: String(typeof output === 'string' ? output : output?.name || ''),
          category: String(typeof output === 'object' ? output?.category || '' : ''), required: Boolean(typeof output === 'object' ? output?.required : false),
        })) : [],
        legalBasis: Array.isArray(step?.legalBasis) ? step.legalBasis.map((basis: any): LegalBasis => ({ id: id('basis'), text: String(typeof basis === 'string' ? basis : basis?.text || '') })) : [],
        fee: { type: feeType, min: typeof fee.min === 'number' ? String(fee.min) : '', max: typeof fee.max === 'number' ? String(fee.max) : '', currency: String(fee.currency || 'RWF'), percentage: typeof fee.percentage === 'number' ? String(fee.percentage) : '', text: String(fee.text || '') },
        timeline: { min: typeof timeline.min === 'number' ? String(timeline.min) : '', max: typeof timeline.max === 'number' ? String(timeline.max) : '', unit: ['hours', 'days', 'weeks'].includes(timeline.unit) ? timeline.unit : 'days', text: String(timeline.text || '') },
        legacy: typeof step?.percentage !== 'number',
      };
    })
    .sort((a: WorkflowAction, b: WorkflowAction) => a.order - b.order);

  return { name: String(template?.name || ''), matterType: String(template?.matterType || ''), caseType: template?.caseType || 'Transactional Cases', active: Boolean(template?.active), stages, actions };
}

function workflowAllocation(form: Form) {
  const allocatedActions = form.actions.filter((action) => toPercentage(action.percentageText) !== undefined);
  const actionBased = allocatedActions.length > 0 || form.actions.some((action) => !action.legacy);
  const total = actionBased
    ? allocatedActions.reduce((sum, action) => sum + (toPercentage(action.percentageText) || 0), 0)
    : form.stages.reduce((sum, stage) => sum + (stage.legacyPercentage || 0), 0);
  return { actionBased, total: Math.round(total * 10000) / 10000, remaining: Math.round((100 - total) * 10000) / 10000 };
}

function stageAllocation(stage: Stage, actions: WorkflowAction[]) {
  const actionPercentages = actions.map((action) => toPercentage(action.percentageText));
  if (actions.length && actionPercentages.every((value) => value !== undefined)) return actionPercentages.reduce((sum, value) => sum + (value || 0), 0);
  return stage.legacyPercentage;
}

function validate(form: Form, draft: boolean) {
  const errors: string[] = [];
  if (!form.name.trim()) errors.push('Procedure name is required.');
  if (!form.matterType.trim()) errors.push('Matter type is required.');
  const allocation = workflowAllocation(form);
  if (allocation.total > 100) errors.push(`Total PERCENTAGE exceeds 100% by ${Math.round((allocation.total - 100) * 100) / 100}%.`);
  if (draft) return errors;
  if (!form.stages.length) errors.push('Add at least one STAGE.');
  if (!form.actions.length) errors.push('Add at least one KEY ACTION.');
  const stageKeys = new Set<string>();
  form.stages.forEach((stage, index) => {
    if (!stage.key.trim()) errors.push(`SECTION ${index + 1} needs a stage key.`);
    if (!stage.title.trim()) errors.push(`SECTION ${index + 1} needs a STAGE name.`);
    if (stage.key.trim() && stageKeys.has(stage.key.trim())) errors.push(`Stage key "${stage.key}" is duplicated.`);
    if (stage.key.trim()) stageKeys.add(stage.key.trim());
  });
  form.actions.forEach((action, index) => {
    if (!action.key.trim()) errors.push(`KEY ACTION ${index + 1} needs a workflow step key.`);
    if (!action.title.trim()) errors.push(`KEY ACTION ${index + 1} is required.`);
    if (!stageKeys.has(action.stageKey.trim())) errors.push(`KEY ACTION ${index + 1} must belong to a STAGE.`);
    const value = toPercentage(action.percentageText);
    if (allocation.actionBased && value === undefined) errors.push(`KEY ACTION ${index + 1} needs a valid PERCENTAGE.`);
    if (value !== undefined && (value < 0 || value > 100)) errors.push(`KEY ACTION ${index + 1} PERCENTAGE must be between 0% and 100%.`);
    if (action.outputs.some((output) => !output.name.trim())) errors.push(`Every OUTPUT for KEY ACTION ${index + 1} needs a name.`);
    if (action.legalBasis.some((basis) => !basis.text.trim())) errors.push(`Every LEGAL BASIS entry for KEY ACTION ${index + 1} needs text.`);
  });
  return Array.from(new Set(errors));
}

function formToPayload(form: Form, draft: boolean, legacyVersion: unknown) {
  const stages = [...form.stages].sort((a, b) => a.order - b.order).map((stage, index) => {
    const value = stageAllocation(stage, form.actions.filter((action) => action.stageKey === stage.key));
    return { key: stage.key.trim(), title: stage.title.trim(), order: index + 1, ...(stage.description.trim() ? { description: stage.description.trim() } : {}), ...(value !== undefined ? { percentage: value } : {}) };
  });
  const steps = [...form.actions].sort((a, b) => a.order - b.order).map((action, index) => {
    const feeMin = toNumber(action.fee.min), feeMax = toNumber(action.fee.max), feePercentage = toNumber(action.fee.percentage);
    const fee = action.fee.type === 'fixed' && feeMin !== undefined ? { type: 'fixed', min: feeMin, currency: action.fee.currency || 'RWF', ...(action.fee.text.trim() ? { text: action.fee.text.trim() } : {}) }
      : action.fee.type === 'range' && feeMin !== undefined && feeMax !== undefined ? { type: 'range', min: feeMin, max: feeMax, currency: action.fee.currency || 'RWF', ...(action.fee.text.trim() ? { text: action.fee.text.trim() } : {}) }
      : action.fee.type === 'percentage' && feePercentage !== undefined ? { type: 'percentage', percentage: feePercentage, ...(action.fee.text.trim() ? { text: action.fee.text.trim() } : {}) }
      : action.fee.type === 'text' && action.fee.text.trim() ? { type: 'text', text: action.fee.text.trim() }
      : action.fee.type === 'included' ? { type: 'included', ...(action.fee.text.trim() ? { text: action.fee.text.trim() } : {}) } : undefined;
    const timelineMin = toNumber(action.timeline.min), timelineMax = toNumber(action.timeline.max);
    const sla = timelineMin !== undefined || timelineMax !== undefined || action.timeline.text.trim()
      ? { ...(timelineMin !== undefined ? { min: timelineMin } : {}), ...(timelineMax !== undefined ? { max: timelineMax } : {}), ...((timelineMin !== undefined || timelineMax !== undefined) ? { unit: action.timeline.unit } : {}), ...(action.timeline.text.trim() ? { text: action.timeline.text.trim() } : {}) }
      : undefined;
    const percentage = toPercentage(action.percentageText);
    return {
      key: action.key.trim(), stageKey: action.stageKey.trim(), title: action.title.trim(), order: index + 1,
      ...(action.responsibleRole.trim() ? { responsibleRole: action.responsibleRole.trim() } : {}),
      actions: splitLines(action.checklistText),
      outputs: action.outputs.filter((output) => output.name.trim()).map((output, outputIndex) => ({ key: output.key.trim() || `${action.key.trim() || `action_${index + 1}`}_output_${outputIndex + 1}`, name: output.name.trim(), required: output.required, ...(output.category.trim() ? { category: output.category.trim() } : {}) })),
      legalBasis: action.legalBasis.filter((basis) => basis.text.trim()).map((basis) => ({ text: basis.text.trim() })),
      ...(percentage !== undefined ? { percentage } : {}), ...(fee ? { fee } : {}), ...(sla ? { sla } : {}),
    };
  });

  return {
    name: form.name.trim(), matterType: form.matterType.trim(), caseType: form.caseType, active: draft ? false : form.active, draft,
    // Retained only for old database records and the existing unique index. It is not shown to users or used by the builder.
    version: typeof legacyVersion === 'number' ? legacyVersion : 1,
    stages, steps,
  };
}

export default function WorkflowTemplates({ onTemplateSaved }: { onTemplateSaved?: () => void }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<Template | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setLoading(true);
    try { setTemplates(await listAllWorkflowTemplates()); }
    catch (e: any) { setError(e.message || 'Failed to load procedures.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const createNew = () => { setSelected({ _id: NEW_ID, version: 1, draft: true }); setForm(blankForm()); setError(''); setNotice(''); };
  const edit = (template: Template) => { setSelected(template); setForm(templateToForm(template)); setError(''); setNotice(''); };
  const close = () => { setSelected(null); setForm(null); setError(''); };
  const save = async (draft: boolean) => {
    if (!form || !selected) return;
    const errors = validate(form, draft);
    if (errors.length) { setError(errors[0]); return; }
    try {
      setSaving(true); setError('');
      const payload = formToPayload(form, draft, selected.version);
      const saved = selected._id === NEW_ID ? await createWorkflowTemplate(payload) : await updateWorkflowTemplate(selected._id, payload);
      await load(); onTemplateSaved?.(); setSelected(saved); setForm(templateToForm(saved));
      setNotice(draft ? 'Draft saved. It remains inactive until published.' : 'Procedure saved. Active procedures are now available wherever workflow templates are selected.');
    } catch (e: any) { setError(e.message || 'Failed to save procedure.'); }
    finally { setSaving(false); }
  };
  const remove = async (template: Template) => {
    if (!window.confirm('Delete this procedure? Existing matter workflow instances are not changed.')) return;
    try { await deleteWorkflowTemplate(template._id); if (selected?._id === template._id) close(); await load(); onTemplateSaved?.(); }
    catch (e: any) { setError(e.message || 'Failed to delete procedure.'); }
  };

  return <div className="workflow-template-builder rounded-lg border border-gray-200 bg-white p-4 sm:p-6">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
      <div><h2 className="text-lg font-semibold text-gray-900">Workflow Procedures</h2><p className="mt-1 text-sm text-gray-500">Create and edit the procedures used for matters, tasks, deadlines, and reporting.</p></div>
      <button type="button" onClick={createNew} className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800">+ New Workflow</button>
    </div>
    {error && <div className="mt-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    {notice && <div className="mt-4 rounded border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</div>}

    {selected?._id === NEW_ID && form && <div className="mt-5"><Editor key="new-procedure" form={form} setForm={setForm} saving={saving} isDraft onClose={close} onSave={save} /></div>}

    <div className="mt-5 space-y-3">
      <div className="flex items-center justify-between"><h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Existing Workflows</h3><span className="text-xs text-gray-500">{templates.length}</span></div>
      {loading && <div className="rounded border border-gray-200 p-4 text-sm text-gray-500">Loading workflows…</div>}
      {!loading && templates.length === 0 && <div className="rounded border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">No workflows yet. Select “New Workflow” to create one.</div>}
      {templates.map((template) => {
        const isEditing = selected?._id === template._id && form;
        return <article key={template._id} className={`overflow-hidden rounded-lg border ${isEditing ? 'border-gray-900' : 'border-gray-200'}`}>
          <div className="flex flex-col gap-3 bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" onClick={() => isEditing ? close() : edit(template)} className="min-w-0 text-left">
              <div className="truncate text-base font-semibold text-gray-900">{template.name || 'Untitled Procedure'}</div>
              <div className="mt-1 text-sm text-gray-600">{template.matterType || 'Matter type not set'} · {template.caseType || 'Case type not set'}</div>
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${template.draft ? 'bg-amber-100 text-amber-800' : template.active ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'}`}>{template.draft ? 'Draft' : template.active ? 'Active' : 'Inactive'}</span>
              <button type="button" onClick={() => edit(template)} className={secondary}>Edit</button>
              <button type="button" onClick={() => void remove(template)} className="rounded border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">Delete</button>
            </div>
          </div>
          {isEditing && <Editor key={`edit-${template._id}`} form={form} setForm={setForm} saving={saving} isDraft={Boolean(template.draft)} onClose={close} onSave={save} />}
        </article>;
      })}
    </div>
  </div>;
}

function Editor({ form, setForm, saving, isDraft, onClose, onSave }: { form: Form; setForm: Dispatch<SetStateAction<Form | null>>; saving: boolean; isDraft: boolean; onClose: () => void; onSave: (draft: boolean) => Promise<void> }) {
  const [builderStep, setBuilderStep] = useState(0);
  const [openStages, setOpenStages] = useState<Set<string>>(new Set());
  const [showErrors, setShowErrors] = useState(false);
  const summary = useMemo(() => workflowAllocation(form), [form]);
  const errors = useMemo(() => validate(form, false), [form]);
  const update = (callback: (current: Form) => Form) => setForm((current) => current ? callback(current) : current);
  const updateAction = (actionId: string, patch: Partial<WorkflowAction>) => update((current) => ({ ...current, actions: current.actions.map((action) => action.id === actionId ? { ...action, ...patch } : action) }));
  const updateStage = (stageId: string, patch: Partial<Stage>) => update((current) => {
    const previous = current.stages.find((stage) => stage.id === stageId);
    const stages = current.stages.map((stage) => stage.id === stageId ? { ...stage, ...patch } : stage);
    const actions = previous && patch.key !== undefined ? current.actions.map((action) => action.stageKey === previous.key ? { ...action, stageKey: patch.key || '' } : action) : current.actions;
    return { ...current, stages, actions };
  });
  const addStage = () => update((current) => {
    const position = current.stages.length + 1;
    const key = uniqueKey(`stage_${position}`, new Set(current.stages.map((stage) => stage.key)));
    const stage = { id: id('stage'), key, title: '', description: '', order: position };
    setOpenStages((existing) => new Set(existing).add(stage.id));
    return { ...current, stages: [...current.stages, stage] };
  });
  const addAction = (stageKey: string) => update((current) => ({ ...current, actions: [...current.actions, newAction(stageKey, current.actions.length + 1, uniqueKey('key_action', new Set(current.actions.map((action) => action.key))))] }));
  const moveStage = (index: number, delta: number) => update((current) => {
    const target = index + delta; if (target < 0 || target >= current.stages.length) return current;
    const stages = [...current.stages]; [stages[index], stages[target]] = [stages[target], stages[index]];
    return { ...current, stages: stages.map((stage, position) => ({ ...stage, order: position + 1 })) };
  });
  const moveAction = (stageKey: string, index: number, delta: number) => update((current) => {
    const inStage = current.actions.filter((action) => action.stageKey === stageKey).sort((a, b) => a.order - b.order); const target = index + delta;
    if (target < 0 || target >= inStage.length) return current;
    const [first, second] = [inStage[index], inStage[target]];
    return { ...current, actions: current.actions.map((action) => action.id === first.id ? { ...action, order: second.order } : action.id === second.id ? { ...action, order: first.order } : action) };
  });
  const duplicateAction = (action: WorkflowAction) => update((current) => ({ ...current, actions: [...current.actions, { ...action, id: id('action'), key: uniqueKey(`${action.key || 'key_action'}_copy`, new Set(current.actions.map((item) => item.key))), title: action.title ? `${action.title} copy` : '', order: current.actions.length + 1, outputs: action.outputs.map((output) => ({ ...output, id: id('output') })), legalBasis: action.legalBasis.map((basis) => ({ ...basis, id: id('basis') })), legacy: false }] }));
  const removeStage = (stage: Stage) => { const count = form.actions.filter((action) => action.stageKey === stage.key).length; if (!window.confirm(`Remove this SECTION${count ? ` and its ${count} KEY ACTION${count === 1 ? '' : 'S'}` : ''}?`)) return; update((current) => ({ ...current, stages: current.stages.filter((item) => item.id !== stage.id), actions: current.actions.filter((action) => action.stageKey !== stage.key) })); };
  const removeAction = (action: WorkflowAction) => { if (!window.confirm('Remove this KEY ACTION and its LEGAL BASIS, OUTPUT, FEES, and TIMELINES?')) return; update((current) => ({ ...current, actions: current.actions.filter((item) => item.id !== action.id) })); };
  const publish = async (draft: boolean) => { setShowErrors(true); if (validate(form, draft).length) return; await onSave(draft); };
  const nav = ['Procedure Information', 'Applicability', 'STAGE, KEY ACTIONS & Allocation', 'Review & Publish'];

  return <div className="border-t border-gray-200 bg-white p-4 sm:p-6">
    <div className="mb-5 flex flex-col gap-3 border-b border-gray-200 pb-4 sm:flex-row sm:items-start sm:justify-between"><div><div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{isDraft ? 'Draft Workflow' : 'Workflow Editor'}</div><h3 className="mt-1 text-lg font-semibold text-gray-900">{form.name || 'New Workflow'}</h3></div><div className="flex flex-wrap gap-2">{isDraft && <button type="button" onClick={() => void publish(true)} disabled={saving} className={secondary}>{saving ? 'Saving…' : 'Save Draft'}</button>}<button type="button" onClick={() => void publish(false)} disabled={saving} className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60">{saving ? 'Saving…' : isDraft ? 'Publish Workflow' : 'Save Changes'}</button><button type="button" onClick={onClose} className={secondary}>Close</button></div></div>
    <div className="mb-5 grid gap-2 sm:grid-cols-4">{nav.map((label, index) => <button key={label} type="button" onClick={() => setBuilderStep(index)} className={`rounded border px-3 py-2 text-left text-sm ${builderStep === index ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-white'}`}><span className="font-semibold">{index + 1}.</span> {label}</button>)}</div>
    {builderStep === 0 && <section className="rounded-lg border border-gray-200 p-4"><h4 className="text-base font-semibold text-gray-900">Procedure Information</h4><p className="mt-1 text-sm text-gray-500">The title shown when this workflow is selected for a matter.</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="PROCEDURE NAME *"><input value={form.name} onChange={(event) => update((current) => ({ ...current, name: event.target.value }))} className={input} placeholder="e.g., Business Registration" /></Field><label className="flex items-center gap-3 self-end rounded border border-gray-200 p-3"><input type="checkbox" checked={form.active} onChange={(event) => update((current) => ({ ...current, active: event.target.checked }))} /><span><span className="block text-sm font-medium text-gray-900">Active</span><span className="block text-xs text-gray-500">Active workflows appear in matter workflow selections.</span></span></label></div></section>}
    {builderStep === 1 && <section className="rounded-lg border border-gray-200 p-4"><h4 className="text-base font-semibold text-gray-900">Applicability</h4><p className="mt-1 text-sm text-gray-500">Choose where this workflow can be used.</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="MATTER TYPE *"><input value={form.matterType} onChange={(event) => update((current) => ({ ...current, matterType: event.target.value }))} className={input} placeholder="e.g., Business Registration" /></Field><Field label="CASE TYPE *"><select value={form.caseType} onChange={(event) => update((current) => ({ ...current, caseType: event.target.value as CaseType }))} className={input}><option value="Transactional Cases">Transactional Cases</option><option value="Litigation Cases">Litigation Cases</option><option value="Labor Cases">Labor Cases</option></select></Field></div></section>}
    {builderStep === 2 && <section className="space-y-4"><AllocationSummary summary={summary} /><div className="rounded-lg border border-gray-200 bg-gray-50 p-4"><div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Reference document fields</div><div className="mt-2 grid gap-2 text-sm font-semibold text-gray-900 sm:grid-cols-2 lg:grid-cols-6"><span>STAGE</span><span>LEGAL BASIS</span><span>OUTPUT</span><span>KEY ACTIONS</span><span>PERCENTAGE</span><span>FEES & TIMELINES</span></div><p className="mt-2 text-xs text-gray-600">Each SECTION below has a STAGE. Add KEY ACTIONS inside it, then fill the LEGAL BASIS, OUTPUT, PERCENTAGE, FEES, and TIMELINES directly in each card.</p></div><div className="flex items-center justify-between"><div><h4 className="text-base font-semibold text-gray-900">Workflow Sections</h4><p className="mt-1 text-sm text-gray-500">Use the same section structure as the reference procedure.</p></div><button type="button" onClick={addStage} className="rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800">+ Add Section</button></div>{form.stages.length === 0 && <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">Add a SECTION to begin filling STAGE, LEGAL BASIS, OUTPUT, KEY ACTIONS, PERCENTAGE, FEES, and TIMELINES.</div>}{form.stages.map((stage, stageIndex) => { const actions = form.actions.filter((action) => action.stageKey === stage.key).sort((a, b) => a.order - b.order); const isOpen = openStages.has(stage.id) || true; return <div key={stage.id} className="overflow-hidden rounded-lg border border-gray-200 bg-white"><div className="flex flex-wrap items-center gap-2 bg-gray-50 px-4 py-3"><button type="button" onClick={() => setOpenStages((existing) => { const next = new Set(existing); if (next.has(stage.id)) next.delete(stage.id); else next.add(stage.id); return next; })} className="text-left"><span className="text-sm font-semibold text-gray-900">SECTION {stageIndex + 1}: {stage.title || 'Untitled STAGE'}</span><span className="ml-2 text-xs text-gray-500">{actions.length} KEY ACTION{actions.length === 1 ? '' : 'S'} · {percent(stageAllocation(stage, actions))}</span></button><div className="ml-auto flex flex-wrap gap-1"><button type="button" disabled={stageIndex === 0} onClick={() => moveStage(stageIndex, -1)} className={secondary}>↑</button><button type="button" disabled={stageIndex === form.stages.length - 1} onClick={() => moveStage(stageIndex, 1)} className={secondary}>↓</button><button type="button" onClick={() => removeStage(stage)} className="rounded border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">Remove Section</button></div></div>{isOpen && <div className="space-y-4 p-4"><div className="grid gap-3 md:grid-cols-3"><Field label="STAGE KEY *"><input value={stage.key} onChange={(event) => updateStage(stage.id, { key: event.target.value })} className={smallInput} /></Field><Field label="STAGE *"><input value={stage.title} onChange={(event) => updateStage(stage.id, { title: event.target.value })} className={smallInput} placeholder="e.g., Client Intake & Preliminary Legal Assessment" /></Field><Field label="STAGE DESCRIPTION (OPTIONAL)"><input value={stage.description} onChange={(event) => updateStage(stage.id, { description: event.target.value })} className={smallInput} /></Field></div><div className="rounded border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">SECTION PERCENTAGE: {percent(stageAllocation(stage, actions))}. It is calculated from the manually entered KEY ACTION PERCENTAGE values and saved in the existing stage field.</div><div className="space-y-3">{actions.map((action, actionIndex) => <ActionEditor key={action.id} action={action} number={actionIndex + 1} total={actions.length} summary={summary} onChange={updateAction} onMove={(delta) => moveAction(stage.key, actionIndex, delta)} onDuplicate={() => duplicateAction(action)} onRemove={() => removeAction(action)} />)}</div><button type="button" onClick={() => addAction(stage.key)} className="rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">+ Add Key Action</button></div>}</div>; })}</section>}
    {builderStep === 3 && <Review form={form} summary={summary} errors={errors} />}
    <div className="mt-5 flex justify-between border-t border-gray-200 pt-4"><button type="button" disabled={builderStep === 0} onClick={() => setBuilderStep((current) => Math.max(0, current - 1))} className={secondary}>Back</button><div className="flex gap-2">{builderStep < 3 && <button type="button" onClick={() => setBuilderStep((current) => Math.min(3, current + 1))} className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800">Continue</button>}{builderStep === 3 && <button type="button" onClick={() => void publish(false)} disabled={saving} className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60">{saving ? 'Saving…' : 'Save Workflow'}</button>}</div></div>
    {showErrors && errors.length > 0 && <div className="mt-4 rounded border border-red-200 bg-red-50 p-3"><div className="text-sm font-semibold text-red-800">Resolve these items before publishing</div><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-700">{errors.map((message) => <li key={message}>{message}</li>)}</ul></div>}
  </div>;
}

function ActionEditor({ action, number, total, summary, onChange, onMove, onDuplicate, onRemove }: { action: WorkflowAction; number: number; total: number; summary: ReturnType<typeof workflowAllocation>; onChange: (id: string, patch: Partial<WorkflowAction>) => void; onMove: (delta: number) => void; onDuplicate: () => void; onRemove: () => void }) {
  const update = (patch: Partial<WorkflowAction>) => onChange(action.id, patch);
  const changeOutput = (outputId: string, patch: Partial<Output>) => update({ outputs: action.outputs.map((output) => output.id === outputId ? { ...output, ...patch } : output) });
  const changeBasis = (basisId: string, patch: Partial<LegalBasis>) => update({ legalBasis: action.legalBasis.map((basis) => basis.id === basisId ? { ...basis, ...patch } : basis) });
  const value = toPercentage(action.percentageText);
  const invalid = (!!action.percentageText && value === undefined) || (value !== undefined && (value < 0 || value > 100));
  return <div className="rounded-lg border border-gray-200 bg-gray-50 p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="text-sm font-semibold text-gray-900">KEY ACTION {number}</div><div className="flex flex-wrap gap-1"><button type="button" disabled={number === 1} onClick={() => onMove(-1)} className={secondary}>↑</button><button type="button" disabled={number === total} onClick={() => onMove(1)} className={secondary}>↓</button><button type="button" onClick={onDuplicate} className={secondary}>Duplicate</button><button type="button" onClick={onRemove} className="rounded border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">Remove</button></div></div><div className="grid gap-4 lg:grid-cols-2"><div className="space-y-4"><Field label="KEY ACTION *"><textarea value={action.title} onChange={(event) => update({ title: event.target.value })} rows={3} className={input} placeholder="e.g., Conduct conflict of interest check and collect client instructions" /></Field><Field label="PERCENTAGE *"><div className="relative"><input value={action.percentageText} onChange={(event) => update({ percentageText: event.target.value, legacy: false })} className={`${input} ${invalid || summary.total > 100 ? 'border-red-500 ring-1 ring-red-300' : ''}`} inputMode="decimal" placeholder="e.g., 2 or 1.5" /><span className="pointer-events-none absolute right-3 top-2 text-sm text-gray-500">%</span></div>{invalid && <p className="mt-1 text-xs text-red-600">Enter a number from 0 to 100.</p>}{summary.total > 100 && <p className="mt-1 text-xs text-red-600">Total allocation is above 100%. Reduce a KEY ACTION PERCENTAGE.</p>}</Field><Field label="LEGAL BASIS"><div className="space-y-2">{action.legalBasis.map((basis) => <div key={basis.id} className="flex gap-2"><input value={basis.text} onChange={(event) => changeBasis(basis.id, { text: event.target.value })} className={smallInput} placeholder="Law, article, regulation, policy, or internal basis" /><button type="button" onClick={() => update({ legalBasis: action.legalBasis.filter((item) => item.id !== basis.id) })} className="text-xs text-red-700 hover:underline">Remove</button></div>)}<button type="button" onClick={() => update({ legalBasis: [...action.legalBasis, { id: id('basis'), text: '' }] })} className="text-sm font-medium text-blue-700 hover:underline">+ Add Legal Basis</button></div></Field></div><div className="space-y-4"><Field label="OUTPUT"><div className="space-y-2">{action.outputs.map((output) => <div key={output.id} className="rounded border border-gray-200 bg-white p-2"><div className="grid gap-2 sm:grid-cols-2"><input value={output.name} onChange={(event) => changeOutput(output.id, { name: event.target.value })} className={smallInput} placeholder="Output / document name" /><input value={output.category} onChange={(event) => changeOutput(output.id, { category: event.target.value })} className={smallInput} placeholder="Category (optional)" /><input value={output.key} onChange={(event) => changeOutput(output.id, { key: event.target.value })} className={smallInput} placeholder="Output key (optional)" /><label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={output.required} onChange={(event) => changeOutput(output.id, { required: event.target.checked })} /> Required</label></div><button type="button" onClick={() => update({ outputs: action.outputs.filter((item) => item.id !== output.id) })} className="mt-2 text-xs text-red-700 hover:underline">Remove Output</button></div>)}<button type="button" onClick={() => update({ outputs: [...action.outputs, { id: id('output'), key: '', name: '', category: '', required: false }] })} className="text-sm font-medium text-blue-700 hover:underline">+ Add Output</button></div></Field><FeeEditor fee={action.fee} onChange={(fee) => update({ fee })} /><TimelineEditor timeline={action.timeline} onChange={(timeline) => update({ timeline })} /></div></div><details className="mt-4 rounded border border-gray-200 bg-white p-3"><summary className="cursor-pointer text-sm font-medium text-gray-700">Advanced configuration</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="WORKFLOW STEP KEY *"><input value={action.key} onChange={(event) => update({ key: event.target.value })} className={smallInput} /></Field><Field label="RESPONSIBLE ROLE"><input value={action.responsibleRole} onChange={(event) => update({ responsibleRole: event.target.value })} className={smallInput} placeholder="e.g., Associate" /></Field><div className="sm:col-span-2"><Field label="KEY ACTION CHECKLIST (ONE ITEM PER LINE)"><textarea value={action.checklistText} onChange={(event) => update({ checklistText: event.target.value })} rows={4} className={smallInput} placeholder="Optional granular checklist completed inside the matter workflow" /></Field></div></div></details></div>;
}

function FeeEditor({ fee, onChange }: { fee: Fee; onChange: (fee: Fee) => void }) { const update = (patch: Partial<Fee>) => onChange({ ...fee, ...patch }); return <div className="rounded border border-gray-200 bg-white p-3"><div className="text-sm font-semibold text-gray-900">FEES</div><div className="mt-2 grid gap-2 sm:grid-cols-2"><select value={fee.type} onChange={(event) => update({ type: event.target.value as FeeType })} className={smallInput}><option value="none">No fee configured</option><option value="fixed">Fixed fee</option><option value="range">Fee range</option><option value="percentage">Percentage fee</option><option value="text">Text / other fee</option><option value="included">Included fee</option></select>{['fixed', 'range'].includes(fee.type) && <input value={fee.currency} onChange={(event) => update({ currency: event.target.value.toUpperCase() })} className={smallInput} placeholder="Currency" />}{fee.type === 'fixed' && <input value={fee.min} onChange={(event) => update({ min: event.target.value })} className={smallInput} inputMode="decimal" placeholder="Amount" />}{fee.type === 'range' && <><input value={fee.min} onChange={(event) => update({ min: event.target.value })} className={smallInput} inputMode="decimal" placeholder="Minimum" /><input value={fee.max} onChange={(event) => update({ max: event.target.value })} className={smallInput} inputMode="decimal" placeholder="Maximum" /></>}{fee.type === 'percentage' && <input value={fee.percentage} onChange={(event) => update({ percentage: event.target.value })} className={smallInput} inputMode="decimal" placeholder="Fee percentage" />}</div>{fee.type !== 'none' && <input value={fee.text} onChange={(event) => update({ text: event.target.value })} className={`mt-2 ${smallInput}`} placeholder="Fee note, regulation, or included-fee text" />}</div>; }

function TimelineEditor({ timeline, onChange }: { timeline: Timeline; onChange: (timeline: Timeline) => void }) { const update = (patch: Partial<Timeline>) => onChange({ ...timeline, ...patch }); return <div className="rounded border border-gray-200 bg-white p-3"><div className="text-sm font-semibold text-gray-900">TIMELINES</div><div className="mt-2 grid gap-2 sm:grid-cols-3"><input value={timeline.min} onChange={(event) => update({ min: event.target.value })} className={smallInput} inputMode="decimal" placeholder="Minimum" /><input value={timeline.max} onChange={(event) => update({ max: event.target.value })} className={smallInput} inputMode="decimal" placeholder="Maximum" /><select value={timeline.unit} onChange={(event) => update({ unit: event.target.value as SlaUnit })} className={smallInput}><option value="hours">Hours</option><option value="days">Days</option><option value="weeks">Weeks</option></select></div><input value={timeline.text} onChange={(event) => update({ text: event.target.value })} className={`mt-2 ${smallInput}`} placeholder="e.g., within 1–2 hours; complete within 24 hours" /></div>; }

function AllocationSummary({ summary }: { summary: ReturnType<typeof workflowAllocation> }) { const exceeded = summary.total > 100; return <div className={`rounded-lg border p-4 ${exceeded ? 'border-red-300 bg-red-50' : summary.total === 100 ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-gray-50'}`}><div className="flex flex-wrap items-end justify-between gap-3"><div><div className="text-sm font-semibold text-gray-900">PERCENTAGE ALLOCATION</div><div className="mt-1 text-sm text-gray-600">Allocated <span className="font-semibold text-gray-900">{percent(summary.total)}</span> · Remaining <span className="font-semibold text-gray-900">{percent(summary.remaining)}</span></div></div><div className="w-full sm:w-52"><div className="h-2 overflow-hidden rounded-full bg-gray-200"><div className={`h-full ${exceeded ? 'bg-red-600' : 'bg-gray-900'}`} style={{ width: `${Math.min(100, Math.max(0, summary.total))}%` }} /></div></div></div>{exceeded ? <p className="mt-3 text-sm text-red-700">The total KEY ACTION PERCENTAGE exceeds 100% by {percent(summary.total - 100)}. Reduce an entered value; no value is changed automatically.</p> : summary.total === 100 ? <p className="mt-3 text-sm text-green-800">100% is allocated. Reduce an existing KEY ACTION PERCENTAGE before adding another allocation.</p> : <p className="mt-3 text-xs text-gray-600">Enter each KEY ACTION PERCENTAGE exactly as required by the procedure, including decimals such as 1.5% or 0.25%.</p>}</div>; }

function Review({ form, summary, errors }: { form: Form; summary: ReturnType<typeof workflowAllocation>; errors: string[] }) { return <section className="space-y-4"><div className="rounded-lg border border-gray-200 p-4"><h4 className="text-base font-semibold text-gray-900">Procedure Review</h4><div className="mt-3 grid gap-3 text-sm sm:grid-cols-2"><div><span className="text-gray-500">PROCEDURE</span><div className="font-medium text-gray-900">{form.name || 'Not set'}</div></div><div><span className="text-gray-500">APPLICABILITY</span><div className="font-medium text-gray-900">{form.matterType || 'Not set'} · {form.caseType}</div></div><div><span className="text-gray-500">TOTAL PERCENTAGE</span><div className={`font-medium ${summary.total > 100 ? 'text-red-700' : 'text-gray-900'}`}>{percent(summary.total)} allocated · {percent(summary.remaining)} remaining</div></div><div><span className="text-gray-500">STATUS</span><div className="font-medium text-gray-900">{form.active ? 'Active' : 'Inactive'}</div></div></div></div>{form.stages.map((stage, stageIndex) => { const actions = form.actions.filter((action) => action.stageKey === stage.key).sort((a, b) => a.order - b.order); return <div key={stage.id} className="overflow-hidden rounded-lg border border-gray-200"><div className="flex justify-between bg-gray-50 px-4 py-3"><span className="font-semibold text-gray-900">SECTION {stageIndex + 1}: {stage.title || 'Untitled STAGE'}</span><span className="font-semibold text-gray-900">{percent(stageAllocation(stage, actions))}</span></div><div className="overflow-x-auto"><table className="min-w-[760px] w-full text-left text-xs"><thead className="bg-gray-50 text-gray-500"><tr><th className="p-3">STAGE</th><th className="p-3">LEGAL BASIS</th><th className="p-3">OUTPUT</th><th className="p-3">KEY ACTIONS</th><th className="p-3">PERCENTAGE</th><th className="p-3">FEES</th><th className="p-3">TIMELINES</th></tr></thead><tbody>{actions.map((action) => <tr key={action.id} className="border-t border-gray-200 align-top"><td className="p-3 text-gray-700">{stage.title}</td><td className="p-3 text-gray-700">{action.legalBasis.map((basis) => basis.text).filter(Boolean).join('; ') || '—'}</td><td className="p-3 text-gray-700">{action.outputs.map((output) => output.name).filter(Boolean).join('; ') || '—'}</td><td className="p-3 text-gray-900">{action.title || '—'}</td><td className="p-3 font-semibold text-gray-900">{action.percentageText ? `${action.percentageText}%` : '—'}</td><td className="p-3 text-gray-700">{action.fee.text || action.fee.min || action.fee.max ? `${action.fee.currency} ${action.fee.min}${action.fee.max ? `–${action.fee.max}` : ''}${action.fee.text ? ` ${action.fee.text}` : ''}` : '—'}</td><td className="p-3 text-gray-700">{action.timeline.text || [action.timeline.min, action.timeline.max].filter(Boolean).join('–') || '—'}</td></tr>)}</tbody></table></div></div>; })}{errors.length ? <div className="rounded border border-red-200 bg-red-50 p-4"><div className="font-semibold text-red-800">Not ready to publish</div><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-700">{errors.map((error) => <li key={error}>{error}</li>)}</ul></div> : <div className="rounded border border-green-200 bg-green-50 p-4 text-sm text-green-800"><span className="font-semibold">Ready to publish.</span> The procedure matches the reference format and is within the 100% allocation limit.</div>}</section>; }

function Field({ label, children }: { label: string; children: ReactNode }) { return <div><label className="mb-1 block text-xs font-semibold tracking-wide text-gray-600">{label}</label>{children}</div>; }
