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
type Unit = 'hours' | 'days' | 'weeks';
type Template = any;
type LegalBasis = { id: string; text: string };
type Output = { id: string; key: string; name: string; category: string; required: boolean };
type Fee = { type: FeeType; min: string; max: string; currency: string; percentage: string; text: string };
type Timeline = { min: string; max: string; unit: Unit; text: string };
type Section = {
  id: string;
  key: string;
  stage: string;
  percentage: string;
  order: number;
  legalBasis: LegalBasis[];
  outputs: Output[];
  fee: Fee;
  timeline: Timeline;
};
type KeyAction = {
  id: string;
  key: string;
  sectionKey: string;
  title: string;
  percentage: string;
  order: number;
  responsibleRole: string;
  checklist: string;
};
type WorkflowForm = { name: string; matterType: string; caseType: CaseType; active: boolean; sections: Section[]; actions: KeyAction[] };

const NEW_ID = '__new__';
let sequence = 0;
const id = (prefix: string) => `${prefix}_${Date.now()}_${++sequence}`;
const input = 'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-400';
const smallInput = 'w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400';
const secondary = 'rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50';
const number = (value: string) => /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value.trim()) : undefined;
const asPercentage = (value: string) => number(value.trim().replace(/%$/, ''));
const displayPercentage = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value) ? `${value}%` : '—';
const splitLines = (value: string) => value.split('\n').map((item) => item.trim()).filter(Boolean);
const blankFee = (): Fee => ({ type: 'none', min: '', max: '', currency: 'RWF', percentage: '', text: '' });
const blankTimeline = (): Timeline => ({ min: '', max: '', unit: 'days', text: '' });

function uniqueKey(base: string, used: Set<string>) {
  let value = base;
  let suffix = 2;
  while (used.has(value)) value = `${base}_${suffix++}`;
  return value;
}

function newSection(position: number, used: Set<string>): Section {
  return {
    id: id('section'), key: uniqueKey(`section_${position}`, used), stage: '', percentage: '', order: position,
    legalBasis: [{ id: id('basis'), text: '' }],
    outputs: [{ id: id('output'), key: '', name: '', category: '', required: false }],
    fee: blankFee(), timeline: blankTimeline(),
  };
}

function newAction(sectionKey: string, position: number, used: Set<string>): KeyAction {
  return { id: id('action'), key: uniqueKey(`key_action_${position}`, used), sectionKey, title: '', percentage: '', order: position, responsibleRole: '', checklist: '' };
}

function emptyForm(): WorkflowForm {
  return { name: '', matterType: '', caseType: 'Transactional Cases', active: true, sections: [], actions: [] };
}

function readBasis(value: unknown): LegalBasis[] {
  return Array.isArray(value) ? value.map((item: any) => ({ id: id('basis'), text: String(typeof item === 'string' ? item : item?.text || '') })) : [];
}

function readOutputs(value: unknown): Output[] {
  return Array.isArray(value) ? value.map((item: any) => ({
    id: id('output'), key: String(typeof item === 'object' ? item?.key || '' : ''), name: String(typeof item === 'string' ? item : item?.name || ''),
    category: String(typeof item === 'object' ? item?.category || '' : ''), required: Boolean(typeof item === 'object' ? item?.required : false),
  })) : [];
}

function readFee(value: any): Fee {
  const fee = value && typeof value === 'object' ? value : {};
  return { type: ['fixed', 'range', 'percentage', 'text', 'included'].includes(fee.type) ? fee.type : fee.text ? 'text' : 'none', min: typeof fee.min === 'number' ? String(fee.min) : '', max: typeof fee.max === 'number' ? String(fee.max) : '', currency: String(fee.currency || 'RWF'), percentage: typeof fee.percentage === 'number' ? String(fee.percentage) : '', text: String(fee.text || '') };
}

function readTimeline(value: any): Timeline {
  const timeline = value && typeof value === 'object' ? value : {};
  return { min: typeof timeline.min === 'number' ? String(timeline.min) : '', max: typeof timeline.max === 'number' ? String(timeline.max) : '', unit: ['hours', 'days', 'weeks'].includes(timeline.unit) ? timeline.unit : 'days', text: String(timeline.text || '') };
}

