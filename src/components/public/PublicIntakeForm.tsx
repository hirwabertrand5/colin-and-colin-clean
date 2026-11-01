import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowUpRight, Building2, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, ClipboardCheck, FileCheck2, FileText, LockKeyhole, Mail, MapPin, Plus, ShieldCheck, Trash2, Upload, UserRound, Loader2 } from 'lucide-react';
import logo from '../../assets/logo-colin-dark-mode.png';
import { intakeRequest, uploadIntakeFile, CLIENT_FIELDS, PARTY_EXTRA_FIELDS, MATTER_FIELDS, ARTICLES_GROUPS, SHAREHOLDER_FIELDS } from '../../services/digitalIntakeService';
import { IntakeAnswers, IntakeField } from './IntakeFormFields';
import './digitalIntake.css';
import './publicIntakeForm.css';

const STEPS = ['Your details', 'Relevant parties', 'Legal matter', 'Supporting information', 'Documents', 'Review & submit'];
const STEP_COPY = [
  ['Client identification details', 'A few details about you, or the organization you represent.'],
  ['Other relevant party identification details', 'Help us understand who else is connected to your enquiry.'],
  ['Legal matter & case overview', 'Tell us what assistance you need and what you would like to achieve.'],
  ['Information & supporting requirements', 'Share the arrangements you have in mind for the service requested.'],
  ['Supporting documents', 'Attach the documents that will help our team understand your matter.'],
  ['Review, acknowledgment & submission', 'Take a moment to check your information before sending it to the firm.'],
];
const ADDRESS_KEYS = ['country', 'cityProvince', 'district', 'sector', 'cell', 'village'];
const CONTACT_KEYS = ['email', 'phone', 'contactName', 'contactPhone'];
const emptyPerson = () => ({ type: 'Individual', name: '', email: '', phone: '', country: '' });
const number = (value: number) => String(value).padStart(2, '0');
type UploadState = { key: string; file: File; id?: string; progress: number; error?: string; uploading: boolean; section: string };

function FieldSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="intake-field-section">
    <div className="intake-field-section-heading"><h3>{title}</h3></div>
    {description && <p className="intake-section-description">{description}</p>}
    <div className="intake-grid">{children}</div>
  </section>;
}

