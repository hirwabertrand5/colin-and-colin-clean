import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/auth/Login';
import DashboardLayout from './components/layout/DashboardLayout';
import ManagingPartnerDashboard from './components/dashboards/ManagingPartnerDashboard';
import AssociateDashboard from './components/dashboards/AssociateDashboard';
import ExecutiveAssistantDashboard from './components/dashboards/ExecutiveAssistantDashboard';
import CaseList from './components/cases/CaseList';
import ClosedCases from './components/cases/ClosedCases';
import CreateCase from './components/cases/CreateCase';
import CaseWorkspace from './components/cases/CaseWorkspace';
import IntakeProspects from './components/cases/IntakeProspects';
import ProspectWorkspace from './components/cases/ProspectWorkspace';
import IndependentTaskModule from './components/independentTasks/IndependentTaskModule';
import IndependentTaskDetail from './components/independentTasks/IndependentTaskDetail';
import PublicFeedbackForm from './components/public/PublicFeedbackForm';
import TaskBoard from './components/tasks/TaskBoard';
import TaskDetail from './components/tasks/TaskDetail';
import TaskManagementPage from './components/tasks/TaskManagementPage';
import Calendar from './components/calendar/Calendar';
import DeadlineManagementPage from './components/calendar/DeadlineManagementPage';
import NotificationCenter from './components/notifications/NotificationCenter';
import BillingDashboard from './components/billing/BillingDashboard';
import InvoiceManagement from './components/billing/InvoiceManagement';
import BillingFinancePage from './components/billing/BillingFinancePage';
import PerformanceDashboard from './components/reports/PerformanceDashboard';
import FirmReports from './components/reports/FirmReports';
import MatterFinancialStatusPage from './components/reports/MatterFinancialStatusPage';
import PeopleCapacityPage from './components/reports/PeopleCapacityPage';
import UserManagement from './components/admin/UserManagement';
import Settings from './components/admin/Settings';
import PettyCashDashboard from './components/pettyCash/PettyCashDashboard';
import { useAutoLogout } from './hooks/useAutoLogout';
import { Toaster } from './components/ui/sonner';

export type UserRole =
  | 'managing_director'
  | 'managing_partner'
  | 'executive_managing_partner'
  | 'senior_partner'
  | 'partner'
  | 'executive_partner'
  | 'associate_partner'
  | 'executive_associate_partner'
  | 'senior_associate'
  | 'senior_executive_assistant'
  | 'associate'
  | 'trainee_associate'
  | 'executive_assistant'
  | 'originating_attorney'
  | 'intern';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

