import { Send } from 'lucide-react';

interface FeedbackRequestCardProps {
  surveyType: string;
  clientEmail: string;
  surveyStatus: string;
  isSending: boolean;
  isSuccess: boolean;
  isDisabled: boolean;
  onSend: () => void;
  helperText: string;
}

export default function FeedbackRequestCard({
  surveyType,
  clientEmail,
  surveyStatus,
  isSending,
  isSuccess,
  isDisabled,
  onSend,
  helperText,
}: FeedbackRequestCardProps) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-blue-100 p-2 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
          <Send className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Feedback request</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">Prepare and dispatch the experience request for the client.</p>
        </div>
      </div>

      <div className="mt-5 space-y-4 text-sm text-slate-700 dark:text-slate-300">
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
          <div className="flex items-start justify-between gap-3">
            <span className="font-medium text-slate-500 dark:text-slate-400">Survey type</span>
            <span className="text-right font-semibold text-slate-900 dark:text-slate-100">{surveyType}</span>
          </div>
          <div className="mt-3 flex items-start justify-between gap-3">
            <span className="font-medium text-slate-500 dark:text-slate-400">Client email</span>
            <span className="text-right font-semibold text-slate-900 dark:text-slate-100">{clientEmail}</span>
          </div>
          <div className="mt-3 flex items-start justify-between gap-3">
            <span className="font-medium text-slate-500 dark:text-slate-400">Survey status</span>
            <span className="text-right font-semibold text-slate-900 dark:text-slate-100">{surveyStatus}</span>
          </div>
          <div className="mt-3 flex items-start justify-between gap-3">
            <span className="font-medium text-slate-500 dark:text-slate-400">Delivery method</span>
            <span className="text-right font-semibold text-slate-900 dark:text-slate-100">Email + Google Forms</span>
          </div>
        </div>

        <button
          type="button"
          onClick={onSend}
          disabled={isDisabled || isSending}
          className="inline-flex items-center rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          <Send className="mr-2 h-4 w-4" />
          {isSending ? 'Sending request...' : 'Send Client Feedback'}
        </button>

        <div className={`rounded-xl border px-3 py-2 text-sm ${isSuccess ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-300' : 'border-dashed border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-400'}`}>
          {helperText}
        </div>
      </div>
    </div>
  );
}
