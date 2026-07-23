interface AutomationCardProps {
  title?: string;
  description?: string;
  items: string[];
}

export default function AutomationCard({ title = 'Automation', description = 'These capabilities will become active as backend integrations are completed.', items }: AutomationCardProps) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-slate-100 p-2 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M8 7h8M8 12h8M8 17h5" strokeLinecap="round" />
          </svg>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">{description}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item} className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-slate-700 dark:border-gray-700 dark:bg-gray-900/40 dark:text-slate-300">
            <span className="text-emerald-600 dark:text-emerald-400">✓</span>
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
