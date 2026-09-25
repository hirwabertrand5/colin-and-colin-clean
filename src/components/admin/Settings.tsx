import { Fragment, useEffect, useMemo, useState } from 'react';
import { Save, Mail, Database, Shield, Bell, GitBranch, ChevronDown } from 'lucide-react';
import { sendTestEmail } from '../../services/adminEmailService';
import usePageTitle from '../../hooks/usePageTitle';
import {
  getMyNotificationPreferences,
  updateMyNotificationPreferences,
  NotificationPreferences,
} from '../../services/notificationPreferencesService';

import WorkflowTemplates from './WorkflowTemplates';
import { listAllWorkflowTemplates, WorkflowTemplate } from '../../services/workflowService';
import SortableHeader from '../ui/SortableHeader';
import TableExport from '../ui/TableExport';
import { sortRows, SortDir } from '../../utils/tableSort';
import { bulletLines, numberedKeyAction } from '../../utils/workflowFormat';
import {
  getIntakeAutomationConfig,
  updateIntakeAutomationConfig,
  IntakeAutomationConfig,
} from '../../services/intakeAutomationConfigService';

type WorkflowRow = {
  stage: string;
  keyActions: string;
  output: string;
  legalBasis: string;
  timeline: string;
  percentage?: number;
};

type WorkflowSection = {
  id: string;
  title: string;
  percentage?: number;
  output: string;
  legalBasis: string;
  timeline: string;
  rows: WorkflowRow[];
};

type WorkflowDoc = {
  id: string;
  title: string;
  active: boolean;
  sections: WorkflowSection[];
};

type TemplateStage = {
  key: string;
  order?: number;
  title: string;
  percentage?: number;
  outputs?: TemplateOutput[];
  legalBasis?: TemplateLegalBasis[];
  sla?: TemplateSla;
};
type TemplateOutput =
  | string
  | { key?: string; name?: string; required?: boolean; category?: string; text?: string; title?: string };
type TemplateLegalBasis = string | { text?: string; title?: string };
type TemplateSla = string | { text?: string; min?: number; max?: number; unit?: string };
type TemplateStep = {
  key?: string;
  order?: number;
  stageKey?: string;
  title?: string;
  actions?: string[];
  outputs?: TemplateOutput[];
  legalBasis?: TemplateLegalBasis[];
  sla?: TemplateSla;
  percentage?: number;
};

function CellList({ text }: { text: string }) {
  const lines = useMemo(() => {
    if (!text) return [];
    // split on newlines OR when "1. " appears (keeps your numbered items readable)
    return text
      .split(/\n|(?=\d+\.\s)/g)
      .map((s) => s.trim())
      .filter(Boolean);
  }, [text]);

  if (lines.length <= 1) return <span className="whitespace-pre-wrap">{text}</span>;

  return (
    <ul className="list-disc pl-5 space-y-1">
      {lines.map((l, i) => (
        <li key={i} className="whitespace-pre-wrap">
          {l}
        </li>
      ))}
    </ul>
  );
}

