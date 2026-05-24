import { useEffect, useMemo, useState } from 'react';
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

type WorkflowRow = {
  stage: string;
  keyActions: string;
  output: string;
  legalBasis: string;
  legalFees: string;
  timeline: string;
};

type WorkflowDoc = {
  id: string;
  title: string;
  rows: WorkflowRow[];
};

type TemplateStage = { key: string; order?: number; title: string };
type TemplateOutput =
  | string
  | { key?: string; name?: string; required?: boolean; category?: string; text?: string; title?: string };
type TemplateLegalBasis = string | { text?: string; title?: string };
type TemplateFee = string | { text?: string };
type TemplateSla = string | { text?: string };
type TemplateStep = {
  key?: string;
  order?: number;
  stageKey?: string;
  title?: string;
  actions?: string[];
  outputs?: TemplateOutput[];
  legalBasis?: TemplateLegalBasis[];
  fee?: TemplateFee;
  sla?: TemplateSla;
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

function WorkflowTable({ rows }: { rows: WorkflowRow[] }) {
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg">
      <table className="min-w-[1100px] w-full text-sm">
        <thead className="bg-gray-50 text-gray-700">
          <tr>
            <th className="text-left p-3 border-b">Stage</th>
            <th className="text-left p-3 border-b">Key Actions</th>
            <th className="text-left p-3 border-b">Output</th>
            <th className="text-left p-3 border-b">Legal Basis</th>
            <th className="text-left p-3 border-b">Legal Fees</th>
            <th className="text-left p-3 border-b">Timeline</th>
          </tr>
        </thead>
        <tbody className="bg-white">
          {rows.map((r, idx) => (
            <tr key={idx} className="align-top">
              <td className="p-3 border-b font-medium text-gray-900 whitespace-pre-wrap">{r.stage}</td>
              <td className="p-3 border-b text-gray-700">
                <CellList text={r.keyActions} />
              </td>
              <td className="p-3 border-b text-gray-700 whitespace-pre-wrap">{r.output}</td>
              <td className="p-3 border-b text-gray-700 whitespace-pre-wrap">{r.legalBasis}</td>
              <td className="p-3 border-b text-gray-700 whitespace-pre-wrap">{r.legalFees}</td>
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

    const normalizeFee = (fee: TemplateFee | undefined) => {
      if (!fee) return '';
      if (typeof fee === 'string') return fee;
      return fee.text || '';
    };

    const normalizeSla = (sla: TemplateSla | undefined) => {
      if (!sla) return '';
      if (typeof sla === 'string') return sla;
      return sla.text || '';
    };

    const templatesSorted = [...workflowTemplates].sort((a, b) => {
      const aMatter = (a.matterType || '').toLowerCase();
      const bMatter = (b.matterType || '').toLowerCase();
      if (aMatter !== bMatter) return aMatter.localeCompare(bMatter);
      return (a.version || 0) - (b.version || 0);
    });

    return templatesSorted.map((t) => {
      const steps = (t.steps || []) as TemplateStep[];
      const stepsSorted = [...steps].sort((a, b) => (a.order || 0) - (b.order || 0));
      const stageTitleByKey = stageTitleByTemplateId[t._id] || {};

      return {
        id: t._id,
        title: `${t.matterType || t.name}${t.name && t.matterType !== t.name ? ` — ${t.name}` : ''} • ${
          t.active ? 'Active' : 'Inactive'
        }`,
        rows: stepsSorted.map((s) => {
          const stageTitle = (s.stageKey && stageTitleByKey[s.stageKey]) || s.stageKey || '';
          const stepTitle = s.title || '';
          const stageCell = [stageTitle, stepTitle].filter(Boolean).join('\n');
          const keyActions = (s.actions || []).map((a, i) => `${i + 1}. ${a}`).join('\n');

          return {
            stage: stageCell,
            keyActions,
            output: normalizeOutputs(s.outputs),
            legalBasis: normalizeLegalBasis(s.legalBasis),
            legalFees: normalizeFee(s.fee),
            timeline: normalizeSla(s.sla),
          };
        }),
      };
    });
  }, [workflowTemplates]);

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
        <WorkflowTemplates />

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
                      <span className="text-sm font-medium text-gray-900">{wf.title}</span>
                      <ChevronDown
                        className={`w-4 h-4 text-gray-500 transition-transform ${
                          open ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    {open && (
                      <div className="px-4 pb-4">
                        <WorkflowTable rows={wf.rows} />
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
