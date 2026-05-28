import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/auth/Login';
import DashboardLayout from './components/layout/DashboardLayout';
import ManagingPartnerDashboard from './components/dashboards/ManagingPartnerDashboard';
import AssociateDashboard from './components/dashboards/AssociateDashboard';
import ExecutiveAssistantDashboard from './components/dashboards/ExecutiveAssistantDashboard';
import CaseList from './components/cases/CaseList';
import CreateCase from './components/cases/CreateCase';
import CaseWorkspace from './components/cases/CaseWorkspace';
import IntakeProspects from './components/cases/IntakeProspects';
import TaskBoard from './components/tasks/TaskBoard';
import TaskDetail from './components/tasks/TaskDetail';
import Calendar from './components/calendar/Calendar';
import NotificationCenter from './components/notifications/NotificationCenter';
import BillingDashboard from './components/billing/BillingDashboard';
import InvoiceManagement from './components/billing/InvoiceManagement';
import PerformanceDashboard from './components/reports/PerformanceDashboard';
import FirmReports from './components/reports/FirmReports';
import UserManagement from './components/admin/UserManagement';
import Settings from './components/admin/Settings';
import PettyCashDashboard from './components/pettyCash/PettyCashDashboard';
import { useAutoLogout } from './hooks/useAutoLogout';

export type UserRole =
  | 'managing_director'
  | 'managing_partner'
  | 'senior_partner'
  | 'partner'
  | 'associate_partner'
  | 'senior_associate'
  | 'associate'
  | 'trainee_associate'
  | 'executive_assistant'
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
  const isPartner = user?.role === 'managing_partner' || user?.role === 'senior_partner' || user?.role === 'partner' || user?.role === 'associate_partner';
  const isExec = user?.role === 'executive_assistant';
  const isAssocLike = isAssociateLike(user?.role);

  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login" element={user ? <Navigate to="/" /> : <Login onLogin={handleLogin} />} />

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
                      (isMD || isPartner) ? (
                        <ManagingPartnerDashboard userRole={user.role} />
                      ) : isExec ? (
                        <ExecutiveAssistantDashboard />
                      ) : (
                        <AssociateDashboard />
                      )
                    }
                  />

                  {/* Cases/Matters */}
                  <Route path="/cases" element={<CaseList userRole={user.role} />} />
                  <Route path="/matters" element={<CaseList userRole={user.role} />} />
                  <Route path="/matters/intake-prospects" element={<IntakeProspects />} />

                  {(isMD || isExec) && <Route path="/cases/new" element={<CreateCase />} />}
                  {(isMD || isExec) && <Route path="/matters/new" element={<CreateCase />} />}
                  {isAssocLike && <Route path="/cases/new" element={<Navigate to="/cases" replace />} />}
                  {isAssocLike && <Route path="/matters/new" element={<Navigate to="/matters" replace />} />}
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
                  {(isMD || isExec) && <Route path="/admin/settings" element={<Settings />} />}
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
