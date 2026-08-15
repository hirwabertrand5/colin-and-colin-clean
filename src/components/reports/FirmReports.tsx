import { useEffect, useMemo, useState } from 'react';
import { Download, FileText, BarChart3, TrendingUp, Users, Search, ArrowUpDown } from 'lucide-react';
import { UserRole } from '../../App';
import { FirmReportDateBasis, FirmReportRange, FirmReportResponse, getFirmReports } from '../../services/firmReportsService';
import { getStaffUsers, User } from '../../services/userService';
import usePageTitle from '../../hooks/usePageTitle';
import { downloadWorkbook } from '../../utils/excelExport';

interface FirmReportsProps {
  userRole: UserRole;
}

const canAccess = (role: UserRole) => role === 'managing_director' || role === 'executive_assistant';

const fmtMoney = (n: number) =>
  `RWF ${Math.round((Number(n) || 0) * 100) / 100}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const pickMoney = (...values: Array<number | undefined | null>) => values.find((value) => value !== undefined && value !== null) ?? 0;
const withRowNumbers = (rows: Array<Array<unknown>>) => rows.map((row, index) => [index + 1, ...row]);
const fmtPercent = (value?: number | null) => (value == null ? '—' : `${Math.round((Number(value) || 0) * 10) / 10}%`);
const fmtDateTime = (value?: string | null) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};
const ROLE_ORDER = [
  'Intern',
  'Trainee Associate',
  'Associate / Executive Assistant',
  'Senior Associate / Senior Executive Assistant',
  'Associate Partner / Executive Associate Partner',
  'Partner / Executive Partner',
  'Managing Partner / Executive Managing Partner',
  'Senior Partner / Executive Partner / Originating Attorney',
  'Firm Retained Earnings',
];

type ClientProfitabilityRow = NonNullable<FirmReportResponse['clientProfitability']>[number];
type ClientProfitabilitySort =
  | 'nameAsc'
  | 'nameDesc'
  | 'grossProfitDesc'
  | 'grossProfitAsc'
  | 'billedDesc'
  | 'marginDesc'
  | 'outstandingDesc'
  | 'mattersDesc';



export default function FirmReports({ userRole }: FirmReportsProps) {
  const [selectedReport, setSelectedReport] = useState<'overview' | 'financial' | 'productivity' | 'cases' | 'clientProfitability'>('overview');
  const [dateRange, setDateRange] = useState<FirmReportRange>('monthly');
  const [dateBasis, setDateBasis] = useState<FirmReportDateBasis>('invoiceDate');
  const [teamMembers, setTeamMembers] = useState<User[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string | undefined>(undefined);
  const [clientNameFilter, setClientNameFilter] = useState('');
  const [clientPracticeAreaFilter, setClientPracticeAreaFilter] = useState('all');
  const [clientStatusFilter, setClientStatusFilter] = useState('all');
  const [clientSortBy, setClientSortBy] = useState<ClientProfitabilitySort>('nameAsc');
  const [selectedClientProfitability, setSelectedClientProfitability] = useState<ClientProfitabilityRow | null>(null);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  usePageTitle('Firm Reports');
  const [data, setData] = useState<FirmReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reportTypes = [
    { id: 'overview', label: 'Firm Overview', icon: BarChart3 },
    { id: 'financial', label: 'Financial Summary', icon: TrendingUp },
    { id: 'productivity', label: 'Productivity Report', icon: Users },
    { id: 'cases', label: 'Case Analytics', icon: FileText },
    { id: 'clientProfitability', label: 'Client Profitability', icon: TrendingUp },
  ] as const;

  useEffect(() => {
    if (!canAccess(userRole)) return;

    let mounted = true;
    (async () => {
      try {
        const users = await getStaffUsers();
        if (!mounted) return;
        setTeamMembers(users);
      } catch {
        if (!mounted) return;
        setTeamMembers([]);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [userRole]);

  useEffect(() => {
    if (!canAccess(userRole)) return;

    if (dateRange === 'custom' && (!customFrom || !customTo)) {
      setData(null);
      return;
    }

    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        setError('');
        const resp = await getFirmReports({
          range: dateRange,
          from: dateRange === 'custom' ? customFrom : undefined,
          to: dateRange === 'custom' ? customTo : undefined,
          basis: dateBasis,
          teamMemberId: selectedMemberId,
        });
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
  }, [userRole, dateRange, dateBasis, selectedMemberId, customFrom, customTo, refreshToken]);

  useEffect(() => {
    const onTaskReportUpdated = () => {
      setRefreshToken((n) => n + 1);
    };

    window.addEventListener('task-report-updated', onTaskReportUpdated as EventListener);
    return () => window.removeEventListener('task-report-updated', onTaskReportUpdated as EventListener);
  }, []);

  const firmStats = useMemo(() => {
    const k = data?.kpis;
    return [
      { label: 'Active Cases', value: k ? String(k.activeCases) : '—' },
      { label: 'Total Contract Value', value: k ? fmtMoney(k.totalContractValue ?? k.contractValue ?? k.billed) : '—' },
      { label: 'Total Billed', value: k ? fmtMoney(k.totalBilled ?? k.billed) : '—' },
      { label: 'Total Collected', value: k ? fmtMoney(k.totalCollected ?? k.collected) : '—' },
    ];
  }, [data]);

  const selectedMemberSummary = data?.selectedMember || null;

  const clientProfitabilityRows = useMemo(() => {
    const rows = [...(data?.clientProfitability || [])];
    const filter = clientNameFilter.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      const practiceArea = row.primaryPracticeArea || row.revenueByPracticeArea?.[0]?.type || 'Unclassified';
      const statusBucket = row.completedMatters > 0 && row.activeMatters > 0 ? 'mixed' : row.completedMatters > 0 ? 'completed' : 'active';
      if (filter && !row.partyName.toLowerCase().includes(filter)) return false;
      if (clientPracticeAreaFilter !== 'all' && practiceArea !== clientPracticeAreaFilter) return false;
      if (clientStatusFilter !== 'all' && statusBucket !== clientStatusFilter) return false;
      return true;
    });

    return filtered.sort((a, b) => {
      switch (clientSortBy) {
        case 'nameDesc':
          return b.partyName.localeCompare(a.partyName);
        case 'grossProfitDesc':
          return (b.grossProfit || 0) - (a.grossProfit || 0);
        case 'grossProfitAsc':
          return (a.grossProfit || 0) - (b.grossProfit || 0);
        case 'billedDesc':
          return (b.totalBilled || 0) - (a.totalBilled || 0);
        case 'marginDesc':
          return (b.grossProfitMargin || 0) - (a.grossProfitMargin || 0);
        case 'outstandingDesc':
          return (b.outstanding || 0) - (a.outstanding || 0);
        case 'mattersDesc':
          return (b.matterCount || 0) - (a.matterCount || 0);
        case 'nameAsc':
        default:
          return a.partyName.localeCompare(b.partyName);
      }
    });
  }, [data, clientNameFilter, clientPracticeAreaFilter, clientStatusFilter, clientSortBy]);

  const clientProfitabilitySummary = useMemo(() => {
    const rows = clientProfitabilityRows;
    const contractValue = rows.reduce((sum, row) => sum + (row.contractValue || 0), 0);
    const billed = rows.reduce((sum, row) => sum + (row.totalBilled || 0), 0);
    const collected = rows.reduce((sum, row) => sum + (row.collected || 0), 0);
    const outstanding = rows.reduce((sum, row) => sum + (row.outstanding || 0), 0);
    const directMatterCosts = rows.reduce((sum, row) => sum + (row.directMatterCosts || 0), 0);
    const grossProfit = collected - directMatterCosts;
    const grossProfitMargin = collected > 0 ? Math.round((grossProfit / collected) * 1000) / 10 : 0;
    const collectionValues = rows.filter((row) => row.collectionPeriodDays != null);
    const collectionDays = collectionValues.reduce((sum, row) => sum + (row.collectionPeriodDays || 0), 0);
    return {
      clientCount: rows.length,
      matterCount: rows.reduce((sum, row) => sum + (row.matterCount || 0), 0),
      contractValue,
      billed,
      collected,
      outstanding,
      directMatterCosts,
      grossProfit,
      grossProfitMargin,
      collectionPeriodDays: collectionValues.length > 0 ? Math.round((collectionDays / collectionValues.length) * 10) / 10 : null,
      retainerValue: rows.reduce((sum, row) => sum + (row.retainerValue || 0), 0),
    };
  }, [clientProfitabilityRows]);

  const formatOptionalMoney = (value?: number | null) => (value == null || value === 0 ? 'N/A' : fmtMoney(value));
  const getPracticeArea = (row: ClientProfitabilityRow) => row.primaryPracticeArea || row.revenueByPracticeArea?.[0]?.type || 'Unclassified';
  const getStatusBucket = (row: ClientProfitabilityRow) =>
    row.completedMatters > 0 && row.activeMatters > 0 ? 'mixed' : row.completedMatters > 0 ? 'completed' : 'active';

  const orderedTeam = useMemo(() => {
    if (!data?.team) return [];
    const idx = (label?: string) => {
      if (!label) return ROLE_ORDER.length + 1;
      const i = ROLE_ORDER.indexOf(label);
      return i === -1 ? ROLE_ORDER.length + 1 : i;
    };
    return [...data.team].sort((a, b) => {
      const al = a.earningRoleLabel || a.role || '';
      const bl = b.earningRoleLabel || b.role || '';
      const ia = idx(al);
      const ib = idx(bl);
      if (ia !== ib) return ia - ib;
      return (b.activeCases || 0) - (a.activeCases || 0);
    });
  }, [data]);

  const exportWorkbook = async () => {
    if (!data) return;

    const orderedTeamRows = (data.team || [])
      .slice()
      .sort((a, b) => {
        const idx = (label?: string) => {
          if (!label) return ROLE_ORDER.length + 1;
          const i = ROLE_ORDER.indexOf(label);
          return i === -1 ? ROLE_ORDER.length + 1 : i;
        };
        const ia = idx(a.earningRoleLabel || a.role || '');
        const ib = idx(b.earningRoleLabel || b.role || '');
        if (ia !== ib) return ia - ib;
        return (b.activeCases || 0) - (a.activeCases || 0);
      });

    const productivityRows = [...(data.productivityRows || [])].sort((a, b) =>
      String(b.completedAt || '').localeCompare(String(a.completedAt || ''))
    );
    const productivitySummary = data.productivitySummary;
    const productivitySummaryRows = withRowNumbers([
      ['Completed Tasks', String(productivitySummary?.completedTasks ?? productivityRows.length)],
      ['Task Fee Collected', fmtMoney(productivitySummary?.totalTaskFeeCollected ?? productivitySummary?.totalTaskFee ?? productivityRows.reduce((sum, row) => sum + ((row.taskFeeCollected ?? row.taskFee) || 0), 0))],
      ['Total Fee Earned', fmtMoney(productivitySummary?.totalFeeEarned ?? productivityRows.reduce((sum, row) => sum + (row.feeEarned || 0), 0))],
      ['Pending Quality Scores', String(productivitySummary?.pendingQualityScores ?? productivityRows.filter((row) => row.qualityScore == null).length)],
      ['Average Quality Score', productivitySummary?.averageQualityScore == null ? '—' : `${productivitySummary.averageQualityScore}%`],
      ['Average Timeliness Score', productivitySummary?.averageTimelinessScore == null ? '—' : `${productivitySummary.averageTimelinessScore}%`],
    ]);
    const numberedOverviewTeamRows = withRowNumbers(
      orderedTeamRows.map((member) => [
        member.name,
        member.role,
        member.activeCases,
        member.tasksCompleted,
        member.earningSharePercent == null ? 0 : member.earningSharePercent / 100,
        pickMoney(member.invoicePaymentsReceived, member.grossFeesHandled),
        pickMoney(member.revenueAttributed, member.earnedFees),
        member.grossFeesHandled || 0,
        member.firmRetainedEarnings || 0,
      ])
    );
    const numberedProductivityRows = withRowNumbers(
      productivityRows.map((row) => [
        fmtDateTime(row.completedAt),
        row.staff,
        row.matter,
        row.task,
        (row.taskFeeCollected ?? row.taskFee) || 0,
        `${row.tpaPercent || 0}%`,
        row.timelinessScore == null ? '—' : `${row.timelinessScore}%`,
        row.qualityScore == null ? '—' : `${row.qualityScore}%`,
        row.formula,
        row.feeEarned == null ? '—' : row.feeEarned,
      ])
    );
    const numberedCaseTypes = withRowNumbers(
      data.caseTypes.map((c) => [c.type, c.active, c.closed, c.avgDurationDays ? `${c.avgDurationDays} days` : '—', c.revenueBilled])
    );
    const numberedClientProfitability = withRowNumbers(
      clientProfitabilityRows.map((row) => [
        row.partyName,
        row.matterCount,
        row.activeMatters,
        row.completedMatters,
        row.contractValue,
        row.totalBilled,
        row.collected,
        row.outstanding,
        row.directMatterCosts,
        row.grossProfit,
        `${row.grossProfitMargin}%`,
        row.collectionPeriodDays == null ? '—' : `${row.collectionPeriodDays} days`,
        row.retainerValue,
        (row.revenueByPracticeArea || [])
          .map((item) => `${item.type}: ${fmtMoney(item.amount)}`)
          .join(' | '),
      ])
    );

    const exportConfig = (() => {
      switch (selectedReport) {
        case 'financial':
          return {
            title: 'Financial Summary',
            sections: [
              {
                title: 'Summary Banners',
                headers: ['#', 'Metric Type', 'Value'],
                rows: [
                  ...withRowNumbers([
                    ['Total Contract Value', data.kpis.totalContractValue ?? data.kpis.contractValue ?? data.kpis.billed],
                    ['Total Billed', data.kpis.totalBilled ?? data.kpis.billed],
                    ['Total Collected', data.kpis.totalCollected ?? data.kpis.collected],
                    ['Total Direct Matter Costs', pickMoney(data.kpis.totalDirectMatterCosts, data.kpis.directMatterCosts, data.kpis.clientRelatedExpenses)],
                    ['Gross Profit', data.kpis.grossProfit ?? 0],
                    ['Firm Operating Expenses', data.kpis.firmOperatingExpenses || 0],
                    ['Net Profit', data.kpis.netProfit ?? 0],
                    ['Net Profit Margin (%)', `${data.kpis.netProfitMargin ?? 0}%`],
                  ]),
                ],
                currencyColumns: [3],
              },
              {
                title: 'Expense Types / Petty Cash Ledger',
                headers: ['#', 'Expense Item Type', 'Total Entries', 'Total Amount (RWF)', 'Reimbursable Client Portion (RWF)'],
                rows: withRowNumbers((data.expenseTypes || []).map((e) => [e.type, e.count, e.amount, e.clientRelatedAmount])),
                currencyColumns: [4, 5],
                summaryRow: ['', 'Total', (data.expenseTypes || []).reduce((sum, e) => sum + (e.count || 0), 0), (data.expenseTypes || []).reduce((sum, e) => sum + (e.amount || 0), 0), (data.expenseTypes || []).reduce((sum, e) => sum + (e.clientRelatedAmount || 0), 0)],
              },
              {
                title: 'Revenue by Practice Path (Total Billed)',
                headers: ['#', 'Practice Path', 'Total Billed Amount (RWF)'],
                rows: numberedCaseTypes,
                currencyColumns: [3],
              },
            ],
          };
        case 'productivity':
          return {
            title: 'Productivity Report',
            sections: [
              {
                title: 'Productivity Summary',
                headers: ['#', 'Metric', 'Value'],
                rows: productivitySummaryRows,
              },
              {
                title: 'Task Productivity Metrics',
                headers: ['#', 'Date & Time', 'Staff', 'Matter', 'Task', 'Task Fee Collected', 'TPA', 'Timeliness Score', 'Quality Score', 'Formula', 'Fee Earned'],
                rows: numberedProductivityRows,
                currencyColumns: [6, 11],
                percentColumns: [7, 8, 9],
                centerColumns: [2, 6, 7, 8, 9, 11],
              },
            ],
          };
        case 'cases':
          return {
            title: 'Case Analytics',
            sections: [
              {
                title: 'Case Analytics by Practice Path',
                headers: ['#', 'Practice Path', 'Active', 'Closed', 'Avg Duration', 'Revenue Billed'],
                rows: numberedCaseTypes,
                currencyColumns: [6],
                centerColumns: [5],
              },
            ],
          };
        case 'clientProfitability':
          return {
            title: 'Client Profitability',
            sections: [
              {
                title: 'Client Profitability Summary',
                headers: ['#', 'Metric', 'Value'],
                rows: withRowNumbers([
                  ['Clients', clientProfitabilitySummary.clientCount],
                  ['Matters', clientProfitabilitySummary.matterCount],
                  ['Total Contract Value', clientProfitabilitySummary.contractValue],
                  ['Total Billed', clientProfitabilitySummary.billed],
                  ['Total Collected', clientProfitabilitySummary.collected],
                  ['Outstanding', Math.max(0, clientProfitabilitySummary.billed - clientProfitabilitySummary.collected)],
                  ['Direct Matter Costs', clientProfitabilitySummary.directMatterCosts],
                  ['Gross Profit', clientProfitabilitySummary.grossProfit],
                  ['Gross Profit Margin (%)', `${clientProfitabilitySummary.grossProfitMargin}%`],
                  ['Collection Period', clientProfitabilitySummary.collectionPeriodDays == null ? 'N/A' : `${clientProfitabilitySummary.collectionPeriodDays} days`],
                  ['Retainer Value', clientProfitabilitySummary.retainerValue],
                ]),
                currencyColumns: [3],
              },
              {
                title: 'Client Profitability by Client Name',
                headers: ['#', 'Client', 'Matters', 'Active', 'Completed', 'Contract Value', 'Total Billed', 'Collected', 'Outstanding', 'Direct Matter Costs', 'Gross Profit', 'Gross Margin', 'Collection Period', 'Retainer Value', 'Revenue by Practice Area'],
                rows: numberedClientProfitability,
                currencyColumns: [6, 7, 8, 9, 10, 11, 13],
                centerColumns: [3, 4, 5, 12],
              },
            ],
          };
        case 'overview':
        default:
          return {
            title: 'Firm Overview',
            sections: [
              {
                title: 'KPI Summary Blocks',
                headers: ['#', 'Metric Type', 'Total Count'],
                rows: [
                  ...withRowNumbers([
                    ['Active Cases', data.kpis.activeCases],
                    ['Total Contract Value', data.kpis.totalContractValue ?? data.kpis.contractValue ?? data.kpis.billed],
                    ['Total Billed', data.kpis.totalBilled ?? data.kpis.billed],
                    ['Total Collected', data.kpis.totalCollected ?? data.kpis.collected],
                    ['Net Profit', data.kpis.netProfit ?? 0],
                  ]),
                ],
                currencyColumns: [3],
              },
              {
                title: 'Team Performance',
                headers: ['#', 'Team Member', 'Role', 'Active Cases', 'Tasks Completed', 'Share', 'Total Collected', 'Revenue Attributed', 'Gross Fees Handled', 'Firm Retained Earnings'],
                rows: numberedOverviewTeamRows,
                currencyColumns: [7, 8, 9, 10],
                percentColumns: [6],
              },
              {
                title: 'Case Distribution by Practice Path',
                headers: ['#', 'Practice Path', 'Active Cases', 'Closed Cases'],
                rows: withRowNumbers(data.caseTypes.map((c) => [c.type, c.active, c.closed])),
              },
            ],
          };
      }
    })();

    const filename = `${exportConfig.title.toLowerCase().replace(/\s+/g, '-')}_${data.range.from}_to_${data.range.to}`;
    await downloadWorkbook(filename, [exportConfig]);
  };

  if (!canAccess(userRole)) {
    return (
      <div className="p-6 bg-white border border-gray-200 rounded">
        <h1 className="text-xl font-semibold text-gray-900 mb-2">Access denied</h1>
        <p className="text-gray-600">Only Managing Director and Executive Assistant can view firm-wide reports.</p>
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
                  ? `Period: ${data.range.from} → ${data.range.to} (${data.dateBasis})`
                  : 'Comprehensive analytics and performance reports'}
            </p>
          </div>

          <div className="flex flex-wrap items-start gap-3">
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as FirmReportRange)}
              className="px-4 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
            >
              <option value="daily">Last Day</option>
              <option value="weekly">Last Week</option>
              <option value="monthly">Last Month</option>
              <option value="quarterly">Last Quarter</option>
              <option value="yearly">Last Year</option>
              <option value="custom">Custom Range</option>
            </select>

            <select
              value={dateBasis}
              onChange={(e) => setDateBasis(e.target.value as FirmReportDateBasis)}
              className="px-4 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
            >
              <option value="invoiceDate">Invoice Date</option>
              <option value="paymentDate">Payment Date</option>
              <option value="taskDate">Task Completion Date</option>
            </select>

            <select
              value={selectedMemberId || ''}
              onChange={(e) => setSelectedMemberId(e.target.value || undefined)}
              className="px-4 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
            >
              <option value="">All team members</option>
              {teamMembers.map((member) => (
                <option key={member._id} value={member._id}>
                  {member.name} ({member.role})
                </option>
              ))}
            </select>

            <button
              onClick={() => void exportWorkbook()}
              disabled={!data || loading}
              className="inline-flex items-center px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700 disabled:opacity-60"
            >
              <Download className="w-4 h-4 mr-2" />
              Export Active Report
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-4 border border-red-200 bg-red-50 text-red-700 rounded">
            {error}
          </div>
        )}

        {dateRange === 'custom' && (
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <label className="flex flex-col text-sm text-gray-700">
              From
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="mt-1 px-3 py-2 border border-gray-300 rounded bg-white text-gray-900"
              />
            </label>
            <label className="flex flex-col text-sm text-gray-700">
              To
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="mt-1 px-3 py-2 border border-gray-300 rounded bg-white text-gray-900"
              />
            </label>
            <div className="text-sm text-gray-500">
              Use the custom range to compare exact date windows for the report.
            </div>
          </div>
        )}

        {/* Report Type Selector */}
        <div className="flex gap-2 border-b border-gray-200 dark:border-slate-700">
          {reportTypes.map((type) => {
            const Icon = type.icon;
            const active = selectedReport === type.id;
            return (
              <button
                key={type.id}
                onClick={() => setSelectedReport(type.id)}
                className={`
                  flex items-center px-4 py-3 border-b-2 font-medium text-sm transition-colors
                  ${active ? 'border-gray-900 text-gray-900 dark:border-gray-100 dark:text-gray-100' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}
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
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">#</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Team member</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Role</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Active cases</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Tasks completed</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Share</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Total Collected</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Revenue attributed</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Gross fees handled</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Firm retained earnings</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {orderedTeam.map((member, index) => (
                      <tr key={member.id || member.name} className="hover:bg-gray-50">
                        <td className="px-5 py-4 text-sm text-gray-500">{index + 1}</td>
                        <td className="px-5 py-4 text-sm font-medium text-gray-900">{member.name}</td>
                        <td className="px-5 py-4 text-sm text-gray-600">{member.role}</td>
                        <td className="px-5 py-4 text-sm text-gray-600">{member.activeCases}</td>
                        <td className="px-5 py-4 text-sm text-gray-600">{member.tasksCompleted}</td>
                        <td className="px-5 py-4 text-sm text-gray-600">
                          {member.earningSharePercent ?? 0}%
                          <div className="text-xs text-gray-500">{member.earningRoleLabel || 'Firm share'}</div>
                        </td>
                        <td className="px-5 py-4 text-sm font-medium text-gray-900">{fmtMoney(member.invoicePaymentsReceived || member.grossFeesHandled || 0)}</td>
                        <td className="px-5 py-4 text-sm font-medium text-gray-900">{fmtMoney(pickMoney(member.revenueAttributed, member.earnedFees))}</td>
                        <td className="px-5 py-4 text-sm text-gray-600">{fmtMoney(member.grossFeesHandled || 0)}</td>
                        <td className="px-5 py-4 text-sm text-gray-600">{fmtMoney(member.firmRetainedEarnings || 0)}</td>
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
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Total Contract Value</div>
                  <div className="mt-2 text-lg font-semibold text-gray-900">
                    {fmtMoney(data.kpis.totalContractValue ?? data.kpis.contractValue ?? data.kpis.billed)}
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Total Billed</div>
                  <div className="mt-2 text-lg font-semibold text-gray-900">
                    {fmtMoney(data.kpis.totalBilled ?? data.kpis.billed)}
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Total Collected</div>
                  <div className="mt-2 text-lg font-semibold text-green-700">
                    {fmtMoney(data.kpis.totalCollected ?? data.kpis.collected)}
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Total Direct Matter Costs</div>
                  <div className="mt-2 text-lg font-semibold text-red-700">
                    {fmtMoney(pickMoney(data.kpis.totalDirectMatterCosts, data.kpis.directMatterCosts, data.kpis.clientRelatedExpenses))}
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Gross Profit</div>
                  <div
                    className={`mt-2 text-lg font-semibold ${(data.kpis.grossProfit ?? 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}
                  >
                    {fmtMoney(data.kpis.grossProfit ?? 0)}
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Firm Operating Expenses</div>
                  <div className="mt-2 text-lg font-semibold text-gray-900">{fmtMoney(data.kpis.firmOperatingExpenses || 0)}</div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Net Profit</div>
                  <div
                    className={`mt-2 text-lg font-semibold ${(data.kpis.netProfit ?? 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}
                  >
                    {fmtMoney(data.kpis.netProfit ?? 0)}
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Net Profit Margin (%)</div>
                  <div
                    className={`mt-2 text-lg font-semibold ${(data.kpis.netProfitMargin ?? 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}
                  >
                    {`${data.kpis.netProfitMargin ?? 0}%`}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Expense Types</h2>

            {!data ? (
              <div className="text-gray-500">No data.</div>
            ) : (data.expenseTypes || []).length === 0 ? (
              <div className="text-gray-500">No expenses recorded for this period.</div>
            ) : (
              <div className="space-y-3">
                {(data.expenseTypes || []).map((e) => (
                  <div key={e.type} className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-sm font-medium text-gray-900">{e.type}</div>
                      <div className="text-xs text-gray-500">{e.count} entries</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-gray-900">{fmtMoney(e.amount)}</div>
                      <div className="text-xs text-red-700">Client: {fmtMoney(e.clientRelatedAmount)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Revenue by Practice Path (Total Billed)</h2>

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
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mt-4">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Completed Tasks</div>
                  <div className="mt-2 text-2xl font-semibold text-gray-900">
                    {data.productivitySummary?.completedTasks ?? data.productivityRows?.length ?? 0}
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Task Fee Collected</div>
                  <div className="mt-2 text-2xl font-semibold text-gray-900">
                    {fmtMoney(data.productivitySummary?.totalTaskFeeCollected ?? data.productivitySummary?.totalTaskFee ?? (data.productivityRows || []).reduce((s, r) => s + ((r.taskFeeCollected ?? r.taskFee) || 0), 0))}
                  </div>
                </div>
                {selectedMemberSummary && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Selected Member Earned</div>
                    <div className="mt-2 text-2xl font-semibold text-green-700">
                      {fmtMoney(selectedMemberSummary.feesEarned || 0)}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {selectedMemberSummary.name}
                      {selectedMemberSummary.role ? ` - ${selectedMemberSummary.role}` : ''}
                    </div>
                  </div>
                )}
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Total Fee Earned</div>
                  <div className="mt-2 text-2xl font-semibold text-green-700">
                    {fmtMoney(data.productivitySummary?.totalFeeEarned ?? (data.productivityRows || []).reduce((s, r) => s + (r.feeEarned || 0), 0))}
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Pending Quality Scores</div>
                  <div className="mt-2 text-2xl font-semibold text-amber-700">
                    {data.productivitySummary?.pendingQualityScores ?? (data.productivityRows || []).filter((r) => r.qualityScore == null).length}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Task Productivity Metrics</h2>

            {!data ? (
              <div className="text-gray-500">No data.</div>
            ) : (data.productivityRows || []).length === 0 ? (
              <div className="text-gray-500">No completed tasks for this period.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[1400px] w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">#</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Date / Time</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Staff</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Matter</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Task</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 uppercase">Task Fee Collected</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase">TPA</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase">Timeliness Score</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase">Quality Score</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase">Formula</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 uppercase">Fee Earned</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {(data.productivityRows || []).map((row, index) => (
                      <tr key={row.id || `${row.staff}-${row.completedAt}-${index}`} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-500">{index + 1}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{fmtDateTime(row.completedAt)}</td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{row.staff}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{row.matter}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{row.task}</td>
                        <td className="px-4 py-3 text-sm text-right font-medium text-gray-900">{fmtMoney(row.taskFeeCollected ?? row.taskFee)}</td>
                        <td className="px-4 py-3 text-sm text-center text-gray-700">{fmtPercent(row.tpaPercent)}</td>
                        <td className="px-4 py-3 text-sm text-center text-gray-700">
                          {row.timelinessScore == null ? '—' : `${row.timelinessScore}%`}
                          <div className="text-[11px] text-gray-500">{row.timelinessScore == null ? '—' : row.timelinessStatus}</div>
                        </td>
                        <td className="px-4 py-3 text-sm text-center text-gray-700">
                          {row.qualityScore == null ? '—' : `${row.qualityScore}%`}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 max-w-[360px] break-words">{row.formula}</td>
                        <td className="px-4 py-3 text-sm text-right font-medium text-gray-900">
                          {row.feeEarned == null ? '—' : fmtMoney(row.feeEarned)}
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
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">#</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Practice Path</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Active</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Closed</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Avg Duration</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Revenue Billed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                    {data.caseTypes.map((item, index) => (
                      <tr key={item.type} className="hover:bg-gray-50">
                        <td className="px-5 py-4 text-sm text-gray-500">{index + 1}</td>
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

      {selectedReport === 'clientProfitability' && (
        <div className="space-y-6">
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="px-5 py-4 border-b border-gray-200 dark:border-slate-700">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Client Profitability Report</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">Party-based profitability across all matters and billing records.</p>
            </div>

            <div className="grid grid-cols-1 gap-3 border-b border-gray-200 p-4 dark:border-slate-700 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-gray-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="text-xs uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Total Clients</div>
                <div className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">{clientProfitabilitySummary.clientCount}</div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="text-xs uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Total Contract Value</div>
                <div className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">{fmtMoney(clientProfitabilitySummary.contractValue)}</div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="text-xs uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Total Billed</div>
                <div className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">{fmtMoney(clientProfitabilitySummary.billed)}</div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="text-xs uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Total Collected</div>
                <div className="mt-2 text-2xl font-semibold text-emerald-700 dark:text-emerald-300">{fmtMoney(clientProfitabilitySummary.collected)}</div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="text-xs uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Total Outstanding</div>
                <div className={`mt-2 text-2xl font-semibold ${clientProfitabilitySummary.outstanding >= 0 ? 'text-amber-700 dark:text-amber-300' : 'text-rose-700 dark:text-rose-300'}`}>{fmtMoney(clientProfitabilitySummary.outstanding)}</div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="text-xs uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Direct Matter Costs</div>
                <div className="mt-2 text-2xl font-semibold text-rose-700 dark:text-rose-300">{fmtMoney(clientProfitabilitySummary.directMatterCosts)}</div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="text-xs uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Gross Profit</div>
                <div className={`mt-2 text-2xl font-semibold ${clientProfitabilitySummary.grossProfit >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>{fmtMoney(clientProfitabilitySummary.grossProfit)}</div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="text-xs uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Average Gross Profit Margin</div>
                <div className={`mt-2 text-2xl font-semibold ${clientProfitabilitySummary.grossProfitMargin >= 50 ? 'text-emerald-700 dark:text-emerald-300' : clientProfitabilitySummary.grossProfitMargin >= 25 ? 'text-amber-700 dark:text-amber-300' : 'text-rose-700 dark:text-rose-300'}`}>{`${clientProfitabilitySummary.grossProfitMargin}%`}</div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 border-b border-gray-200 p-4 dark:border-slate-700 lg:grid-cols-4">
              <label className="flex flex-col gap-2">
                <span className="text-xs font-medium uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Search client</span>
                <div className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900">
                  <Search className="h-4 w-4 text-gray-400" />
                  <input
                    value={clientNameFilter}
                    onChange={(e) => setClientNameFilter(e.target.value)}
                    placeholder="Type a client or party name"
                    className="w-full bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100"
                  />
                </div>
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs font-medium uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Primary practice area</span>
                <select
                  value={clientPracticeAreaFilter}
                  onChange={(e) => setClientPracticeAreaFilter(e.target.value)}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-gray-100"
                >
                  <option value="all">All practice areas</option>
                  {clientPracticeAreas.map((area) => (
                    <option key={area} value={area}>{area}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs font-medium uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Matter status</span>
                <select
                  value={clientStatusFilter}
                  onChange={(e) => setClientStatusFilter(e.target.value)}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-gray-100"
                >
                  <option value="all">All statuses</option>
                  <option value="active">Active only</option>
                  <option value="completed">Completed only</option>
                  <option value="mixed">Mixed</option>
                </select>
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs font-medium uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Sort by</span>
                <div className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900">
                  <ArrowUpDown className="h-4 w-4 text-gray-400" />
                  <select
                    value={clientSortBy}
                    onChange={(e) => setClientSortBy(e.target.value as ClientProfitabilitySort)}
                    className="w-full bg-transparent text-sm text-gray-900 outline-none dark:text-gray-100"
                  >
                    <option value="nameAsc">Client name A-Z</option>
                    <option value="nameDesc">Client name Z-A</option>
                    <option value="grossProfitDesc">Highest gross profit</option>
                    <option value="grossProfitAsc">Lowest gross profit</option>
                    <option value="billedDesc">Highest billed</option>
                    <option value="marginDesc">Highest margin</option>
                    <option value="outstandingDesc">Highest outstanding</option>
                    <option value="mattersDesc">Most matters</option>
                  </select>
                </div>
              </label>
            </div>

            {!clientProfitabilityRows.length ? (
              <div className="px-5 py-10 text-sm text-gray-500 dark:text-gray-400">No client profitability data matches the current filters.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[1600px] w-full">
                  <thead className="bg-gray-50 border-b border-gray-200 dark:border-slate-700 dark:bg-slate-800">
                    <tr>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase dark:text-gray-300">Client</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase dark:text-gray-300">Contract Value</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase dark:text-gray-300">Total Billed</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase dark:text-gray-300">Collected</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase dark:text-gray-300">Outstanding</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase dark:text-gray-300">Direct Matter Costs</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase dark:text-gray-300">Gross Profit</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase dark:text-gray-300">Gross Profit Margin</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase dark:text-gray-300">No. of Matters</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase dark:text-gray-300">Collection Period</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase dark:text-gray-300">Retainer Value</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase dark:text-gray-300">Primary Practice Area</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase dark:text-gray-300">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-slate-800">
                    {clientProfitabilityRows.map((row) => {
                      const practiceArea = getPracticeArea(row);
                      const statusBucket = getStatusBucket(row);
                      return (
                        <tr key={row.partyName} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800/70" onClick={() => setSelectedClientProfitability(row)}>
                          <td className="px-5 py-4">
                            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{row.partyName}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">{statusBucket === 'mixed' ? 'Mixed client activity' : statusBucket === 'active' ? 'Active pipeline' : 'Completed records'}</div>
                          </td>
                          <td className="px-5 py-4 text-sm font-medium text-gray-900 dark:text-gray-100">{fmtMoney(row.contractValue)}</td>
                          <td className="px-5 py-4 text-sm font-medium text-gray-900 dark:text-gray-100">{fmtMoney(row.totalBilled)}</td>
                          <td className="px-5 py-4 text-sm font-medium text-emerald-700 dark:text-emerald-300">{fmtMoney(row.collected)}</td>
                          <td className={`px-5 py-4 text-sm font-medium ${row.outstanding >= 0 ? 'text-amber-700 dark:text-amber-300' : 'text-rose-700 dark:text-rose-300'}`}>{fmtMoney(row.outstanding)}</td>
                          <td className="px-5 py-4 text-sm font-medium text-rose-700 dark:text-rose-300">{fmtMoney(row.directMatterCosts)}</td>
                          <td className={`px-5 py-4 text-sm font-semibold ${row.grossProfit >= 0 ? 'text-gray-900 dark:text-gray-100' : 'text-rose-700 dark:text-rose-300'}`}>{fmtMoney(row.grossProfit)}</td>
                          <td className="px-5 py-4 text-sm font-semibold">
                            <span className={`${row.grossProfitMargin >= 50 ? 'text-emerald-600 dark:text-emerald-300' : row.grossProfitMargin >= 25 ? 'text-amber-600 dark:text-amber-300' : 'text-rose-600 dark:text-rose-300'}`}>{row.grossProfitMargin}%</span>
                          </td>
                          <td className="px-5 py-4 text-sm font-medium text-gray-900 dark:text-gray-100">{row.matterCount}</td>
                          <td className="px-5 py-4 text-sm font-medium text-gray-900 dark:text-gray-100">{row.collectionPeriodDays == null ? 'N/A' : `${row.collectionPeriodDays} days`}</td>
                          <td className="px-5 py-4 text-sm font-medium text-gray-900 dark:text-gray-100">{formatOptionalMoney(row.retainerValue)}</td>
                          <td className="px-5 py-4 text-sm font-medium text-gray-900 dark:text-gray-100">{practiceArea}</td>
                          <td className="px-5 py-4 text-sm">
                            <button
                              type="button"
                              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-800"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedClientProfitability(row);
                              }}
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {selectedClientProfitability && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-7xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4 dark:border-slate-700">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{selectedClientProfitability.partyName}</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">Primary practice area: {getPracticeArea(selectedClientProfitability)}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedClientProfitability(null)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-800"
              >
                Close
              </button>
            </div>

            <div className="max-h-[calc(90vh-5rem)] overflow-y-auto p-6">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
                {[
                  ['Contract Value', fmtMoney(selectedClientProfitability.contractValue)],
                  ['Total Billed', fmtMoney(selectedClientProfitability.totalBilled)],
                  ['Collected', fmtMoney(selectedClientProfitability.collected)],
                  ['Outstanding', fmtMoney(selectedClientProfitability.outstanding)],
                  ['Direct Matter Costs', fmtMoney(selectedClientProfitability.directMatterCosts)],
                  ['Gross Profit', fmtMoney(selectedClientProfitability.grossProfit)],
                  ['Gross Profit Margin', `${selectedClientProfitability.grossProfitMargin}%`],
                  ['No. of Matters', String(selectedClientProfitability.matterCount)],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-xl border border-gray-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
                    <div className="text-xs uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">{label}</div>
                    <div className="mt-2 text-base font-semibold text-gray-900 dark:text-gray-100">{value}</div>
                  </div>
                ))}
              </div>

              <div className="mt-6 rounded-xl border border-gray-200 dark:border-slate-700">
                <div className="border-b border-gray-200 px-5 py-4 dark:border-slate-700">
                  <h4 className="font-semibold text-gray-900 dark:text-gray-100">Matter / Prospect Breakdown</h4>
                </div>
                {!selectedClientProfitability.matterDetails?.length ? (
                  <div className="px-5 py-8 text-sm text-gray-500 dark:text-gray-400">No linked matter breakdown was returned for this client.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-[1500px] w-full">
                      <thead className="bg-gray-50 dark:bg-slate-800">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-700 dark:text-gray-300">Type</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-700 dark:text-gray-300">Record</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-700 dark:text-gray-300">Practice Area</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-700 dark:text-gray-300">Status</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-700 dark:text-gray-300">Contract Value</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-700 dark:text-gray-300">Total Billed</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-700 dark:text-gray-300">Collected</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-700 dark:text-gray-300">Outstanding</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-700 dark:text-gray-300">Direct Costs</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-700 dark:text-gray-300">Gross Profit</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-700 dark:text-gray-300">Margin</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-700 dark:text-gray-300">Assigned Lawyer</th>
                          <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-700 dark:text-gray-300">Next Deadline</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-slate-800">
                        {selectedClientProfitability.matterDetails.map((item) => (
                          <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/60">
                            <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100">{item.recordType}</td>
                            <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{item.recordLabel}</td>
                            <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{item.practiceArea}</td>
                            <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{item.status}</td>
                            <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">{fmtMoney(item.contractValue)}</td>
                            <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">{fmtMoney(item.totalBilled)}</td>
                            <td className="px-4 py-3 text-sm font-medium text-emerald-700 dark:text-emerald-300">{fmtMoney(item.collected)}</td>
                            <td className="px-4 py-3 text-sm font-medium text-amber-700 dark:text-amber-300">{fmtMoney(item.outstanding)}</td>
                            <td className="px-4 py-3 text-sm font-medium text-rose-700 dark:text-rose-300">{fmtMoney(item.directMatterCosts)}</td>
                            <td className={`px-4 py-3 text-sm font-semibold ${item.grossProfit >= 0 ? 'text-gray-900 dark:text-gray-100' : 'text-rose-700 dark:text-rose-300'}`}>{fmtMoney(item.grossProfit)}</td>
                            <td className="px-4 py-3 text-sm font-semibold">
                              <span className={`${item.grossProfitMargin >= 50 ? 'text-emerald-600 dark:text-emerald-300' : item.grossProfitMargin >= 25 ? 'text-amber-600 dark:text-amber-300' : 'text-rose-600 dark:text-rose-300'}`}>
                                {item.grossProfitMargin}%
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{item.assignedLawyer}</td>
                            <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{item.nextDeadline ? fmtDateTime(item.nextDeadline) : 'N/A'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}





