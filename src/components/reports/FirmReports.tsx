import { useEffect, useMemo, useState } from 'react';
import { Download, FileText, BarChart3, TrendingUp, Users } from 'lucide-react';
import { UserRole } from '../../App';
import { FirmReportRange, FirmReportResponse, getFirmReports } from '../../services/firmReportsService';
import usePageTitle from '../../hooks/usePageTitle';

interface FirmReportsProps {
  userRole: UserRole;
}

const canAccess = (role: UserRole) => role === 'managing_director';

const fmtMoney = (n: number) =>
  `RWF ${Math.round((Number(n) || 0) * 100) / 100}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const downloadTextFile = (filename: string, content: string, mime = 'text/csv;charset=utf-8') => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
};

const toCsv = (rows: Array<Record<string, any>>) => {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const esc = (v: any) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const lines = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => esc(r[h])).join(',')),
  ];
  return lines.join('\n');
};

export default function FirmReports({ userRole }: FirmReportsProps) {
  const [selectedReport, setSelectedReport] = useState<'overview' | 'financial' | 'productivity' | 'cases'>('overview');
  const [dateRange, setDateRange] = useState<FirmReportRange>('monthly');
  usePageTitle('Firm Reports');
  const [data, setData] = useState<FirmReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reportTypes = [
    { id: 'overview', label: 'Firm Overview', icon: BarChart3 },
    { id: 'financial', label: 'Financial Summary', icon: TrendingUp },
    { id: 'productivity', label: 'Productivity Report', icon: Users },
    { id: 'cases', label: 'Case Analytics', icon: FileText },
  ] as const;

  useEffect(() => {
    if (!canAccess(userRole)) return;

    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        setError('');
        const resp = await getFirmReports({ range: dateRange });
        if (!mounted) return;
        setData(resp);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message || 'Failed to load firm reports.');
        setData(null);
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [userRole, dateRange]);

  const firmStats = useMemo(() => {
    const k = data?.kpis;
    return [
      { label: 'Active Cases', value: k ? String(k.activeCases) : '—' },
      { label: 'Billed (range)', value: k ? fmtMoney(k.billed) : '—' },
      { label: 'Collected (range)', value: k ? fmtMoney(k.collected) : '—' },
      { label: 'Billable Hours (range)', value: k ? String(k.billableHours) : '—' },
    ];
  }, [data]);

  const exportCsv = () => {
    if (!data) return;

    // export a simple multi-sheet style using section headers
    const lines: string[] = [];

    lines.push(`Firm Reports`);
    lines.push(`From,${data.range.from}`);
    lines.push(`To,${data.range.to}`);
    lines.push('');

    lines.push('KPIs');
    lines.push(toCsv([data.kpis as any]));
    lines.push('');

    lines.push('Team');
    lines.push(
      toCsv(
        data.team.map((t) => ({
          name: t.name,
          role: t.role,
          activeCases: t.activeCases,
          tasksCompleted: t.tasksCompleted,
          billableHours: t.billableHours,
          earnedFees: t.earnedFees || 0,
          earlyTasks: t.earlyTasks || 0,
          onTimeTasks: t.onTimeTasks || 0,
          lateTasks: t.lateTasks || 0,
          overdueTasks: t.overdueTasks || 0,
          excellentTasks: t.excellentTasks || 0,
          goodTasks: t.goodTasks || 0,
          delayedTasks: t.delayedTasks || 0,
          riskTasks: t.riskTasks || 0,
          averageTimeUsedPercent: t.averageTimeUsedPercent ?? '',
        }))
      )
    );
    lines.push('');

    lines.push('Practice Paths');
    lines.push(
      toCsv(
        data.caseTypes.map((c) => ({
          type: c.type,
          active: c.active,
          closed: c.closed,
          avgDurationDays: c.avgDurationDays ?? '',
          revenueBilled: c.revenueBilled,
        }))
      )
    );

    const filename = `firm-reports_${data.range.from}_to_${data.range.to}.csv`;
    downloadTextFile(filename, lines.join('\n'));
  };

  if (!canAccess(userRole)) {
    return (
      <div className="p-6 bg-white border border-gray-200 rounded">
        <h1 className="text-xl font-semibold text-gray-900 mb-2">Access denied</h1>
        <p className="text-gray-600">Only Managing Director can view firm-wide reports.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Page Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 mb-1">Firm Reports</h1>
            <p className="text-gray-600">
              {loading
                ? 'Loading…'
                : data
                  ? `Period: ${data.range.from} → ${data.range.to}`
                  : 'Comprehensive analytics and performance reports'}
            </p>
          </div>

          <div className="flex gap-3">
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as FirmReportRange)}
              className="px-4 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
            >
              <option value="weekly">Last Week</option>
              <option value="monthly">Last Month</option>
              <option value="quarterly">Last Quarter</option>
              <option value="yearly">Last Year</option>
            </select>

            <button
              onClick={exportCsv}
              disabled={!data || loading}
              className="inline-flex items-center px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700 disabled:opacity-60"
            >
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-4 border border-red-200 bg-red-50 text-red-700 rounded">
            {error}
          </div>
        )}

        {/* Report Type Selector */}
        <div className="flex gap-2 border-b border-gray-200">
          {reportTypes.map((type) => {
            const Icon = type.icon;
            const active = selectedReport === type.id;
            return (
              <button
                key={type.id}
                onClick={() => setSelectedReport(type.id)}
                className={`
                  flex items-center px-4 py-3 border-b-2 font-medium text-sm transition-colors
                  ${active ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}
                `}
              >
                <Icon className="w-4 h-4 mr-2" />
                {type.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Loading empty state */}
      {loading && !data ? (
        <div className="bg-white border border-gray-200 rounded-lg p-6 text-gray-600">Loading report…</div>
      ) : null}

      {/* Report Content */}
      {selectedReport === 'overview' && (
        <div className="space-y-6">
          {/* Key Metrics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {firmStats.map((stat) => (
              <div key={stat.label} className="bg-white border border-gray-200 rounded-lg p-5">
                <div className="text-sm text-gray-600 mb-2">{stat.label}</div>
                <div className="text-2xl font-semibold text-gray-900">{stat.value}</div>
              </div>
            ))}
          </div>

          {/* Team Performance */}
          <div className="bg-white border border-gray-200 rounded-lg">
            <div className="px-5 py-4 border-b border-gray-200">
              <h2 className="font-semibold text-gray-900">Team Performance</h2>
            </div>

            {!data ? (
              <div className="px-5 py-10 text-gray-500">No data.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Team member</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Role</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Active cases</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Tasks completed</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Fees earned</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Billable hours</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {data.team.map((member) => (
                      <tr key={member.name} className="hover:bg-gray-50">
                        <td className="px-5 py-4 text-sm font-medium text-gray-900">{member.name}</td>
                        <td className="px-5 py-4 text-sm text-gray-600">{member.role}</td>
                        <td className="px-5 py-4 text-sm text-gray-600">{member.activeCases}</td>
                        <td className="px-5 py-4 text-sm text-gray-600">{member.tasksCompleted}</td>
                        <td className="px-5 py-4 text-sm font-medium text-gray-900">{fmtMoney(member.earnedFees || 0)}</td>
                        <td className="px-5 py-4 text-sm text-gray-600">{member.billableHours}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Case Distribution */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Case Distribution by Practice Path</h2>

            {!data ? (
              <div className="text-gray-500">No data.</div>
            ) : data.caseTypes.length === 0 ? (
              <div className="text-gray-500">No practice paths available.</div>
            ) : (
              <div className="space-y-3">
                {data.caseTypes.map((item) => {
                  const total = (item.active || 0) + (item.closed || 0);
                  const percentage = total > 0 ? (item.active / total) * 100 : 0;

                  return (
                    <div key={item.type}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="font-medium text-gray-900">{item.type}</span>
                        <span className="text-gray-600">
                          {item.active} active / {item.closed} closed
                        </span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-gray-700" style={{ width: `${percentage}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {selectedReport === 'financial' && (
        <div className="space-y-6">
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Financial Summary</h2>

            {!data ? (
              <div className="text-gray-500">No data.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <div className="text-sm text-gray-600 mb-2">Total Billed</div>
                  <div className="text-3xl font-semibold text-gray-900 mb-1">{fmtMoney(data.kpis.billed)}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600 mb-2">Total Collected</div>
                  <div className="text-3xl font-semibold text-green-700 mb-1">{fmtMoney(data.kpis.collected)}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600 mb-2">Outstanding</div>
                  <div className="text-3xl font-semibold text-yellow-700 mb-1">{fmtMoney(data.kpis.outstanding)}</div>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Revenue by Practice Path (Billed)</h2>

            {!data ? (
              <div className="text-gray-500">No data.</div>
            ) : (
              <div className="space-y-3">
                {data.caseTypes.map((c) => (
                  <div key={c.type} className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">{c.type}</span>
                    <span className="text-sm font-semibold text-gray-900">{fmtMoney(c.revenueBilled)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {selectedReport === 'productivity' && (
        <div className="space-y-6">
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="font-semibold text-gray-900 mb-2">Productivity Summary</h2>
            {!data ? (
              <div className="text-gray-500">No data.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
                {[
                  ['Excellent', data.team.reduce((s, m) => s + (m.excellentTasks || 0), 0), 'bg-green-600'],
                  ['Good', data.team.reduce((s, m) => s + (m.goodTasks || 0), 0), 'bg-yellow-500'],
                  ['Delayed', data.team.reduce((s, m) => s + (m.delayedTasks || 0), 0), 'bg-yellow-500'],
                  ['Risk', data.team.reduce((s, m) => s + (m.riskTasks || 0), 0), 'bg-red-600'],
                ].map(([label, value, color]) => {
                  const total = data.team.reduce(
                    (s, m) =>
                      s +
                      (m.excellentTasks || 0) +
                      (m.goodTasks || 0) +
                      (m.delayedTasks || 0) +
                      (m.riskTasks || 0),
                    0
                  );
                  const pct = total ? Math.round((Number(value) / total) * 100) : 0;
                  return (
                    <div key={String(label)} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
                        {label}
                      </div>
                      <div className="mt-2 text-2xl font-semibold text-gray-900">{pct}%</div>
                      <div className="text-xs text-gray-500">{String(value)} completed tasks</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Team Productivity Metrics</h2>

            {!data ? (
              <div className="text-gray-500">No data.</div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Team Member</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Tasks Completed</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Fees Earned</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Early</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">On Time</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Late</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Overdue</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Deadline Score</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Hours</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {data.team.map((member) => (
                    <tr key={member.name}>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{member.name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{member.tasksCompleted}</td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{fmtMoney(member.earnedFees || 0)}</td>
                      <td className="px-4 py-3 text-sm text-green-700">{member.earlyTasks || 0}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{member.onTimeTasks || 0}</td>
                      <td className="px-4 py-3 text-sm text-yellow-700">{member.lateTasks || 0}</td>
                      <td className="px-4 py-3 text-sm text-red-700">{member.overdueTasks || 0}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        <div className="flex gap-1.5 flex-wrap">
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">{member.excellentTasks || 0}</span>
                          <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800">{member.goodTasks || 0}</span>
                          <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800">{member.delayedTasks || 0}</span>
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">{member.riskTasks || 0}</span>
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                          Avg used: {member.averageTimeUsedPercent == null ? '—' : `${member.averageTimeUsedPercent}%`}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{member.billableHours}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {selectedReport === 'cases' && (
        <div className="space-y-6">
          <div className="bg-white border border-gray-200 rounded-lg">
            <div className="px-5 py-4 border-b border-gray-200">
              <h2 className="font-semibold text-gray-900">Case Analytics by Practice Path</h2>
            </div>

            {!data ? (
              <div className="px-5 py-10 text-gray-500">No data.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Practice Path</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Active</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Closed</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Avg Duration</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Revenue Billed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {data.caseTypes.map((item) => (
                      <tr key={item.type} className="hover:bg-gray-50">
                        <td className="px-5 py-4 text-sm font-medium text-gray-900">{item.type}</td>
                        <td className="px-5 py-4 text-sm text-gray-600">{item.active}</td>
                        <td className="px-5 py-4 text-sm text-gray-600">{item.closed}</td>
                        <td className="px-5 py-4 text-sm text-gray-600">
                          {item.avgDurationDays ? `${item.avgDurationDays} days` : '—'}
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-900 font-medium">
                          {fmtMoney(item.revenueBilled)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
