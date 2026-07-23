interface ExperienceTimelineProps {
  items: Array<{ title: string; detail: string }>;
}

export default function ExperienceTimeline({ items }: ExperienceTimelineProps) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-violet-100 p-2 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M7 6h10M7 12h10M7 18h6" strokeLinecap="round" />
          </svg>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Client experience timeline</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">A structured record of milestones and follow-up actions.</p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {items.map((item, index) => (
          <div key={`${item.title}-${index}`} className="flex gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
            <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-slate-900 dark:bg-slate-100" />
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.title}</div>
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-400">{item.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
