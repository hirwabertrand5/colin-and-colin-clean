import { useEffect, useMemo, useState } from 'react';
import ProductivityReportContent from './ProductivityReportContent';
import './firmReports.css';
import { Download, FileText, BarChart3, TrendingUp, Users, Search, ArrowUpDown, RefreshCw } from 'lucide-react';
import { UserRole } from '../../App';
import { FirmReportDateBasis, FirmReportRange, FirmReportResponse, getFirmReports } from '../../services/firmReportsService';
import { getStaffUsers, User } from '../../services/userService';
import usePageTitle from '../../hooks/usePageTitle';
import useProductivityReport from '../../hooks/useProductivityReport';
import { buildProductivityExport, exportProductivityReport } from '../../utils/productivityReportExport';
import { downloadWorkbook } from '../../utils/excelExport';
import SortableHeader from '../ui/SortableHeader';
import { sortRows, SortDir } from '../../utils/tableSort';
import { REPORT_PERIOD_LABELS } from '../../constants/reportPeriods';

type FirmReportTab =
  | 'overview'
  | 'financial'
  | 'productivity'
  | 'cases'
  | 'clientProfitability'
  | 'staffRevenue'
  | 'staffProfitability';

const REPORT_TABS: readonly {
  readonly id: FirmReportTab;
  label: string;
  icon: any;
}[] = [
  { id: 'overview', label: 'Firm Overview', icon: BarChart3 },
  { id: 'financial', label: 'Financial Summary', icon: TrendingUp },
  { id: 'productivity', label: 'Productivity Report', icon: Users },
  { id: 'cases', label: 'Case Analytics', icon: FileText },
  { id: 'clientProfitability', label: 'Client Profitability', icon: TrendingUp },
  { id: 'staffRevenue', label: 'Staff Revenue Attribution', icon: Users },
  { id: 'staffProfitability', label: 'Staff Profitability', icon: TrendingUp },
];

const ALL_REPORT_TABS: readonly FirmReportTab[] = REPORT_TABS.map((t) => t.id);

const RANGE_LABELS = { all: 'All time', ...REPORT_PERIOD_LABELS };
const DATE_BASIS_LABELS: Record<FirmReportDateBasis, string> = {
  invoiceDate: 'Invoice Date',
  paymentDate: 'Payment Date',
  taskDate: 'Task Completion Date',
};
interface FirmReportsProps {
  userRole: UserRole;
  /** Page title shown in the browser tab (defaults to 'Firm Reports'). */
  title?: string;
  /** Restrict which report tabs are rendered (defaults to every tab). */
  tabs?: readonly FirmReportTab[];
  /** Tab selected on mount; falls back to the first allowed tab. */
  defaultTab?: FirmReportTab;
}

const canAccess = (role: UserRole) =>
  role === 'managing_director' ||
  role === 'executive_assistant' ||
  role === 'managing_partner' ||
  role === 'executive_managing_partner';