function toForm(template: Template): WorkflowForm {
  const sections: Section[] = (Array.isArray(template?.stages) ? template.stages : []).map((stage: any, index: number) => ({
    id: id('section'), key: String(stage?.key || `section_${index + 1}`), stage: String(stage?.title || stage?.name || ''), percentage: typeof stage?.percentage === 'number' ? String(stage.percentage) : '', order: typeof stage?.order === 'number' ? stage.order : index + 1,
    legalBasis: readBasis(stage?.legalBasis), outputs: readOutputs(stage?.outputs), fee: readFee(stage?.fee), timeline: readTimeline(stage?.sla),
  })).sort((a, b) => a.order - b.order);
  const actions: KeyAction[] = (Array.isArray(template?.steps) ? template.steps : []).map((step: any, index: number) => ({
    id: id('action'), key: String(step?.key || `key_action_${index + 1}`), sectionKey: String(step?.stageKey || ''), title: String(step?.title || ''), percentage: typeof step?.percentage === 'number' ? String(step.percentage) : '', order: typeof step?.order === 'number' ? step.order : index + 1, responsibleRole: String(step?.responsibleRole || ''), checklist: Array.isArray(step?.actions) ? step.actions.map(String).join('\n') : '',
  })).sort((a, b) => a.order - b.order);
  sections.forEach((section) => {
    const first = (template?.steps || []).find((step: any) => String(step?.stageKey || '') === section.key);
    if (!first) return;
    if (!section.legalBasis.length) section.legalBasis = readBasis(first.legalBasis);
    if (!section.outputs.length) section.outputs = readOutputs(first.outputs);
    if (section.fee.type === 'none') section.fee = readFee(first.fee);
    if (!section.timeline.min && !section.timeline.max && !section.timeline.text) section.timeline = readTimeline(first.sla);
  });
  return { name: String(template?.name || ''), matterType: String(template?.matterType || ''), caseType: template?.caseType || 'Transactional Cases', active: Boolean(template?.active), sections, actions };
}

function actionTotal(actions: KeyAction[]) {
  return actions.reduce((sum, action) => sum + (asPercentage(action.percentage) || 0), 0);
}

function workflowTotal(form: WorkflowForm) {
  return Math.round(actionTotal(form.actions) * 10000) / 10000;
}

function validate(form: WorkflowForm, draft: boolean) {
  const errors: string[] = [];
  if (!form.name.trim()) errors.push('Workflow name is required.');
  if (!form.matterType.trim()) errors.push('Matter type is required.');
  if (workflowTotal(form) > 100) errors.push('Total KEY ACTION PERCENTAGE cannot exceed 100%.');
  if (draft) return errors;
  if (!form.sections.length) errors.push('Add at least one SECTION.');
  if (!form.actions.length) errors.push('Add at least one KEY ACTION.');
  const keys = new Set(form.sections.map((section) => section.key));
  form.sections.forEach((section, index) => {
    const stagePercentage = asPercentage(section.percentage);
    const total = actionTotal(form.actions.filter((action) => action.sectionKey === section.key));
    if (!section.stage.trim()) errors.push(`SECTION ${index + 1} needs a STAGE.`);
    if (stagePercentage === undefined || stagePercentage < 0 || stagePercentage > 100) errors.push(`SECTION ${index + 1} needs a STAGE PERCENTAGE from 0 to 100.`);
    if (stagePercentage !== undefined && Math.abs(stagePercentage - total) > 0.0001) errors.push(`SECTION ${index + 1} STAGE PERCENTAGE must equal its KEY ACTION total (${total}%).`);
    if (section.legalBasis.some((item) => !item.text.trim())) errors.push(`Every LEGAL BASIS entry in SECTION ${index + 1} needs text.`);
    if (section.outputs.some((item) => !item.name.trim())) errors.push(`Every OUTPUT in SECTION ${index + 1} needs a name.`);
  });
  form.actions.forEach((action, index) => {
    const value = asPercentage(action.percentage);
    if (!action.title.trim()) errors.push(`KEY ACTION ${index + 1} is required.`);
    if (!keys.has(action.sectionKey)) errors.push(`KEY ACTION ${index + 1} must belong to a SECTION.`);
    if (value === undefined || value < 0 || value > 100) errors.push(`KEY ACTION ${index + 1} needs a PERCENTAGE from 0 to 100.`);
  });
  return Array.from(new Set(errors));
}

function serialiseOutputs(outputs: Output[], sectionKey: string) {
  return outputs.filter((output) => output.name.trim()).map((output, index) => ({ key: output.key.trim() || `${sectionKey}_output_${index + 1}`, name: output.name.trim(), required: output.required, ...(output.category.trim() ? { category: output.category.trim() } : {}) }));
}

