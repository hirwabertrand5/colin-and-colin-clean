import type { NotificationPreferences } from '../../services/notificationPreferencesService';

export default function AdditionalNotificationPreferences({ prefs, onChange }: { prefs: NotificationPreferences; onChange: (updates: Partial<NotificationPreferences>) => void }) {
  const checks = [
    ['mattersEnabled', 'Matter updates', 'Requests, decisions and responsibility changes.'],
    ['pettyCashCreatedEnabled', 'Petty cash allocation', 'New funds and replenishments.'],
    ['pettyCashExpensesEnabled', 'Petty cash activity', 'Expenses, refunds and daily summaries.'],
  ] as const;
  return <div className="space-y-4 border-t border-gray-200 pt-4 text-gray-900 dark:border-gray-700 dark:text-gray-100">
    <div className="grid gap-3 md:grid-cols-2">{checks.map(([key, title, description]) => <label key={key} className="flex items-start gap-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <input type="checkbox" className="mt-1" checked={prefs[key] ?? true} onChange={event => onChange({ [key]: event.target.checked })} />
      <span><span className="block text-sm font-medium">{title}</span><span className="block text-xs text-gray-500 dark:text-gray-400">{description}</span></span>
    </label>)}</div>
    <label className="block text-sm font-medium">Petty cash expense emails
      <select value={prefs.pettyCashExpenseMode || 'daily'} onChange={event => onChange({ pettyCashExpenseMode: event.target.value as 'daily' | 'immediate' | 'off' })} className="mt-2 block w-full rounded border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-700">
        <option value="daily">Daily summary</option><option value="immediate">Each activity</option><option value="off">Off</option>
      </select>
    </label>
    <label className="block text-sm font-medium">Escalate critical overdue work after (hours)
      <input type="number" min={1} max={168} value={prefs.overdueEscalationHours ?? 24} onChange={event => onChange({ overdueEscalationHours: Number(event.target.value) })} className="mt-2 block w-32 rounded border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-700" />
    </label>
    <p className="text-xs text-gray-500 dark:text-gray-400">Normal tasks also receive a 2-hour reminder. High-priority tasks receive an earlier 48-hour reminder, and critical legal deadlines receive an earlier 72-hour reminder. Low-priority tasks receive the first reminder only.</p>
  </div>;
}
