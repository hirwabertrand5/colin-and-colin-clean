interface FeedbackStatusCardProps {
  currentStatus: string;
  surveyType: string;
  surveyStatus: string;
  requestCreated: string;
  requestSent: string;
  completed: string;
  overallRisk: string;
}

export default function FeedbackStatusCard({
  currentStatus,
  surveyType,
  surveyStatus,
  requestCreated,
  requestSent,
  completed,
  overallRisk,
}: FeedbackStatusCardProps) {
  const rows = [
    { label: 'Current status', value: currentStatus },
    { label: 'Survey type', value: surveyType },
    { label: 'Survey status', value: surveyStatus },
    { label: 'Request created', value: requestCreated },
    { label: 'Sent', value: requestSent },
    { label: 'Completed', value: completed },
    { label: 'Overall risk', value: overallRisk },
  ];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="text-xs font-semibold uppercase tracking-[0.24em] text-gray-500 dark:text-gray-400">Client experience</div>
      <div className="mt-4 space-y-3 text-sm text-slate-700 dark:text-slate-300">
        {rows.map((row) => (
          <div key={row.label} className="flex items-start justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-900/40">
            <span className="font-medium text-slate-500 dark:text-slate-400">{row.label}</span>
            <span className="text-right font-semibold text-slate-900 dark:text-slate-100">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
