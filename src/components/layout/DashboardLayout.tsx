import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Briefcase,
  CheckSquare,
  Calendar as CalendarIcon,
  Bell,
  DollarSign,
  BarChart3,
  Settings,
  Menu,
  X,
  LogOut,
  Users,
  Wallet,
  FolderTree,
  Clock3,
  Sun,
  Moon,
  ChevronDown,
  Search,
  Plus,
  FilePlus2,
  UserPlus,
  ReceiptText,
  ClipboardPlus,
  UploadCloud,
  CalendarPlus,
  Mail,
  Activity,
  Banknote,
  Calculator,
  ChartNoAxesCombined,
  ClipboardCheck,
  ClipboardList,
  Coins,
  FileBarChart,
  FileClock,
  FileSearch,
  Gauge,
  HandCoins,
  Landmark,
  ListChecks,
  Network,
  Scale,
  ShieldAlert,
  ShoppingCart,
  Target,
  TrendingDown,
  TrendingUp,
  UserCheck,
  UserCog,
  UserRoundSearch,
  UsersRound,
} from 'lucide-react';
import { User } from '../../App';
import { useTheme } from '../../hooks/useTheme';
import './DashboardLayout.css';

import companyLogoDark from '../../assets/logo-colin-dark-mode.png';
import { getUnreadNotificationCount } from '../../services/notificationService';

interface DashboardLayoutProps {
  user: User;
  onLogout: () => void;
  children: React.ReactNode;
}

type NavItem = {
  name: string;
  href: string;
  icon: React.ComponentType<any>;
  roles?: string[];
  submenu?: NavItem[];
  exact?: boolean;
};

const managementRoles = ['managing_director', 'managing_partner', 'executive_managing_partner'];

const managementView = (section: string, view: string) => `/management/${section}?view=${encodeURIComponent(view)}`;

const managementItem = (name: string, href: string, icon: React.ComponentType<any>): NavItem => ({ name, href, icon });

const formatToday = (date: Date) =>
  date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

const getTimeGreeting = (date: Date) => {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  return 'Good evening';
};

