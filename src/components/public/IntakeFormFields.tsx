import { IntakeQuestion } from '../../services/digitalIntakeService';

export function IntakeField({ question, value, onChange, prefix = 'intake', required, disabled }: {
  question: IntakeQuestion; value: unknown; onChange: (value: string | number) => void; prefix?: string; required?: boolean; disabled?: boolean;
}) {
  const id = `${prefix}-${question.key}`;
  const className = 'intake-input';
  const props = { id, className, value: value == null ? '' : String(value), required: required ?? question.required, disabled,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(question.type === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value) };
  return <div className={question.type === 'textarea' ? 'intake-field intake-field-wide' : 'intake-field'}>
    <label htmlFor={id}>{question.label}{props.required ? <span aria-label="required"> *</span> : null}</label>
    {question.type === 'textarea' ? <textarea {...props} rows={4} maxLength={15000} /> : <input {...props} type={question.type || 'text'} min={question.type === 'number' ? 0 : undefined} max={question.max} step={question.type === 'number' ? 'any' : undefined} maxLength={question.type === 'email' ? 254 : question.type === 'tel' ? 40 : 500} />}
  </div>;
}

export function IntakeAnswers({ title, value, labels }: { title: string; value: any; labels?: IntakeQuestion[] }) {
  if (!value) return null;
  const names = Object.fromEntries((labels || []).map(q => [q.key, q.label]));
  const entries = Object.entries(value).filter(([, v]) => v !== '' && v != null && typeof v !== 'object');
  return <section className="intake-answer-section"><h3>{title}</h3><dl>{entries.map(([key, answer]) => <div key={key}><dt>{names[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())}</dt><dd>{typeof answer === 'boolean' ? answer ? 'Yes' : 'No' : String(answer)}</dd></div>)}</dl></section>;
}