function serialiseFee(fee: Fee) {
  const min = number(fee.min), max = number(fee.max), feePercentage = number(fee.percentage);
  if (fee.type === 'fixed' && min !== undefined) return { type: 'fixed', min, currency: fee.currency || 'RWF', ...(fee.text.trim() ? { text: fee.text.trim() } : {}) };
  if (fee.type === 'range' && min !== undefined && max !== undefined) return { type: 'range', min, max, currency: fee.currency || 'RWF', ...(fee.text.trim() ? { text: fee.text.trim() } : {}) };
  if (fee.type === 'percentage' && feePercentage !== undefined) return { type: 'percentage', percentage: feePercentage, ...(fee.text.trim() ? { text: fee.text.trim() } : {}) };
  if (fee.type === 'text' && fee.text.trim()) return { type: 'text', text: fee.text.trim() };
  if (fee.type === 'included') return { type: 'included', ...(fee.text.trim() ? { text: fee.text.trim() } : {}) };
  return undefined;
}

function serialiseTimeline(timeline: Timeline) {
  const min = number(timeline.min), max = number(timeline.max);
  return min === undefined && max === undefined && !timeline.text.trim() ? undefined : { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(min !== undefined || max !== undefined ? { unit: timeline.unit } : {}), ...(timeline.text.trim() ? { text: timeline.text.trim() } : {}) };
}

function toPayload(form: WorkflowForm, draft: boolean, legacyVersion: unknown) {
  const stages = form.sections.map((section, index) => {
    const fee = serialiseFee(section.fee), sla = serialiseTimeline(section.timeline);
    return { key: section.key, title: section.stage.trim(), order: index + 1, percentage: asPercentage(section.percentage), legalBasis: section.legalBasis.filter((item) => item.text.trim()).map((item) => ({ text: item.text.trim() })), outputs: serialiseOutputs(section.outputs, section.key), ...(fee ? { fee } : {}), ...(sla ? { sla } : {}) };
  });
  const steps = form.actions.map((action, index) => {
    const section = form.sections.find((item) => item.key === action.sectionKey);
    const fee = section ? serialiseFee(section.fee) : undefined, sla = section ? serialiseTimeline(section.timeline) : undefined;
    return { key: action.key, stageKey: action.sectionKey, title: action.title.trim(), order: index + 1, percentage: asPercentage(action.percentage), ...(action.responsibleRole.trim() ? { responsibleRole: action.responsibleRole.trim() } : {}), actions: splitLines(action.checklist), outputs: section ? serialiseOutputs(section.outputs, section.key) : [], legalBasis: section ? section.legalBasis.filter((item) => item.text.trim()).map((item) => ({ text: item.text.trim() })) : [], ...(fee ? { fee } : {}), ...(sla ? { sla } : {}) };
  });
  return { name: form.name.trim(), matterType: form.matterType.trim(), caseType: form.caseType, active: draft ? false : form.active, draft, version: typeof legacyVersion === 'number' ? legacyVersion : 1, stages, steps };
}