export default function DashboardLayout({ user, onLogout, children }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedMenu, setExpandedMenu] = useState<string | null>(null);
  const [expandedManagementMenus, setExpandedManagementMenus] = useState<string[]>([]);
  const [notificationCount, setNotificationCount] = useState(0);
  const [clockNow, setClockNow] = useState(() => new Date());
  const topbarRef = useRef<HTMLElement | null>(null);
  const location = useLocation();
  const { isDark, toggleTheme } = useTheme();
  const companyLogo = companyLogoDark;
  const greeting = getTimeGreeting(clockNow);

  const navigation: NavItem[] = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard },
      {
        name: 'Matters',
        href: '/matters',
        icon: Briefcase,
      roles: ['managing_director', 'managing_partner', 'executive_managing_partner', 'senior_partner', 'partner', 'executive_partner', 'associate_partner', 'executive_associate_partner', 'senior_associate', 'senior_executive_assistant', 'associate', 'trainee_associate', 'executive_assistant', 'originating_attorney', 'intern'],
        submenu: [
        { name: 'Intake & Prospects', href: '/matters/intake-prospects', icon: Users },
        { name: 'Active Matters', href: '/matters', icon: Briefcase, exact: true },
        { name: 'Temporarily Closed', href: '/matters/temporarily-closed', icon: Clock3 },
        { name: 'Closed Matters', href: '/matters/closed', icon: FolderTree },
        { name: 'Independent Tasks', href: '/matters/independent-tasks', icon: CheckSquare },
      ],
    },
    { name: 'Tasks', href: '/tasks', icon: CheckSquare },
    { name: 'Calendar & Deadlines', href: '/calendar', icon: CalendarIcon },
    { name: 'Billing & Margins', href: '/billing', icon: DollarSign, roles: ['managing_director', 'managing_partner', 'executive_managing_partner', 'senior_partner', 'partner', 'executive_partner', 'associate_partner', 'executive_associate_partner', 'executive_assistant', 'originating_attorney'] },
    { name: 'Firm Reports', href: '/reports', icon: BarChart3, roles: ['managing_director', 'executive_assistant'] },
    {
      name: 'Performance',
      href: '/performance',
      icon: BarChart3,
      roles: ['senior_associate', 'senior_executive_assistant', 'associate', 'trainee_associate', 'intern'],
    },
  ];

  const managementNavigation: NavItem[] = [
    {
      name: 'Matters', href: '/matters', icon: Briefcase, roles: managementRoles, submenu: [
        managementItem('Intake & Prospects', '/matters/intake-prospects', Users),
        managementItem('Active Matters', '/matters', Briefcase),
        managementItem('Temporarily Closed Matters', '/matters/temporarily-closed', Clock3),
        managementItem('Closed Matters', '/matters/closed', FolderTree),
        managementItem('Independent Tasks', '/matters/independent-tasks', CheckSquare),
        managementItem('Matter Financial Status', managementView('matters', 'financial-status'), Calculator),
        managementItem('Contract Value', managementView('matters', 'contract-value'), HandCoins),
        managementItem('Amount Billed', managementView('matters', 'amount-billed'), ReceiptText),
        managementItem('Amount Collected', managementView('matters', 'amount-collected'), Banknote),
        managementItem('Outstanding Matter Balance', managementView('matters', 'outstanding-balance'), Wallet),
        managementItem('Matter Direct Cost', managementView('matters', 'direct-cost'), Coins),
        managementItem('Matter Gross Profit', managementView('matters', 'gross-profit'), TrendingUp),
        managementItem('Matter Net Profit', managementView('matters', 'net-profit'), ChartNoAxesCombined),
        managementItem('Matter Gross Profit Margin', managementView('matters', 'gross-profit-margin'), Gauge),
        managementItem('Amount Billed', managementView('matters', 'amount-billed-profitability'), ReceiptText),
        managementItem('Amount Collected', managementView('matters', 'amount-collected-profitability'), Banknote),
        managementItem('Matter Profitability', managementView('matters', 'profitability'), ChartNoAxesCombined),
        managementItem('Matter Direct Cost Workload', managementView('matters', 'direct-cost-workload'), ClipboardList),
        managementItem('Matter Gross Profit Matter Timeliness', managementView('matters', 'timeliness'), FileClock),
      ],
    },
    {
      name: 'Task Management', href: '/tasks', icon: ListChecks, roles: managementRoles, submenu: [
        managementItem('All Tasks', '/tasks', ListChecks),
        managementItem('My Tasks', '/tasks?view=my-tasks', UserCheck),
        managementItem('Unassigned Tasks', '/tasks?view=unassigned', UserCog),
        managementItem('Due Today', '/tasks?view=due-today', CalendarIcon),
        managementItem('Due This Week', '/tasks?view=due-this-week', CalendarPlus),
        managementItem('Overdue Tasks', '/tasks?view=overdue', FileClock),
        managementItem('Awaiting Review', '/tasks?view=awaiting-review', ClipboardCheck),
        managementItem('Awaiting External Action', '/tasks?view=awaiting-external-action', HandCoins),
        managementItem('Completed Tasks', '/tasks?view=completed', CheckSquare),
        managementItem('Closed Tasks', '/tasks?view=closed', FolderTree),
        managementItem('Task Performance', '/performance', Activity),
      ],
    },
    {
      name: 'Calendar & Deadlines', href: '/calendar', icon: CalendarIcon, roles: managementRoles, submenu: [
        managementItem('Calendar', '/calendar', CalendarIcon),
        managementItem('All Deadlines', '/calendar?view=all-deadlines', FileClock),
        managementItem('Litigation Deadlines', '/calendar?view=litigation', Scale),
        managementItem('Transaction Deadlines', '/calendar?view=transaction', Briefcase),
        managementItem('Regulatory Deadlines', '/calendar?view=regulatory', ShieldAlert),
        managementItem('Internal Deadlines', '/calendar?view=internal', ClipboardList),
        managementItem('Upcoming Deadlines', '/calendar?view=upcoming', Clock3),
        managementItem('Missed Deadlines', '/calendar?view=missed', FileSearch),
        managementItem('Deadline Compliance', '/calendar?view=compliance', ClipboardCheck),
      ],
    },
    {
      name: 'Billing & Finance', href: '/billing', icon: DollarSign, roles: managementRoles, submenu: [
        {
          name: 'Financial Dashboard', href: '/billing', icon: Landmark, submenu: [
            ['Total Contract Value', 'contract-value', HandCoins], ['Total Billed', 'total-billed', ReceiptText], ['Total Collected', 'total-collected', Banknote], ['Outstanding', 'outstanding', Wallet], ['Direct Matter Costs', 'direct-matter-costs', Coins], ['Gross Profit', 'gross-profit', TrendingUp], ['Gross Profit Margin', 'gross-profit-margin', Gauge], ['Firm Operating Expenses', 'operating-expenses', Calculator], ['Net Profit', 'net-profit', ChartNoAxesCombined], ['Net Profit Margin', 'net-profit-margin', Gauge],
          ].map(([name, view, icon]) => managementItem(name as string, managementView('billing', view as string), icon as React.ComponentType<any>)),
        },
        {
          name: 'Billing & Invoicing', href: '/billing/invoices', icon: ReceiptText, submenu: [
            ['All Invoices', 'all', FileBarChart], ['Draft', 'draft', FileClock], ['Issued', 'issued', ReceiptText], ['Paid', 'paid', Banknote], ['Pending', 'pending', Clock3], ['Overdue', 'overdue', ShieldAlert], ['No. of Invoices', 'count', Calculator], ['Total Billed', 'total-billed', HandCoins], ['Recent Invoices', 'recent', FileSearch], ['Billing Triggers', 'triggers', Activity],
          ].map(([name, view, icon]) => managementItem(name as string, `/billing/invoices?view=${view}`, icon as React.ComponentType<any>)),
        },
        {
          name: 'Collections & Receivables', href: managementView('billing', 'collections'), icon: HandCoins, submenu: [
            ['Outstanding', 'outstanding'], ['Overdue', 'overdue'], ['Collection Rate', 'collection-rate'], ['Debtor Ageing', 'debtor-ageing'], ['Payment Follow-Up', 'payment-follow-up'], ['Collection Triggers', 'collection-triggers'],
          ].map(([name, view]) => managementItem(name as string, managementView('billing', view as string), name === 'Collection Rate' ? Gauge : HandCoins)),
        },
        {
          name: 'Profitability', href: managementView('profitability', 'firm'), icon: ChartNoAxesCombined, submenu: [
            ['Firm Profitability', 'firm'], ['Department Profitability', 'department'], ['Matter Profitability', 'matter'], ['Client Profitability', 'client'], ['Staff Profitability', 'staff'], ['Net Profit Margin', 'net-profit-margin'],
          ].map(([name, view]) => managementItem(name as string, managementView('profitability', view as string), name === 'Net Profit Margin' ? Gauge : ChartNoAxesCombined)),
        },
        {
          name: 'Cash & Cash Flow', href: managementView('cash-flow', 'position'), icon: Wallet, submenu: [
            ['Cash Position', 'position'], ['Cash Inflows', 'inflows'], ['Cash Outflows', 'outflows'], ['Cash Forecast', 'forecast'],
          ].map(([name, view]) => managementItem(name as string, managementView('cash-flow', view as string), name === 'Cash Position' ? Wallet : name === 'Cash Inflows' ? Banknote : name === 'Cash Outflows' ? Coins : ChartNoAxesCombined)),
        },
        {
          name: 'Expenses & Procurement', href: managementView('expenses', 'expenses'), icon: ShoppingCart, submenu: [
            ['Expenses', 'expenses'], ['Direct Matter Costs', 'direct-matter-costs'], ['Operating Expenses', 'operating-expenses'], ['Procurement', 'procurement'],
          ].map(([name, view]) => managementItem(name as string, managementView('expenses', view as string), name === 'Procurement' ? ShoppingCart : Coins)),
        },
        {
          name: 'Firm Remuneration', href: managementView('remuneration', 'fee-earned'), icon: Coins, submenu: [
            ['Fee Earned', 'fee-earned'], ['Accrued', 'accrued'], ['Payable', 'payable'], ['Deferred', 'deferred'], ['Paid', 'paid'], ['By Role', 'by-role'], ['By Staff', 'by-staff'], ['By Matter', 'by-matter'],
          ].map(([name, view]) => managementItem(name as string, managementView('remuneration', view as string), name === 'By Role' ? UsersRound : name === 'By Staff' ? Users : name === 'By Matter' ? Briefcase : Coins)),
        },
      ],
    },
    {
      name: 'People & Capacity', href: managementView('people', 'all-staff'), icon: UsersRound, roles: managementRoles, submenu: [
        ['All Staff', 'all-staff', Users], ['Headcount', 'headcount', UsersRound], ['Capacity', 'capacity', Gauge], ['Utilisation', 'utilisation', Activity], ['Timeliness', 'timeliness', Clock3], ['Performance & Quality', 'performance-quality', Target], ['Staff Contribution', 'staff-contribution', HandCoins], ['Staff Cost', 'staff-cost', Coins], ['Remuneration', 'remuneration', Banknote], ['Training & Development', 'training-development', UserCheck], ['Recruitment & Retention', 'recruitment-retention', UserRoundSearch],
      ].map(([name, view, icon]) => managementItem(name as string, managementView('people', view as string), icon as React.ComponentType<any>)),
    },
    {
      name: 'Clients & Business Development', href: managementView('clients-business-development', 'portfolio'), icon: Users, roles: managementRoles, submenu: [
        {
          name: 'Clients', href: managementView('clients-business-development', 'portfolio'), icon: Users, submenu: ['Client Portfolio', 'Client Financials', 'Client Profitability', 'Client Relationship', 'Client Risk', 'Client Experience']
            .map((name, index) => managementItem(name, managementView('clients-business-development', `client-${index}`), index === 2 ? ChartNoAxesCombined : index === 4 ? ShieldAlert : Users)),
        },
        {
          name: 'Business Development', href: managementView('clients-business-development', 'prospect-intake'), icon: Network, submenu: ['Prospect & Intake', 'Pipeline', 'Opportunities', 'Proposals & Quotations', 'Conversion', 'Lost Opportunities', 'Referral Sources', 'Revenue Forecast']
            .map((name, index) => managementItem(name, managementView('clients-business-development', `business-${index}`), index === 1 || index === 7 ? ChartNoAxesCombined : index === 5 ? TrendingDown : Network)),
        },
        {
          name: 'Client Experience', href: managementView('clients-business-development', 'lost-prospect-feedback'), icon: UserCheck, submenu: ['Lost Prospect Feedback', 'Mid-Matter Feedback', 'Matter Completion Feedback', 'Client Satisfaction', 'Complaints', 'Red Flags', 'Follow-Up Actions', 'Client Experience Analytics']
            .map((name, index) => managementItem(name, managementView('clients-business-development', `experience-${index}`), index === 4 || index === 5 ? ShieldAlert : index === 3 ? Target : UserCheck)),
        },
      ],
    },
    {
      name: 'Risk & Compliance', href: managementView('risk-compliance', 'risk-overview'), icon: ShieldAlert, roles: managementRoles, submenu: ['Risk Overview', 'Matter Risk', 'Financial Risk', 'Operational Risk', 'Client Issues', 'Complaints', 'Conflicts', 'Red Flags', 'Management Alerts', 'Critical Matters', 'Litigation Deadlines', 'Regulatory Deadlines', 'Compliance', 'Complaints', 'Conflicts', 'Firm Risk']
        .map((name, index) => managementItem(name, `${managementView('risk-compliance', name.toLowerCase().replace(/ /g, '-'))}&item=${index}`, index === 12 ? ClipboardCheck : index === 10 || index === 11 ? FileClock : ShieldAlert)),
    },
    {
      name: 'Reports & Analytics', href: managementView('reports-analytics', 'reporting'), icon: BarChart3, roles: managementRoles, submenu: [
        {
          name: 'Reports', href: managementView('reports-analytics', 'weekly-transaction-reports'), icon: FileBarChart, submenu: ['Weekly Transaction Reports', 'Monthly Litigation Reports', 'Significant Updates', 'Reporting Compliance', 'Reporting Triggers']
            .map((name, index) => managementItem(name, managementView('reports-analytics', `report-${index}`), index === 3 ? ClipboardCheck : index === 4 ? Activity : FileBarChart)),
        },
        { name: 'Firm Trends', href: managementView('reports-analytics', 'firm-trends'), icon: TrendingUp, submenu: ['Revenue Trend', 'Collections Trend', 'Profitability Trend', 'Matter Volume Trend', 'New Client Trend', 'Staff Productivity Trend'].map((name, index) => managementItem(name, managementView('reports-analytics', `firm-trend-${index}`), index === 1 ? Banknote : index === 2 ? ChartNoAxesCombined : TrendingUp)) },
        { name: 'Period Comparison', href: managementView('reports-analytics', 'period-comparison'), icon: Activity, submenu: ['Current vs Previous Period', 'Month-on-Month', 'Quarter-on-Quarter', 'Year-on-Year', 'Budget / Target vs Actual'].map((name, index) => managementItem(name, managementView('reports-analytics', `period-${index}`), index === 4 ? Target : Activity)) },
        { name: 'Historical Analysis', href: managementView('reports-analytics', 'historical-analysis'), icon: FileClock, submenu: ['Revenue History', 'Collections History', 'Profit History', 'Matter History', 'Client Growth History', 'Staff Performance History'].map((name, index) => managementItem(name, managementView('reports-analytics', `history-${index}`), FileClock)) },
        { name: 'Matter & Practice Analytics', href: managementView('reports-analytics', 'matter-practice'), icon: Briefcase, submenu: ['Matter Growth / Decline', 'Practice Area Growth', 'Practice Area Revenue Trend', 'Matter Success / Closure Trends', 'Matter Cycle-Time Trends'].map((name, index) => managementItem(name, managementView('reports-analytics', `matter-${index}`), index === 2 ? ChartNoAxesCombined : Briefcase)) },
        { name: 'Client & Business Development Analytics', href: managementView('reports-analytics', 'client-business-development'), icon: Network, submenu: ['Client Growth & Retention', 'New vs Existing Client Revenue', 'Client Revenue Trends', 'Referral / Source Performance', 'Prospect Pipeline', 'Lost Opportunity Analysis', 'Conversion Trends'].map((name, index) => managementItem(name, managementView('reports-analytics', `client-${index}`), index === 4 ? ChartNoAxesCombined : Network)) },
        { name: 'Client Experience Analytics', href: managementView('reports-analytics', 'client-experience'), icon: UserCheck, submenu: ['Client Satisfaction Trends', 'Repeat Instruction Rate', 'Recommendation Rate', 'Complaint Trends', 'Red Flag Trends', 'Feedback Response Rate'].map((name, index) => managementItem(name, managementView('reports-analytics', `experience-${index}`), index > 2 ? ShieldAlert : UserCheck)) },
        { name: 'People & Productivity Analytics', href: managementView('reports-analytics', 'people-productivity'), icon: Activity, submenu: ['Productivity Trends', 'Workload Trends', 'Timeliness Trends', 'Revenue Contribution Trends', 'Performance vs Target'].map((name, index) => managementItem(name, managementView('reports-analytics', `people-${index}`), index === 4 ? Target : Activity)) },
        { name: 'Operational & Reporting Analytics', href: managementView('reports-analytics', 'operational-reporting'), icon: ClipboardCheck, submenu: ['Task Completion', 'Deadline Compliance', 'Matter Timeliness', 'Reporting Compliance', 'Significant Update Compliance'].map((name, index) => managementItem(name, managementView('reports-analytics', `operations-${index}`), ClipboardCheck)) },
        { name: 'Forecast & Projection', href: managementView('reports-analytics', 'forecast'), icon: ChartNoAxesCombined, submenu: ['Revenue Forecast', 'Collection Forecast', 'Matter Pipeline Forecast', 'Profit Forecast'].map((name, index) => managementItem(name, managementView('reports-analytics', `forecast-${index}`), ChartNoAxesCombined)) },
        { name: 'Custom Analysis', href: managementView('reports-analytics', 'custom-analysis'), icon: FileSearch, submenu: ['Build Report', 'Compare Dimensions', 'Filter & Segment', 'Save Report', 'Export'].map((name, index) => managementItem(name, managementView('reports-analytics', `custom-${index}`), index === 4 ? FileBarChart : FileSearch)) },
      ],
    },
  ];

  const adminNavigation: NavItem[] = [
    { name: 'Users', href: '/admin/users', icon: Users, roles: ['managing_director', 'executive_assistant'] },
    { name: 'Petty Cash', href: '/petty-cash', icon: Wallet, roles: ['managing_director', 'executive_assistant'] },
    {
      name: 'Settings',
      href: '/admin/settings',
      icon: Settings,
      roles: ['managing_director', 'managing_partner', 'executive_managing_partner', 'executive_assistant'],
    },
  ];

  const isPathActive = (href: string, exact = false) => {
    const [path, query] = href.split('?');
    if (href === '/') return location.pathname === '/';
    if (query) return location.pathname === path && location.search === `?${query}`;
    if (exact) return location.pathname === path || location.pathname === path + '/';
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  const isManagementItemActive = (item: NavItem): boolean =>
    isPathActive(item.href) || item.submenu?.some(isManagementItemActive) === true;

  const getActiveManagementParents = (items: NavItem[], parents: string[] = []): string[] =>
    items.reduce((activeParents, item) => {
      if (item.submenu?.some(isManagementItemActive)) {
        activeParents.push(item.href);
        getActiveManagementParents(item.submenu, activeParents);
      }
      return activeParents;
    }, parents);

  const renderManagementItem = (item: NavItem, depth = 0): React.ReactNode => {
    const Icon = item.icon;
    const hasSubmenu = Boolean(item.submenu?.length);
    const isExpanded = expandedManagementMenus.includes(item.href);
    const isActive = isManagementItemActive(item);

    if (hasSubmenu) {
      return (
        <div key={`${item.name}-${item.href}`}>
          <button
            onClick={() => setExpandedManagementMenus(current => isExpanded
              ? current.filter(href => href !== item.href)
              : [...current, item.href])}
            className={`w-full flex items-center justify-between px-3 py-2 text-sm rounded transition-colors ${isActive || isExpanded ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100' : 'text-slate-100/90 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#061a3a]'}`}
          >
            <span className="flex items-center"><Icon className="w-5 h-5 mr-3" />{item.name}</span>
            <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
          </button>
          {isExpanded && (
            <div className={depth === 0 ? 'mt-2 ml-3 rounded-lg border border-white/10 bg-[#0a1d3e]/80 p-2 shadow-none' : 'ml-3 mt-1'}>
              <div className="space-y-1">{item.submenu!.map(child => renderManagementItem(child, depth + 1))}</div>
            </div>
          )}
        </div>
      );
    }

    return (
      <Link
        key={`${item.name}-${item.href}`}
        to={item.href}
        className={`flex items-center gap-2 px-3 py-2 text-sm rounded transition-colors ${isActive ? 'bg-blue-600 text-white font-medium shadow-sm shadow-blue-950/20' : 'text-slate-100/90 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#061a3a]'}`}
        onClick={() => setSidebarOpen(false)}
      >
        <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-200'}`} />
        <span className="truncate">{item.name}</span>
      </Link>
    );
  };

  useEffect(() => {
    const activeParents = getActiveManagementParents(managementNavigation);
    if (activeParents.length) setExpandedManagementMenus(activeParents);
  }, [location.pathname, location.search]);

  const hasAccess = (item: { roles?: string[] }) => !item.roles || item.roles.includes(user.role);
  const adminItems = adminNavigation.filter(hasAccess);
  const canShowQuickActions = ['managing_director', 'executive_assistant'].includes(user.role);
  const quickActions = [
    { name: 'New Matter', href: '/matters/new', icon: FilePlus2 },
    { name: 'New Client', href: '/matters/intake-prospects', icon: UserPlus },
    { name: 'New Invoice', href: '/billing/invoices', icon: ReceiptText },
    { name: 'New Task', href: '/matters/independent-tasks', icon: ClipboardPlus },
    { name: 'Upload Document', href: '/matters', icon: UploadCloud },
    { name: 'Schedule Meeting', href: '/calendar', icon: CalendarPlus },
  ];

  useEffect(() => {
    if (location.pathname.startsWith('/matters')) {
      setExpandedMenu('Matters');
    }
  }, [location.pathname]);

  const refreshUnreadCount = async () => {
    try {
      const n = await getUnreadNotificationCount();
      setNotificationCount(n);
    } catch {
      // do nothing (avoid breaking UI)
    }
  };

  // Load once + poll every 30s
  useEffect(() => {
    refreshUnreadCount();
    const t = window.setInterval(refreshUnreadCount, 30000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh on route change (useful after marking notifications read)
  useEffect(() => {
    refreshUnreadCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  useEffect(() => {
    const updateTopbarHeight = () => {
      const height = topbarRef.current?.offsetHeight ?? 64;
      document.documentElement.style.setProperty('--topbar-height', `${height}px`);
    };

    updateTopbarHeight();
    window.addEventListener('resize', updateTopbarHeight);

    return () => {
      window.removeEventListener('resize', updateTopbarHeight);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="app-shell min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-gray-900 bg-opacity-50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`
          app-shell-sidebar fixed inset-y-0 left-0 w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transform transition-transform duration-200 ease-in-out z-50
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0
        `}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="app-shell-logo flex items-center justify-center h-24 px-6 border-b border-gray-200 dark:border-gray-700">
            <img src={companyLogo} alt="Colin & Colin Logo" className="max-w-[165px] w-full object-contain" />
          </div>

          {/* Navigation */}
          <nav className="app-shell-nav flex-1 px-3 py-4 overflow-y-auto">
            <div className="space-y-1">
              {navigation.filter(item => (!managementRoles.includes(user.role) || item.name === 'Dashboard') && hasAccess(item)).map((item) => {
                const Icon = item.icon;
                const submenu = item.submenu ?? [];
                const hasSubmenu = submenu.length > 0;
                const isExpanded = expandedMenu === item.name;
                const isSubmenuActive = hasSubmenu && submenu.some(sub => isPathActive(sub.href, !!sub.exact));

                if (hasSubmenu) {
                  return (
                    <div key={item.name}>
                      <button
                        onClick={() => setExpandedMenu(isExpanded ? null : item.name)}
                        className={`
                          w-full flex items-center justify-between px-3 py-2 text-sm rounded transition-colors
                          ${isSubmenuActive || isExpanded
                            ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                            : 'text-slate-100/90 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#061a3a]'
                          }
                        `}
                      >
                        <div className="flex items-center">
                          <Icon className="w-5 h-5 mr-3" />
                          {item.name}
                        </div>
                        <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </button>
                      {isExpanded && (
                        <div className="mt-2 ml-3">
                          <div className="rounded-lg border border-white/10 bg-[#0a1d3e]/80 p-2 shadow-none">
                            {submenu.map((sub: any) => {
                              const SubIcon = sub.icon || Briefcase;
                              const subActive = isPathActive(sub.href, !!sub.exact);
                              return (
                                <Link
                                  key={sub.name}
                                  to={sub.href}
                                  className={`
                                    flex items-center gap-2 px-3 py-2 text-sm rounded transition-colors
                                    ${subActive
                                      ? 'bg-blue-600 text-white font-medium shadow-sm shadow-blue-950/20'
                                      : 'text-slate-100/90 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#061a3a]'
                                    }
                                  `}
                                  onClick={() => setSidebarOpen(false)}
                                >
                                  <SubIcon className={`w-4 h-4 ${subActive ? 'text-white' : 'text-slate-200'}`} />
                                  <span className="truncate">{sub.name}</span>
                                </Link>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                }

                return (
                  <Link
                    key={item.name}
                    to={item.href}
                    className={`
                      flex items-center px-3 py-2 text-sm rounded transition-colors
                      ${isPathActive(item.href)
                        ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                        : 'text-slate-100/90 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#061a3a]'
                      }
                    `}
                    onClick={() => setSidebarOpen(false)}
                  >
                    <Icon className="w-5 h-5 mr-3" />
                    {item.name}
                  </Link>
                );
              })}
            </div>

            {managementRoles.includes(user.role) && (
              <div className="space-y-1 mt-1">{managementNavigation.map(item => renderManagementItem(item))}</div>
            )}

            {canShowQuickActions && (
              <div className="app-quick-actions">
                <div className="app-quick-actions-title">
                  <span>Quick Actions</span>
                  <Plus className="w-4 h-4" />
                </div>
                <div className="app-quick-actions-list">
                  {quickActions.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.name}
                        to={item.href}
                        className="app-quick-action-link"
                        onClick={() => setSidebarOpen(false)}
                      >
                        <Icon className="w-4 h-4" />
                        <span>{item.name}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Admin */}
            {adminItems.length > 0 && (
              <div className="mt-8">
                <div className="px-3 mb-2 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Administration
                </div>
                <div className="space-y-1">
                  {adminItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.name}
                        to={item.href}
                        className={`
                          flex items-center px-3 py-2 text-sm rounded transition-colors
                          ${isPathActive(item.href)
                            ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                            : 'text-slate-100/90 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#061a3a]'
                          }
                        `}
                        onClick={() => setSidebarOpen(false)}
                      >
                        <Icon className="w-5 h-5 mr-3" />
                        {item.name}
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

          </nav>

          {/* User Footer */}
          <div className="app-shell-user p-4 border-t border-gray-200 dark:border-gray-700">
            <div className="flex items-center mb-3">
              <div className="w-10 h-10 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center text-gray-600 dark:text-gray-300 font-medium">
                {user.name.split(' ').map((n) => n[0]).join('')}
              </div>
              <div className="ml-3 flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{user.name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate capitalize">{user.role.replace('_', ' ')}</p>
              </div>
            </div>

            <button
              onClick={onLogout}
              className="w-full flex items-center px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 rounded transition-colors"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="lg:pl-64">
        {/* Top Header */}
        <header
          ref={topbarRef}
          className="app-shell-topbar topbar fixed top-0 left-0 right-0 lg:left-64 h-16 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 lg:px-6 z-30"
        >
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="app-icon-button lg:hidden p-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
            title="Toggle menu"
          >
            {sidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>

          <div className="app-topbar-greeting">
            <strong>{greeting}, {user.name.split(' ')[0] || user.name}</strong>
            <span>Here&apos;s your firm overview for {formatToday(clockNow)}.</span>
          </div>

          <label className="app-topbar-search">
            <Search className="w-4 h-4" />
            <input type="search" placeholder="Search matters, clients, documents, tasks, invoices..." />
            <kbd>Ctrl K</kbd>
          </label>

          <div className="app-topbar-actions flex items-center space-x-4">
            <Link to="/matters/new" className="app-topbar-primary" title="New matter">
              <Plus className="w-5 h-5" />
            </Link>

            <button
              onClick={toggleTheme}
              className="app-icon-button relative z-10 p-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? <Sun className="w-6 h-6" /> : <Moon className="w-6 h-6" />}
            </button>

            <Link to="/notifications" className="app-icon-button relative p-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors" title="Notifications">
              <Bell className="w-6 h-6" />
              {notificationCount > 0 && (
                <span className="absolute top-0 right-0 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                  {notificationCount > 99 ? '99+' : notificationCount}
                </span>
              )}
            </Link>

            <Link to="/calendar" className="app-icon-button" title="Calendar">
              <CalendarIcon className="w-5 h-5" />
            </Link>

            <Link to="/billing/invoices" className="app-icon-button" title="Invoices">
              <Mail className="w-5 h-5" />
            </Link>

            <div className="app-topbar-profile">
              <div className="w-10 h-10 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center text-gray-600 dark:text-gray-300 font-medium">
                {user.name.split(' ').map((n) => n[0]).join('')}
              </div>
              <div>
                <strong>{user.name}</strong>
                <span>{user.role.replaceAll('_', ' ')}</span>
              </div>
              <ChevronDown className="w-4 h-4" />
            </div>
          </div>
        </header>

        <main className="main-content px-4 lg:px-6 bg-gray-50 dark:bg-gray-900 min-h-screen" style={{ paddingBottom: '100px' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
