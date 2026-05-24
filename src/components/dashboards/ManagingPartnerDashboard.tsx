import React, { useEffect, useMemo, useState } from 'react';
import usePageTitle from '../../hooks/usePageTitle';
import { Link } from 'react-router-dom';
import { UserRole } from '../../App';
import {
  Briefcase,
  Clock,
  DollarSign,
  TrendingUp,
  AlertCircle,
  Plus,
  FileText,
} from 'lucide-react';

import { getAllCases, CaseData } from '../../services/caseService';
import { getBillingSummary, BillingSummary } from '../../services/billingService';
import { getAllTasks, TaskData } from '../../services/taskService';
import { getFirmEvents, FirmCalendarEvent } from '../../services/eventService';
import { getRecentAuditFeed, AuditFeedItem } from '../../services/auditService';

const formatRwfShort = (n: number) => {
  const val = Number(n) || 0;
  if (val >= 1_000_000_000) return `RWF ${(val / 1_000_000_000).toFixed(1)}B`;
  if (val >= 1_000_000) return `RWF ${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `RWF ${(val / 1_000).toFixed(1)}K`;
  return `RWF ${Math.round(val).toLocaleString('en-US')}`;
};

const formatRwf = (n: number) => `RWF ${Math.round(Number(n) || 0).toLocaleString('en-US')}`;

const isoToday = () => new Date().toISOString().slice(0, 10);
const addDaysISO = (baseISO: string, days: number) => {
  const d = new Date(baseISO);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const timeAgo = (isoDate: string) => {
  const t = new Date(isoDate).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
};

export default function ManagingPartnerDashboard({ userRole }: { userRole?: UserRole }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const roleLabel = useMemo(() => {
    if (!userRole) return 'Dashboard';
    if (userRole === 'managing_director') return 'Managing Director';
    if (userRole === 'managing_partner') return 'Managing Partner';
    if (userRole === 'senior_partner') return 'Senior Partner';
    if (userRole === 'partner') return 'Partner';
    if (userRole === 'associate_partner') return 'Associate Partner';
    return 'Leadership';
  }, [userRole]);
  
  usePageTitle(`Dashboard - ${roleLabel}`);
  const [cases, setCases] = useState<CaseData[]>([]);
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [pendingTasks, setPendingTasks] = useState<TaskData[]>([]);
  const [events, setEvents] = useState<FirmCalendarEvent[]>([]);
  const [auditFeed, setAuditFeed] = useState<AuditFeedItem[]>([]);

  const today = useMemo(() => isoToday(), []);
  const next14Days = useMemo(() => addDaysISO(today, 14), [today]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setLoading(true);
        setError('');

        const [allCases, billing, tasksPending, firmEvents, feed] = await Promise.all([
          getAllCases(),
          getBillingSummary(), // backend default range
          getAllTasks({ approvalStatus: 'Pending' as any }),
          getFirmEvents({ from: today, to: next14Days, type: 'all' }),
          getRecentAuditFeed(12),
        ]);

        if (!mounted) return;

        setCases(allCases);
        setSummary(billing);
        setPendingTasks(tasksPending);
        setEvents(firmEvents);
        setAuditFeed(feed);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message || `Failed to load ${roleLabel} dashboard.`);
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [today, next14Days]);

  // ----------------------------
  // Metrics
  // ----------------------------
  const activeCasesCount = useMemo(() => {
    // treat anything not "Closed" as active
    return cases.filter((c) => String(c.status || '').toLowerCase() !== 'closed').length;
  }, [cases]);

  const pendingApprovalsCount = pendingTasks.length;

  const billed = summary?.billed ?? 0;
  const collected = summary?.collected ?? 0;
  const outstanding = summary?.outstanding ?? Math.max(0, billed - collected);
  const collectionRate =
    summary?.collectionRate ?? (billed > 0 ? Math.round((collected / billed) * 100) : 0);

  const stats = useMemo(() => {
    return [
      {
        label: 'Active Cases',
        value: loading ? '…' : String(activeCasesCount),
        icon: Briefcase,
        change: 'Firm-wide',
      },
      {
        label: 'Pending Approvals',
        value: loading ? '…' : String(pendingApprovalsCount),
        icon: AlertCircle,
        change: pendingApprovalsCount > 0 ? `${Math.min(pendingApprovalsCount, 6)} urgent` : 'No pending',
      },
      {
        label: 'Total Billed',
        value: loading ? '…' : formatRwfShort(billed),
        icon: DollarSign,
        change: `Collected: ${formatRwfShort(collected)}`,
      },
      {
        label: 'Collection Rate',
        value: loading ? '…' : `${collectionRate}%`,
        icon: TrendingUp,
        change: `Outstanding: ${formatRwfShort(outstanding)}`,
      },
    ];
  }, [loading, activeCasesCount, pendingApprovalsCount, billed, collected, outstanding, collectionRate]);

  // ----------------------------
  // Pending approvals list (tasks only for now)
  // ----------------------------
  const approvalsList = useMemo(() => {
    return [...pendingTasks]
      .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
      .slice(0, 6)
      .map((t) => ({
        id: String(t._id),
        title: t.title,
        urgency: t.priority === 'High' ? 'High' : t.priority === 'Medium' ? 'Medium' : 'Low',
        dueDate: t.dueDate,
      }));
  }, [pendingTasks]);

  // ----------------------------
  // Upcoming deadlines from calendar
  // ----------------------------
  const upcomingDeadlines = useMemo(() => {
    return [...events]
      .filter((e) => String(e.date) >= today)
      .sort((a, b) => {
        const d = String(a.date).localeCompare(String(b.date));
        if (d !== 0) return d;
        return String(a.time || '').localeCompare(String(b.time || ''));
      })
      .slice(0, 6)
      .map((e) => ({
        id: String(e._id),
        title: e.title,
        case: e.case ? `${e.case.caseNo} • ${e.case.parties}` : '—',
        date: e.date,
        time: e.time || '—',
      }));
  }, [events, today]);

  // ----------------------------
  // Billing bars
  // ----------------------------
  const billedPct = useMemo(() => (billed > 0 ? 100 : 0), [billed]);
  const collectedPct = useMemo(() => {
    if (!billed) return 0;
    return Math.min(100, Math.round((collected / billed) * 100));
  }, [billed, collected]);
  const outstandingPct = useMemo(() => {
    if (!billed) return 0;
    return Math.min(100, Math.round((outstanding / billed) * 100));
  }, [billed, outstanding]);

  // ----------------------------
  // Audit Feed UI mapping
  // ----------------------------
  const activityItems = useMemo(() => {
    return (auditFeed || []).map((a) => ({
      id: a._id,
      actor: a.actorName || 'System',
      message: a.message,
      detail: a.detail,
      caseLabel: a.case ? `${a.case.caseNo} • ${a.case.parties}` : null,
      time: a.createdAt ? timeAgo(a.createdAt) : '—',
    }));
  }, [auditFeed]);

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">{roleLabel} Dashboard</h1>
        <p className="text-gray-600">Firm performance, approvals and billing insights</p>
      </div>

      {error && (
        <div className="mb-6 p-4 border border-red-200 bg-red-50 text-red-700 rounded">
          {error}
        </div>
      )}

      {/* Quick Actions */}
      <div className="mb-6 flex flex-wrap gap-3">
        <Link
          to="/cases/new"
          className="inline-flex items-center px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700 transition-colors"
        >
          <Plus className="w-4 h-4 mr-2" />
          Create New Case
        </Link>
        <Link
          to="/reports"
          className="inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-gray-700 rounded hover:bg-gray-50 transition-colors"
        >
          <FileText className="w-4 h-4 mr-2" />
          View Reports
        </Link>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="bg-white border border-gray-200 rounded-lg p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                  <Icon className="w-5 h-5 text-gray-700" />
                </div>
              </div>
              <div className="text-2xl font-semibold text-gray-900 mb-1">{stat.value}</div>
              <div className="text-sm text-gray-600 mb-1">{stat.label}</div>
              <div className="text-xs text-gray-500">{stat.change}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending Approvals */}
        <div className="bg-white border border-gray-200 rounded-lg">
          <div className="px-5 py-4 border-b border-gray-200 flex justify-between items-center">
            <h2 className="font-semibold text-gray-900">Pending Task Approvals</h2>
            <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded">
              {loading ? '…' : `${pendingApprovalsCount} pending`}
            </span>
          </div>

          {loading ? (
            <div className="px-5 py-10 text-gray-500">Loading approvals…</div>
          ) : approvalsList.length === 0 ? (
            <div className="px-5 py-10 text-gray-500">No pending approvals.</div>
          ) : (
            <div className="divide-y divide-gray-200">
              {approvalsList.map((item) => (
                <div key={item.id} className="px-5 py-4 hover:bg-gray-50">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded">Task</span>
                        {item.urgency === 'High' && (
                          <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded">Urgent</span>
                        )}
                      </div>
                      <p className="text-sm font-medium text-gray-900">{item.title}</p>
                    </div>

                    <Link
                      to={`/tasks/${item.id}`}
                      className="ml-4 px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50"
                    >
                      Review
                    </Link>
                  </div>

                  <div className="flex items-center text-xs text-gray-500">
                    <Clock className="w-3 h-3 mr-1" />
                    Due {item.dueDate}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="px-5 py-3 border-t border-gray-200">
            <Link to="/tasks" className="text-sm text-gray-600 hover:text-gray-900">
              View all approvals →
            </Link>
          </div>
        </div>

        {/* Upcoming Deadlines */}
        <div className="bg-white border border-gray-200 rounded-lg">
          <div className="px-5 py-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">Upcoming Deadlines</h2>
          </div>

          {loading ? (
            <div className="px-5 py-10 text-gray-500">Loading deadlines…</div>
          ) : upcomingDeadlines.length === 0 ? (
            <div className="px-5 py-10 text-gray-500">No upcoming deadlines.</div>
          ) : (
            <div className="divide-y divide-gray-200">
              {upcomingDeadlines.map((deadline) => (
                <div key={deadline.id} className="px-5 py-4 hover:bg-gray-50">
                  <p className="text-sm font-medium text-gray-900 mb-1">{deadline.title}</p>
                  <p className="text-xs text-gray-500 mb-2">{deadline.case}</p>
                  <div className="flex items-center text-xs text-gray-600">
                    <Clock className="w-3 h-3 mr-1" />
                    {deadline.date} at {deadline.time}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="px-5 py-3 border-t border-gray-200">
            <Link to="/calendar" className="text-sm text-gray-600 hover:text-gray-900">
              View firm calendar →
            </Link>
          </div>
        </div>

        {/* Billing Summary */}
        <div className="bg-white border border-gray-200 rounded-lg">
          <div className="px-5 py-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">Billing Overview</h2>
          </div>

          {loading ? (
            <div className="px-5 py-10 text-gray-500">Loading billing…</div>
          ) : (
            <div className="p-5 space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Billed (Period)</span>
                  <span className="font-medium text-gray-900">{formatRwf(billed)}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-gray-700" style={{ width: `${billedPct}%` }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Collected</span>
                  <span className="font-medium text-gray-900">{formatRwf(collected)}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-green-600" style={{ width: `${collectedPct}%` }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Outstanding</span>
                  <span className="font-medium text-gray-900">{formatRwf(outstanding)}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-yellow-500" style={{ width: `${outstandingPct}%` }} />
                </div>
              </div>

              <div className="text-xs text-gray-500">
                Period: {summary?.from || '—'} → {summary?.to || '—'}
              </div>
            </div>
          )}

          <div className="px-5 py-3 border-t border-gray-200">
            <Link to="/billing" className="text-sm text-gray-600 hover:text-gray-900">
              Go to billing →
            </Link>
          </div>
        </div>

        {/* Team Activity (Audit Feed) */}
        <div className="bg-white border border-gray-200 rounded-lg">
          <div className="px-5 py-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">Team Activity</h2>
          </div>

          {loading ? (
            <div className="px-5 py-10 text-gray-500">Loading activity…</div>
          ) : activityItems.length === 0 ? (
            <div className="px-5 py-10 text-gray-500">No recent activity.</div>
          ) : (
            <div className="divide-y divide-gray-200">
              {activityItems.map((a) => (
                <div key={a.id} className="px-5 py-4">
                  <p className="text-sm text-gray-900 mb-1">
                    <span className="font-medium">{a.actor}</span>{' '}
                    <span className="text-gray-600">{a.message}</span>
                  </p>

                  {a.detail ? <p className="text-xs text-gray-500">{a.detail}</p> : null}
                  {a.caseLabel ? <p className="text-xs text-gray-500">{a.caseLabel}</p> : null}

                  <p className="text-xs text-gray-400">{a.time}</p>
                </div>
              ))}
            </div>
          )}

          <div className="px-5 py-3 border-t border-gray-200">
            <Link to="/reports" className="text-sm text-gray-600 hover:text-gray-900">
              View reports →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}