export default function WorkflowTemplates({ onTemplateSaved }: { onTemplateSaved?: () => void }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<Template | null>(null);
  const [form, setForm] = useState<WorkflowForm | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = async () => { setLoading(true); try { setTemplates(await listAllWorkflowTemplates()); } catch (err: any) { setError(err.message || 'Failed to load workflows.'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const close = () => { setSelected(null); setForm(null); setError(''); };
  const create = () => { setSelected({ _id: NEW_ID, version: 1, draft: true }); setForm(emptyForm()); setError(''); setNotice(''); };
  const edit = (template: Template) => { setSelected(template); setForm(toForm(template)); setError(''); setNotice(''); };
  const save = async (draft: boolean) => { if (!form || !selected) return; const errors = validate(form, draft); if (errors.length) { setError(errors[0]); return; } try { setSaving(true); const payload = toPayload(form, draft, selected.version); const saved = selected._id === NEW_ID ? await createWorkflowTemplate(payload) : await updateWorkflowTemplate(selected._id, payload); await load(); onTemplateSaved?.(); setSelected(saved); setForm(toForm(saved)); setNotice(draft ? 'Draft saved. It remains inactive until published.' : 'Workflow saved. Active workflows are available in case workflow selections.'); } catch (err: any) { setError(err.message || 'Failed to save workflow.'); } finally { setSaving(false); } };
  const remove = async (template: Template) => { if (!window.confirm('Delete this workflow? Existing case workflow instances are not changed.')) return; try { await deleteWorkflowTemplate(template._id); if (selected?._id === template._id) close(); await load(); onTemplateSaved?.(); } catch (err: any) { setError(err.message || 'Failed to delete workflow.'); } };
  return <div className="workflow-template-builder rounded-lg border border-gray-200 bg-white p-4 sm:p-6"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="text-lg font-semibold text-gray-900">Workflow Procedures</h2><p className="mt-1 text-sm text-gray-500">Create procedures in the same section and key-action format as the reference document.</p></div><button type="button" onClick={create} className="self-end rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 sm:self-auto">+ New Workflow</button></div>{error && <Message tone="error">{error}</Message>}{notice && <Message tone="success">{notice}</Message>}{selected?._id === NEW_ID && form && <div className="mt-5"><WorkflowEditor form={form} setForm={setForm} saving={saving} isDraft onClose={close} onSave={save} /></div>}<div className="mt-5 space-y-3"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Existing Workflows</h3><span className="text-xs text-gray-500">{templates.length}</span></div>{loading && <div className="rounded border border-gray-200 p-4 text-sm text-gray-500">Loading workflows...</div>}{!loading && !templates.length && <div className="rounded border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">No workflows yet. Select “New Workflow” to create one.</div>}{templates.map((template) => { const isEditing = selected?._id === template._id && form; return <article key={template._id} className={`overflow-hidden rounded-lg border ${isEditing ? 'border-gray-900' : 'border-gray-200'}`}><div className="flex flex-col gap-3 bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-between"><button type="button" onClick={() => isEditing ? close() : edit(template)} className="min-w-0 text-left"><div className="truncate text-base font-semibold text-gray-900">{template.name || 'Untitled Workflow'}</div><div className="mt-1 text-sm text-gray-600">{template.matterType || 'Matter type not set'} · {template.caseType || 'Case type not set'}</div></button><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${template.draft ? 'bg-amber-100 text-amber-800' : template.active ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'}`}>{template.draft ? 'Draft' : template.active ? 'Active' : 'Inactive'}</span><button type="button" onClick={() => edit(template)} className={secondary}>Edit</button><button type="button" onClick={() => void remove(template)} className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">Delete</button></div></div>{isEditing && <WorkflowEditor form={form} setForm={setForm} saving={saving} isDraft={Boolean(template.draft)} onClose={close} onSave={save} />}</article>; })}</div></div>;
}

function WorkflowEditor({ form, setForm, saving, isDraft, onClose, onSave }: { form: WorkflowForm; setForm: Dispatch<SetStateAction<WorkflowForm | null>>; saving: boolean; isDraft: boolean; onClose: () => void; onSave: (draft: boolean) => Promise<void> }) {
  const [review, setReview] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const total = useMemo(() => workflowTotal(form), [form]);
  const errors = useMemo(() => validate(form, false), [form]);
  const update = (callback: (current: WorkflowForm) => WorkflowForm) => setForm((current) => current ? callback(current) : current);
  const updateSection = (sectionId: string, patch: Partial<Section>) => update((current) => ({ ...current, sections: current.sections.map((section) => section.id === sectionId ? { ...section, ...patch } : section) }));
  const updateAction = (actionId: string, patch: Partial<KeyAction>) => update((current) => ({ ...current, actions: current.actions.map((action) => action.id === actionId ? { ...action, ...patch } : action) }));
  const addSection = () => update((current) => ({ ...current, sections: [...current.sections, newSection(current.sections.length + 1, new Set(current.sections.map((section) => section.key)))] }));
  const addAction = (sectionKey: string) => update((current) => ({ ...current, actions: [...current.actions, newAction(sectionKey, current.actions.length + 1, new Set(current.actions.map((action) => action.key)))] }));
  const removeSection = (section: Section) => { if (!window.confirm('Remove this SECTION and its KEY ACTIONS?')) return; update((current) => ({ ...current, sections: current.sections.filter((item) => item.id !== section.id), actions: current.actions.filter((action) => action.sectionKey !== section.key) })); };
  const publish = async (draft: boolean) => { setShowErrors(true); if (!validate(form, draft).length) await onSave(draft); };
  return <div className="border-t border-gray-200 bg-white p-4 sm:p-6"><div className="mb-5 flex flex-col gap-3 border-b border-gray-200 pb-4 sm:flex-row sm:items-start sm:justify-between"><div><div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{isDraft ? 'Draft Workflow' : 'Workflow Editor'}</div><h3 className="mt-1 text-lg font-semibold text-gray-900">{form.name || 'New Workflow'}</h3></div><div className="flex flex-wrap gap-2">{isDraft && <button type="button" onClick={() => void publish(true)} disabled={saving} className={secondary}>{saving ? 'Saving...' : 'Save Draft'}</button>}<button type="button" onClick={() => void publish(false)} disabled={saving} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60">{saving ? 'Saving...' : isDraft ? 'Publish Workflow' : 'Save Changes'}</button><button type="button" onClick={onClose} className={secondary}>Close</button></div></div><section className="rounded-lg border border-gray-200 bg-gray-50 p-4"><div className="grid gap-4 lg:grid-cols-3"><Field label="WORKFLOW NAME"><input value={form.name} onChange={(event) => update((current) => ({ ...current, name: event.target.value }))} className={input} placeholder="e.g., PROCEDURE FOR BUSINESS REGISTRATION" /></Field><Field label="MATTER TYPE"><input value={form.matterType} onChange={(event) => update((current) => ({ ...current, matterType: event.target.value }))} className={input} placeholder="e.g., Business Registration" /></Field><Field label="CASE TYPE"><select value={form.caseType} onChange={(event) => update((current) => ({ ...current, caseType: event.target.value as CaseType }))} className={input}><option value="Transactional Cases">Transactional Cases</option><option value="Litigation Cases">Litigation Cases</option><option value="Labor Cases">Labor Cases</option></select></Field></div><label className="mt-4 inline-flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={form.active} onChange={(event) => update((current) => ({ ...current, active: event.target.checked }))} /> Active - available in case workflow selections</label></section><section className="mt-5 space-y-4"><div className={`rounded-lg border p-4 ${total > 100 ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50'}`}><div className="text-sm font-semibold text-gray-900">PERCENTAGE ALLOCATION</div><div className="mt-1 text-sm text-gray-600">Key actions allocated <span className="font-semibold text-gray-900">{displayPercentage(total)}</span> · Remaining <span className="font-semibold text-gray-900">{displayPercentage(100 - total)}</span></div>{total > 100 && <p className="mt-2 text-sm text-red-700">The total KEY ACTION PERCENTAGE cannot exceed 100%.</p>}</div><div className="rounded-lg border border-gray-200 bg-gray-50 p-4"><div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Reference document hierarchy</div><div className="mt-2 grid gap-2 text-sm font-semibold text-gray-900 sm:grid-cols-2 lg:grid-cols-7"><span>STAGE</span><span>STAGE PERCENTAGE</span><span>LEGAL BASIS</span><span>OUTPUT</span><span>KEY ACTIONS</span><span>FEES</span><span>TIMELINES</span></div><p className="mt-2 text-xs text-gray-600">Enter the stage percentage, then enter Key Action percentages that total the same amount.</p></div>{form.sections.map((section, sectionIndex) => { const actions = form.actions.filter((action) => action.sectionKey === section.key).sort((a, b) => a.order - b.order); return <SectionEditor key={section.id} section={section} number={sectionIndex + 1} actions={actions} total={total} onChange={(patch) => updateSection(section.id, patch)} onAddAction={() => addAction(section.key)} onActionChange={updateAction} onRemoveAction={(actionId) => update((current) => ({ ...current, actions: current.actions.filter((action) => action.id !== actionId) }))} onRemove={() => removeSection(section)} />; })}<div className="flex justify-end border-t border-gray-200 pt-4"><button type="button" onClick={addSection} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800">+ Add New Section</button></div></section><div className="mt-5 flex flex-wrap gap-2 border-t border-gray-200 pt-4"><button type="button" onClick={() => setReview((value) => !value)} className={secondary}>{review ? 'Hide Review' : 'Review Workflow'}</button>{review && <button type="button" onClick={() => void publish(false)} disabled={saving} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-60">{saving ? 'Saving...' : 'Save Workflow'}</button>}</div>{review && <Review form={form} total={total} errors={errors} />}{showErrors && errors.length > 0 && <div className="mt-4 rounded border border-red-200 bg-red-50 p-3"><div className="font-semibold text-red-800">Resolve these items before publishing</div><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-700">{errors.map((error) => <li key={error}>{error}</li>)}</ul></div>}</div>;
}

function SectionEditor({ section, number: sectionNumber, actions, total, onChange, onAddAction, onActionChange, onRemoveAction, onRemove }: { section: Section; number: number; actions: KeyAction[]; total: number; onChange: (patch: Partial<Section>) => void; onAddAction: () => void; onActionChange: (id: string, patch: Partial<KeyAction>) => void; onRemoveAction: (id: string) => void; onRemove: () => void }) {
  const actionPercentage = actionTotal(actions);
  const stagePercentage = asPercentage(section.percentage);
  const mismatch = stagePercentage !== undefined && actions.length > 0 && Math.abs(stagePercentage - actionPercentage) > 0.0001;
  const updateBasis = (basisId: string, text: string) => onChange({ legalBasis: section.legalBasis.map((basis) => basis.id === basisId ? { ...basis, text } : basis) });
  const updateOutput = (outputId: string, patch: Partial<Output>) => onChange({ outputs: section.outputs.map((output) => output.id === outputId ? { ...output, ...patch } : output) });
  return <article className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"><div className="flex flex-wrap items-center gap-3 bg-gray-50 px-4 py-3"><div><div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Section {sectionNumber}</div><div className="text-sm font-semibold text-gray-900">{section.stage || 'Untitled Stage'}</div></div><div className="ml-auto flex items-center gap-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${mismatch ? 'bg-red-100 text-red-700' : 'bg-blue-50 text-blue-800'}`}>{displayPercentage(stagePercentage)}</span><button type="button" onClick={onRemove} className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">Remove Section</button></div></div><div className="space-y-5 p-4"><div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]"><Field label="STAGE"><input value={section.stage} onChange={(event) => onChange({ stage: event.target.value })} className={input} placeholder="e.g., Client Intake & Preliminary Legal Assessment" /></Field><Field label="STAGE PERCENTAGE"><PercentageInput value={section.percentage} onChange={(value) => onChange({ percentage: value })} invalid={stagePercentage === undefined && Boolean(section.percentage)} placeholder="e.g., 8" /></Field></div><div className={`rounded border px-3 py-2 text-xs ${mismatch ? 'border-red-200 bg-red-50 text-red-700' : 'border-blue-100 bg-blue-50 text-blue-800'}`}>Key Action total: {displayPercentage(actionPercentage)}. {mismatch ? 'It must match the STAGE PERCENTAGE before publishing.' : 'Enter Key Action percentages until this equals the STAGE PERCENTAGE.'}</div><div className="rounded-lg border border-gray-200 bg-gray-50 p-4"><div className="mb-3 text-sm font-semibold text-gray-900">KEY ACTIONS</div><div className="space-y-3">{actions.map((action, actionIndex) => <KeyActionEditor key={action.id} action={action} number={actionIndex + 1} total={total} onChange={(patch) => onActionChange(action.id, patch)} onRemove={() => onRemoveAction(action.id)} />)}</div>{!actions.length && <p className="rounded border border-dashed border-gray-300 bg-white p-3 text-sm text-gray-500">Add a Key Action. Its number is assigned automatically.</p>}<div className="mt-3 flex justify-end"><button type="button" onClick={onAddAction} className={secondary}>+ Add Key Action</button></div></div><div className="grid gap-4 border-t border-gray-200 pt-5 lg:grid-cols-2"><Field label="LEGAL BASIS"><div className="space-y-2">{section.legalBasis.map((basis) => <div key={basis.id} className="flex gap-2"><input value={basis.text} onChange={(event) => updateBasis(basis.id, event.target.value)} className={smallInput} placeholder="Law, article, regulation, policy, or internal basis" /><button type="button" onClick={() => onChange({ legalBasis: section.legalBasis.filter((item) => item.id !== basis.id) })} className="text-xs text-red-700 hover:underline">Remove</button></div>)}<button type="button" onClick={() => onChange({ legalBasis: [...section.legalBasis, { id: id('basis'), text: '' }] })} className="text-sm font-medium text-blue-700 hover:underline">+ Add Legal Basis</button></div></Field><Field label="OUTPUT"><div className="space-y-2">{section.outputs.map((output) => <div key={output.id} className="rounded border border-gray-200 bg-white p-2"><div className="grid gap-2 sm:grid-cols-2"><input value={output.name} onChange={(event) => updateOutput(output.id, { name: event.target.value })} className={smallInput} placeholder="Output / document name" /><input value={output.category} onChange={(event) => updateOutput(output.id, { category: event.target.value })} className={smallInput} placeholder="Category (optional)" /><input value={output.key} onChange={(event) => updateOutput(output.id, { key: event.target.value })} className={smallInput} placeholder="Output key (optional)" /><label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={output.required} onChange={(event) => updateOutput(output.id, { required: event.target.checked })} /> Required</label></div><button type="button" onClick={() => onChange({ outputs: section.outputs.filter((item) => item.id !== output.id) })} className="mt-2 text-xs text-red-700 hover:underline">Remove Output</button></div>)}<button type="button" onClick={() => onChange({ outputs: [...section.outputs, { id: id('output'), key: '', name: '', category: '', required: false }] })} className="text-sm font-medium text-blue-700 hover:underline">+ Add Output</button></div></Field><FeeEditor fee={section.fee} onChange={(fee) => onChange({ fee })} /><TimelineEditor timeline={section.timeline} onChange={(timeline) => onChange({ timeline })} /></div></div></article>;
}

function KeyActionEditor({ action, number: actionNumber, total, onChange, onRemove }: { action: KeyAction; number: number; total: number; onChange: (patch: Partial<KeyAction>) => void; onRemove: () => void }) { const value = asPercentage(action.percentage); const invalid = (!!action.percentage && value === undefined) || (value !== undefined && (value < 0 || value > 100)); return <div className="rounded-md border border-gray-200 bg-white p-4"><div className="mb-3 flex items-center justify-between"><span className="text-sm font-semibold text-gray-900">KEY ACTION {actionNumber}</span><button type="button" onClick={onRemove} className="text-sm text-red-700 hover:underline">Remove</button></div><div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px]"><Field label="KEY ACTION"><textarea value={action.title} onChange={(event) => onChange({ title: event.target.value })} rows={3} className={input} placeholder="e.g., Conduct conflict of interest check and collect client instructions" /></Field><Field label="PERCENTAGE"><PercentageInput value={action.percentage} onChange={(percentage) => onChange({ percentage })} invalid={invalid || total > 100} placeholder="e.g., 2 or 1.5" />{invalid && <p className="mt-1 text-xs text-red-600">Enter a number from 0 to 100.</p>}</Field></div></div>; }
function PercentageInput({ value, onChange, invalid, placeholder }: { value: string; onChange: (value: string) => void; invalid?: boolean; placeholder: string }) { return <div className="relative"><input value={value} onChange={(event) => onChange(event.target.value)} className={`${input} ${invalid ? 'border-red-500 ring-1 ring-red-300' : ''}`} inputMode="decimal" placeholder={placeholder} /><span className="pointer-events-none absolute right-3 top-2 text-sm text-gray-500">%</span></div>; }
function FeeEditor({ fee, onChange }: { fee: Fee; onChange: (fee: Fee) => void }) { const update = (patch: Partial<Fee>) => onChange({ ...fee, ...patch }); return <div className="rounded border border-gray-200 bg-white p-3"><div className="text-sm font-semibold text-gray-900">FEES</div><div className="mt-2 grid gap-2 sm:grid-cols-2"><select value={fee.type} onChange={(event) => update({ type: event.target.value as FeeType })} className={smallInput}><option value="none">No fee configured</option><option value="fixed">Fixed fee</option><option value="range">Fee range</option><option value="percentage">Percentage fee</option><option value="text">Text / other fee</option><option value="included">Included in advisory fee</option></select>{['fixed', 'range'].includes(fee.type) && <input value={fee.currency} onChange={(event) => update({ currency: event.target.value.toUpperCase() })} className={smallInput} placeholder="Currency" />}{fee.type === 'fixed' && <input value={fee.min} onChange={(event) => update({ min: event.target.value })} className={smallInput} inputMode="decimal" placeholder="Amount" />}{fee.type === 'range' && <><input value={fee.min} onChange={(event) => update({ min: event.target.value })} className={smallInput} inputMode="decimal" placeholder="Minimum" /><input value={fee.max} onChange={(event) => update({ max: event.target.value })} className={smallInput} inputMode="decimal" placeholder="Maximum" /></>}{fee.type === 'percentage' && <input value={fee.percentage} onChange={(event) => update({ percentage: event.target.value })} className={smallInput} inputMode="decimal" placeholder="Fee percentage" />}</div>{fee.type !== 'none' && <input value={fee.text} onChange={(event) => update({ text: event.target.value })} className={`mt-2 ${smallInput}`} placeholder="Fee note, regulation, or included-fee text" />}</div>; }
function TimelineEditor({ timeline, onChange }: { timeline: Timeline; onChange: (timeline: Timeline) => void }) { const update = (patch: Partial<Timeline>) => onChange({ ...timeline, ...patch }); return <div className="rounded border border-gray-200 bg-white p-3"><div className="text-sm font-semibold text-gray-900">TIMELINES</div><div className="mt-2 grid gap-2 sm:grid-cols-3"><input value={timeline.min} onChange={(event) => update({ min: event.target.value })} className={smallInput} inputMode="decimal" placeholder="Minimum" /><input value={timeline.max} onChange={(event) => update({ max: event.target.value })} className={smallInput} inputMode="decimal" placeholder="Maximum" /><select value={timeline.unit} onChange={(event) => update({ unit: event.target.value as Unit })} className={smallInput}><option value="hours">Hours</option><option value="days">Days</option><option value="weeks">Weeks</option></select></div><input value={timeline.text} onChange={(event) => update({ text: event.target.value })} className={`mt-2 ${smallInput}`} placeholder="e.g., within 1-2 hours; complete within 24 hours" /></div>; }
function feeText(fee: Fee) { if (fee.type === 'included') return fee.text || 'Included in advisory fee'; if (fee.type === 'range') return [fee.currency, fee.min && fee.max ? `${fee.min} - ${fee.max}` : '', fee.text].filter(Boolean).join(' '); if (fee.type === 'fixed') return [fee.currency, fee.min, fee.text].filter(Boolean).join(' '); if (fee.type === 'percentage') return [`${fee.percentage}%`, fee.text].filter(Boolean).join(' '); return fee.text || '—'; }
function timelineText(timeline: Timeline) { if (timeline.text) return timeline.text; const range = [timeline.min, timeline.max].filter(Boolean).join(' - '); return range ? `${range} ${timeline.unit}` : '—'; }
function Review({ form, total, errors }: { form: WorkflowForm; total: number; errors: string[] }) { return <section className="mt-5 space-y-4"><div className="rounded-lg border border-gray-200 p-4"><h4 className="text-base font-semibold text-gray-900">Workflow Review</h4><div className="mt-2 text-sm text-gray-600">{form.name || 'Workflow name not set'} · {displayPercentage(total)} Key Actions allocated</div></div>{form.sections.map((section, sectionIndex) => { const actions = form.actions.filter((action) => action.sectionKey === section.key).sort((a, b) => a.order - b.order); const rows = actions.length ? actions : [undefined]; return <div key={section.id} className="overflow-hidden rounded-lg border border-gray-200"><div className="bg-gray-100 px-4 py-3 text-center text-sm font-semibold text-gray-900">SECTION {sectionIndex + 1}: {section.stage || 'Untitled STAGE'} {section.percentage ? `${section.percentage}%` : ''}</div><div className="overflow-x-auto"><table className="min-w-[860px] w-full text-left text-xs"><thead className="bg-gray-900 text-white"><tr><th className="p-3">STAGE</th><th className="p-3">LEGAL BASIS</th><th className="p-3">OUTPUT</th><th className="p-3">KEY ACTIONS</th><th className="p-3">PERCENTAGE</th><th className="p-3">FEES</th><th className="p-3">TIMELINES</th></tr></thead><tbody>{rows.map((action, index) => <tr key={action?.id || `${section.id}_empty`} className="border-t border-gray-200 align-top">{index === 0 && <><td rowSpan={rows.length} className="bg-gray-50 p-3 font-semibold text-gray-900">{section.stage || '—'}</td><td rowSpan={rows.length} className="p-3 text-gray-700">{section.legalBasis.map((item) => item.text).filter(Boolean).join('; ') || '—'}</td><td rowSpan={rows.length} className="p-3 text-gray-700">{section.outputs.map((item) => item.name).filter(Boolean).join('; ') || '—'}</td></>}<td className="p-3 text-gray-900">{action ? `${index + 1}. ${action.title || '—'}` : '—'}</td><td className="p-3 font-semibold text-gray-900">{action?.percentage ? `${action.percentage}%` : '—'}</td>{index === 0 && <><td rowSpan={rows.length} className="p-3 text-gray-700">{feeText(section.fee)}</td><td rowSpan={rows.length} className="p-3 text-gray-700">{timelineText(section.timeline)}</td></>}</tr>)}</tbody></table></div></div>; })}{errors.length > 0 && <div className="rounded border border-red-200 bg-red-50 p-4"><div className="font-semibold text-red-800">Not ready to publish</div><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-700">{errors.map((error) => <li key={error}>{error}</li>)}</ul></div>}</section>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <div><label className="mb-1 block text-xs font-semibold tracking-wide text-gray-600">{label}</label>{children}</div>; }
function Message({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) { return <div className={`mt-4 rounded border px-4 py-3 text-sm ${tone === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-800'}`}>{children}</div>; }