const fmtMoney = (n: number) => `RWF ${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pickMoney = (...values: Array<number | undefined | null>) => values.find((value) => value !== undefined && value !== null) ?? 0;
const withRowNumbers = (rows: Array<Array<unknown>>) => rows.map((row, index) => [index + 1, ...row]);
const fmtPercent = (value?: number | null) => (value == null ? '—' : `${Math.round((Number(value) || 0) * 10) / 10}%`);
const fmtDateTime = (value?: string | null, timeZone?: string) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
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
const CLIENT_PROFITABILITY_PAGE_SIZE = 10;

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



export default function FirmReports({ userRole, title, tabs, defaultTab }: FirmReportsProps) {
  const allowedTabs: readonly FirmReportTab[] = tabs?.length
    ? (tabs as readonly FirmReportTab[])
    : ALL_REPORT_TABS;
  const initialTab: FirmReportTab =
    defaultTab && allowedTabs.includes(defaultTab) ? defaultTab : allowedTabs[0];
  const [selectedReport, setSelectedReport] = useState<FirmReportTab>(initialTab);
  const [dateRange, setDateRange] = useState<FirmReportRange>('ytd');
  const [dateBasis, setDateBasis] = useState<FirmReportDateBasis>('invoiceDate');
  const [teamMembers, setTeamMembers] = useState<User[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string | undefined>(undefined);
  const [clientNameFilter, setClientNameFilter] = useState('');
  const [clientPracticeAreaFilter, setClientPracticeAreaFilter] = useState('all');
  const [clientStatusFilter, setClientStatusFilter] = useState('all');
  const [clientSortBy, setClientSortBy] = useState<ClientProfitabilitySort>('nameAsc');
  const [clientProfitabilityPage, setClientProfitabilityPage] = useState(1);
  const [selectedClientProfitability, setSelectedClientProfitability] = useState<ClientProfitabilityRow | null>(null);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  usePageTitle(title ?? 'Firm Reports');
  const [data, setData] = useState<FirmReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loadedReportKey, setLoadedReportKey] = useState<string | null>(null);
  const reportFilterKey = JSON.stringify([
    dateRange,
    dateBasis,
    selectedMemberId || '',
    dateRange === 'custom' ? customFrom : '',
    dateRange === 'custom' ? customTo : '',
  ]);
  // Keep newly selected filters from being attached to the previous response.
  const canExportReport = !!data && !loading && loadedReportKey === reportFilterKey
    && (!selectedMemberId || !!data.selectedMember);

  const reportTypes = REPORT_TABS.filter((type) => allowedTabs.includes(type.id));

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
      setLoadedReportKey(null);
      setLoading(false);
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
        setLoadedReportKey(reportFilterKey);
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
  }, [userRole, dateRange, dateBasis, selectedMemberId, customFrom, customTo, refreshToken, reportFilterKey]);

  // New period/report/member/data → back to page 1 of the metrics table.
  useEffect(() => {
    setProductivityPage(1);
  }, [dateRange, dateBasis, selectedMemberId, customFrom, customTo, selectedReport, data?.productivityRows?.length]);

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

  const clientPracticeAreas = useMemo(() => {
    const areas = new Set<string>();
    for (const row of clientProfitabilityRows) {
      const practiceArea = row.primaryPracticeArea || row.revenueByPracticeArea?.[0]?.type;
      if (practiceArea) areas.add(practiceArea);
    }
    return Array.from(areas).sort((a, b) => a.localeCompare(b));
  }, [clientProfitabilityRows]);

  const clientProfitabilityTotalPages = Math.max(1, Math.ceil(clientProfitabilityRows.length / CLIENT_PROFITABILITY_PAGE_SIZE));
  const paginatedClientProfitabilityRows = useMemo(
    () =>
      clientProfitabilityRows.slice(
        (clientProfitabilityPage - 1) * CLIENT_PROFITABILITY_PAGE_SIZE,
        clientProfitabilityPage * CLIENT_PROFITABILITY_PAGE_SIZE
      ),
    [clientProfitabilityRows, clientProfitabilityPage]
  );

  useEffect(() => {
    setClientProfitabilityPage(1);
  }, [clientNameFilter, clientPracticeAreaFilter, clientStatusFilter, clientSortBy, data]);

  useEffect(() => {
    setClientProfitabilityPage((prev) => Math.min(prev, clientProfitabilityTotalPages));
  }, [clientProfitabilityTotalPages]);

  const formatOptionalMoney = (value?: number | null) => (value == null ? '—' : fmtMoney(value));
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

  const [teamSortKey, setTeamSortKey] = useState('');
  const [teamSortDir, setTeamSortDir] = useState<SortDir>('asc');
  const handleTeamSort = (column: string) => {
    if (teamSortKey === column) {
      setTeamSortDir(teamSortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setTeamSortKey(column);
      setTeamSortDir('asc');
    }
  };
  const teamSortValueOf = (member: any, key: string): unknown => {
    switch (key) {
      case 'name':
        return member?.name || '';
      case 'role':
        return member?.earningRoleLabel || member?.role || '';
      case 'activeCases':
        return member?.activeCases || 0;
      case 'tasksCompleted':
        return member?.tasksCompleted || 0;
      case 'share':
        return member?.earningSharePercent ?? 0;
      case 'collected':
        return pickMoney(member?.invoicePaymentsReceived);
      case 'revenueAttributed':
        return pickMoney(member?.revenueAttributed, member?.earnedFees);
      case 'grossFees':
        return pickMoney(member?.grossFeesHandled, member?.invoicePaymentsReceived);
      case 'retained':
        return pickMoney(member?.firmRetainedEarnings);
      default:
        return member?.name || '';
    }
  };
  const sortedTeam = useMemo(
    () => sortRows(orderedTeam, teamSortKey, teamSortDir, (member) => teamSortValueOf(member, teamSortKey)),
    [orderedTeam, teamSortKey, teamSortDir],
  );

  const productivityReport = useProductivityReport(data);
  const {
    productivitySortKey, productivitySortDir, productivityView,
    productivityIssue, productivitySearch, setProductivityPage, sortedProductivityRows,
  } = productivityReport;

  const productivityExportOptions = () => ({
    data: data!, rows: sortedProductivityRows, view: productivityView,
    periodLabel: RANGE_LABELS[dateRange], issue: productivityIssue, search: productivitySearch,
    sortKey: productivitySortKey, sortDir: productivitySortDir,
  });

  const [caseSortKey, setCaseSortKey] = useState('');
  const [caseSortDir, setCaseSortDir] = useState<SortDir>('asc');
  const handleCaseSort = (column: string) => {
    if (caseSortKey === column) {
      setCaseSortDir(caseSortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setCaseSortKey(column);
      setCaseSortDir('asc');
    }
  };
  const sortedCaseTypes = useMemo(
    () => sortRows(data?.caseTypes || [], caseSortKey, caseSortDir, (item: any) => {
      switch (caseSortKey) {
        case 'type':
          return item?.type || '';
        case 'active':
          return item?.active || 0;
        case 'closed':
          return item?.closed || 0;
        case 'avgDuration':
          return item?.avgDurationDays ?? -1;
        case 'revenueBilled':
          return item?.revenueBilled || 0;
        default:
          return item?.type || '';
      }
    }),
    [data, caseSortKey, caseSortDir],
  );

  const staffPerformanceRows = useMemo(
    () =>
      [...(data?.team || [])]
        .map((member) => {
          const revenueAttributed = pickMoney(member.revenueAttributed, member.earnedFees);
          const grossFeesHandled = pickMoney(member.grossFeesHandled, member.invoicePaymentsReceived);
          const firmRetainedEarnings = pickMoney(member.firmRetainedEarnings, grossFeesHandled - revenueAttributed);
          const contributionMargin = member.contributionMargin ?? (grossFeesHandled > 0 ? Math.round((revenueAttributed / grossFeesHandled) * 1000) / 10 : null);
          const contributionRatio = member.contributionRatio ?? (grossFeesHandled > 0 ? Math.round((revenueAttributed / grossFeesHandled) * 1000) / 10 : null);
          return {
            ...member,
            revenueAttributed,
            grossFeesHandled,
            firmRetainedEarnings,
            contributionMargin,
            contributionRatio,
          };
        })
        .sort((a, b) => (b.revenueAttributed || 0) - (a.revenueAttributed || 0)),
    [data]
  );

  const staffRevenueSummary = useMemo(
    () => ({
      staffCount: staffPerformanceRows.length,
      totalRevenueAttributed: staffPerformanceRows.reduce((sum, row) => sum + (row.revenueAttributed || 0), 0),
      totalGrossFeesHandled: staffPerformanceRows.reduce((sum, row) => sum + (row.grossFeesHandled || 0), 0),
      totalFirmRetainedEarnings: staffPerformanceRows.reduce((sum, row) => sum + (row.firmRetainedEarnings || 0), 0),
    }),
    [staffPerformanceRows]
  );

  const staffProfitabilitySummary = useMemo(
    () => ({
      staffCount: staffPerformanceRows.length,
      averageContributionMargin:
        staffPerformanceRows.length > 0
          ? Math.round(
              (staffPerformanceRows.reduce((sum, row) => sum + (Number(row.contributionMargin) || 0), 0) / staffPerformanceRows.length) * 10
            ) / 10
          : null,
      averageContributionRatio:
        staffPerformanceRows.length > 0
          ? Math.round(
              (staffPerformanceRows.reduce((sum, row) => sum + (Number(row.contributionRatio) || 0), 0) / staffPerformanceRows.length) * 10
            ) / 10
          : null,
      totalTasksCompleted: staffPerformanceRows.reduce((sum, row) => sum + (row.tasksCompleted || 0), 0),
      totalOverdueTasks: staffPerformanceRows.reduce((sum, row) => sum + (row.overdueTasks || 0), 0),
    }),
    [staffPerformanceRows]
  );

  const staffRevenueRows = useMemo(
    () => staffPerformanceRows.slice().sort((a, b) => (b.revenueAttributed || 0) - (a.revenueAttributed || 0)),
    [staffPerformanceRows]
  );
  const staffProfitabilityRows = useMemo(
    () => staffPerformanceRows.slice().sort((a, b) => (b.contributionMargin || 0) - (a.contributionMargin || 0)),
    [staffPerformanceRows]
  );

  const exportWorkbook = async () => {
    if (!data || !canExportReport) return;

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
          return buildProductivityExport(productivityExportOptions());
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
        case 'staffRevenue':
          return {
            title: 'Staff Revenue Attribution',
            sections: [
              {
                title: 'Staff Revenue Summary',
                headers: ['#', 'Metric', 'Value'],
                rows: withRowNumbers([
                  ['Staff Members', staffRevenueSummary.staffCount],
                  ['Total Revenue Attributed', staffRevenueSummary.totalRevenueAttributed],
                  ['Total Gross Fees Handled', staffRevenueSummary.totalGrossFeesHandled],
                  ['Total Firm Retained Earnings', staffRevenueSummary.totalFirmRetainedEarnings],
                ]),
                currencyColumns: [3],
              },
              {
                title: 'Staff Revenue Attribution by Member',
                headers: ['#', 'Staff Member', 'Role', 'Active Cases', 'Tasks Completed', 'Share', 'Revenue Attributed', 'Gross Fees Handled', 'Firm Retained Earnings'],
                rows: withRowNumbers(
                  staffRevenueRows.map((member) => [
                    member.name,
                    member.role,
                    member.activeCases,
                    member.tasksCompleted,
                    member.earningSharePercent == null ? 0 : member.earningSharePercent / 100,
                    member.revenueAttributed || 0,
                    member.grossFeesHandled || 0,
                    member.firmRetainedEarnings || 0,
                  ])
                ),
                currencyColumns: [7, 8, 9],
                percentColumns: [6],
              },
            ],
          };
        case 'staffProfitability':
          return {
            title: 'Staff Profitability',
            sections: [
              {
                title: 'Staff Profitability Summary',
                headers: ['#', 'Metric', 'Value'],
                rows: withRowNumbers([
                  ['Staff Members', staffProfitabilitySummary.staffCount],
                  ['Tasks Completed', staffProfitabilitySummary.totalTasksCompleted],
                  ['Overdue Tasks', staffProfitabilitySummary.totalOverdueTasks],
                  [
                    'Average Contribution Margin (%)',
                    staffProfitabilitySummary.averageContributionMargin == null ? '—' : `${staffProfitabilitySummary.averageContributionMargin}%`,
                  ],
                  [
                    'Average Contribution Ratio (%)',
                    staffProfitabilitySummary.averageContributionRatio == null ? '—' : `${staffProfitabilitySummary.averageContributionRatio}%`,
                  ],
                ]),
              },
              {
                title: 'Staff Profitability by Member',
                headers: [
                  '#',
                  'Staff Member',
                  'Role',
                  'Tasks Completed',
                  'Overdue',
                  'Early',
                  'On Time',
                  'Late',
                  'Excellent',
                  'Good',
                  'Delayed',
                  'Risk',
                  'Contribution Margin',
                  'Contribution Ratio',
                ],
                rows: withRowNumbers(
                  staffProfitabilityRows.map((member) => [
                    member.name,
                    member.role,
                    member.tasksCompleted,
                    member.overdueTasks || 0,
                    member.earlyTasks || 0,
                    member.onTimeTasks || 0,
                    member.lateTasks || 0,
                    member.excellentTasks || 0,
                    member.goodTasks || 0,
                    member.delayedTasks || 0,
                    member.riskTasks || 0,
                    member.contributionMargin == null ? '—' : `${member.contributionMargin}%`,
                    member.contributionRatio == null ? '—' : `${member.contributionRatio}%`,
                  ])
                ),
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

    const staffSuffix = selectedReport === 'productivity'
      ? `_${data.selectedMember
        ? data.selectedMember.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'selected-staff'
        : 'all-team-members'}`
      : '';
    const filename = `${exportConfig.title.toLowerCase().replace(/\s+/g, '-')}_${data.range.from}_to_${data.range.to}${staffSuffix}`;
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
    <div className="firm-reports">
      <header>
        <div className="fr-page-heading">
          <div><span className="fr-eyebrow">Firm performance</span><h1>{title ?? 'Firm Reports'}</h1><p className="fr-period">{loading ? 'Loading...' : data ? data.range.from === '0001-01-01' ? 'All time' : `${data.range.from} to ${data.range.to}` : 'Reports & analytics'}</p></div>
          <div className="fr-header-actions">{selectedReport === 'productivity' && <button className="fr-refresh" disabled={!canExportReport} onClick={() => void exportProductivityReport('pdf', productivityExportOptions()).catch(error => setError(error?.message || 'Failed to export PDF.'))}><FileText size={15} />PDF</button>}<button className="fr-refresh" aria-label="Refresh report" disabled={loading} onClick={() => setRefreshToken(value => value + 1)}><RefreshCw size={15} />Refresh</button><button className="fr-export" onClick={() => void exportWorkbook()} disabled={!canExportReport}><Download size={15} />Export report</button></div>
        </div>
        <div className="fr-filter-bar">
          <label>Reporting period<select aria-label="Reporting period" value={dateRange} onChange={event => setDateRange(event.target.value as FirmReportRange)}>{Object.entries(RANGE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Team member<select aria-label="Team member" value={selectedMemberId || ''} onChange={event => setSelectedMemberId(event.target.value || undefined)}><option value="">All team members</option>{teamMembers.map(member => <option key={member._id} value={member._id}>{member.name} ({member.role.replace(/_/g, ' ')})</option>)}</select></label>
          {selectedReport !== 'productivity' && <label>Date basis<select aria-label="Date basis" value={dateBasis} onChange={event => setDateBasis(event.target.value as FirmReportDateBasis)}>{Object.entries(DATE_BASIS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
          {dateRange === 'custom' && <><label>From<input type="date" value={customFrom} onChange={event => setCustomFrom(event.target.value)} /></label><label>To<input type="date" min={customFrom || undefined} value={customTo} onChange={event => setCustomTo(event.target.value)} /></label></>}
        </div>
        {error && <div role="alert" className="mb-4 p-4 border border-red-200 bg-red-50 text-red-700 rounded">{error}</div>}
        <nav className="fr-tabs" aria-label="Report tabs">{reportTypes.map(type => { const Icon = type.icon; return <button key={type.id} onClick={() => setSelectedReport(type.id)} aria-current={selectedReport === type.id ? 'page' : undefined}><Icon />{type.label}</button>; })}</nav>
      </header>

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
                <table className="min-w-[1400px] w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">#</th>
                      <SortableHeader label="Team member" column="name" sortKey={teamSortKey} sortDir={teamSortDir} onSort={handleTeamSort} className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase" />
                      <SortableHeader label="Role" column="role" sortKey={teamSortKey} sortDir={teamSortDir} onSort={handleTeamSort} className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase" />
                      <SortableHeader label="Active cases" column="activeCases" sortKey={teamSortKey} sortDir={teamSortDir} onSort={handleTeamSort} className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase" />
                      <SortableHeader label="Tasks completed" column="tasksCompleted" sortKey={teamSortKey} sortDir={teamSortDir} onSort={handleTeamSort} className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase" />
                      <SortableHeader label="Share" column="share" sortKey={teamSortKey} sortDir={teamSortDir} onSort={handleTeamSort} className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase" />
                      <SortableHeader label="Total Collected" column="collected" sortKey={teamSortKey} sortDir={teamSortDir} onSort={handleTeamSort} className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase" />
                      <SortableHeader label="Revenue attributed" column="revenueAttributed" sortKey={teamSortKey} sortDir={teamSortDir} onSort={handleTeamSort} className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase" />
                      <SortableHeader label="Gross fees handled" column="grossFees" sortKey={teamSortKey} sortDir={teamSortDir} onSort={handleTeamSort} className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase" />
                      <SortableHeader label="Firm retained earnings" column="retained" sortKey={teamSortKey} sortDir={teamSortDir} onSort={handleTeamSort} className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {sortedTeam.map((member, index) => (
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

      {selectedReport === 'productivity' && <ProductivityReportContent data={data} report={productivityReport} />}

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
              <table className="min-w-[900px] w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">#</th>
                    <SortableHeader label="Practice Path" column="type" sortKey={caseSortKey} sortDir={caseSortDir} onSort={handleCaseSort} className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase" />
                    <SortableHeader label="Active" column="active" sortKey={caseSortKey} sortDir={caseSortDir} onSort={handleCaseSort} className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase" />
                    <SortableHeader label="Closed" column="closed" sortKey={caseSortKey} sortDir={caseSortDir} onSort={handleCaseSort} className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase" />
                    <SortableHeader label="Avg Duration" column="avgDuration" sortKey={caseSortKey} sortDir={caseSortDir} onSort={handleCaseSort} className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase" />
                    <SortableHeader label="Revenue Billed" column="revenueBilled" sortKey={caseSortKey} sortDir={caseSortDir} onSort={handleCaseSort} className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                    {sortedCaseTypes.map((item, index) => (
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
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase dark:text-gray-300">No.</th>
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
                    {paginatedClientProfitabilityRows.map((row, index) => {
                      const practiceArea = getPracticeArea(row);
                      const statusBucket = getStatusBucket(row);
                      return (
                        <tr key={row.partyName} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800/70" onClick={() => setSelectedClientProfitability(row)}>
                          <td className="px-5 py-4 text-sm text-gray-500 dark:text-gray-400">
                            {(clientProfitabilityPage - 1) * CLIENT_PROFITABILITY_PAGE_SIZE + index + 1}
                          </td>
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
            {clientProfitabilityRows.length > 0 && (
              <div className="flex flex-col gap-3 border-t border-gray-200 px-5 py-4 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Showing {(clientProfitabilityPage - 1) * CLIENT_PROFITABILITY_PAGE_SIZE + 1}-
                  {Math.min(clientProfitabilityPage * CLIENT_PROFITABILITY_PAGE_SIZE, clientProfitabilityRows.length)} of {clientProfitabilityRows.length} clients
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setClientProfitabilityPage((prev) => Math.max(prev - 1, 1))}
                    disabled={clientProfitabilityPage === 1}
                    className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-800"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    Page {clientProfitabilityPage} of {clientProfitabilityTotalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setClientProfitabilityPage((prev) => Math.min(prev + 1, clientProfitabilityTotalPages))}
                    disabled={clientProfitabilityPage === clientProfitabilityTotalPages}
                    className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-800"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {selectedReport === 'staffRevenue' && (
        <div className="space-y-6">
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="font-semibold text-gray-900">Staff Revenue Attribution</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Revenue is attributed per completed Key Action using the same earnings calculation as the staff
                  dashboards: each action earns its role-based share of the matter's collected fees.
                </p>
              </div>
              <div className="text-xs text-gray-500">
                Staff members: <span className="font-medium text-gray-900">{staffRevenueSummary.staffCount}</span>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                ['Total Revenue Attributed', fmtMoney(staffRevenueSummary.totalRevenueAttributed)],
                ['Total Gross Fees Handled', fmtMoney(staffRevenueSummary.totalGrossFeesHandled)],
                ['Total Firm Retained Earnings', fmtMoney(staffRevenueSummary.totalFirmRetainedEarnings)],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-gray-500">{label}</div>
                  <div className="mt-2 text-2xl font-semibold text-gray-900">{value}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg">
            <div className="px-5 py-4 border-b border-gray-200">
              <h2 className="font-semibold text-gray-900">Revenue Attribution by Staff Member</h2>
            </div>

            {!staffRevenueRows.length ? (
              <div className="px-5 py-10 text-gray-500">No staff revenue data available for this period.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[1200px] w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">#</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Staff Member</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Role</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Active Cases</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Tasks Completed</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Share</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Revenue Attributed</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Gross Fees Handled</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Firm Retained Earnings</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {staffRevenueRows.map((member, index) => (
                      <tr key={member.id || member.name} className="hover:bg-gray-50">
                        <td className="px-5 py-4 text-sm text-gray-500">{index + 1}</td>
                        <td className="px-5 py-4 text-sm font-medium text-gray-900">{member.name}</td>
                        <td className="px-5 py-4 text-sm text-gray-600">{member.role}</td>
                        <td className="px-5 py-4 text-sm text-gray-600">{member.activeCases}</td>
                        <td className="px-5 py-4 text-sm text-gray-600">{member.tasksCompleted}</td>
                        <td className="px-5 py-4 text-sm text-gray-600">{member.earningSharePercent ?? 0}%</td>
                        <td className="px-5 py-4 text-sm font-medium text-gray-900">{fmtMoney(member.revenueAttributed || 0)}</td>
                        <td className="px-5 py-4 text-sm text-gray-600">{fmtMoney(member.grossFeesHandled || 0)}</td>
                        <td className="px-5 py-4 text-sm text-gray-600">{fmtMoney(member.firmRetainedEarnings || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {selectedReport === 'staffProfitability' && (
        <div className="space-y-6">
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="font-semibold text-gray-900">Staff Profitability</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Same sources as each member's AssociateDashboard for the selected period: whole cases completed, workflow sections overdue, whole-case timeliness bands, and earned-fee contribution share.
                </p>
              </div>
              <div className="text-xs text-gray-500">
                Staff members: <span className="font-medium text-gray-900">{staffProfitabilitySummary.staffCount}</span>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Tasks Completed</div>
                <div className="mt-2 text-2xl font-semibold text-gray-900">{staffProfitabilitySummary.totalTasksCompleted}</div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Overdue Tasks</div>
                <div className="mt-2 text-2xl font-semibold text-gray-900">{staffProfitabilitySummary.totalOverdueTasks}</div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Average Contribution Margin</div>
                <div className="mt-2 text-2xl font-semibold text-gray-900">
                  {staffProfitabilitySummary.averageContributionMargin == null
                    ? '—'
                    : `${staffProfitabilitySummary.averageContributionMargin}%`}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Average Contribution Ratio</div>
                <div className="mt-2 text-2xl font-semibold text-gray-900">
                  {staffProfitabilitySummary.averageContributionRatio == null
                    ? '—'
                    : `${staffProfitabilitySummary.averageContributionRatio}%`}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg">
            <div className="px-5 py-4 border-b border-gray-200">
              <h2 className="font-semibold text-gray-900">Profitability by Staff Member</h2>
              <p className="mt-1 text-xs text-gray-500">
                Tasks Completed = whole cases completed in period (dashboard Matters Completed) · Overdue = workflow sections past deadline (dashboard Overdue Tasks) · Early / On Time / Late and Excellent / Good / Delayed / Risk = whole-case timeliness bands · Contribution = earned-fee share of gross fees handled (dashboard Fees Earned source).
              </p>
            </div>

            {!staffProfitabilityRows.length ? (
              <div className="px-5 py-10 text-gray-500">No staff profitability data available for this period.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[1500px] w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">#</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Staff Member</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Role</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Tasks Completed</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Overdue</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Early</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">On Time</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Late</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Excellent</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Good</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Delayed</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Risk</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Contribution Margin</th>
                      <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase">Contribution Ratio</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {staffProfitabilityRows.map((member, index) => (
                      <tr key={member.id || member.name} className="hover:bg-gray-50">
                        <td className="px-5 py-4 text-sm text-gray-500">{index + 1}</td>
                        <td className="px-5 py-4 text-sm font-medium text-gray-900">{member.name}</td>
                        <td className="px-5 py-4 text-sm text-gray-600">{member.role}</td>
                        <td className="px-5 py-4 text-sm text-gray-600">{member.tasksCompleted}</td>
                        <td className="px-5 py-4 text-sm text-gray-600">{member.overdueTasks || 0}</td>
                        <td className="px-5 py-4 text-sm text-gray-600">{member.earlyTasks || 0}</td>
                        <td className="px-5 py-4 text-sm text-gray-600">{member.onTimeTasks || 0}</td>
                        <td className="px-5 py-4 text-sm text-gray-600">{member.lateTasks || 0}</td>
                        <td className="px-5 py-4 text-sm text-gray-600">{member.excellentTasks || 0}</td>
                        <td className="px-5 py-4 text-sm text-gray-600">{member.goodTasks || 0}</td>
                        <td className="px-5 py-4 text-sm text-gray-600">{member.delayedTasks || 0}</td>
                        <td className="px-5 py-4 text-sm text-gray-600">{member.riskTasks || 0}</td>
                        <td className="px-5 py-4 text-sm font-medium text-gray-900">
                          {member.contributionMargin == null ? '—' : `${member.contributionMargin}%`}
                        </td>
                        <td className="px-5 py-4 text-sm font-medium text-gray-900">
                          {member.contributionRatio == null ? '—' : `${member.contributionRatio}%`}
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





