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
import Calendar from './components/calendar/Calendar';
import NotificationCenter from './components/notifications/NotificationCenter';
import BillingDashboard from './components/billing/BillingDashboard';
import InvoiceManagement from './components/billing/InvoiceManagement';
import PerformanceDashboard from './components/reports/PerformanceDashboard';
import FirmReports from './components/reports/FirmReports';
import MatterFinancialStatusPage from './components/reports/MatterFinancialStatusPage';
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
                  <Route path="/tasks/:id" element={<TaskDetail userRole={user.role} />} />

                  {/* Calendar */}
                  <Route path="/calendar" element={<Calendar userRole={user.role} />} />

                  {/* Notifications */}
                  <Route path="/notifications" element={<NotificationCenter />} />

                  {/* Billing */}
                  <Route path="/billing" element={<BillingDashboard userRole={user.role} />} />
                  <Route path="/billing/invoices" element={<InvoiceManagement userRole={user.role} />} />

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
