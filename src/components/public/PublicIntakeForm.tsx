import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, FileText, LockKeyhole, Plus, Trash2, Upload, Loader2 } from 'lucide-react';
import logo from '../../assets/logo-colin.png';
import { intakeRequest, uploadIntakeFile, CLIENT_FIELDS, PARTY_EXTRA_FIELDS, MATTER_FIELDS, ARTICLES_GROUPS, SHAREHOLDER_FIELDS } from '../../services/digitalIntakeService';
import { IntakeAnswers, IntakeField } from './IntakeFormFields';
import './digitalIntake.css';

const STEPS = ['Your details', 'Relevant parties', 'Legal matter', 'Supporting information', 'Documents', 'Review & submit'];
const emptyPerson = () => ({ type: 'Individual', name: '', email: '', phone: '', country: '' });
type UploadState = { key: string; file: File; id?: string; progress: number; error?: string; uploading: boolean; section: string };
export default function PublicIntakeForm({ clarification = false }: { clarification?: boolean }) {
  const { token = '' } = useParams();
  const [details, setDetails] = useState<any>(null);
  const [failure, setFailure] = useState<any>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<any>({ client: emptyPerson(), parties: [], matter: {}, serviceId: '', questionnaireId: '', answers: {}, shareholders: [], acknowledged: false });
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [uploadSection, setUploadSection] = useState('General supporting documents');
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<any>(null);
  const [response, setResponse] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let active = true;
    setDetails(null); setFailure(null); setStep(0); setConfirmation(null); setUploads([]);
    setForm({ client: emptyPerson(), parties: [], matter: {}, serviceId: '', questionnaireId: '', answers: {}, shareholders: [], acknowledged: false });
    const meta = document.createElement('meta'); meta.name = 'referrer'; meta.content = 'no-referrer'; document.head.appendChild(meta);
    document.title = 'Secure Client Intake | Colin & Colin';
    intakeRequest(clarification ? '/public/clarification' : '/public/form', 'POST', {}, token).then(data => {
      if (!active) return; setDetails(data); setForm((f: any) => ({ ...f, serviceId: data.serviceId || '', questionnaireId: data.questionnaireId || '' }));
    }).catch(e => { if (active) setFailure(e); });
    return () => { active = false; meta.remove(); };
  }, [token, clarification]);
  useEffect(() => { heading.current?.focus(); }, [step]);
  const patchPerson = (key: string, value: unknown) => setForm((f: any) => ({ ...f, client: { ...f.client, [key]: value } }));
  const company = form.client.type === 'Company';
  const hasArticlesService = details?.services?.find((s: any) => s.id === form.serviceId)?.path.some((p: any) => p.id === 'company_incorporation');
  const personFields = (person: any) => CLIENT_FIELDS.filter(q => person.type === 'Company' ? q.key !== 'identification' : !['tin', 'representativeName', 'representativeIdentification'].includes(q.key)).map(q => q.key === 'name' ? { ...q, label: person.type === 'Company' ? 'Company / Organization name' : 'Full legal name' } : q.key === 'profession' ? { ...q, label: person.type === 'Company' ? 'Representative position' : 'Profession (if applicable)' } : q);
  const uploading = uploads.some(file => file.uploading);
  const fieldsError = () => {
    if (step === 0 && (!form.client.name?.trim() || !form.client.email?.trim() || !form.client.phone?.trim() || !form.client.country?.trim())) return 'Please complete the required name, email, telephone and country fields.';
    if (step === 0 && !company && !form.client.identification?.trim()) return 'Please enter your national ID or passport number.';
    if (step === 0 && company && (!form.client.tin?.trim() || !form.client.representativeName?.trim() || !form.client.representativeIdentification?.trim())) return 'Please complete the company TIN and authorized representative details.';
    if (step === 1 && form.parties.some((p: any) => !p.name?.trim())) return 'Please give each relevant party a name, or remove the empty party.';
    if (step === 2 && (!form.serviceId || MATTER_FIELDS.some(q => q.required && !form.matter[q.key]?.trim()))) return 'Please choose a legal service and complete the required matter information.';
    if (step === 3 && form.questionnaireId && form.shareholders.some((s: any) => !s.name?.trim())) return 'Each shareholder needs a name, or remove the empty entry.';
    return '';
  };
  const next = (event: React.FormEvent) => {
    event.preventDefault(); const message = fieldsError(); setError(message); if (!message) setStep(s => Math.min(s + 1, STEPS.length - 1));
  };
  const upload = async (key: string, file: File, section: string) => {
    const update = (values: Partial<UploadState>) => setUploads(items => items.map(item => item.key === key ? { ...item, ...values } : item));
    update({ uploading: true, error: '', progress: 0 });
    try { const result = await uploadIntakeFile(token, file, section, progress => update({ progress })); update({ id: result._id, progress: 100 }); }
    catch (e: any) { update({ error: e.message }); } finally { update({ uploading: false }); }
  };
  const chooseFiles = async (files: FileList | null) => {
    if (!files) return;
    if (uploads.length + files.length > 20) { setError('You can attach up to 20 documents.'); return; }
    const items = Array.from(files).map(file => ({ key: crypto.randomUUID(), file, section: uploadSection, progress: 0, uploading: true }));
    setUploads(previous => [...previous, ...items]);
    for (const item of items) await upload(item.key, item.file, item.section);
  };
  const removeUpload = async (item: UploadState) => {
    try { if (item.id) await intakeRequest(`/public/files/${item.id}`, 'DELETE', undefined, token); setUploads(items => items.filter(file => file.key !== item.key)); }
    catch (e: any) { setError(e.message); }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (uploading || uploads.some(file => file.error)) { setError('Finish or remove failed uploads before submitting.'); return; }
    if (!form.acknowledged) { setError('Please acknowledge the privacy notice before submitting.'); return; }
    setBusy(true); setError('');
    try { setConfirmation(await intakeRequest('/public/submit', 'POST', { ...form, noticeVersion: details.notice.version, documentIds: uploads.map(file => file.id) }, token)); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const renderSummary = () => <>
    <IntakeAnswers title="Client identification" value={form.client} labels={CLIENT_FIELDS} />
    {form.parties.map((party: any, index: number) => <IntakeAnswers key={index} title={`Relevant party ${index + 1}`} value={party} labels={[...CLIENT_FIELDS, ...PARTY_EXTRA_FIELDS]} />)}
    <IntakeAnswers title="Legal matter" value={form.matter} labels={MATTER_FIELDS} />
    {form.questionnaireId && <><IntakeAnswers title="Articles of Association" value={form.answers} labels={ARTICLES_GROUPS.flatMap(g => g.questions)} />{form.shareholders.map((shareholder: any, index: number) => <IntakeAnswers key={index} title={`Shareholder ${index + 1}`} value={shareholder} labels={SHAREHOLDER_FIELDS} />)}</>}
  </>;
  return <div className="intake-public">
    <header className="intake-brand"><img src={logo} alt="Colin & Colin Legal Solutions" /><span><LockKeyhole size={15} /> Secure client intake</span></header>
    <main className="intake-public-main">
      {failure ? <section className="intake-card intake-message"><FileText size={36} /><h1>{failure.code === 'ALREADY_SUBMITTED' ? 'Your form has been received' : 'This link is unavailable'}</h1><p>{failure.message}</p><p>Please contact Colin & Colin Legal Solutions for assistance.</p><button className="intake-button secondary" onClick={() => window.location.reload()}>Try again</button></section>
        : confirmation ? <section className="intake-card intake-message"><span className="intake-success-icon"><Check size={32} /></span><h1>Thank you. We’ve received your {clarification ? 'reply' : 'enquiry'}.</h1><p>Your reference is <strong>{confirmation.reference}</strong>.</p><p>Our team will review the information and contact you about the next step.</p><p className="intake-muted">This confirmation is not an engagement letter or confirmation that the firm has accepted instructions.</p></section>
        : !details ? <section className="intake-card intake-message" role="status"><Loader2 className="animate-spin" /><p>Opening your secure intake form…</p></section>
        : clarification ? <section className="intake-card"><p className="intake-eyebrow">Additional information · {details.reference}</p><h1>Help us understand your enquiry</h1><p className="intake-notice">{details.message}</p><form onSubmit={async e => { e.preventDefault(); setBusy(true); try { setConfirmation(await intakeRequest('/public/clarification/reply', 'POST', { response }, token)); } catch (err: any) { setError(err.message); } finally { setBusy(false); } }}><label htmlFor="clarification-response">Your reply *</label><textarea className="intake-input" id="clarification-response" rows={9} value={response} onChange={e => setResponse(e.target.value)} maxLength={20000} required />{error && <p role="alert" className="intake-error">{error}</p>}<button disabled={busy} className="intake-button">{busy ? 'Sending…' : 'Send secure reply'}</button></form></section>
        : <>
          <div className="intake-intro"><p className="intake-eyebrow">A clear first step</p><h1>Tell us how we can help.</h1><p>{details.introduction || 'Share your enquiry with our team. We’ll review your information and guide you through the next steps.'}</p><span className="intake-muted">Keep this link private. Available until {new Date(details.expiresAt).toLocaleDateString()}.</span></div>
          <nav className="intake-progress" aria-label="Form progress"><ol>{STEPS.map((label, index) => <li key={label} className={index === step ? 'active' : index < step ? 'done' : ''} aria-current={index === step ? 'step' : undefined}><span>{index < step ? <Check size={15} /> : index + 1}</span><b>{label}</b></li>)}</ol></nav>
          <form className="intake-card" onInvalid={event => { (event.target as HTMLElement).closest('details')?.setAttribute('open', ''); }} onSubmit={step === 5 ? submit : next}>
            <p className="intake-eyebrow">Step {step + 1} of {STEPS.length}</p><h2 ref={heading} tabIndex={-1}>{STEPS[step]}</h2><p className="intake-muted">Fields marked * are required. Your answers are submitted at the final step. Selected documents upload securely when attached.</p>
            {step === 0 && <><fieldset className="intake-type"><legend>I am enquiring as</legend>{['Individual', 'Company'].map(type => <label key={type}><input type="radio" name="client-type" checked={form.client.type === type} onChange={() => patchPerson('type', type)} />{type === 'Company' ? 'Company / Organization' : type}</label>)}</fieldset><div className="intake-grid">{personFields(form.client).map(question => <IntakeField key={question.key} question={question} value={form.client[question.key]} onChange={value => patchPerson(question.key, value)} required={['name', 'email', 'phone', 'country', ...(company ? ['tin', 'representativeName', 'representativeIdentification'] : ['identification'])].includes(question.key)} />)}</div></>}
            {step === 1 && <><p>List people or organizations relevant to this matter. They may be a co-owner, counterparty, beneficiary or another contact; listing someone does not classify them as an opposing party.</p>{form.parties.map((party: any, index: number) => <fieldset className="intake-repeat" key={index}><legend>Relevant party {index + 1}</legend><div className="intake-row"><label>Party type<select className="intake-input" value={party.type} onChange={e => setForm((f: any) => ({ ...f, parties: f.parties.map((p: any, i: number) => i === index ? { ...p, type: e.target.value } : p) }))}><option>Individual</option><option value="Company">Company / Organization</option></select></label><button type="button" className="intake-button danger" onClick={() => setForm((f: any) => ({ ...f, parties: f.parties.filter((_: any, i: number) => i !== index) }))}><Trash2 size={15} /> Remove party</button></div><div className="intake-grid">{[...personFields(party), ...PARTY_EXTRA_FIELDS].map(question => <IntakeField key={question.key} prefix={`party-${index}`} question={question} value={party[question.key]} required={question.key === 'name'} onChange={value => setForm((f: any) => ({ ...f, parties: f.parties.map((p: any, i: number) => i === index ? { ...p, [question.key]: value } : p) }))} />)}</div></fieldset>)}<button type="button" disabled={form.parties.length >= 20} className="intake-button secondary" onClick={() => setForm((f: any) => ({ ...f, parties: [...f.parties, emptyPerson()] }))}><Plus size={16} /> Add another party</button><p className="intake-muted">You may continue with no additional parties.</p></>}
            {step === 2 && <div className="intake-grid"><div className="intake-field intake-field-wide"><label htmlFor="intake-service">Legal service *</label><select id="intake-service" className="intake-input" value={form.serviceId} required disabled={!!details.serviceId} onChange={e => setForm((f: any) => ({ ...f, serviceId: e.target.value, questionnaireId: '', answers: {}, shareholders: [] }))}><option value="">Choose the closest service</option>{details.services.map((service: any) => <option key={service.id} value={service.id}>{service.label}</option>)}</select></div>{MATTER_FIELDS.map(question => <IntakeField key={question.key} question={question} value={form.matter[question.key]} onChange={value => setForm((f: any) => ({ ...f, matter: { ...f.matter, [question.key]: value } }))} />)}</div>}
            {step === 3 && <>
              {hasArticlesService && <label className="intake-checkbox"><input type="checkbox" checked={!!form.questionnaireId} disabled={!!details.questionnaireId} onChange={e => setForm((f: any) => ({ ...f, questionnaireId: e.target.checked ? 'articles-of-association-v1' : '' }))} /> My enquiry includes preparing Articles of Association</label>}
              {!form.questionnaireId ? <p>No additional service questionnaire is required for this enquiry. You can provide supporting documents in the next step.</p> : <><p>Describe your proposed arrangements where known. Leave undecided points blank so the firm can advise you.</p>{ARTICLES_GROUPS.map(group => <details className="intake-question-group" key={group.key}><summary>{group.title}</summary>{group.condition && <label className="intake-checkbox"><input type="checkbox" checked={form.answers.appointSecretary === true} onChange={e => setForm((f: any) => ({ ...f, answers: { ...f.answers, appointSecretary: e.target.checked } }))} /> We intend to appoint a Company Secretary</label>}{(!group.condition || form.answers[group.condition] === true) && <div className="intake-grid">{group.questions.map(question => <IntakeField key={question.key} question={question} value={form.answers[question.key]} onChange={value => setForm((f: any) => ({ ...f, answers: { ...f.answers, [question.key]: value } }))} />)}</div>}{group.key === 'capital' && <div className="intake-shareholders">{form.shareholders.map((shareholder: any, index: number) => <fieldset key={index} className="intake-repeat"><legend>Shareholder {index + 1}</legend><div className="intake-grid">{SHAREHOLDER_FIELDS.map(question => <IntakeField key={question.key} question={question} prefix={`shareholder-${index}`} value={shareholder[question.key]} required={question.key === 'name'} onChange={value => setForm((f: any) => ({ ...f, shareholders: f.shareholders.map((s: any, i: number) => i === index ? { ...s, [question.key]: value } : s) }))} />)}</div><button type="button" className="intake-button danger" onClick={() => setForm((f: any) => ({ ...f, shareholders: f.shareholders.filter((_: any, i: number) => i !== index) }))}>Remove shareholder</button></fieldset>)}<button type="button" className="intake-button secondary" disabled={form.shareholders.length >= 100} onClick={() => setForm((f: any) => ({ ...f, shareholders: [...f.shareholders, {}] }))}><Plus size={15} /> Add shareholder</button>{form.shareholders.length > 0 && <p className="intake-muted">Proposed ownership total: {form.shareholders.reduce((sum: number, s: any) => sum + (Number(s.percentage) || 0), 0)}%. {Math.abs(form.shareholders.reduce((sum: number, s: any) => sum + (Number(s.percentage) || 0), 0) - 100) > 0.01 ? 'This is not yet 100%; the firm will review the proposed structure with you.' : ''}</p>}</div>}</details>)}</>}
            </>}
            {step === 4 && <><p>Attach relevant supporting documents. PDF, DOC, DOCX, JPG or PNG; up to 10 MB each, 20 files and 100 MB in total. Documents upload when selected.</p><label htmlFor="upload-section">Document section</label><select className="intake-input" id="upload-section" value={uploadSection} onChange={e => setUploadSection(e.target.value)}><option>General supporting documents</option><option>Client identification</option><option>Relevant parties</option>{form.questionnaireId && ARTICLES_GROUPS.map(g => <option key={g.key}>{g.title}</option>)}</select><label className="intake-upload"><Upload size={24} /><span>Select supporting documents</span><input type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" disabled={uploading || uploads.length >= 20} onChange={e => { void chooseFiles(e.target.files); e.target.value = ''; }} /></label>{uploads.map(item => <div key={item.key} className="intake-upload-item"><FileText size={18} /><div><strong>{item.file.name}</strong><span>{item.section} · {(item.file.size / 1048576).toFixed(2)} MB</span>{item.uploading ? <progress max={100} value={item.progress} aria-label={`Uploading ${item.file.name}`} /> : item.error ? <p className="intake-error">{item.error}</p> : <small>Uploaded securely</small>}</div>{item.error && <button type="button" className="intake-button secondary" onClick={() => void upload(item.key, item.file, item.section)}>Retry</button>}<button type="button" disabled={item.uploading} className="intake-button danger" onClick={() => void removeUpload(item)} aria-label={`Remove ${item.file.name}`}><Trash2 size={16} /></button></div>)}</>}
            {step === 5 && <><div className="intake-review-header"><p>Check your information before submitting. You can return to any section to edit it.</p><select className="intake-input" aria-label="Edit section" value="" onChange={e => setStep(Number(e.target.value))}><option value="">Edit a section</option>{STEPS.slice(0, 5).map((label, index) => <option key={label} value={index}>{label}</option>)}</select></div><p><strong>Legal service:</strong> {details.services.find((s: any) => s.id === form.serviceId)?.label}</p>{renderSummary()}<IntakeAnswers title="Documents" value={Object.fromEntries(uploads.map((file, index) => [`Document ${index + 1}`, file.file.name]))} /><section className="intake-notice"><h3>Privacy and client notice</h3><p>{details.notice.text}</p><p><strong>Privacy contact:</strong> {details.notice.contact}</p><p><strong>Retention:</strong> {details.notice.retention}</p><small>Notice version {details.notice.version}</small></section><label className="intake-checkbox"><input type="checkbox" checked={form.acknowledged} required onChange={e => setForm((f: any) => ({ ...f, acknowledged: e.target.checked }))} /> I have read the notice, confirm that the information is accurate to the best of my knowledge, and understand that the firm may request further information.</label></>}
            {error && <p className="intake-error" role="alert">{error}</p>}
            <div className="intake-form-footer"><button className="intake-button secondary" type="button" disabled={step === 0 || busy || uploading} onClick={() => { setError(''); setStep(s => s - 1); }}><ChevronLeft size={16} /> Previous</button><span className="intake-muted">{step + 1} / {STEPS.length}</span><button className="intake-button" disabled={busy || uploading} type="submit">{busy ? 'Submitting…' : step === 5 ? 'Submit intake form' : 'Next'}<ChevronRight size={16} /></button></div>
          </form>
        </>}
      <footer className="intake-public-footer">Colin & Colin Legal Solutions <span>Confidential enquiries, considered with care.</span></footer>
    </main>
  </div>;
}