const isAssociateLike = (role?: string) =>
  role === 'associate' || 
  role === 'trainee_associate' || 
  role === 'senior_associate' || 
  role === 'intern';

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
    setIsLoading(false);
  }, []);

  const handleLogin = (u: User) => {
    setUser(u);
    localStorage.setItem('user', JSON.stringify(u));
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('user');
    localStorage.removeItem('token');
  };

  // Auto-logout after 15 minutes of inactivity
  useAutoLogout({
    timeout: 15 * 60 * 1000, // 15 minutes
    onLogout: handleLogout,
    enabled: !!user, // Only enable when user is logged in
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  const isMD = user?.role === 'managing_director';
  const isManagingPartner =
    user?.role === 'managing_partner' ||
    user?.role === 'executive_managing_partner';
  const isManagementDashboardRole =
    user?.role === 'managing_director' ||
    user?.role === 'managing_partner' ||
    user?.role === 'executive_managing_partner';
  const isPartner =
    user?.role === 'senior_partner' ||
    user?.role === 'partner' ||
    user?.role === 'executive_partner' ||
    user?.role === 'associate_partner' ||
    user?.role === 'executive_associate_partner' ||
    user?.role === 'originating_attorney';
  const isExec = user?.role === 'executive_assistant';
  const isAssocLike = isAssociateLike(user?.role);

  return (
    <BrowserRouter>
      <Toaster />
      <Routes>
        {/* Public */}
        <Route path="/login" element={user ? <Navigate to="/" /> : <Login onLogin={handleLogin} />} />
        <Route path="/public/feedback/:prospectId" element={<PublicFeedbackForm />} />

        {/* Protected */}
        <Route
          path="/*"
          element={
            user ? (
              <DashboardLayout user={user} onLogout={handleLogout}>
                <Routes>
                  {/* Dashboard */}
                  <Route
                    path="/"
                    element={
                      isManagementDashboardRole ? (
                        <ManagingPartnerDashboard />
                      ) : isExec ? (
                        <ExecutiveAssistantDashboard />
                      ) : (
                        <AssociateDashboard userRole={user.role} />
                      )
                    }
                  />

                  {isManagementDashboardRole && (
                    <Route path="/management/*" element={<ManagingPartnerDashboard />} />
                  )}

                  {isManagementDashboardRole && (
                    <>
                      <Route path="/management/people/all-staff" element={<PeopleCapacityPage view="all-staff" userRole={user.role} />} />
                      <Route path="/management/people/headcount" element={<PeopleCapacityPage view="headcount" userRole={user.role} />} />
                      <Route path="/management/people/capacity" element={<PeopleCapacityPage view="capacity" userRole={user.role} />} />
                      <Route path="/management/people/utilisation" element={<PeopleCapacityPage view="utilisation" userRole={user.role} />} />
                      <Route path="/management/people/timeliness" element={<PeopleCapacityPage view="timeliness" userRole={user.role} />} />
                      <Route path="/management/people/performance-quality" element={<PeopleCapacityPage view="performance-quality" userRole={user.role} />} />
                      <Route path="/management/people/staff-contribution" element={<PeopleCapacityPage view="staff-contribution" userRole={user.role} />} />
                      <Route path="/management/people/staff-cost" element={<PeopleCapacityPage view="staff-cost" userRole={user.role} />} />
                      <Route path="/management/people/remuneration" element={<PeopleCapacityPage view="remuneration" userRole={user.role} />} />
                      <Route path="/management/people/training-development" element={<PeopleCapacityPage view="training-development" userRole={user.role} />} />
                      <Route path="/management/people/recruitment-retention" element={<PeopleCapacityPage view="recruitment-retention" userRole={user.role} />} />
                    </>
                  )}

                  {isManagementDashboardRole && (
                    <>
                      <Route path="/management/matters/financial-status" element={<MatterFinancialStatusPage view="financial-status" />} />
                      <Route path="/management/matters/contract-value" element={<MatterFinancialStatusPage view="contract-value" />} />
                      <Route path="/management/matters/amount-billed" element={<MatterFinancialStatusPage view="amount-billed" />} />
                      <Route path="/management/matters/amount-collected" element={<MatterFinancialStatusPage view="amount-collected" />} />
                      <Route path="/management/matters/outstanding-balance" element={<MatterFinancialStatusPage view="outstanding-balance" />} />
                      <Route path="/management/matters/direct-cost" element={<MatterFinancialStatusPage view="direct-cost" />} />
                      <Route path="/management/matters/gross-profit" element={<MatterFinancialStatusPage view="gross-profit" />} />
                      <Route path="/management/matters/net-profit" element={<MatterFinancialStatusPage view="net-profit" />} />
                      <Route path="/management/matters/gross-profit-margin" element={<MatterFinancialStatusPage view="gross-profit-margin" />} />
                      <Route path="/management/matters/profitability" element={<MatterFinancialStatusPage view="profitability" />} />
                      <Route path="/management/matters/direct-cost-workload" element={<MatterFinancialStatusPage view="direct-cost-workload" />} />
                      <Route path="/management/matters/timeliness" element={<MatterFinancialStatusPage view="timeliness" />} />
                    </>
                  )}

                  {/* Cases/Matters */}
                  <Route path="/cases" element={<CaseList userRole={user.role} mode="active" />} />
                  <Route path="/matters" element={<CaseList userRole={user.role} mode="active" />} />
                  <Route path="/matters/intake-prospects" element={<IntakeProspects />} />
                  <Route path="/matters/intake-prospects/:prospectId" element={<ProspectWorkspace />} />
                  <Route path="/matters/independent-tasks" element={<IndependentTaskModule userRole={user.role} />} />
                  <Route path="/matters/independent-tasks/:id" element={<IndependentTaskDetail userRole={user.role} />} />
                  <Route
                    path="/matters/closed/independent-tasks"
                    element={<Navigate to="/matters/independent-tasks" replace />}
                  />
                  <Route
                    path="/cases/temporarily-closed"
                    element={<CaseList userRole={user.role} mode="temporarilyClosed" />}
                  />
                  <Route
                    path="/matters/temporarily-closed"
                    element={<CaseList userRole={user.role} mode="temporarilyClosed" />}
                  />
                  <Route path="/matters/closed" element={<ClosedCases userRole={user.role} />} />

                  {(isMD || isPartner || isExec) && <Route path="/cases/new" element={<CreateCase />} />}
                  {(isMD || isPartner || isExec) && <Route path="/matters/new" element={<CreateCase />} />}
                  {(isMD || isPartner || isExec) && (
                    <Route
                      path="/cases/temporarily-closed/new"
                      element={
                        <CreateCase
                          initialStatus="Temporarily Closed"
                          pageTitle="Create Temporarily Closed Matter"
                          pageSubtitle="Record a matter that is paused temporarily and may be reactivated later."
                          backHref="/cases/temporarily-closed"
                          backLabel="Back to Temporarily Closed Matters"
                          successNavigateTo="/cases/temporarily-closed"
                          successMessage="Temporarily closed matter created successfully!"
                          submitLabel="Create Temporarily Closed Matter"
                          draftKey="createTemporaryClosedMatterDraft:v1"
                        />
                      }
                    />
                  )}
                  {(isMD || isPartner || isExec) && (
                    <Route
                      path="/matters/temporarily-closed/new"
                      element={
                        <CreateCase
                          initialStatus="Temporarily Closed"
                          pageTitle="Create Temporarily Closed Matter"
                          pageSubtitle="Record a matter that is paused temporarily and may be reactivated later."
                          backHref="/matters/temporarily-closed"
                          backLabel="Back to Temporarily Closed Matters"
                          successNavigateTo="/matters/temporarily-closed"
                          successMessage="Temporarily closed matter created successfully!"
                          submitLabel="Create Temporarily Closed Matter"
                          draftKey="createTemporaryClosedMatterDraft:v1"
                        />
                      }
                    />
                  )}
                  {isAssocLike && <Route path="/cases/new" element={<Navigate to="/cases" replace />} />}
                  {isAssocLike && <Route path="/matters/new" element={<Navigate to="/matters" replace />} />}
                  {isAssocLike && <Route path="/cases/temporarily-closed/new" element={<Navigate to="/cases/temporarily-closed" replace />} />}
                  {isAssocLike && <Route path="/matters/temporarily-closed/new" element={<Navigate to="/matters/temporarily-closed" replace />} />}
                  <Route path="/cases/:id/*" element={<CaseWorkspace userRole={user.role} />} />
                  <Route path="/matters/:id/*" element={<CaseWorkspace userRole={user.role} />} />

                  {/* Tasks */}
                  <Route path="/tasks" element={<TaskBoard userRole={user.role} />} />
                  {isManagementDashboardRole && (
                    <>
                      <Route path="/tasks/all" element={<TaskManagementPage view="all" />} />
                      <Route path="/tasks/my" element={<TaskManagementPage view="my" />} />
                      <Route path="/tasks/unassigned" element={<TaskManagementPage view="unassigned" />} />
                      <Route path="/tasks/due-today" element={<TaskManagementPage view="due-today" />} />
                      <Route path="/tasks/due-this-week" element={<TaskManagementPage view="due-this-week" />} />
                      <Route path="/tasks/overdue" element={<TaskManagementPage view="overdue" />} />
                      <Route path="/tasks/awaiting-review" element={<TaskManagementPage view="awaiting-review" />} />
                      <Route path="/tasks/awaiting-external-action" element={<TaskManagementPage view="awaiting-external-action" />} />
                      <Route path="/tasks/completed" element={<TaskManagementPage view="completed" />} />
                      <Route path="/tasks/closed" element={<TaskManagementPage view="closed" />} />
                      <Route path="/tasks/performance" element={<TaskManagementPage view="performance" />} />
                    </>
                  )}
                  <Route path="/tasks/:id" element={<TaskDetail userRole={user.role} />} />

                  {/* Calendar */}
                  <Route path="/calendar" element={<Calendar userRole={user.role} />} />
                  {isManagementDashboardRole && (
                    <>
                      <Route path="/deadlines" element={<DeadlineManagementPage view="all" />} />
                      <Route path="/deadlines/litigation" element={<DeadlineManagementPage view="litigation" />} />
                      <Route path="/deadlines/transaction" element={<DeadlineManagementPage view="transaction" />} />
                      <Route path="/deadlines/regulatory" element={<DeadlineManagementPage view="regulatory" />} />
                      <Route path="/deadlines/internal" element={<DeadlineManagementPage view="internal" />} />
                      <Route path="/deadlines/upcoming" element={<DeadlineManagementPage view="upcoming" />} />
                      <Route path="/deadlines/missed" element={<DeadlineManagementPage view="missed" />} />
                      <Route path="/deadlines/compliance" element={<DeadlineManagementPage view="compliance" />} />
                    </>
                  )}

                  {/* Notifications */}
                  <Route path="/notifications" element={<NotificationCenter />} />

                  {/* Billing */}
                  <Route path="/billing" element={<BillingDashboard userRole={user.role} />} />
                  <Route path="/billing/invoices" element={<InvoiceManagement userRole={user.role} />} />
                  {isManagementDashboardRole && (
                    <>
                      <Route path="/billing/finance/financial-dashboard/contract-value" element={<BillingFinancePage view="contract-value" userRole={user.role} />} />
                      <Route path="/billing/finance/financial-dashboard/total-billed" element={<BillingFinancePage view="total-billed" userRole={user.role} />} />
                      <Route path="/billing/finance/financial-dashboard/total-collected" element={<BillingFinancePage view="total-collected" userRole={user.role} />} />
                      <Route path="/billing/finance/financial-dashboard/outstanding" element={<BillingFinancePage view="outstanding" userRole={user.role} />} />
                      <Route path="/billing/finance/financial-dashboard/direct-matter-costs" element={<BillingFinancePage view="direct-matter-costs" userRole={user.role} />} />
                      <Route path="/billing/finance/financial-dashboard/gross-profit" element={<BillingFinancePage view="gross-profit" userRole={user.role} />} />
                      <Route path="/billing/finance/financial-dashboard/gross-profit-margin" element={<BillingFinancePage view="gross-profit-margin" userRole={user.role} />} />
                      <Route path="/billing/finance/financial-dashboard/operating-expenses" element={<BillingFinancePage view="operating-expenses" userRole={user.role} />} />
                      <Route path="/billing/finance/financial-dashboard/net-profit" element={<BillingFinancePage view="net-profit" userRole={user.role} />} />
                      <Route path="/billing/finance/financial-dashboard/net-profit-margin" element={<BillingFinancePage view="net-profit-margin" userRole={user.role} />} />
                      <Route path="/billing/finance/invoicing/all-invoices" element={<BillingFinancePage view="all-invoices" userRole={user.role} />} />
                      <Route path="/billing/finance/invoicing/draft" element={<BillingFinancePage view="draft" userRole={user.role} />} />
                      <Route path="/billing/finance/invoicing/issued" element={<BillingFinancePage view="issued" userRole={user.role} />} />
                      <Route path="/billing/finance/invoicing/paid" element={<BillingFinancePage view="paid" userRole={user.role} />} />
                      <Route path="/billing/finance/invoicing/pending" element={<BillingFinancePage view="pending" userRole={user.role} />} />
                      <Route path="/billing/finance/invoicing/overdue" element={<BillingFinancePage view="overdue" userRole={user.role} />} />
                      <Route path="/billing/finance/invoicing/invoice-count" element={<BillingFinancePage view="invoice-count" userRole={user.role} />} />
                      <Route path="/billing/finance/invoicing/invoice-total-billed" element={<BillingFinancePage view="invoice-total-billed" userRole={user.role} />} />
                      <Route path="/billing/finance/invoicing/recent-invoices" element={<BillingFinancePage view="recent-invoices" userRole={user.role} />} />
                      <Route path="/billing/finance/invoicing/billing-triggers" element={<BillingFinancePage view="billing-triggers" userRole={user.role} />} />
                      <Route path="/billing/finance/collections/collections-outstanding" element={<BillingFinancePage view="collections-outstanding" userRole={user.role} />} />
                      <Route path="/billing/finance/collections/collections-overdue" element={<BillingFinancePage view="collections-overdue" userRole={user.role} />} />
                      <Route path="/billing/finance/collections/collections-collection-rate" element={<BillingFinancePage view="collection-rate" userRole={user.role} />} />
                      <Route path="/billing/finance/collections/collections-debtor-ageing" element={<BillingFinancePage view="debtor-ageing" userRole={user.role} />} />
                      <Route path="/billing/finance/collections/collections-payment-follow-up" element={<BillingFinancePage view="payment-follow-up" userRole={user.role} />} />
                      <Route path="/billing/finance/collections/collections-collection-triggers" element={<BillingFinancePage view="collection-triggers" userRole={user.role} />} />
                      <Route path="/billing/finance/profitability/firm-profitability" element={<BillingFinancePage view="firm-profitability" userRole={user.role} />} />
                      <Route path="/billing/finance/profitability/department-profitability" element={<BillingFinancePage view="department-profitability" userRole={user.role} />} />
                      <Route path="/billing/finance/profitability/matter-profitability" element={<BillingFinancePage view="matter-profitability" userRole={user.role} />} />
                      <Route path="/billing/finance/profitability/client-profitability" element={<BillingFinancePage view="client-profitability" userRole={user.role} />} />
                      <Route path="/billing/finance/profitability/staff-profitability" element={<BillingFinancePage view="staff-profitability" userRole={user.role} />} />
                      <Route path="/billing/finance/profitability/net-profit-margin" element={<BillingFinancePage view="net-profit-margin" userRole={user.role} />} />
                      <Route path="/billing/finance/cash-flow/cash-position" element={<BillingFinancePage view="cash-position" userRole={user.role} />} />
                      <Route path="/billing/finance/cash-flow/cash-inflows" element={<BillingFinancePage view="cash-inflows" userRole={user.role} />} />
                      <Route path="/billing/finance/cash-flow/cash-outflows" element={<BillingFinancePage view="cash-outflows" userRole={user.role} />} />
                      <Route path="/billing/finance/cash-flow/cash-forecast" element={<BillingFinancePage view="cash-forecast" userRole={user.role} />} />
                      <Route path="/billing/finance/expenses/expenses" element={<BillingFinancePage view="expenses" userRole={user.role} />} />
                      <Route path="/billing/finance/expenses/expense-direct-costs" element={<BillingFinancePage view="expense-direct-costs" userRole={user.role} />} />
                      <Route path="/billing/finance/expenses/expense-operating" element={<BillingFinancePage view="expense-operating" userRole={user.role} />} />
                      <Route path="/billing/finance/expenses/procurement" element={<BillingFinancePage view="procurement" userRole={user.role} />} />
                      <Route path="/billing/finance/remuneration/fee-earned" element={<BillingFinancePage view="fee-earned" userRole={user.role} />} />
                      <Route path="/billing/finance/remuneration/accrued" element={<BillingFinancePage view="accrued" userRole={user.role} />} />
                      <Route path="/billing/finance/remuneration/payable" element={<BillingFinancePage view="payable" userRole={user.role} />} />
                      <Route path="/billing/finance/remuneration/deferred" element={<BillingFinancePage view="deferred" userRole={user.role} />} />
                      <Route path="/billing/finance/remuneration/remuneration-paid" element={<BillingFinancePage view="remuneration-paid" userRole={user.role} />} />
                      <Route path="/billing/finance/remuneration/by-role" element={<BillingFinancePage view="by-role" userRole={user.role} />} />
                      <Route path="/billing/finance/remuneration/by-staff" element={<BillingFinancePage view="by-staff" userRole={user.role} />} />
                      <Route path="/billing/finance/remuneration/by-matter" element={<BillingFinancePage view="by-matter" userRole={user.role} />} />
                    </>
                  )}

                  {/* Petty Cash */}
                  {(isMD || isExec) && <Route path="/petty-cash" element={<PettyCashDashboard />} />}

                  {/* Performance */}
                  <Route path="/performance" element={<PerformanceDashboard userRole={user.role} />} />
                  <Route path="/reports" element={<FirmReports userRole={user.role} />} />

                  {/* Admin */}
                  {(isMD || isExec) && <Route path="/admin/users" element={<UserManagement />} />}
                  {(isMD || isManagingPartner || isExec) && <Route path="/admin/settings" element={<Settings />} />}
                </Routes>
              </DashboardLayout>
            ) : (
              <Navigate to="/login" />
            )
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
