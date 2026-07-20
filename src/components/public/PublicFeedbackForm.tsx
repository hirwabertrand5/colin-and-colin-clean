import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { submitPublicProspectFeedback } from '../../services/prospectFeedbackService';

const reasonOptions = [
  { category: 'Commercial', label: 'Commercial Reasons', options: ['Fees or budget considerations', 'Chose another law firm or advisor'] },
  { category: 'Matter', label: 'Matter Reasons', options: ['Matter no longer requires legal assistance', 'Matter has been postponed or delayed', 'Decided to handle the matter internally'] },
  { category: 'Service Experience', label: 'Service Experience Reasons', options: ['Response time was too slow', 'Communication was not satisfactory', 'Follow-up was insufficient', 'I was not confident the firm was the right fit for my matter'] },
  { category: 'Other', label: 'Other', options: ['Prefer not to say', 'Other'] },
] as const;

export default function PublicFeedbackForm() {
  const { prospectId } = useParams();
  const navigate = useNavigate();
  const [category, setCategory] = useState('Commercial');
  const [detail, setDetail] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const detailOptions = useMemo(() => reasonOptions.find((item) => item.category === category)?.options || [], [category]);

  useEffect(() => {
    if (detailOptions.length) {
      setDetail(detailOptions[0]);
    }
  }, [detailOptions]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!prospectId) return;
    setSubmitting(true);
    setError('');
    try {
      await submitPublicProspectFeedback(prospectId, { primaryReasonCategory: category, primaryReasonDetail: detail, clientComment: comment });
      setSubmitted(true);
    } catch (err: any) {
      setError(err?.message || 'Unable to submit feedback right now.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-16 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <div className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h1 className="text-2xl font-semibold">Thank you</h1>
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">Your feedback has been received. We appreciate the time you took to share it with us.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-16 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">Client feedback</p>
          <h1 className="mt-2 text-2xl font-semibold">What is the primary reason you did not proceed with us?</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Your responses are kept confidential and used to help us improve the experience for future clients.</p>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Reason category</label>
            <select value={category} onChange={(event) => setCategory(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
              {reasonOptions.map((option) => (
                <option key={option.category} value={option.category}>{option.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Reason detail</label>
            <select value={detail} onChange={(event) => setDetail(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
              {detailOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Is there anything we could have done better?</label>
            <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={6} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" placeholder="Share any additional context with us." />
          </div>

          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

          <button type="submit" disabled={submitting} className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300">
            {submitting ? 'Submitting...' : 'Submit Feedback'}
          </button>
        </form>
      </div>
    </div>
  );
}
