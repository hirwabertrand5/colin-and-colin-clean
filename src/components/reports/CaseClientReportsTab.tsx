import { useEffect, useMemo, useState } from 'react';
import { Eye, Plus, FileText, Trash2, Download, Save, CalendarDays } from 'lucide-react';
import { CaseData, updateCase } from '../../services/caseService';
import {
  generateReportForCase,
  listReportsForCase,
  ClientReportRun,
  downloadReportPdf,
} from '../../services/clientReportService';

type Props = {
  caseData: CaseData;
  canManage: boolean;
};

type ClientContact = {
  name?: string;
  email?: string;
  phone?: string;
  isPrimary?: boolean;
};

export default function CaseClientReportsTab({ caseData, canManage }: Props) {
  const caseId = caseData._id as string;

  const [contacts, setContacts] = useState<ClientContact[]>(caseData.clientContacts || []);
  const [weeklyEnabled, setWeeklyEnabled] = useState<boolean>(Boolean(caseData.reporting?.weeklyEnabled));
  const [monthlyEnabled, setMonthlyEnabled] = useState<boolean>(
    caseData.reporting?.monthlyEnabled === undefined ? true : Boolean(caseData.reporting?.monthlyEnabled)
  );
  const [onUpdateEnabled, setOnUpdateEnabled] = useState<boolean>(
    caseData.reporting?.onUpdateEnabled === undefined ? true : Boolean(caseData.reporting?.onUpdateEnabled)
  );

  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [reportSummary, setReportSummary] = useState(caseData.description || '');
  const [reportStatus, setReportStatus] = useState(caseData.status || '');
  const [reportAssignedTo, setReportAssignedTo] = useState(caseData.assignedTo || '');

  const [reports, setReports] = useState<ClientReportRun[]>([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [reportsError, setReportsError] = useState('');

  const [periodDays, setPeriodDays] = useState<number>(30);
  const [generating, setGenerating] = useState(false);
  const [generatingKind, setGeneratingKind] = useState<'weekly' | 'monthly' | 'manual' | null>(null);

  const [previewReport, setPreviewReport] = useState<ClientReportRun | null>(null);

  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    setContacts(caseData.clientContacts || []);
    setWeeklyEnabled(Boolean(caseData.reporting?.weeklyEnabled));
    setMonthlyEnabled(
      caseData.reporting?.monthlyEnabled === undefined ? true : Boolean(caseData.reporting?.monthlyEnabled)
    );
    setOnUpdateEnabled(
      caseData.reporting?.onUpdateEnabled === undefined ? true : Boolean(caseData.reporting?.onUpdateEnabled)
    );
    setReportSummary(caseData.description || '');
    setReportStatus(caseData.status || '');
    setReportAssignedTo(caseData.assignedTo || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseData._id]);

  const recipientCount = useMemo(() => (contacts || []).filter((c) => c.email).length, [contacts]);
  const serviceRequested = useMemo(() => {
    const path = caseData.legalServicePath || [];
    return path.length > 0 ? path.map((item) => item.label).join(' / ') : caseData.matterType || caseData.workflow || caseData.caseType;
  }, [caseData]);

  const loadReports = async () => {
    if (!caseId) return;
    try {
      setLoadingReports(true);
      setReportsError('');
      const data = await listReportsForCase(caseId);
      setReports(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setReportsError(e?.message || 'Failed to load reports');
      setReports([]);
    } finally {
      setLoadingReports(false);
    }
  };

  useEffect(() => {
    loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  const addContactRow = () => {
    setContacts((prev) => [...prev, { name: '', email: '', phone: '', isPrimary: prev.length === 0 }]);
  };

  const removeContactRow = (idx: number) => {
    setContacts((prev) => prev.filter((_, i) => i !== idx));
  };

  const setPrimary = (idx: number) => {
    setContacts((prev) => prev.map((c, i) => ({ ...c, isPrimary: i === idx })));
  };

  const saveSettings = async () => {
    if (!canManage) return;
    try {
      setSavingSettings(true);
      setSettingsError('');

      for (const c of contacts) {
        if (c.email && !String(c.email).includes('@')) {
          throw new Error(`Invalid email: ${c.email}`);
        }
      }

      await updateCase(caseId, {
        clientContacts: contacts,
        description: reportSummary,
        status: reportStatus,
        assignedTo: reportAssignedTo,
        reporting: {
          weeklyEnabled,
          monthlyEnabled,
          onUpdateEnabled,
        },
      } as any);
    } catch (e: any) {
      setSettingsError(e?.message || 'Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const downloadPdfBlob = async (r: ClientReportRun) => {
    const blob = await downloadReportPdf(r._id);
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    const safeName = (r.subject || 'case-report').replace(/[^\w\s\-().]/g, '').replace(/\s+/g, ' ').trim();
    a.href = url;
    a.download = `${safeName.slice(0, 120)}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  };

  const onGenerate = async () => {
    return onGenerateTyped('manual', false);
  };

  const onGenerateTyped = async (trigger: 'weekly' | 'monthly' | 'manual', downloadAfterCreate = true) => {
    if (!caseId) return;
    try {
      setGenerating(true);
      setGeneratingKind(trigger);
      setReportsError('');
      const created = await generateReportForCase(caseId, trigger === 'manual' ? { periodDays } : { trigger });
      await loadReports();
      setPreviewReport(created);
      if (downloadAfterCreate) {
        setDownloadingId(created._id);
        await downloadPdfBlob(created);
      }
    } catch (e: any) {
      setReportsError(e?.message || 'Failed to generate report');
    } finally {
      setGenerating(false);
      setGeneratingKind(null);
      setDownloadingId(null);
    }
  };

  const onDownloadPdf = async (r: ClientReportRun) => {
    try {
      setDownloadingId(r._id);
      setReportsError('');

      await downloadPdfBlob(r);
    } catch (e: any) {
      setReportsError(e?.message || 'Failed to download PDF');
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Settings */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-gray-900">Client Report Workspace</h2>
            <p className="text-sm text-gray-500 mt-1">
              Prepare formal client update reports using the case information already recorded across the workspace.
            </p>
          </div>

          <button
            type="button"
            onClick={saveSettings}
            disabled={!canManage || savingSettings}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-60"
          >
            <Save className="w-4 h-4" />
            {savingSettings ? 'Saving...' : 'Save Settings'}
          </button>
        </div>

        {settingsError && (
          <div className="mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
            {settingsError}
          </div>
        )}

        <div className="mt-6 border border-gray-200 rounded-lg p-5 bg-gray-50">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Editable Report Details</h3>
              <p className="text-xs text-gray-500 mt-1">
                These fields feed the Case Information and Case Overview sections in the client report.
              </p>
            </div>
            <div className="hidden md:block text-xs text-gray-500 text-right">
              Service Requested<br />
              <span className="font-medium text-gray-700">{serviceRequested}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">Case Summary</label>
              <textarea
                value={reportSummary}
                onChange={(e) => setReportSummary(e.target.value)}
                disabled={!canManage}
                rows={6}
                className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-sm resize-y disabled:opacity-60"
                placeholder="Summarise the matter, background, and client objective for the report."
              />
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Current Stage</label>
                <input
                  value={reportStatus}
                  onChange={(e) => setReportStatus(e.target.value)}
                  disabled={!canManage}
                  className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-sm disabled:opacity-60"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Partner / Associate In Charge</label>
                <input
                  value={reportAssignedTo}
                  onChange={(e) => setReportAssignedTo(e.target.value)}
                  disabled={!canManage}
                  className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-sm disabled:opacity-60"
                />
              </div>
              <div className="md:hidden">
                <label className="block text-xs font-medium text-gray-700 mb-1">Service Requested</label>
                <div className="px-3 py-2 border border-gray-200 rounded bg-white text-sm text-gray-700">{serviceRequested}</div>
              </div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => onGenerateTyped('weekly')}
              disabled={!canManage || generating}
              className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-60"
            >
              <CalendarDays className="w-4 h-4" />
              {generatingKind === 'weekly' ? 'Preparing Weekly PDF...' : 'Download Weekly PDF'}
            </button>
            <button
              type="button"
              onClick={() => onGenerateTyped('monthly')}
              disabled={!canManage || generating}
              className="inline-flex items-center justify-center gap-2 px-4 py-3 border border-gray-900 text-gray-900 rounded hover:bg-gray-100 disabled:opacity-60"
            >
              <Download className="w-4 h-4" />
              {generatingKind === 'monthly' ? 'Preparing Monthly PDF...' : 'Download Monthly PDF'}
            </button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Contacts */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900">
                Client Contacts <span className="text-gray-500 font-medium">({recipientCount} emails)</span>
              </h3>
              <button
                type="button"
                onClick={addContactRow}
                disabled={!canManage}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                <Plus className="w-4 h-4" />
                Add Contact
              </button>
            </div>

            <div className="space-y-3">
              {contacts.length === 0 ? (
                <div className="text-sm text-gray-500">
                  No contacts yet. Add at least one email to prepare reports for sending.
                </div>
              ) : (
                contacts.map((c, idx) => (
                  <div key={idx} className="border border-gray-200 rounded-lg p-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <input
                        value={c.name || ''}
                        onChange={(e) =>
                          setContacts((prev) => prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))
                        }
                        placeholder="Name (optional)"
                        className="px-3 py-2 border border-gray-300 rounded"
                        disabled={!canManage}
                      />
                      <input
                        value={c.email || ''}
                        onChange={(e) =>
                          setContacts((prev) => prev.map((x, i) => (i === idx ? { ...x, email: e.target.value } : x)))
                        }
                        placeholder="Email (optional)"
                        className="px-3 py-2 border border-gray-300 rounded"
                        disabled={!canManage}
                      />
                      <input
                        value={c.phone || ''}
                        onChange={(e) =>
                          setContacts((prev) => prev.map((x, i) => (i === idx ? { ...x, phone: e.target.value } : x)))
                        }
                        placeholder="Phone (optional)"
                        className="px-3 py-2 border border-gray-300 rounded"
                        disabled={!canManage}
                      />
                    </div>

                    <div className="flex items-center justify-between mt-3">
                      <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                        <input type="radio" checked={Boolean(c.isPrimary)} onChange={() => setPrimary(idx)} disabled={!canManage} />
                        Primary
                      </label>

                      <button
                        type="button"
                        onClick={() => removeContactRow(idx)}
                        disabled={!canManage}
                        className="inline-flex items-center gap-2 text-sm text-red-700 hover:text-red-900 disabled:opacity-60"
                      >
                        <Trash2 className="w-4 h-4" />
                        Remove
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Rules */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Reporting Rules</h3>

            <div className="space-y-3">
              <div className="p-4 border border-gray-200 rounded-lg">
                <div className="text-sm font-medium text-gray-900">Case Type</div>
                <div className="text-sm text-gray-600 mt-1">{caseData.caseType}</div>
                <div className="text-xs text-gray-500 mt-2">
                  Guidance: Transactional usually weekly + monthly; Litigation/Labor usually monthly + updates.
                </div>
              </div>

              <label className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                <div>
                  <div className="text-sm font-medium text-gray-900">Weekly</div>
                  <div className="text-xs text-gray-500">Enable weekly drafts (manual send later).</div>
                </div>
                <input type="checkbox" checked={weeklyEnabled} onChange={(e) => setWeeklyEnabled(e.target.checked)} disabled={!canManage} className="h-4 w-4" />
              </label>

              <label className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                <div>
                  <div className="text-sm font-medium text-gray-900">Monthly</div>
                  <div className="text-xs text-gray-500">Enable monthly drafts (manual send later).</div>
                </div>
                <input type="checkbox" checked={monthlyEnabled} onChange={(e) => setMonthlyEnabled(e.target.checked)} disabled={!canManage} className="h-4 w-4" />
              </label>

              <label className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                <div>
                  <div className="text-sm font-medium text-gray-900">On Update</div>
                  <div className="text-xs text-gray-500">Phase 3: auto-create a draft when major updates happen.</div>
                </div>
                <input type="checkbox" checked={onUpdateEnabled} onChange={(e) => setOnUpdateEnabled(e.target.checked)} disabled={!canManage} className="h-4 w-4" />
              </label>

              <div className="p-4 border border-gray-200 rounded-lg">
                <div className="text-sm font-medium text-gray-900 mb-2">Manual Generation Range</div>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={7}
                    max={180}
                    value={periodDays}
                    onChange={(e) => setPeriodDays(Number(e.target.value))}
                    className="w-28 px-3 py-2 border border-gray-300 rounded"
                  />
                  <div className="text-sm text-gray-600">days back</div>

                  <button
                    type="button"
                    onClick={onGenerate}
                    disabled={!canManage || generating}
                    className="ml-auto inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-60"
                  >
                    <FileText className="w-4 h-4" />
                    {generating ? 'Generating...' : 'Generate Draft'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Reports list */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-900">Generated Reports</h2>
            <p className="text-sm text-gray-500">Draft reports created for review. Download as PDF anytime.</p>
          </div>
        </div>

        {reportsError && (
          <div className="px-6 py-3 text-sm text-red-700 bg-red-50 border-b border-red-100">{reportsError}</div>
        )}

        {loadingReports ? (
          <div className="px-6 py-10 text-gray-500">Loading reports...</div>
        ) : reports.length === 0 ? (
          <div className="px-6 py-10 text-gray-500">No reports generated yet.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {reports.map((r) => (
              <div key={r._id} className="px-6 py-5 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900 truncate">{r.subject}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    Status: <span className="font-medium">{r.status}</span> • Trigger: {r.trigger} •{' '}
                    {r.createdAt ? new Date(r.createdAt).toLocaleString() : ''}
                  </div>
                </div>

                <div className="shrink-0 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPreviewReport(r)}
                    className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
                  >
                    <Eye className="w-4 h-4" />
                    Preview
                  </button>

                  <button
                    type="button"
                    onClick={() => onDownloadPdf(r)}
                    className="inline-flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                    disabled={downloadingId === r._id}
                  >
                    <Download className="w-4 h-4" />
                    {downloadingId === r._id ? 'Downloading...' : 'PDF'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Preview modal */}
      {previewReport && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg w-full max-w-4xl flex flex-col" style={{ maxHeight: '90vh' }}>
            <div className="p-6 border-b flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-lg font-semibold text-gray-900 truncate">{previewReport.subject}</div>
                <div className="text-xs text-gray-500 mt-1">
                  {previewReport.createdAt ? new Date(previewReport.createdAt).toLocaleString() : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewReport(null)}
                className="px-3 py-2 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>

            <div className="p-6 overflow-y-auto">
              <div className="border border-gray-200 rounded-lg p-4 bg-white">
                <div dangerouslySetInnerHTML={{ __html: previewReport.contentHtml }} />
              </div>

              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => onDownloadPdf(previewReport)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-60"
                  disabled={downloadingId === previewReport._id}
                >
                  <Download className="w-4 h-4" />
                  {downloadingId === previewReport._id ? 'Downloading...' : 'Download PDF'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