export default function PublicIntakeForm({ clarification = false }: { clarification?: boolean }) {
  const { token = '' } = useParams();
  const [details, setDetails] = useState<any>(null);
  const [failure, setFailure] = useState<any>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<any>({ client: emptyPerson(), parties: [], matter: {}, serviceId: '', questionnaireId: '', answers: {}, shareholders: [], acknowledged: false });
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [uploadSection, setUploadSection] = useState('General supporting documents');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<any>(null);
  const [response, setResponse] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let active = true;
    setDetails(null); setFailure(null); setStep(0); setConfirmation(null); setUploads([]); setError(''); setResponse('');
    setForm({ client: emptyPerson(), parties: [], matter: {}, serviceId: '', questionnaireId: '', answers: {}, shareholders: [], acknowledged: false });
    const meta = document.createElement('meta'); meta.name = 'referrer'; meta.content = 'no-referrer'; document.head.appendChild(meta);
    document.title = 'Client Intake Form | Colin & Colin Legal Solutions';
    intakeRequest(clarification ? '/public/clarification' : '/public/form', 'POST', {}, token).then(data => {
      const valid = clarification ? typeof data.message === 'string' && typeof data.reference === 'string' : Array.isArray(data.services) && data.services.length > 0 && typeof data.notice?.version === 'string' && typeof data.notice?.text === 'string' && Number.isFinite(Date.parse(data.expiresAt));
      if (!valid) throw Object.assign(new Error('The public intake form could not be loaded. Please contact the firm or try again shortly.'), { code: 'INVALID_API_RESPONSE' });
      if (!active) return;
      setDetails(data); setForm((f: any) => ({ ...f, serviceId: data.serviceId || '', questionnaireId: data.questionnaireId || '' }));
    }).catch(e => { if (active) setFailure(e); });
    return () => { active = false; meta.remove(); };
  }, [token, clarification]);
  useEffect(() => { heading.current?.focus(); }, [step]);

  const patchPerson = (key: string, value: unknown) => setForm((f: any) => ({ ...f, client: { ...f.client, [key]: value } }));
  const company = form.client.type === 'Company';
  const service = details?.services?.find((item: any) => item.id === form.serviceId);
  const hasArticlesService = service?.path.some((part: any) => part.id === 'company_incorporation');
  const uploading = uploads.some(file => file.uploading);
  const ownershipTotal = form.shareholders.reduce((sum: number, shareholder: any) => sum + (Number(shareholder.percentage) || 0), 0);
  const personFields = (person: any) => CLIENT_FIELDS.filter(question => person.type === 'Company' ? question.key !== 'identification' : !['tin', 'representativeName', 'representativeIdentification'].includes(question.key)).map(question => ({ ...question,
    label: question.key === 'name' ? person.type === 'Company' ? 'Company / Organization name' : 'Full legal name' : question.key === 'profession' ? person.type === 'Company' ? 'Representative position' : 'Profession (if applicable)' : question.key === 'representativeName' ? 'Managing Director / Authorized representative' : question.label,
  }));
  const personSections = (person: any, update: (key: string, value: string | number) => void, prefix = 'intake', client = false) => {
    const fields = personFields(person);
    const field = (question: typeof CLIENT_FIELDS[number]) => <IntakeField key={question.key} prefix={prefix} question={question} value={person[question.key]} onChange={value => update(question.key, value)} showOptional
      required={client ? ['name', 'email', 'phone', 'country', ...(person.type === 'Company' ? ['tin', 'representativeName', 'representativeIdentification'] : ['identification'])].includes(question.key) : question.key === 'name'} />;
    return <>
      <FieldSection title={person.type === 'Company' ? 'Company & representative' : 'Personal identification'} description={client ? 'Use the name and identification details shown on your official records.' : undefined}>
        {fields.filter(question => !CONTACT_KEYS.includes(question.key) && !ADDRESS_KEYS.includes(question.key)).map(field)}
        {!client && PARTY_EXTRA_FIELDS.map(question => field({ ...question, label: question.key === 'representativeOrFather' ? person.type === 'Company' ? 'Additional representative details (if relevant)' : "Father's name (if relevant)" : question.label }))}
      </FieldSection>
      <FieldSection title="Contact information" description={client ? 'Use the email address and telephone number where we can reach you. Add an alternative contact only where relevant.' : undefined}>
        {fields.filter(question => CONTACT_KEYS.includes(question.key)).map(field)}
      </FieldSection>
      <FieldSection title="Location & address" description={client ? 'Provide the address details that apply to your location.' : undefined}>
        {fields.filter(question => ADDRESS_KEYS.includes(question.key)).map(field)}
      </FieldSection>
    </>;
  };
  const fieldsError = () => {
    const people = step === 0 ? [form.client] : step === 1 ? form.parties : [];
    if (people.some((person: any) => person.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email.trim()))) return 'Please enter a valid email address, including its domain.';
    if (people.some((person: any) => person.phone && !/^[+\d\s().-]{5,40}$/.test(person.phone.trim()))) return 'Please enter a valid telephone number using digits and an optional country code.';
    if (step === 0 && (!form.client.name?.trim() || !form.client.email?.trim() || !form.client.phone?.trim() || !form.client.country?.trim())) return 'Please complete the required name, email, telephone and country fields.';
    if (step === 0 && !company && !form.client.identification?.trim()) return 'Please enter your national ID or passport number.';
    if (step === 0 && company && (!form.client.tin?.trim() || !form.client.representativeName?.trim() || !form.client.representativeIdentification?.trim())) return 'Please complete the company TIN and authorized representative details.';
    if (step === 1 && form.parties.some((party: any) => !party.name?.trim())) return 'Please give each relevant party a name, or remove the empty party.';
    if (step === 2 && (!form.serviceId || MATTER_FIELDS.some(question => question.required && !form.matter[question.key]?.trim()))) return 'Please choose a legal service and complete the required matter information.';
    if (step === 3 && form.questionnaireId && form.shareholders.some((shareholder: any) => !shareholder.name?.trim())) return 'Each shareholder needs a name, or remove the empty entry.';
    if (step === 3 && form.questionnaireId && form.shareholders.some((shareholder: any) => shareholder.shares !== '' && shareholder.shares != null && !Number.isInteger(shareholder.shares))) return 'Please enter a whole number of shares for each shareholder.';
    return '';
  };
  const next = (event: React.FormEvent) => {
    event.preventDefault(); const message = fieldsError(); setError(message); if (!message) setStep(value => Math.min(value + 1, STEPS.length - 1));
  };
  const upload = async (key: string, file: File, section: string) => {
    const update = (values: Partial<UploadState>) => setUploads(items => items.map(item => item.key === key ? { ...item, ...values } : item));
    update({ uploading: true, error: '', progress: 0 });
    try { const result = await uploadIntakeFile(token, file, section, progress => update({ progress })); update({ id: result._id, progress: 100 }); }
    catch (e: any) { update({ error: e.message }); } finally { update({ uploading: false }); }
  };
  const chooseFiles = async (files: FileList | null) => {
    if (!files || uploading || busy) return;
    if (uploads.length + files.length > 20) { setError('You can attach up to 20 documents.'); return; }
    setError('');
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
  const edit = (index: number) => { setError(''); setStep(index); };
  const reviewHeading = (title: string, index: number) => <div className="intake-review-section-heading"><h3>{title}</h3><button type="button" className="intake-text-button" onClick={() => edit(index)}>Edit <ArrowUpRight size={14} /></button></div>;
  const renderSummary = () => <>
    <div className="intake-review-block">{reviewHeading('A. Client identification', 0)}<IntakeAnswers title={company ? 'Company / Organization' : 'Individual'} value={form.client} labels={personFields(form.client)} /></div>
    <div className="intake-review-block">{reviewHeading('B. Other relevant parties', 1)}{form.parties.length ? form.parties.map((party: any, index: number) => <IntakeAnswers key={index} title={`Relevant party ${index + 1}`} value={party} labels={[...personFields(party), ...PARTY_EXTRA_FIELDS]} />) : <p className="intake-muted">No additional parties listed.</p>}</div>
    <div className="intake-review-block">{reviewHeading('C. Legal matter & case overview', 2)}<p className="intake-review-service"><strong>Legal service</strong><span>{service?.label}</span></p><IntakeAnswers title="Your enquiry" value={form.matter} labels={MATTER_FIELDS} /></div>
    {form.questionnaireId && <div className="intake-review-block">{reviewHeading('Articles of Association', 3)}{ARTICLES_GROUPS.map((group, index) => <details className="intake-question-group intake-review-question" key={group.key}><summary><span className="intake-question-number">{number(index + 1)}</span><span>{group.title}</span><ChevronDown size={17} /></summary><IntakeAnswers title={group.title} value={Object.fromEntries(group.questions.map(question => [question.key, form.answers[question.key]]))} labels={group.questions} />{group.condition && <p className="intake-muted">Company Secretary proposed: {form.answers.appointSecretary ? 'Yes' : 'No'}</p>}</details>)}{form.shareholders.map((shareholder: any, index: number) => <IntakeAnswers key={index} title={`Shareholder ${index + 1}`} value={shareholder} labels={SHAREHOLDER_FIELDS} />)}</div>}
  </>;

  return <div className="intake-public">
    <a className="intake-skip-link" href="#intake-main">Skip to form</a>
    <header className="intake-brand"><div className="intake-brand-inner"><img src={logo} alt="Colin & Colin Legal Solutions" /><span className="intake-brand-divider" aria-hidden="true" /><span className="intake-brand-caption">Client services<br /><strong>Committed to excellence.</strong></span><span className="intake-brand-secure"><LockKeyhole size={14} /> Secure client intake</span></div></header>
    <main className="intake-public-main" id="intake-main">
      {failure ? <section className="intake-card intake-message"><span className="intake-message-icon"><FileText size={29} /></span><p className="intake-eyebrow">Client intake</p><h1>{failure.code === 'ALREADY_SUBMITTED' ? 'Your form has been received' : 'This link is unavailable'}</h1><p>{failure.message}</p><p className="intake-muted">Please contact Colin & Colin Legal Solutions for assistance.</p><div className="intake-row"><button type="button" className="intake-button" onClick={() => window.location.reload()}>Try again</button><a className="intake-button secondary" href="mailto:info@colinandcolin.com">Contact the firm <ArrowUpRight size={15} /></a></div></section>
        : confirmation ? <section className="intake-card intake-message intake-confirmation"><span className="intake-success-icon"><Check size={32} /></span><p className="intake-eyebrow">Successfully received</p><h1>Thank you. We've received your {clarification ? 'reply' : 'enquiry'}.</h1><p>Our team will review the information and contact you about the next step.</p><div className="intake-receipt"><span>Your reference</span><strong>{confirmation.reference}</strong><small>Keep this reference for future correspondence.</small></div><div className="intake-next-steps"><span><Check size={16} /> Information received</span><ChevronRight size={14} /><span><ClipboardCheck size={16} /> Team review</span><ChevronRight size={14} /><span><Mail size={16} /> Next steps</span></div><p className="intake-muted">This confirmation is not an engagement letter or confirmation that the firm has accepted instructions.</p><a className="intake-contact-link" href="mailto:info@colinandcolin.com">Contact our team <ArrowUpRight size={14} /></a></section>
        : !details ? <section className="intake-card intake-message intake-loading" role="status"><Loader2 className="animate-spin" size={28} /><p>Opening your secure intake form...</p><div className="intake-loading-lines" aria-hidden="true"><span /><span /><span /></div></section>
        : clarification ? <section className="intake-card intake-clarification"><p className="intake-eyebrow">Additional information · {details.reference}</p><h1>Help us understand your enquiry</h1><p className="intake-notice">{details.message}</p><form onSubmit={async event => { event.preventDefault(); setBusy(true); setError(''); try { setConfirmation(await intakeRequest('/public/clarification/reply', 'POST', { response }, token)); } catch (err: any) { setError(err.message); } finally { setBusy(false); } }}><label htmlFor="clarification-response">Your reply *</label><textarea className="intake-input" id="clarification-response" rows={9} value={response} onChange={event => setResponse(event.target.value)} maxLength={20000} disabled={busy} required />{error && <p role="alert" className="intake-error">{error}</p>}<button disabled={busy} className="intake-button">{busy ? 'Sending...' : 'Send secure reply'}<ChevronRight size={16} /></button></form></section>
        : <>
          <div className="intake-intro"><div className="intake-intro-copy"><p className="intake-eyebrow"><span aria-hidden="true" /> A considered first step</p><h1>Client Intake Form<span>.</span></h1><p>{details.introduction || 'Tell us about yourself and the legal assistance you need. Our team will review your enquiry and guide you through the next steps.'}</p><div className="intake-intro-meta"><span><FileText size={14} /> Six guided steps</span><span><ShieldCheck size={14} /> Confidential enquiries</span></div></div><div className="intake-before"><div><CircleHelp size={19} /><h2>Before you begin</h2></div><p>Have your identification and relevant documents nearby. Complete the form in one visit; your answers are sent at the final step.</p><span><LockKeyhole size={12} /> Keep this invitation private.</span><small>Available until {new Date(details.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</small></div></div>
          <nav className="intake-progress" aria-label="Form progress"><div className="intake-progress-heading"><span>Your progress</span><span>Step {number(step + 1)} <span className="intake-progress-total">of {number(STEPS.length)}</span></span></div><ol>{STEPS.map((label, index) => <li key={label} className={index === step ? 'active' : index < step ? 'done' : ''} aria-current={index === step ? 'step' : undefined}><button type="button" disabled={index > step || busy || uploading} onClick={() => edit(index)} aria-label={`${label}${index < step ? ', completed, edit section' : ''}`}><span>{index < step ? <Check size={15} /> : number(index + 1)}</span><b>{label}</b></button></li>)}</ol></nav>
          <form className="intake-card intake-client-form" onInvalid={event => { (event.target as HTMLElement).closest('details')?.setAttribute('open', ''); }} onSubmit={step === 5 ? submit : next}>
            <div className="intake-step-heading"><span className="intake-step-number" aria-hidden="true">{number(step + 1)}</span><div><p className="intake-eyebrow">{STEP_COPY[step][0]}</p><h2 ref={heading} tabIndex={-1}>{STEPS[step]}</h2><p>{STEP_COPY[step][1]}</p></div></div>
            <div className="intake-required-note"><span><span aria-hidden="true">*</span> Required information</span><small>You can leave optional details blank if they do not apply.</small></div>
            {step === 0 && <>
              <fieldset className="intake-type"><legend>I am enquiring as</legend>{['Individual', 'Company'].map(type => <label key={type} className={form.client.type === type ? 'selected' : ''}><input type="radio" name="client-type" aria-label={type === 'Company' ? 'Company / Organization' : type} checked={form.client.type === type} onChange={() => patchPerson('type', type)} />{type === 'Individual' ? <UserRound size={21} /> : <Building2 size={21} />}<span><strong>{type === 'Company' ? 'Company / Organization' : type}</strong><small>{type === 'Company' ? 'On behalf of an organization' : 'For myself or in a personal capacity'}</small></span><span className="intake-type-check" aria-hidden="true">{form.client.type === type && <Check size={12} />}</span></label>)}</fieldset>
              {personSections(form.client, patchPerson, 'intake', true)}
            </>}
            {step === 1 && <>
              <div className="intake-guidance"><ShieldCheck size={19} /><p>List relevant people or organizations, such as a co-owner, counterparty or beneficiary. Listing someone does not classify them as an opposing party.</p></div>
              {!form.parties.length && <div className="intake-parties-empty"><span><UserRound size={24} /><Plus size={13} /></span><h3>Anyone else involved?</h3><p>You can add one or more relevant parties below.<br />If there are none, continue to the next step.</p></div>}
              {form.parties.map((party: any, index: number) => <fieldset className="intake-repeat intake-party" key={index}><legend>Relevant party {index + 1}</legend><div className="intake-repeat-heading"><div><span className="intake-section-tag">Party {number(index + 1)}</span><h3>{party.name || 'Party identification'}</h3></div><button type="button" className="intake-button danger" onClick={() => setForm((f: any) => ({ ...f, parties: f.parties.filter((_: any, item: number) => item !== index) }))}><Trash2 size={14} /> Remove party</button></div><div className="intake-party-type"><label htmlFor={`party-${index}-type`}>Party type</label><select id={`party-${index}-type`} className="intake-input" value={party.type} onChange={event => setForm((f: any) => ({ ...f, parties: f.parties.map((item: any, position: number) => position === index ? { ...item, type: event.target.value } : item) }))}><option>Individual</option><option value="Company">Company / Organization</option></select></div>{personSections(party, (key, value) => setForm((f: any) => ({ ...f, parties: f.parties.map((item: any, position: number) => position === index ? { ...item, [key]: value } : item) })), `party-${index}`)}</fieldset>)}
              <button type="button" disabled={form.parties.length >= 20} className="intake-button secondary intake-add-button" onClick={() => setForm((f: any) => ({ ...f, parties: [...f.parties, emptyPerson()] }))}><Plus size={16} /> Add another party</button>
            </>}
            {step === 2 && <>
              <FieldSection title="Legal assistance" description="Choose the closest service and describe the outcome you are seeking."><div className="intake-field intake-field-wide"><label htmlFor="intake-service">Legal service <span aria-label="required">*</span></label><select id="intake-service" className="intake-input" value={form.serviceId} required disabled={!!details.serviceId} onChange={event => setForm((f: any) => ({ ...f, serviceId: event.target.value, questionnaireId: '', answers: {}, shareholders: [] }))}><option value="">Choose the closest service</option>{details.services.map((item: any) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>{details.serviceId && <small className="intake-field-hint">This service was selected for your invitation.</small>}</div>{MATTER_FIELDS.filter(question => ['inquiry', 'objectives'].includes(question.key)).map(question => <IntakeField key={question.key} question={question} value={form.matter[question.key]} showOptional onChange={value => setForm((f: any) => ({ ...f, matter: { ...f.matter, [question.key]: value } }))} />)}</FieldSection>
              <FieldSection title="Case overview" description="Include the background, important dates, jurisdictions and any concerns you would like us to consider.">{MATTER_FIELDS.filter(question => !['inquiry', 'objectives'].includes(question.key)).map(question => <IntakeField key={question.key} question={question} value={form.matter[question.key]} showOptional onChange={value => setForm((f: any) => ({ ...f, matter: { ...f.matter, [question.key]: value } }))} />)}</FieldSection>
            </>}
            {step === 3 && <>
              {hasArticlesService && <label className="intake-checkbox intake-questionnaire-choice"><input type="checkbox" checked={!!form.questionnaireId} disabled={!!details.questionnaireId} onChange={event => setForm((f: any) => ({ ...f, questionnaireId: event.target.checked ? 'articles-of-association-v1' : '' }))} /><span><strong>My enquiry includes preparing Articles of Association</strong><small>Complete the ten sections below where your proposed arrangements are known.</small></span></label>}
              {!form.questionnaireId ? <div className="intake-parties-empty"><span><FileCheck2 size={27} /></span><h3>Ready for your documents</h3><p>No additional service questionnaire is required for this enquiry.<br />You can attach supporting documents in the next step.</p></div> : <>
                <div className="intake-questionnaire-intro"><span className="intake-section-tag">Articles of Association</span><h3>Your proposed company arrangements</h3><p>These sections follow the information requirements in the firm's Client Intake Form. Leave undecided points blank so our team can advise you.</p></div>
                {ARTICLES_GROUPS.map((group, index) => <details className="intake-question-group" key={group.key} open={index === 0}><summary><span className="intake-question-number">{number(index + 1)}</span><span className="intake-question-title">{group.title}<small>{group.questions.filter(question => form.answers[question.key] !== '' && form.answers[question.key] != null).length} of {group.questions.length} topics answered</small></span><ChevronDown size={18} /></summary>
                  <div className="intake-question-body">{group.condition && <label className="intake-checkbox"><input type="checkbox" checked={form.answers.appointSecretary === true} onChange={event => setForm((f: any) => ({ ...f, answers: { ...f.answers, appointSecretary: event.target.checked } }))} /> We intend to appoint a Company Secretary</label>}{(!group.condition || form.answers[group.condition] === true) && <div className="intake-grid">{group.questions.map(question => <IntakeField key={question.key} question={question} value={form.answers[question.key]} showOptional onChange={value => setForm((f: any) => ({ ...f, answers: { ...f.answers, [question.key]: value } }))} />)}</div>}
                    {group.key === 'capital' && <div className="intake-shareholders"><div className="intake-field-section-heading"><h4>Individual shareholder details</h4><span className="intake-section-tag">{form.shareholders.length} listed</span></div><p className="intake-section-description">Add each shareholder's name, identification, shares, ownership and contribution.</p>{form.shareholders.map((shareholder: any, position: number) => <fieldset key={position} className="intake-repeat"><legend>Shareholder {position + 1}</legend><div className="intake-grid">{SHAREHOLDER_FIELDS.map(question => <IntakeField key={question.key} question={question} prefix={`shareholder-${position}`} value={shareholder[question.key]} required={question.key === 'name'} showOptional onChange={value => setForm((f: any) => ({ ...f, shareholders: f.shareholders.map((item: any, itemIndex: number) => itemIndex === position ? { ...item, [question.key]: value } : item) }))} />)}</div><button type="button" className="intake-button danger" onClick={() => setForm((f: any) => ({ ...f, shareholders: f.shareholders.filter((_: any, itemIndex: number) => itemIndex !== position) }))}><Trash2 size={14} />Remove shareholder</button></fieldset>)}<button type="button" className="intake-button secondary" disabled={form.shareholders.length >= 100} onClick={() => setForm((f: any) => ({ ...f, shareholders: [...f.shareholders, {}] }))}><Plus size={15} /> Add shareholder</button>{form.shareholders.length > 0 && <p className="intake-ownership">Proposed ownership total: {ownershipTotal}%. <span>{Math.abs(ownershipTotal - 100) > 0.01 ? 'This is not yet 100%; the firm will review the proposed structure with you.' : 'Proposed ownership adds up to 100%.'}</span></p>}</div>}
                  </div>
                </details>)}
              </>}
            </>}
            {step === 4 && <>
              <div className="intake-document-intro"><div><FileText size={19} /><span>PDF, Word, JPG or PNG</span></div><div>10 MB per file</div><div>20 files maximum</div><div>100 MB in total</div></div>
              <FieldSection title="Add supporting documents" description="Choose the section each document relates to before attaching it. Documents upload when selected; you may continue without attachments if none are available."><div className="intake-field intake-field-wide"><label htmlFor="upload-section">Document section</label><select className="intake-input" id="upload-section" value={uploadSection} disabled={uploading} onChange={event => setUploadSection(event.target.value)}><option>General supporting documents</option><option>Client identification</option><option>Relevant parties</option><option>Legal matter</option>{form.questionnaireId && ARTICLES_GROUPS.map(group => <option key={group.key}>{group.title}</option>)}</select></div></FieldSection>
              <label className={`intake-upload ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); if (!uploading) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); void chooseFiles(event.dataTransfer.files); }}><span className="intake-upload-icon"><Upload size={25} /></span><strong>Choose files or drag and drop</strong><span>Relevant documents, securely attached to your enquiry.</span><span className="intake-upload-choose">Browse documents <Plus size={14} /></span><input type="file" multiple aria-label="Select supporting documents" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" disabled={uploading || uploads.length >= 20} onChange={event => { void chooseFiles(event.target.files); event.target.value = ''; }} /></label>
              {uploads.length > 0 && <div className="intake-upload-list"><div className="intake-field-section-heading"><h3>Your documents</h3><span className="intake-section-tag">{uploads.length} / 20</span></div>{uploads.map(item => <div key={item.key} className="intake-upload-item"><span className="intake-file-icon"><FileText size={20} /></span><div><strong>{item.file.name}</strong><span>{item.section} · {(item.file.size / 1048576).toFixed(2)} MB</span>{item.uploading ? <><small>Uploading {item.progress}%</small><progress max={100} value={item.progress} aria-label={`Uploading ${item.file.name}`} /></> : item.error ? <p className="intake-error">{item.error}</p> : <small className="intake-upload-success"><Check size={12} /> Uploaded securely</small>}</div>{item.error && <button type="button" className="intake-button secondary" onClick={() => void upload(item.key, item.file, item.section)}>Retry</button>}<button type="button" disabled={item.uploading} className="intake-button danger" onClick={() => void removeUpload(item)} aria-label={`Remove ${item.file.name}`}><Trash2 size={16} /></button></div>)}</div>}
            </>}
            {step === 5 && <>
              <div className="intake-review-header"><p><ClipboardCheck size={19} /> Check your information. You can edit any section before sending.</p><select className="intake-input" aria-label="Edit section" value="" onChange={event => edit(Number(event.target.value))}><option value="">Edit a section</option>{STEPS.slice(0, 5).map((label, index) => <option key={label} value={index}>{label}</option>)}</select></div>
              {renderSummary()}
              <div className="intake-review-block">{reviewHeading('Supporting documents', 4)}{uploads.length ? <IntakeAnswers title={`${uploads.length} document${uploads.length > 1 ? 's' : ''} attached`} value={Object.fromEntries(uploads.map((file, index) => [`Document ${index + 1}`, file.file.name]))} /> : <p className="intake-muted">No supporting documents attached.</p>}</div>
              <section className="intake-notice"><div className="intake-privacy-heading"><ShieldCheck size={20} /><div><p className="intake-eyebrow">Please read before submitting</p><h3>Privacy and client notice</h3></div></div><p>{details.notice.text}</p><div className="intake-privacy-meta"><p><strong>Privacy contact</strong>{details.notice.contact}</p><p><strong>Retention</strong>{details.notice.retention}</p></div><small>Notice version {details.notice.version}</small></section>
              <label className="intake-checkbox intake-acknowledgment"><input type="checkbox" checked={form.acknowledged} required disabled={busy} onChange={event => setForm((f: any) => ({ ...f, acknowledged: event.target.checked }))} /><span>I have read the notice, confirm that the information is accurate to the best of my knowledge, and understand that the firm may request further information.</span></label>
            </>}
            {error && <p className="intake-error" role="alert">{error}</p>}
            <div className="intake-form-footer"><button className="intake-button secondary" type="button" disabled={step === 0 || busy || uploading} onClick={() => edit(step - 1)}><ChevronLeft size={16} /> Previous</button><span className="intake-footer-position">{number(step + 1)} <span>/ {number(STEPS.length)}</span></span><button className="intake-button" disabled={busy || uploading} type="submit">{busy ? <><Loader2 size={16} className="animate-spin" />Submitting...</> : <>{step === 5 ? 'Submit intake form' : 'Next'}<ChevronRight size={16} /></>}</button></div>
            <p className="intake-form-assurance"><LockKeyhole size={12} /> Your enquiry is submitted only when you select Submit intake form. Documents upload when attached.</p>
          </form>
          <div className="intake-help"><CircleHelp size={17} /><p>Need a little help? <a href="mailto:info@colinandcolin.com">Contact our team <ArrowUpRight size={12} /></a></p><span>info@colinandcolin.com</span></div>
        </>}
      <footer className="intake-public-footer"><div><strong>Colin & Colin Legal Solutions</strong><span>Committed to excellence.</span></div><div className="intake-firm-contact"><a href="mailto:info@colinandcolin.com"><Mail size={13} /> info@colinandcolin.com</a><a href="tel:+250788300401">+250 788 300 401</a><span><MapPin size={13} /> Kigali, Rwanda</span></div></footer>
    </main>
  </div>;
}
