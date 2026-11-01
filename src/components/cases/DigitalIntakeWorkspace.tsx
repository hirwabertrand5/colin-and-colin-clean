import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Download, ExternalLink, Link2, Mail, RefreshCw, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { getAssignmentUsers } from '../../services/userService';
import { intakeRequest, downloadIntakeDocument, CLIENT_FIELDS, PARTY_EXTRA_FIELDS, MATTER_FIELDS, ARTICLES_GROUPS, SHAREHOLDER_FIELDS, OFFICIAL_USE_FIELDS } from '../../services/digitalIntakeService';
import { IntakeAnswers, IntakeField } from '../public/IntakeFormFields';
import GenerateIntakeLinkDialog, { type IntakeInvitation } from './GenerateIntakeLinkDialog';
import IntakeTablePagination, { INTAKE_ROWS_PER_PAGE } from './IntakeTablePagination';
import '../public/digitalIntake.css';

const formatTime = (value: string) => value ? new Date(value).toLocaleString() : '—';
const idOf = (value: any) => typeof value === 'string' ? value : value?._id || '';
const newInvitation = (expiryDays = 7): IntakeInvitation => ({ clientName: '', clientEmail: '', serviceId: '', questionnaireId: '', assignedTo: '', responsiblePartner: '', responsibleAssociate: '', expiryDays, introduction: '' });
export default function DigitalIntakeWorkspace({ view, generateRequested, initialSubmission, onAccepted }: { view: 'links' | 'submissions'; generateRequested: number; initialSubmission?: string; onAccepted: () => void }) {
  const [config, setConfig] = useState<any>(null);
  const [configurationLoading, setConfigurationLoading] = useState(true);
  const [configurationError, setConfigurationError] = useState('');
  const [staffLoading, setStaffLoading] = useState(true);
  const [staffError, setStaffError] = useState('');
  const [generationError, setGenerationError] = useState('');
  const invitationEdited = useRef(false);
  const active = useRef(true);
  const [users, setUsers] = useState<any[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [showGenerate, setShowGenerate] = useState(false);
  const [invitation, setInvitation] = useState<IntakeInvitation>(() => newInvitation());
  const [secrets, setSecrets] = useState<Record<string, { url: string; token: string }>>({});
  const [generated, setGenerated] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [review, setReview] = useState<any>({});
  const [clarificationUrl, setClarificationUrl] = useState('');
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const modalOpen = showGenerate || !!detail;
  useEffect(() => {
    if (!modalOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const dialogs = document.querySelectorAll<HTMLElement>('.intake-modal[role="dialog"]');
    const dialog = dialogs[dialogs.length - 1];
    const controls = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]') || []).filter(element => element.getClientRects().length > 0);
    controls()[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) { setShowGenerate(false); setDetail(null); }
      if (event.key === 'Tab') {
        const items = controls(); const first = items[0]; const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); document.body.style.overflow = overflow; previous?.focus(); };
  }, [modalOpen, showGenerate]);
  const loadVersion = useRef(0);
  const load = async () => {
    const version = ++loadVersion.current;
    setLoading(true); setError('');
    try { const data = await intakeRequest(view === 'links' ? '/links' : '/submissions'); if (version === loadVersion.current) setRows(data); }
    catch (e: any) { if (version === loadVersion.current) setError(e.message); } finally { if (version === loadVersion.current) setLoading(false); }
  };
  const loadConfiguration = async () => {
    setConfigurationLoading(true); setConfigurationError('');
    try {
      const data = await intakeRequest('/configuration');
      if (!data?.settings || !Array.isArray(data.services)) throw new Error('Intake settings are unavailable. Please retry or contact an administrator.');
      if (!active.current) return;
      setConfig(data);
      if (!invitationEdited.current) setInvitation(newInvitation(data.settings.defaultExpiryDays || 7));
    } catch (e: any) { if (active.current) setConfigurationError(e.message || 'Unable to load invitation settings.'); }
    finally { if (active.current) setConfigurationLoading(false); }
  };
  const loadStaff = async () => {
    setStaffLoading(true); setStaffError('');
    try { const data = await getAssignmentUsers(); if (active.current) setUsers(data.filter(user => user.isActive !== false)); }
    catch (e: any) { if (active.current) setStaffError(e.message || 'Unable to load team members.'); }
    finally { if (active.current) setStaffLoading(false); }
  };
  useEffect(() => { active.current = true; void Promise.allSettled([loadConfiguration(), loadStaff()]); return () => { active.current = false; }; }, []);
  useEffect(() => { setStatus(''); setSearch(''); void load(); }, [view]);
  useEffect(() => { if (generateRequested) { if (generated) { invitationEdited.current = false; setInvitation(newInvitation(config?.settings.defaultExpiryDays || 7)); } setGenerated(null); setGenerationError(''); setShowGenerate(true); } }, [generateRequested]);
  const openSubmission = async (id: string) => {
    setBusy(true); setError(''); setClarificationUrl('');
    try { const data = await intakeRequest(`/submissions/${id}`); setDetail(data); setReview({ ...data.administration, internalNotes: data.internalNotes || '', missingInformation: data.missingInformation || '', serviceId: data.administration?.serviceId || data.form.serviceId, responsiblePartner: idOf(data.administration?.responsiblePartner || data.link.responsiblePartner), responsibleAssociate: idOf(data.administration?.responsibleAssociate || data.link.responsibleAssociate), assignedTo: idOf(data.administration?.assignedTo || data.link.assignedTo), duplicatesReviewed: false }); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  useEffect(() => { if (initialSubmission) void openSubmission(initialSubmission); }, [initialSubmission]);
  const action = async (fn: () => Promise<any>) => { setBusy(true); setError(''); try { await fn(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } };
  const copy = async (url: string) => { try { await navigator.clipboard.writeText(url); toast.success('Link copied.'); return true; } catch { const message = 'Copy is unavailable in this browser. Select and copy the displayed link.'; if (showGenerate) setGenerationError(message); else setError(message); return false; } };
  const remember = (data: any) => { setSecrets(values => ({ ...values, [data.link._id]: { url: data.url, token: data.token } })); setGenerated(data); };
  const generateLink = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setGenerationError('');
    try {
      const result = await intakeRequest('/links', 'POST', { ...invitation, clientName: invitation.clientName.trim(), clientEmail: invitation.clientEmail.trim(), expiryDays: Number(invitation.expiryDays) });
      remember(result); void load();
    } catch (e: any) {
      setGenerationError(e.message || 'The link could not be generated. Please try again.');
      if (e.code === 'NOTICE_APPROVAL_REQUIRED') setGenerationError('Intake configuration requires administrator approval. Please contact your administrator.');
    } finally { busyRef.current = false; setBusy(false); }
  };
  const sendGeneratedLink = async () => {
    if (busyRef.current || !generated) return;
    busyRef.current = true; setBusy(true); setGenerationError('');
    try { const result = await intakeRequest(`/links/${generated.link._id}/send`, 'POST', { token: generated.token }); toast[result.sent ? 'success' : 'error'](result.message); if (!result.sent) setGenerationError(result.message); else setGenerated((value: any) => ({ ...value, link: { ...value.link, emailStatus: 'Sent' } })); void load(); }
    catch (e: any) { setGenerationError(e.message || 'The invitation could not be emailed. You can still copy the link.'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const staffFields = (value: any, update: (field: string, value: string) => void, required = false) => <div className="intake-grid">{[['responsiblePartner', 'Responsible partner'], ['responsibleAssociate', 'Responsible associate'], ['assignedTo', 'Assigned staff member']].map(([key, label]) => <div key={key} className="intake-field"><label htmlFor={`staff-${view}-${key}`}>{label}{required ? ' *' : ''}</label><select className="intake-input" id={`staff-${view}-${key}`} required={required} value={value[key!] || ''} onChange={e => update(key!, e.target.value)}><option value="">Confirm staff assignment</option>{users.map(user => <option key={user._id} value={user._id}>{user.name} ({user.role.replace(/_/g, ' ')})</option>)}</select></div>)}</div>;
  const serviceField = (value: any, change: (value: string) => void, required = false) => <div className="intake-field intake-field-wide"><label htmlFor={`staff-service-${view}`}>Legal service{required ? ' *' : ''}</label><select className="intake-input" id={`staff-service-${view}`} value={value || ''} required={required} onChange={e => change(e.target.value)}><option value="">Client can choose a legal service</option>{config?.services.map((service: any) => <option key={service.id} value={service.id}>{service.label}</option>)}</select></div>;
  const statuses = view === 'links' ? ['Pending', 'Opened', 'Submitted', 'Expired', 'Revoked'] : ['Awaiting Review', 'Under Review', 'Additional Information Requested', 'Accepted', 'Rejected'];
  const filtered = rows.filter(row => (!status || row.status === status) && [row.reference, row.clientName, row.clientEmail, row.service, row.assignedStaff].some(value => String(value || '').toLowerCase().includes(search.toLowerCase())));
  const totalPages = Math.max(1, Math.ceil(filtered.length / INTAKE_ROWS_PER_PAGE));
  const page = Math.min(currentPage, totalPages);
  const pageRows = filtered.slice((page - 1) * INTAKE_ROWS_PER_PAGE, page * INTAKE_ROWS_PER_PAGE);
  useEffect(() => { setCurrentPage(1); }, [search, status, view]);
  useEffect(() => { setCurrentPage(value => Math.min(value, totalPages)); }, [totalPages]);
  const deleteRow = (row: any) => {
    const message = view === 'links'
      ? 'Delete this intake link? Its URL will stop working. Any submission already received will remain available.'
      : 'Delete this client submission and its intake link?';
    if (!window.confirm(message)) return;
    void action(async () => {
      await intakeRequest(`/${view}/${row._id}`, 'DELETE');
      setRows(values => values.filter(value => value._id !== row._id));
      if (view === 'links') setSecrets(values => { const next = { ...values }; delete next[row._id]; return next; });
      toast.success(view === 'links' ? 'Intake link deleted.' : 'Client submission deleted.');
      await load();
    });
  };
  const deleteButton = (row: any) => <button type="button" className="intake-text-button danger" aria-label={`Delete ${row.reference}`} title={view === 'submissions' && (row.status === 'Accepted' || row.prospectId) ? 'Accepted submissions are retained with their linked prospect.' : 'Delete record'} disabled={busy || (view === 'submissions' && (row.status === 'Accepted' || !!row.prospectId))} onClick={() => deleteRow(row)}><Trash2 size={14} /> Delete</button>;
  const resolved = detail && ['Accepted', 'Rejected'].includes(detail.status);
  return <div className="intake-staff">
    <div className="intake-toolbar"><div><h2>{view === 'links' ? 'Secure intake links' : 'Client submissions'}</h2><p>{view === 'links' ? 'Invite a client to complete their enquiry securely.' : 'Review client-supplied information before accepting it into the prospect pipeline.'}</p></div><div className="intake-row"><button type="button" className="intake-button secondary" disabled={loading} onClick={() => void load()}><RefreshCw size={15} /> Refresh</button></div></div>
    {error && <p className="intake-error" role="alert">{error}</p>}
    <div className="intake-card intake-table-card"><div className="intake-table-filters"><label><span className="sr-only">Search {view}</span><input className="intake-input" type="search" placeholder="Search reference, client or service" value={search} onChange={e => setSearch(e.target.value)} /></label><label><span className="sr-only">Status filter</span><select className="intake-input" value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{statuses.map(item => <option key={item}>{item}</option>)}</select></label></div>
      {loading ? <p className="intake-empty" role="status">Loading {view}…</p> : !filtered.length ? <div className="intake-empty"><Link2 size={28} /><h3>{search || status ? 'No matching records' : view === 'links' ? 'Your next client starts here' : 'No client submissions yet'}</h3><p>{view === 'links' ? 'Generate an intake link and share it with your prospective client.' : 'Submitted forms will appear here, ready for your review.'}</p></div> : <div className="intake-table-scroll"><table className="intake-table"><thead><tr><th scope="col">#</th><th>Reference</th><th>Client / Organization</th><th>{view === 'links' ? 'Legal service / Email' : 'Legal service'}</th><th>{view === 'links' ? 'Expires' : 'Submitted'}</th><th>{view === 'links' ? 'Link status' : 'Responsible staff / Status'}</th><th>Actions</th></tr></thead><tbody>{pageRows.map((row, index) => <tr key={row._id}><td>{(page - 1) * INTAKE_ROWS_PER_PAGE + index + 1}</td><td><strong>{row.reference}</strong></td><td>{row.clientName || 'Not specified'}</td><td className="intake-table-service">{view === 'links' ? <>{config?.services.find((s: any) => s.id === row.serviceId)?.label || 'Client chooses'}<small>{row.clientEmail || 'No email specified'}</small></> : row.service}</td><td>{formatTime(view === 'links' ? row.expiresAt : row.submittedAt)}</td><td>{view === 'submissions' && <small>{row.assignedStaff}</small>}<span className={`intake-status ${row.status === 'Accepted' || row.status === 'Submitted' ? 'success' : ''}`}>{row.status}</span>{row.emailStatus && <small>Email: {row.emailStatus}</small>}</td><td>{view === 'submissions' ? <div className="intake-table-actions"><button className="intake-text-button" onClick={() => void openSubmission(row._id)} disabled={busy}>Review submission</button>{deleteButton(row)}</div> : <div className="intake-table-actions"><button className="intake-text-button" disabled={!secrets[row._id]} title={secrets[row._id] ? 'Copy secure link' : 'Regenerate to obtain a new copy'} onClick={() => void copy(secrets[row._id]!.url)}><Copy size={14} /> Copy</button><button className="intake-text-button" disabled={busy || !secrets[row._id] || !row.clientEmail || !['Pending', 'Opened'].includes(row.status)} onClick={() => void action(async () => { const result = await intakeRequest(`/links/${row._id}/send`, 'POST', { token: secrets[row._id]!.token }); toast[result.sent ? 'success' : 'error'](result.message); await load(); })}><Mail size={14} /> Send email</button>{row.status !== 'Submitted' && <><button className="intake-text-button" disabled={busy} onClick={() => { if (window.confirm('Regenerate this link? The previous link will stop working.')) void action(async () => { const result = await intakeRequest(`/links/${row._id}/regenerate`, 'POST', {}); remember(result); setShowGenerate(true); await load(); }); }}>Regenerate</button>{row.status !== 'Revoked' && <button className="intake-text-button danger" disabled={busy} onClick={() => { if (window.confirm('Revoke this intake link? The client will no longer be able to use it.')) void action(async () => { await intakeRequest(`/links/${row._id}/revoke`, 'POST', {}); await load(); }); }}>Revoke</button>}</>}{deleteButton(row)}</div>}</td></tr>)}</tbody></table></div>}
      {!loading && <IntakeTablePagination page={page} total={filtered.length} view={view} busy={busy} onPageChange={setCurrentPage} />}
    </div>

    {showGenerate && <GenerateIntakeLinkDialog
      configuration={config} configurationLoading={configurationLoading} configurationError={configurationError}
      staff={users} staffLoading={staffLoading} staffError={staffError}
      invitation={invitation} generated={generated} busy={busy} error={generationError}
      onChange={patch => { invitationEdited.current = true; setInvitation(value => ({ ...value, ...patch })); }}
      onGenerate={() => void generateLink()} onClose={() => { if (!busy) setShowGenerate(false); }}
      onCopy={() => copy(generated.url)} onSend={() => void sendGeneratedLink()}
      onCreateAnother={() => { invitationEdited.current = false; setInvitation(newInvitation(config?.settings.defaultExpiryDays || 7)); setGenerated(null); setGenerationError(''); }}
      onReloadConfiguration={() => void loadConfiguration()} onReloadStaff={() => void loadStaff()}
    />}


    {detail && <div className="intake-modal-backdrop"><section className="intake-modal intake-review-modal" role="dialog" aria-modal="true" aria-labelledby="submission-review-title"><div className="intake-modal-heading"><div><p className="intake-eyebrow">{detail.reference} · {detail.status}</p><h2 id="submission-review-title">{detail.form.client.name}</h2></div><button className="intake-icon-button" aria-label="Close submission review" disabled={busy} onClick={() => setDetail(null)}><X /></button></div><p className="intake-muted">Submitted {formatTime(detail.submittedAt)} · Invitation {detail.link.reference}</p>{error && <p className="intake-error" role="alert">{error}</p>}<div className="intake-review-columns"><div><div className="intake-warning">Client-supplied information — review and verify before relying on it.</div><IntakeAnswers title="Client identification" value={detail.form.client} labels={CLIENT_FIELDS} />{detail.form.parties.map((party: any, index: number) => <IntakeAnswers key={index} title={`Relevant party ${index + 1}`} value={party} labels={[...CLIENT_FIELDS, ...PARTY_EXTRA_FIELDS]} />)}<IntakeAnswers title="Legal matter" value={detail.form.matter} labels={MATTER_FIELDS} />{detail.form.questionnaireId && <><h3>Articles of Association</h3>{ARTICLES_GROUPS.map(group => <details key={group.key} className="intake-question-group"><summary>{group.title}</summary><IntakeAnswers title={group.title} value={Object.fromEntries(group.questions.map(q => [q.key, detail.form.answers[q.key]]))} labels={group.questions} /></details>)}{detail.form.shareholders.map((shareholder: any, index: number) => <IntakeAnswers key={index} title={`Shareholder ${index + 1}`} value={shareholder} labels={SHAREHOLDER_FIELDS} />)}</>}<section className="intake-answer-section"><h3>Supporting documents</h3>{detail.files.length ? detail.files.map((file: any) => <div className="intake-upload-item" key={file._id}><div><strong>{file.name}</strong><small>{file.section} · {(file.size / 1048576).toFixed(2)} MB</small></div><button className="intake-text-button" onClick={() => void action(() => downloadIntakeDocument(file._id, file.name))}><Download size={15} /> Download</button></div>) : <p className="intake-muted">No documents submitted.</p>}</section><details className="intake-question-group"><summary>{detail.noticeAcknowledgment.kind === 'enquiry-confirmation' ? 'Client confirmation' : 'Notice acknowledgment'} · {detail.noticeAcknowledgment.version}</summary><p>{detail.noticeAcknowledgment.text}</p>{detail.noticeAcknowledgment.contact && <p>Contact: {detail.noticeAcknowledgment.contact}</p>}{detail.noticeAcknowledgment.retention && <p>Retention: {detail.noticeAcknowledgment.retention}</p>}<p>Acknowledged {formatTime(detail.noticeAcknowledgment.at)}</p></details>{detail.clarifications?.map((entry: any, index: number) => <IntakeAnswers key={index} title={`Additional information ${index + 1}`} value={{ request: entry.message, response: entry.response || 'Awaiting reply' }} />)}</div><aside><h3>Internal review</h3><div className="intake-repeat"><h4>Possible duplicate records</h4>{detail.duplicates.length ? <><p>These records share contact or identification information. Review them; no records will be merged automatically.</p>{detail.duplicates.map((match: any, index: number) => <p key={index}>{match.type} · <strong>{match.reference}</strong> · {match.name}</p>)}<label className="intake-checkbox"><input type="checkbox" checked={review.duplicatesReviewed} disabled={resolved} onChange={e => setReview((v: any) => ({ ...v, duplicatesReviewed: e.target.checked }))} /> I reviewed the possible matches and confirm a new prospect is appropriate.</label></> : <p className="intake-muted">No possible matches in records available to you. This is not a conflict clearance.</p>}</div><form onSubmit={e => { e.preventDefault(); void action(async () => { await intakeRequest(`/submissions/${detail._id}/review`, 'PUT', review); await openSubmission(detail._id); await load(); toast.success('Review saved.'); }); }}><fieldset disabled={busy || resolved}>{serviceField(review.serviceId, value => setReview((v: any) => ({ ...v, serviceId: value })), true)}{staffFields(review, (key, value) => setReview((v: any) => ({ ...v, [key]: value })), true)}<h3>Official use only</h3><div className="intake-grid">{OFFICIAL_USE_FIELDS.map(question => <IntakeField key={question.key} prefix="review-official" question={question} value={review[question.key]} onChange={value => setReview((v: any) => ({ ...v, [question.key]: value }))} />)}</div><p className="intake-muted">Record an existing signature reference where applicable. This form does not create an electronic signature.</p><label htmlFor="review-notes">Internal notes</label><textarea className="intake-input" id="review-notes" rows={5} maxLength={20000} value={review.internalNotes || ''} onChange={e => setReview((v: any) => ({ ...v, internalNotes: e.target.value }))} /><label htmlFor="review-missing">Missing information / Clarification request</label><textarea className="intake-input" id="review-missing" rows={4} maxLength={5000} value={review.missingInformation || ''} onChange={e => setReview((v: any) => ({ ...v, missingInformation: e.target.value }))} /><div className="intake-row"><button type="submit" className="intake-button secondary">Save review</button><button type="button" className="intake-button secondary" disabled={!review.missingInformation?.trim()} onClick={() => void action(async () => { const result = await intakeRequest(`/submissions/${detail._id}/request-information`, 'POST', { message: review.missingInformation }); setDetail(await intakeRequest(`/submissions/${detail._id}`)); setClarificationUrl(result.url); toast[result.sent ? 'success' : 'error'](result.message || (result.sent ? 'Additional-information request sent.' : 'The request is saved. Copy and share the secure reply link.')); if (!result.sent) setError(result.message || 'Email could not be sent. Copy the secure reply link.'); await load(); })}>Request information</button></div><div className="intake-review-actions"><button type="button" className="intake-button" disabled={!review.assignedTo || !review.responsiblePartner || !review.responsibleAssociate || !review.serviceId || (detail.duplicates.length > 0 && !review.duplicatesReviewed)} onClick={() => { if (window.confirm('Accept this submission and create a prospect at Inquiry?')) void action(async () => { const result = await intakeRequest(`/submissions/${detail._id}/accept`, 'POST', review); await openSubmission(detail._id); await load(); onAccepted(); toast.success(`Prospect ${result.prospectNo || ''} created.`); }); }}>Accept into prospect pipeline</button><button type="button" className="intake-button danger" onClick={() => { const reason = window.prompt('Record the reason for rejecting this submission:'); if (reason?.trim()) void action(async () => { await intakeRequest(`/submissions/${detail._id}/reject`, 'POST', { reason }); await openSubmission(detail._id); await load(); }); }}>Reject submission</button></div></fieldset></form>{clarificationUrl && <div className="intake-notice"><label htmlFor="clarification-link">Secure reply link</label><input id="clarification-link" className="intake-input" value={clarificationUrl} readOnly /><button className="intake-text-button" onClick={() => void copy(clarificationUrl)}><Copy size={14} /> Copy reply link</button></div>}{detail.prospectId && <Link className="intake-button" to={`/matters/intake-prospects/${detail.prospectId}`}><ExternalLink size={15} /> Open linked prospect</Link>}{detail.rejectionReason && <p className="intake-error">Rejected: {detail.rejectionReason}</p>}<h3>Review activity</h3><ol className="intake-history">{detail.reviewHistory.map((entry: any, index: number) => <li key={index}><strong>{entry.action}</strong><span>{entry.actorName} · {formatTime(entry.at)}</span>{entry.note && <p>{entry.note}</p>}</li>)}</ol></aside></div></section></div>}
  </div>;
}