function WorkflowTable({ sections }: { sections: WorkflowSection[] }) {
  // Legacy table markup remains below only for a gradual rendering change.
  // The visible table is the grouped section table rendered before it.
  const sortedRows: WorkflowRow[] = [];
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const handleSort = (column: string) => {
    setSortKey((current) => current === column ? current : column);
    setSortDir((current) => sortKey === column && current === 'asc' ? 'desc' : 'asc');
  };
  const exportRows = sections.flatMap((section) => {
    const rows = section.rows.length ? section.rows : [{ stage: '', keyActions: '', output: '', legalBasis: '', timeline: '', percentage: undefined }];
    return rows.map((row, index) => ({
      stage: index === 0 ? section.title : '',
      keyActions: row.keyActions,
      output: index === 0 ? bulletLines(section.output) : '',
      legalBasis: index === 0 ? bulletLines(section.legalBasis) : '',
      percentage: row.percentage,
      timeline: index === 0 ? section.timeline : '',
    }));
  });
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <div className="mb-2 flex items-center justify-end">
        <TableExport
          filename="workflow_template"
          title="Workflow Stages & Key Actions"
          subtitle={`${sections.length} sections`}
          columns={[
            { label: 'Stage', value: (r: WorkflowRow) => r.stage },
            { label: 'Key Actions', value: (r: WorkflowRow) => r.keyActions },
            { label: 'Output', value: (r: WorkflowRow) => r.output },
            { label: 'Legal Basis', value: (r: WorkflowRow) => r.legalBasis },
            { label: 'Percentage', value: (r: WorkflowRow) => (r.percentage != null ? `${r.percentage}%` : '—') },
            { label: 'Timeline', value: (r: WorkflowRow) => r.timeline },
          ]}
          rows={exportRows}
        />
      </div>
      <table className="min-w-[1100px] w-full text-sm">
        <thead className="bg-gray-900 text-white">
          <tr>
            <th className="p-3 text-left">STAGE</th>
            <th className="p-3 text-left">LEGAL BASIS</th>
            <th className="p-3 text-left">OUTPUT</th>
            <th className="p-3 text-left">KEY ACTIONS</th>
            <th className="p-3 text-left">PERCENTAGE</th>
            <th className="p-3 text-left">TIMELINES</th>
          </tr>
        </thead>
        <tbody className="bg-white">
          {sections.map((section) => {
            const rows = section.rows.length
              ? section.rows
              : [{ stage: '', keyActions: '', output: '', legalBasis: '', timeline: '', percentage: undefined }];
            return (
              <Fragment key={section.id}>
                <tr className="bg-gray-100">
                  <td colSpan={6} className="px-4 py-2 text-center font-semibold text-gray-900">
                    {section.title}{section.percentage != null ? ` ${section.percentage}%` : ''}
                  </td>
                </tr>
                {rows.map((row, index) => (
                  <tr key={`${section.id}-${index}`} className="align-top">
                    {index === 0 && <>
                      <td rowSpan={rows.length} className="p-3 border-b font-medium text-gray-900 whitespace-pre-wrap">{section.title}</td>
                      <td rowSpan={rows.length} className="p-3 border-b text-gray-700"><CellList text={section.legalBasis} /></td>
                      <td rowSpan={rows.length} className="p-3 border-b text-gray-700"><CellList text={section.output} /></td>
                    </>}
                    <td className="p-3 border-b text-gray-700 whitespace-pre-wrap">{row.keyActions || '—'}</td>
                    <td className="p-3 border-b text-gray-700 whitespace-pre-wrap">{row.percentage != null ? `${row.percentage}%` : '—'}</td>
                    {index === 0 && <td rowSpan={rows.length} className="p-3 border-b text-gray-700"><CellList text={section.timeline} /></td>}
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <table className="hidden min-w-[1100px] w-full text-sm" aria-hidden="true">
        <thead className="bg-gray-50 text-gray-700">
          <tr>
            <th className="p-3 text-left">STAGE</th>
            <th className="p-3 text-left">LEGAL BASIS</th>
            <th className="p-3 text-left">OUTPUT</th>
            <th className="p-3 text-left">KEY ACTIONS</th>
            <th className="p-3 text-left">PERCENTAGE</th>
            <th className="p-3 text-left">TIMELINES</th>
          </tr>
        </thead>
        <tbody className="bg-white">
          {sortedRows.map((r, idx) => (
            <tr key={idx} className="align-top">
              <td className="p-3 border-b font-medium text-gray-900 whitespace-pre-wrap">{r.stage}</td>
              <td className="p-3 border-b text-gray-700">
                <CellList text={r.keyActions} />
              </td>
              <td className="p-3 border-b text-gray-700 whitespace-pre-wrap">{r.output}</td>
              <td className="p-3 border-b text-gray-700 whitespace-pre-wrap">{r.legalBasis}</td>
              <td className="p-3 border-b text-gray-700 whitespace-pre-wrap">
                {r.percentage != null ? `${r.percentage}%` : '—'}
              </td>
              <td className="p-3 border-b text-gray-700 whitespace-pre-wrap">{r.timeline}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Settings() {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  usePageTitle('Settings');
  const [testSending, setTestSending] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [automationConfig, setAutomationConfig] = useState<IntakeAutomationConfig | null>(null);
  const [automationConfigLoading, setAutomationConfigLoading] = useState(false);
  const [automationConfigSaving, setAutomationConfigSaving] = useState(false);
  const [automationConfigErr, setAutomationConfigErr] = useState('');
  const [automationConfigMsg, setAutomationConfigMsg] = useState('');

  // Workflows UI state
  const [openWorkflowId, setOpenWorkflowId] = useState<string>('');
  const [workflowTemplates, setWorkflowTemplates] = useState<WorkflowTemplate[]>([]);
  const [workflowTemplatesLoading, setWorkflowTemplatesLoading] = useState(false);
  const [workflowTemplatesErr, setWorkflowTemplatesErr] = useState('');

  const loadWorkflowTemplates = async (shouldUpdate: () => boolean = () => true) => {
    if (!shouldUpdate()) return;
    setWorkflowTemplatesLoading(true);
    setWorkflowTemplatesErr('');
    try {
      const data = await listAllWorkflowTemplates();
      if (!shouldUpdate()) return;
      setWorkflowTemplates(data);
      setOpenWorkflowId((cur) => cur || data?.[0]?._id || '');
    } catch (e: any) {
      if (!shouldUpdate()) return;
      setWorkflowTemplatesErr(e?.message || 'Failed to load workflows');
    } finally {
      if (!shouldUpdate()) return;
      setWorkflowTemplatesLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      await loadWorkflowTemplates(() => mounted);
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const workflows: WorkflowDoc[] = useMemo(() => {
    const stageTitleByTemplateId: Record<string, Record<string, string>> = {};

    for (const t of workflowTemplates) {
      const stages = (t.stages || []) as TemplateStage[];
      stageTitleByTemplateId[t._id] = stages.reduce<Record<string, string>>((acc, s) => {
        if (s?.key) acc[s.key] = s.title;
        return acc;
      }, {});
    }

    const normalizeOutputs = (outputs: TemplateOutput[] | undefined) => {
      if (!outputs?.length) return '';
      return outputs
        .map((o) => {
          if (typeof o === 'string') return o;
          const name = o.name || o.title || o.text || '';
          const required = o.required ? ' (required)' : '';
          const category = o.category ? ` — ${o.category}` : '';
          return `${name}${required}${category}`.trim();
        })
        .filter(Boolean)
        .join('\n');
    };

    const normalizeLegalBasis = (legalBasis: TemplateLegalBasis[] | undefined) => {
      if (!legalBasis?.length) return '';
      return legalBasis
        .map((b) => (typeof b === 'string' ? b : b.text || b.title || ''))
        .filter(Boolean)
        .join('\n');
    };

    const normalizeSla = (sla: TemplateSla | undefined) => {
      if (!sla) return '';
      if (typeof sla === 'string') return sla;
      if (sla.text) return sla.text;
      const range = [sla.min, sla.max].filter((value): value is number => typeof value === 'number').join(' - ');
      return range ? `${range} ${sla.unit || 'days'}` : '';
    };

    // Settings-page display rule: show only the original active workflows. When
    // the same workflow exists as several copies/versions, keep the most recently
    // updated copy. This is a display change only — nothing is deleted from the DB.
    const templateUpdatedAt = (t: WorkflowTemplate) => {
      const record = t as WorkflowTemplate & { updatedAt?: unknown; createdAt?: unknown };
      const source = record.updatedAt || record.createdAt;
      const parsed = source ? new Date(String(source)).getTime() : Number.NaN;
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const dedupeKey = (t: WorkflowTemplate) =>
      `${(t.matterType || '').trim().toLowerCase()}::${(t.name || '').trim().toLowerCase()}`;
    const templatesSorted = workflowTemplates
      .filter((t) => Boolean(t.active) && !t.draft)
      .reduce<WorkflowTemplate[]>((unique, t) => {
        const key = dedupeKey(t);
        const index = unique.findIndex((u) => dedupeKey(u) === key);
        if (index === -1) {
          unique.push(t);
        } else if (templateUpdatedAt(t) > templateUpdatedAt(unique[index])) {
          unique[index] = t;
        }
        return unique;
      }, [])
      .sort((a, b) => {
        const aMatter = (a.matterType || '').toLowerCase();
        const bMatter = (b.matterType || '').toLowerCase();
        if (aMatter !== bMatter) return aMatter.localeCompare(bMatter);
        return (a.name || '').localeCompare(b.name || '');
      });

    return templatesSorted.map((t) => {
      const steps = (t.steps || []) as TemplateStep[];
      const stepsSorted = [...steps].sort((a, b) => (a.order || 0) - (b.order || 0));
      const stages = [...((t.stages || []) as TemplateStage[])].sort((a, b) => (a.order || 0) - (b.order || 0));

      // Automatic Key Action number — derived from the Key Action's position in
      // the workflow, spanning every stage/step so it never restarts (1…N).
      let globalActionNumber = 0;

      return {
        id: t._id,
        title: `${t.matterType || t.name}${t.name && t.matterType !== t.name ? ` — ${t.name}` : ''}`,
        active: Boolean(t.active),
        sections: stages.map((stage, sectionIndex) => {
          const sectionSteps = stepsSorted.filter((step) => String(step.stageKey || '') === stage.key);
          const firstStep = sectionSteps[0];
          // One row per Key Action (= one workflow step). The Key Actions column
          // shows the text entered in the builder — never the step's internal
          // checklist — so the review table, the exports and the editor always
          // list the same Key Actions with the same numbers and percentages.
          const rows = sectionSteps.map((step) => {
            globalActionNumber += 1;
            const keyActionText = String(step.title || step.actions?.[0] || '').trim();
            return {
              stage: '',
              keyActions: keyActionText ? numberedKeyAction(keyActionText, globalActionNumber) : '',
              output: '',
              legalBasis: '',
              timeline: '',
              percentage: typeof step.percentage === 'number' ? step.percentage : undefined,
            };
          });
          return {
            id: `${t._id}_${stage.key}`,
            title: `SECTION ${sectionIndex + 1}: ${stage.title || stage.key || 'Untitled Stage'}`,
            percentage: typeof stage.percentage === 'number' ? stage.percentage : undefined,
            output: normalizeOutputs(stage.outputs) || normalizeOutputs(firstStep?.outputs),
            legalBasis: normalizeLegalBasis(stage.legalBasis) || normalizeLegalBasis(firstStep?.legalBasis),
            timeline: normalizeSla(stage.sla) || normalizeSla(firstStep?.sla),
            rows,
          };
        }),
      };
    });
  }, [workflowTemplates]);

  // Auto-open the first visible workflow when none is selected yet.
  useEffect(() => {
    if (!openWorkflowId && workflows.length) setOpenWorkflowId(workflows[0].id);
  }, [openWorkflowId, workflows]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        setErr('');
        const p = await getMyNotificationPreferences();
        if (!mounted) return;
        setPrefs(p);
      } catch (e: any) {
        if (!mounted) return;
        setErr(e?.message || 'Failed to load settings');
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setAutomationConfigLoading(true);
        setAutomationConfigErr('');
        const config = await getIntakeAutomationConfig();
        if (!mounted) return;
        setAutomationConfig(config);
      } catch (e: any) {
        if (!mounted) return;
        setAutomationConfigErr(e?.message || 'Failed to load intake automation settings');
      } finally {
        if (!mounted) return;
        setAutomationConfigLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const onSave = async () => {
    if (!prefs) return;
    try {
      setSaving(true);
      setErr('');
      setMsg('');
      const saved = await updateMyNotificationPreferences(prefs);
      setPrefs(saved);
      setMsg('Saved.');
      setTimeout(() => setMsg(''), 2000);
    } catch (e: any) {
      setErr(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const onSaveAutomationConfig = async () => {
    if (!automationConfig) return;
    try {
      setAutomationConfigSaving(true);
      setAutomationConfigErr('');
      setAutomationConfigMsg('');
      const saved = await updateIntakeAutomationConfig(automationConfig);
      setAutomationConfig(saved);
      setAutomationConfigMsg('Automation settings saved.');
      setTimeout(() => setAutomationConfigMsg(''), 2500);
    } catch (e: any) {
      setAutomationConfigErr(e?.message || 'Failed to save automation settings');
    } finally {
      setAutomationConfigSaving(false);
    }
  };

  const onTestEmail = async () => {
    try {
      setTestSending(true);
      setErr('');
      setMsg('');
      const resp = await sendTestEmail(testTo || undefined);
      setMsg(resp.message || 'Test email triggered.');
      setTimeout(() => setMsg(''), 3000);
    } catch (e: any) {
      setErr(e?.message || 'Failed to send test email');
    } finally {
      setTestSending(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">System Settings</h1>
        <p className="text-gray-600">Configure system-wide settings and integrations</p>
      </div>

      {err && (
        <div className="mb-6 p-4 border border-red-200 bg-red-50 text-red-700 rounded">
          {err}
        </div>
      )}
      {msg && (
        <div className="mb-6 p-4 border border-green-200 bg-green-50 text-green-700 rounded">
          {msg}
        </div>
      )}

      <div className="space-y-6">
        {/* General Settings (still static for now) */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center mb-4">
            <Shield className="w-5 h-5 text-gray-700 mr-2" />
            <h2 className="text-lg font-semibold text-gray-900">General Settings</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Firm Name</label>
              <input
                type="text"
                defaultValue="Colin & Colin Legal Solutions Ltd"
                className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Firm Address</label>
              <input
                type="text"
                defaultValue="EDC Plaza, Adjacent to Swiss Embassy, KN 4 Avenue, Kigali"
                className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
              />
            </div>
          </div>
        </div>

        {/* ✅ Workflow templates editor (your existing component) */}
        <WorkflowTemplates onTemplateSaved={() => void loadWorkflowTemplates()} />

        {/* ✅ NEW: Workflows section (like the others) */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center mb-4">
            <GitBranch className="w-5 h-5 text-gray-700 mr-2" />
            <h2 className="text-lg font-semibold text-gray-900">Workflows</h2>
          </div>

          {workflowTemplatesErr && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 text-red-700 rounded">
              {workflowTemplatesErr}
            </div>
          )}

          {workflowTemplatesLoading ? (
            <div className="text-sm text-gray-500">Loading workflows…</div>
          ) : workflows.length === 0 ? (
            <div className="text-sm text-gray-500">No workflows found.</div>
          ) : (
            <div className="space-y-3">
              {workflows.map((wf) => {
                const open = openWorkflowId === wf.id;
                return (
                  <div key={wf.id} className="border border-gray-200 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setOpenWorkflowId((cur) => (cur === wf.id ? '' : wf.id))}
                      className="w-full flex items-center justify-between px-4 py-3 text-left"
                    >
                      <span className="text-sm font-medium text-gray-900">
                          <span className="inline-flex items-center gap-2">
                            <span>{wf.title}</span>
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                                wf.active
                                  ? 'border-emerald-600 bg-emerald-600 text-white shadow-sm dark:border-emerald-300 dark:bg-emerald-400 dark:text-emerald-950'
                                  : 'border-gray-300 bg-gray-200 text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300'
                              }`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                  wf.active ? 'bg-white dark:bg-emerald-950' : 'bg-gray-500 dark:bg-gray-400'
                                }`}
                              />
                              {wf.active ? 'Active' : 'Inactive'}
                            </span>
                          </span>
                        </span>
                      <ChevronDown
                        className={`w-4 h-4 text-gray-500 transition-transform ${
                          open ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    {open && (
                      <div className="px-4 pb-4">
                        <WorkflowTable sections={wf.sections} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <p className="mt-3 text-xs text-gray-500">
            These are reference workflow templates (display only). Edit templates above to change how new case workflows are generated.
          </p>
        </div>

        {/* Email Integration */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center mb-4">
            <Mail className="w-5 h-5 text-gray-700 mr-2" />
            <h2 className="text-lg font-semibold text-gray-900">Email Integration</h2>
          </div>

          <div className="space-y-4">
            {loading ? (
              <div className="text-sm text-gray-500">Loading…</div>
            ) : !prefs ? (
              <div className="text-sm text-gray-500">No preferences loaded.</div>
            ) : (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-gray-300"
                  checked={prefs.emailEnabled}
                  onChange={(e) => setPrefs((p) => (p ? { ...p, emailEnabled: e.target.checked } : p))}
                />
                <span className="text-sm text-gray-900">Enable email notifications</span>
              </label>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Test send to (optional)</label>
                <input
                  type="email"
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  placeholder="example@domain.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
              </div>

              <button
                type="button"
                onClick={onTestEmail}
                disabled={testSending}
                className="h-10 px-4 py-2 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                {testSending ? 'Sending…' : 'Test email connection'}
              </button>
            </div>

            <p className="text-xs text-gray-500">SMTP credentials are read from backend environment variables.</p>
          </div>
        </div>

        {/* Intake Automation Configurations */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center mb-4">
            <Database className="w-5 h-5 text-gray-700 mr-2" />
            <h2 className="text-lg font-semibold text-gray-900">Intake Automation Configurations</h2>
          </div>

          {automationConfigErr && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-100 text-red-700 rounded">
              {automationConfigErr}
            </div>
          )}

          {automationConfigMsg && (
            <div className="mb-4 px-4 py-3 bg-green-50 border border-green-100 text-green-700 rounded">
              {automationConfigMsg}
            </div>
          )}

          {automationConfigLoading ? (
            <div className="text-sm text-gray-500">Loading automation settings…</div>
          ) : !automationConfig ? (
            <div className="text-sm text-gray-500">No automation settings loaded.</div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Google Form Base URL</label>
                <input
                  type="text"
                  value={automationConfig.googleFormBaseUrl}
                  onChange={(e) =>
                    setAutomationConfig((cur) =>
                      cur ? { ...cur, googleFormBaseUrl: e.target.value } : cur
                    )
                  }
                  placeholder="https://docs.google.com/forms/d/e/FORM_ID/viewform"
                  className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
                <p className="mt-1 text-xs text-gray-500">Use the Google Form URL without the prospect-specific parameter.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Google Form Entry ID</label>
                <input
                  type="text"
                  value={automationConfig.googleFormEntryId}
                  onChange={(e) =>
                    setAutomationConfig((cur) =>
                      cur ? { ...cur, googleFormEntryId: e.target.value } : cur
                    )
                  }
                  placeholder="entry.123456789"
                  className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
                <p className="mt-1 text-xs text-gray-500">The form field key that receives the prospect ID.</p>
              </div>
            </div>
          )}

          <div className="flex justify-end mt-4">
            <button
              type="button"
              onClick={onSaveAutomationConfig}
              disabled={!automationConfig || automationConfigSaving}
              className="inline-flex items-center px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700 disabled:opacity-60"
            >
              {automationConfigSaving ? 'Saving…' : 'Save Automation Settings'}
            </button>
          </div>
        </div>

        {/* Notification Preferences (dynamic) */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="flex items-center mb-4">
            <Bell className="w-5 h-5 text-gray-700 mr-2" />
            <h2 className="text-lg font-semibold text-gray-900">Notification Preferences</h2>
          </div>

          {loading ? (
            <div className="text-sm text-gray-500">Loading…</div>
          ) : !prefs ? (
            <div className="text-sm text-gray-500">No preferences loaded.</div>
          ) : (
            <div className="space-y-3">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-0.5 w-4 h-4 rounded border-gray-300"
                  checked={prefs.deadlinesEnabled}
                  onChange={(e) => setPrefs((p) => (p ? { ...p, deadlinesEnabled: e.target.checked } : p))}
                />
                <div>
                  <p className="text-sm font-medium text-gray-900">Deadline Reminders</p>
                  <p className="text-xs text-gray-500">Tasks due (24h) and hearings (24h + 2h).</p>
                </div>
              </label>

              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-0.5 w-4 h-4 rounded border-gray-300"
                  checked={prefs.taskAssignmentsEnabled}
                  onChange={(e) =>
                    setPrefs((p) => (p ? { ...p, taskAssignmentsEnabled: e.target.checked } : p))
                  }
                />
                <div>
                  <p className="text-sm font-medium text-gray-900">Task Assignments</p>
                  <p className="text-xs text-gray-500">Notify when a new task is assigned.</p>
                </div>
              </label>

              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-0.5 w-4 h-4 rounded border-gray-300"
                  checked={prefs.approvalsEnabled}
                  onChange={(e) => setPrefs((p) => (p ? { ...p, approvalsEnabled: e.target.checked } : p))}
                />
                <div>
                  <p className="text-sm font-medium text-gray-900">Deadlines & Approvals</p>
                  <p className="text-xs text-gray-500">Approval requests and status updates.</p>
                </div>
              </label>

              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-0.5 w-4 h-4 rounded border-gray-300"
                  checked={prefs.pettyCashLowEnabled}
                  onChange={(e) =>
                    setPrefs((p) => (p ? { ...p, pettyCashLowEnabled: e.target.checked } : p))
                  }
                />
                <div>
                  <p className="text-sm font-medium text-gray-900">Petty Cash Low</p>
                  <p className="text-xs text-gray-500">Critical low balance alerts.</p>
                </div>
              </label>
            </div>
          )}
        </div>

        {/* Save */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onSave}
            disabled={!prefs || saving}
            className="inline-flex items-center px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700 disabled:opacity-60"
          >
            <Save className="w-4 h-4 mr-2" />
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-6 opacity-70">
          <div className="flex items-center mb-4">
            <Database className="w-5 h-5 text-gray-700 mr-2" />
            <h2 className="text-lg font-semibold text-gray-900">Data & Backup</h2>
          </div>
          <p className="text-sm text-gray-600">Backup configuration UI can be wired later.</p>
        </div>
      </div>
    </div>
  );
}
