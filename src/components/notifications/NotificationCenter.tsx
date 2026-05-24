import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import usePageTitle from '../../hooks/usePageTitle';
import {
  Bell,
  AlertTriangle,
  DollarSign,
  FileText,
  Settings as SettingsIcon,
  CheckSquare,
  ClipboardCheck,
  Clock,
} from 'lucide-react';

import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  AppNotification,
} from '../../services/notificationService';

import {
  getMyNotificationPreferences,
  updateMyNotificationPreferences,
  NotificationPreferences,
} from '../../services/notificationPreferencesService';

const getUserId = () => {
  try {
    const u = JSON.parse(localStorage.getItem('user') || '{}');
    return u.id || u._id;
  } catch {
    return undefined;
  }
};

const iconForType = (type: string) => {
  switch (type) {
    case 'PETTY_CASH_LOW':
      return AlertTriangle;
    case 'PETTY_CASH_CREATED':
      return DollarSign;
    case 'PETTY_CASH_EXPENSE':
      return FileText;

    case 'TASK_ASSIGNED':
      return CheckSquare;
    case 'TASK_APPROVAL_REQUESTED':
      return ClipboardCheck;

    case 'TASK_DUE_REMINDER':
      return Clock;
    case 'EVENT_REMINDER':
      return Clock;

    default:
      return SettingsIcon;
  }
};

const priorityForType = (type: string, severity?: string) => {
  if (severity === 'critical') return 'high';
  if (severity === 'warning') return 'high';

  if (type === 'PETTY_CASH_LOW') return 'high';
  if (type === 'TASK_APPROVAL_REQUESTED') return 'high';

  if (type === 'EVENT_REMINDER') return 'high';
  if (type === 'TASK_DUE_REMINDER') return 'medium';

  return 'low';
};

