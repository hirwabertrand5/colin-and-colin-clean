function preloadable<T>(load: () => Promise<T>) {
  let pending: Promise<T> | undefined;
  return () => {
    if (!pending) {
      pending = load();
      void pending.catch(() => { pending = undefined; });
    }
    return pending;
  };
}

export const pageModules = {
  ManagingPartnerDashboard: preloadable(() => import('../components/dashboards/ManagingPartnerDashboard')),
  AssociateDashboard: preloadable(() => import('../components/dashboards/AssociateDashboard')),
  ExecutiveAssistantDashboard: preloadable(() => import('../components/dashboards/ExecutiveAssistantDashboard')),
  CaseList: preloadable(() => import('../components/cases/CaseList')),
  ClosedCases: preloadable(() => import('../components/cases/ClosedCases')),
  CreateCase: preloadable(() => import('../components/cases/CreateCase')),
  CaseWorkspace: preloadable(() => import('../components/cases/CaseWorkspace')),
  IntakeProspects: preloadable(() => import('../components/cases/IntakeProspects')),
  ProspectWorkspace: preloadable(() => import('../components/cases/ProspectWorkspace')),
  IndependentTaskModule: preloadable(() => import('../components/independentTasks/IndependentTaskModule')),
  IndependentTaskDetail: preloadable(() => import('../components/independentTasks/IndependentTaskDetail')),
  TaskBoard: preloadable(() => import('../components/tasks/TaskBoard')),
  TaskDetail: preloadable(() => import('../components/tasks/TaskDetail')),
  TaskManagementPage: preloadable(() => import('../components/tasks/TaskManagementPage')),
  Calendar: preloadable(() => import('../components/calendar/Calendar')),
  DeadlineManagementPage: preloadable(() => import('../components/calendar/DeadlineManagementPage')),
  NotificationCenter: preloadable(() => import('../components/notifications/NotificationCenter')),
  BillingDashboard: preloadable(() => import('../components/billing/BillingDashboard')),
  InvoiceManagement: preloadable(() => import('../components/billing/InvoiceManagement')),
  BillingFinancePage: preloadable(() => import('../components/billing/BillingFinancePage')),
  ProfitabilityPage: preloadable(() => import('../components/billing/ProfitabilityPage')),
  RetainerManagement: preloadable(() => import('../components/billing/RetainerManagement')),
  RetainerDetail: preloadable(() => import('../components/billing/RetainerDetail')),
  PerformanceDashboard: preloadable(() => import('../components/reports/PerformanceDashboard')),
  FirmReports: preloadable(() => import('../components/reports/FirmReports')),
  MatterFinancialStatusPage: preloadable(() => import('../components/reports/MatterFinancialStatusPage')),
  PeopleCapacityPage: preloadable(() => import('../components/reports/PeopleCapacityPage')),
  ClientsBusinessDevelopmentPage: preloadable(() => import('../components/reports/ClientsBusinessDevelopmentPage')),
  RiskCompliancePage: preloadable(() => import('../components/reports/RiskCompliancePage')),
  ReportsAnalyticsPage: preloadable(() => import('../components/reports/ReportsAnalyticsPage')),
  UserManagement: preloadable(() => import('../components/admin/UserManagement')),
  Settings: preloadable(() => import('../components/admin/Settings')),
  PettyCashDashboard: preloadable(() => import('../components/pettyCash/PettyCashDashboard')),
};

export type PageModule = keyof typeof pageModules;

/** Match the staff router, including query-based nested management menus. */
export function navigationPage(href: string, role: string): PageModule | undefined {
  const path = href.split('?')[0].replace(/\/$/, '') || '/';
  if (path === '/' || path === '/management') return ['managing_director', 'managing_partner', 'executive_managing_partner'].includes(role)
    ? 'ManagingPartnerDashboard' : role === 'executive_assistant' ? 'ExecutiveAssistantDashboard' : 'AssociateDashboard';
  if (path.startsWith('/management/people/')) return 'PeopleCapacityPage';
  if (path.startsWith('/management/matters/')) return 'MatterFinancialStatusPage';
  if (path === '/management/clients-business-development') return 'ClientsBusinessDevelopmentPage';
  if (path === '/management/risk-compliance') return 'RiskCompliancePage';
  if (path === '/management/reports-analytics') return 'ReportsAnalyticsPage';
  if (path === '/cases' || path === '/matters' || /^\/(cases|matters)\/temporarily-closed$/.test(path)) return 'CaseList';
  if (path === '/matters/closed/independent-tasks' || path === '/matters/independent-tasks') return 'IndependentTaskModule';
  if (path.startsWith('/matters/independent-tasks/')) return 'IndependentTaskDetail';
  if (path === '/matters/closed') return 'ClosedCases';
  if (/^\/(cases|matters)\/(temporarily-closed\/)?new$/.test(path)) return 'CreateCase';
  if (path === '/matters/intake-prospects') return 'IntakeProspects';
  if (path.startsWith('/matters/intake-prospects/')) return 'ProspectWorkspace';
  if (path === '/matters/retainers') return 'RetainerManagement';
  if (path.startsWith('/matters/retainers/')) return 'RetainerDetail';
  if (/^\/(cases|matters)\//.test(path)) return 'CaseWorkspace';
  if (path === '/tasks') return 'TaskBoard';
  if (/^\/tasks\/(all|my|unassigned|due-today|due-this-week|overdue|awaiting-review|awaiting-external-action|completed|closed|performance)$/.test(path)) return 'TaskManagementPage';
  if (path.startsWith('/tasks/')) return 'TaskDetail';
  if (path === '/calendar') return 'Calendar';
  if (path === '/deadlines' || path.startsWith('/deadlines/')) return 'DeadlineManagementPage';
  if (path === '/billing') return 'BillingDashboard';
  if (path === '/billing/finance/profitability' || path.startsWith('/billing/finance/profitability/')) return 'ProfitabilityPage';
  if (path.startsWith('/billing/finance/')) return 'BillingFinancePage';
  if (path === '/billing/invoices') return 'InvoiceManagement';
  if (path === '/billing/profitability') return 'ProfitabilityPage';
  if (path === '/performance') return 'PerformanceDashboard';
  if (path === '/reports') return 'FirmReports';
  if (path === '/notifications') return 'NotificationCenter';
  if (path === '/admin/users') return 'UserManagement';
  if (path === '/admin/settings') return 'Settings';
  if (path === '/petty-cash') return 'PettyCashDashboard';
  return undefined;
}
