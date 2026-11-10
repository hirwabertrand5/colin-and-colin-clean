import { navigationPage, pageModules, type PageModule } from './pageModules';
import { prepareNavigationRequest } from '../services/navigationRequest';

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const financeRoles = ['managing_director', 'executive_assistant'];

export function navigationReads(page: PageModule, role: string): string[] {
  switch (page) {
    case 'CaseList': case 'ClosedCases': return ['/cases'];
    case 'TaskBoard': case 'TaskManagementPage': return ['/tasks', '/cases'];
    case 'MatterFinancialStatusPage': return ['/cases', '/invoices', '/tasks'];
    case 'PeopleCapacityPage': return ['/users/staff?includeInactive=true', '/cases', '/reports/firm?range=monthly&basis=paymentDate'];
    case 'ClientsBusinessDevelopmentPage': return ['/cases', '/invoices', '/reports/firm?range=monthly&basis=invoiceDate'];
    case 'RiskCompliancePage': return ['/cases', '/invoices', '/tasks', '/calendar/events?from=2000-01-01&to=2100-12-31&type=Deadline'];
    case 'ReportsAnalyticsPage': return ['/reports/firm?range=ytd&basis=paymentDate'];
    case 'FirmReports': return ['/users/staff'];
    case 'RetainerManagement': return ['/retainers'];
    case 'IndependentTaskModule': return ['/independent-tasks/dashboard', '/cases/independent-task-options', '/users/assignment-options'];
    case 'Calendar': return ['/cases'];
    case 'DeadlineManagementPage': return ['/calendar/events?from=2000-01-01&to=2100-12-31&type=Deadline', '/cases'];
    case 'InvoiceManagement': return ['/invoices', '/cases'];
    case 'BillingDashboard': return ['/billing/summary', '/invoices', '/cases', ...(financeRoles.includes(role) ? ['/petty-cash/funds'] : [])];
    case 'BillingFinancePage': return ['/reports/firm?range=ytd&basis=invoiceDate', '/cases', ...(financeRoles.includes(role) ? ['/petty-cash/funds'] : [])];
    case 'PerformanceDashboard': return ['/tasks', '/performance/me'];
    case 'UserManagement': return ['/users'];
    case 'PettyCashDashboard': return ['/petty-cash/funds/active', '/petty-cash/funds', '/cases', '/users'];
    case 'Settings': return ['/notifications/preferences/me', '/workflows/templates'];
    case 'NotificationCenter': return ['/notifications?filter=all'];
    case 'CreateCase': return ['/users/assignment-options', '/workflows/templates/active'];
    case 'ManagingPartnerDashboard': return ['/cases', '/tasks'];
    case 'ExecutiveAssistantDashboard': return ['/dashboard/executive-assistant'];
    case 'AssociateDashboard': return ['/dashboard/staff-summary'];
    default: return [];
  }
}

export function canPrepareNavigation() {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !connection?.saveData && !['slow-2g', '2g'].includes(connection?.effectiveType || '');
}

let newestIntent = 0;
let activeReads = 0;
let queuedReads: Array<{ intent: number; run: () => Promise<void> }> = [];
function drainReads() {
  while (activeReads < 3 && queuedReads.length) {
    const next = queuedReads.shift()!;
    if (next.intent !== newestIntent) continue;
    activeReads++;
    void next.run().finally(() => { activeReads--; drainReads(); });
  }
}
export function prepareNavigation(href: string, includeData = true) {
  if (!canPrepareNavigation()) return;
  let token: string | null;
  let role: string;
  try {
    token = localStorage.getItem('token');
    role = JSON.parse(localStorage.getItem('user') || 'null')?.role;
  } catch { return; }
  if (!token || !role || !href.startsWith('/')) return;
  const page = navigationPage(href, role);
  if (!page) return;
  // Loading code grants no access; the router and API keep all existing guards.
  void pageModules[page]().catch(() => {});
  if (!includeData) return;
  const intent = ++newestIntent;
  const paths = navigationReads(page, role);
  queuedReads = paths.map(path => ({ intent,
    run: () => localStorage.getItem('token') === token
      ? prepareNavigationRequest(`${API.replace(/\/$/, '')}${path}`, { headers: { Authorization: `Bearer ${token}` } })
      : Promise.resolve(),
  }));
  // Keep a global limit even when the pointer moves rapidly between menus.
  drainReads();
}
