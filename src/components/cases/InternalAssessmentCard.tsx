import { ReactNode } from 'react';

interface InternalAssessmentCardProps {
  completedBy: string;
  category: string;
  wasAvoidable: string;
  conversionProbability: string;
  recommendations: string;
  partnerApproval: string;
  isDisabled: boolean;
  children?: ReactNode;
}

export default function InternalAssessmentCard({
  completedBy,
  category,
  wasAvoidable,
  conversionProbability,
  recommendations,
  partnerApproval,
  isDisabled,
  children,
}: InternalAssessmentCardProps) {
  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${isDisabled ? 'border-dashed border-gray-300 bg-gray-50/80 dark:border-gray-700 dark:bg-gray-900/40' : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'}`}>
      <div className="flex items-center gap-3">
        <div className={`rounded-xl p-2 ${isDisabled ? 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M5 7h14M7 11h10M9 15h6" strokeLinecap="round" />
          </svg>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Internal assessment</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">The internal review and decision context for this prospect.</p>
        </div>
      </div>

      <div className="mt-5 space-y-3 text-sm text-slate-700 dark:text-slate-300">
        <div className="flex items-start justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-900/40">
          <span className="font-medium text-slate-500 dark:text-slate-400">Completed by</span>
          <span className="text-right font-semibold text-slate-900 dark:text-slate-100">{completedBy}</span>
        </div>
        <div className="flex items-start justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-900/40">
          <span className="font-medium text-slate-500 dark:text-slate-400">Category</span>
          <span className="text-right font-semibold text-slate-900 dark:text-slate-100">{category}</span>
        </div>
        <div className="flex items-start justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-900/40">
          <span className="font-medium text-slate-500 dark:text-slate-400">Was loss avoidable</span>
          <span className="text-right font-semibold text-slate-900 dark:text-slate-100">{wasAvoidable}</span>
        </div>
        <div className="flex items-start justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-900/40">
          <span className="font-medium text-slate-500 dark:text-slate-400">Estimated conversion probability</span>
          <span className="text-right font-semibold text-slate-900 dark:text-slate-100">{conversionProbability}</span>
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
          <div className="font-medium text-slate-500 dark:text-slate-400">Recommendations</div>
          <div className="mt-2 text-slate-700 dark:text-slate-300">{recommendations}</div>
        </div>
        <div className="flex items-start justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-900/40">
          <span className="font-medium text-slate-500 dark:text-slate-400">Partner approval</span>
          <span className="text-right font-semibold text-slate-900 dark:text-slate-100">{partnerApproval}</span>
        </div>
      </div>
      {children ? <div className="mt-5">{children}</div> : null}
    </div>
  );
}
