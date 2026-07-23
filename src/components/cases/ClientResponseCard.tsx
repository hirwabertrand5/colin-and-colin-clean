interface ClientResponseCardProps {
  surveyStatus: string;
  submittedDate: string;
  overallRating: string;
  wouldRecommend: string;
  wouldInstructAgain: string;
  clientComments: string;
}

export default function ClientResponseCard({
  surveyStatus,
  submittedDate,
  overallRating,
  wouldRecommend,
  wouldInstructAgain,
  clientComments,
}: ClientResponseCardProps) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-emerald-100 p-2 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M7 12.5 10.5 16 17 8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Client response</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">A live summary of the latest client interaction.</p>
        </div>
      </div>

      <div className="mt-5 space-y-3 text-sm text-slate-700 dark:text-slate-300">
        <div className="flex items-start justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-900/40">
          <span className="font-medium text-slate-500 dark:text-slate-400">Survey status</span>
          <span className="text-right font-semibold text-slate-900 dark:text-slate-100">{surveyStatus}</span>
        </div>
        <div className="flex items-start justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-900/40">
          <span className="font-medium text-slate-500 dark:text-slate-400">Submitted date</span>
          <span className="text-right font-semibold text-slate-900 dark:text-slate-100">{submittedDate}</span>
        </div>
        <div className="flex items-start justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-900/40">
          <span className="font-medium text-slate-500 dark:text-slate-400">Overall rating</span>
          <span className="text-right font-semibold text-slate-900 dark:text-slate-100">{overallRating}</span>
        </div>
        <div className="flex items-start justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-900/40">
          <span className="font-medium text-slate-500 dark:text-slate-400">Would recommend</span>
          <span className="text-right font-semibold text-slate-900 dark:text-slate-100">{wouldRecommend}</span>
        </div>
        <div className="flex items-start justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-900/40">
          <span className="font-medium text-slate-500 dark:text-slate-400">Would instruct again</span>
          <span className="text-right font-semibold text-slate-900 dark:text-slate-100">{wouldInstructAgain}</span>
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
          <div className="font-medium text-slate-500 dark:text-slate-400">Client comments</div>
          <div className="mt-2 text-slate-700 dark:text-slate-300">{clientComments}</div>
        </div>
      </div>
    </div>
  );
}