export default function NotificationCenter() {
  const navigate = useNavigate();
  usePageTitle('Notification center');
  const [filter, setFilter] = useState<string>('all');
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Preferences
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [prefsLoading, setPrefsLoading] = useState(false);
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [prefsError, setPrefsError] = useState('');
  const [prefsSaved, setPrefsSaved] = useState('');

  const userId = getUserId();

  const loadNotifications = async (f = filter) => {
    try {
      setLoading(true);
      setError('');
      const data = await listNotifications(f);
      setItems(data);
    } catch (e: any) {
      setError(e?.message || 'Failed to load notifications');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const loadPrefs = async () => {
    try {
      setPrefsLoading(true);
      setPrefsError('');
      const p = await getMyNotificationPreferences();
      setPrefs(p);
    } catch (e: any) {
      setPrefsError(e?.message || 'Failed to load preferences');
      setPrefs(null);
    } finally {
      setPrefsLoading(false);
    }
  };

  useEffect(() => {
    loadNotifications(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    loadPrefs();
  }, []);

  const isRead = (n: AppNotification) => {
    if (!userId) return false;
    return (n.isReadBy || []).some((id) => String(id) === String(userId));
  };

  const unreadCount = useMemo(() => items.filter((n) => !isRead(n)).length, [items]);

  const getIconColor = (priority: string, read: boolean) => {
    if (read) return 'text-gray-400 bg-gray-100 dark:bg-gray-700 dark:text-gray-500';
    switch (priority) {
      case 'high':
        return 'text-red-600 bg-red-100 dark:bg-red-900/40 dark:text-red-400';
      case 'medium':
        return 'text-yellow-700 bg-yellow-100 dark:bg-yellow-900/40 dark:text-yellow-400';
      case 'low':
        return 'text-blue-700 bg-blue-100 dark:bg-blue-900/40 dark:text-blue-400';
      default:
        return 'text-gray-600 bg-gray-100 dark:bg-gray-700 dark:text-gray-400';
    }
  };

  const handleMarkAll = async () => {
    try {
      await markAllNotificationsRead();
      await loadNotifications(filter);
    } catch (e: any) {
      setError(e?.message || 'Failed to mark all as read');
    }
  };

  const handleOpen = async (n: AppNotification) => {
    try {
      await markNotificationRead(n._id);
      await loadNotifications(filter);

      // ✅ navigate to link if provided
      if (n.link) {
        navigate(n.link);
        return;
      }

      // fallback routing
      if (n.taskId) navigate(`/tasks/${n.taskId}`);
      else if (n.caseId) navigate(`/cases/${n.caseId}`);
      else if (n.fundId) navigate(`/petty-cash`);
      else navigate('/'); // final fallback
    } catch (e: any) {
      setError(e?.message || 'Failed to open notification');
    }
  };

  const savePrefs = async () => {
    if (!prefs) return;
    try {
      setPrefsSaving(true);
      setPrefsError('');
      setPrefsSaved('');
      const saved = await updateMyNotificationPreferences(prefs);
      setPrefs(saved);
      setPrefsSaved('Saved.');
      window.setTimeout(() => setPrefsSaved(''), 2000);
    } catch (e: any) {
      setPrefsError(e?.message || 'Failed to save preferences');
    } finally {
      setPrefsSaving(false);
    }
  };

  return (
    <div>
      {/* Page Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-1">Notification Center</h1>
            <p className="text-gray-600 dark:text-gray-400">All platform alerts and reminders</p>
          </div>
          {unreadCount > 0 && (
            <button onClick={handleMarkAll} className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100">
              Mark all as read
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'all', label: 'All' },
            { id: 'unread', label: `Unread ${unreadCount > 0 ? `(${unreadCount})` : ''}` },

            // Tasks
            { id: 'TASK_ASSIGNED', label: 'Task Assigned' },
            { id: 'TASK_APPROVAL_REQUESTED', label: 'Approval Requests' },
            { id: 'TASK_DUE_REMINDER', label: 'Task Due Reminders' },

            // Events
            { id: 'EVENT_REMINDER', label: 'Event Reminders' },

            // Petty cash
            { id: 'PETTY_CASH_LOW', label: 'Petty Cash Low' },
            { id: 'PETTY_CASH_CREATED', label: 'Petty Cash Created' },
            { id: 'PETTY_CASH_EXPENSE', label: 'Petty Cash Expenses' },
          ].map((btn) => (
            <button
              key={btn.id}
              onClick={() => setFilter(btn.id)}
              className={`px-3 py-1 text-sm rounded ${
                filter === btn.id
                  ? 'bg-gray-800 dark:bg-gray-600 text-white'
                  : 'border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* Notifications List */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-200 dark:divide-gray-700">
        {loading ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">Loading notifications...</div>
        ) : items.length > 0 ? (
          items.map((n) => {
            const Icon = iconForType(n.type);
            const read = isRead(n);
            const priority = priorityForType(n.type, n.severity);
            const time = new Date(n.createdAt).toLocaleString();

            return (
              <div
                key={n._id}
                className={`px-5 py-4 transition-colors ${
                  !read ? 'bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                <div className="flex items-start gap-4">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${getIconColor(
                      priority,
                      read
                    )}`}
                  >
                    <Icon className="w-5 h-5" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between mb-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{n.title}</p>
                      {!read && (
                        <div className="w-2 h-2 bg-blue-600 dark:bg-blue-400 rounded-full ml-2 flex-shrink-0" title="New" />
                      )}
                    </div>

                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{n.message}</p>

                    <div className="flex items-center justify-between">
                      <p className="text-xs text-gray-500 dark:text-gray-500">{time}</p>
                      <button
                        onClick={() => handleOpen(n)}
                        className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
                      >
                        Open →
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="text-center py-12">
            <Bell className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 dark:text-gray-400">No notifications found.</p>
          </div>
        )}
      </div>

      {/* Preferences (dynamic) */}
      <div className="mt-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Notification Preferences</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Control which events send emails and reminders for your account.
            </p>
          </div>

          <button
            type="button"
            onClick={savePrefs}
            disabled={!prefs || prefsSaving}
            className="px-4 py-2 bg-gray-900 dark:bg-gray-600 text-white rounded hover:bg-gray-800 dark:hover:bg-gray-500 disabled:opacity-60"
          >
            {prefsSaving ? 'Saving…' : 'Save Preferences'}
          </button>
        </div>

        {prefsError && (
          <div className="mt-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded text-sm">
            {prefsError}
          </div>
        )}
        {prefsSaved && (
          <div className="mt-4 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 px-4 py-3 rounded text-sm">
            {prefsSaved}
          </div>
        )}

        {prefsLoading ? (
          <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">Loading preferences…</div>
        ) : !prefs ? (
          <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">No preferences available.</div>
        ) : (
          <div className="mt-5 space-y-4">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-0.5 w-4 h-4 rounded border-gray-300 dark:border-gray-600"
                checked={prefs.emailEnabled}
                onChange={(e) => setPrefs((p) => (p ? { ...p, emailEnabled: e.target.checked } : p))}
              />
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Enable email notifications</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Master switch for all email sending.</p>
              </div>
            </label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="flex items-start gap-3 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                <input
                  type="checkbox"
                  className="mt-0.5 w-4 h-4 rounded border-gray-300 dark:border-gray-600"
                  checked={prefs.deadlinesEnabled}
                  onChange={(e) => setPrefs((p) => (p ? { ...p, deadlinesEnabled: e.target.checked } : p))}
                />
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Deadline Reminders</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Tasks due & hearing reminders.</p>
                </div>
              </label>

              <label className="flex items-start gap-3 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                <input
                  type="checkbox"
                  className="mt-0.5 w-4 h-4 rounded border-gray-300 dark:border-gray-600"
                  checked={prefs.taskAssignmentsEnabled}
                  onChange={(e) =>
                    setPrefs((p) => (p ? { ...p, taskAssignmentsEnabled: e.target.checked } : p))
                  }
                />
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Task Assignments</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">When a task is assigned to you.</p>
                </div>
              </label>

              <label className="flex items-start gap-3 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                <input
                  type="checkbox"
                  className="mt-0.5 w-4 h-4 rounded border-gray-300 dark:border-gray-600"
                  checked={prefs.approvalsEnabled}
                  onChange={(e) => setPrefs((p) => (p ? { ...p, approvalsEnabled: e.target.checked } : p))}
                />
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Approvals</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Approval requested and decision updates.</p>
                </div>
              </label>

              <label className="flex items-start gap-3 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                <input
                  type="checkbox"
                  className="mt-0.5 w-4 h-4 rounded border-gray-300 dark:border-gray-600"
                  checked={prefs.pettyCashLowEnabled}
                  onChange={(e) => setPrefs((p) => (p ? { ...p, pettyCashLowEnabled: e.target.checked } : p))}
                />
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Petty Cash Low</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Critical low fund alerts.</p>
                </div>
              </label>
            </div>

            <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                    Task due reminder (hours before due)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={168}
                    value={prefs.taskDueReminderHours}
                    onChange={(e) =>
                      setPrefs((p) => (p ? { ...p, taskDueReminderHours: Number(e.target.value) } : p))
                    }
                    className="w-40 px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                    Event reminders (hours before)
                  </label>
                  <input
                    type="text"
                    value={(prefs.eventReminderHours || []).join(',')}
                    onChange={(e) => {
                      const parts = e.target.value
                        .split(',')
                        .map((x) => x.trim())
                        .filter(Boolean);

                      const nums = parts
                        .map((x) => Number(x))
                        .filter((n) => Number.isFinite(n) && n > 0 && n <= 168);

                      setPrefs((p) => (p ? { ...p, eventReminderHours: nums } : p));
                    }}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded"
                    placeholder="24,2"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Example: 24,2 means 24h and 2h before.</p>
                </div>
              </div>
            </div>

            <div className="text-xs text-gray-500 dark:text-gray-400">
              These preferences control email sending. In-app notifications still appear in the center.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}