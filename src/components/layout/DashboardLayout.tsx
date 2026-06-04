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
  Sun,
  Moon,
  ChevronDown,
} from 'lucide-react';
import { User } from '../../App';
import { useTheme } from '../../hooks/useTheme';

import companyLogoLight from '../../assets/logo-colin.png';
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
  submenu?: { name: string; href: string; icon?: React.ComponentType<any>; exact?: boolean }[];
};


export default function DashboardLayout({ user, onLogout, children }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedMenu, setExpandedMenu] = useState<string | null>(null);
  const [notificationCount, setNotificationCount] = useState(0);
  const topbarRef = useRef<HTMLElement | null>(null);
  const location = useLocation();
  const { isDark, toggleTheme } = useTheme();
  const companyLogo = isDark ? companyLogoDark : companyLogoLight;

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
        { name: 'Closed Matters', href: '/matters/closed', icon: FolderTree },
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

  const adminNavigation: NavItem[] = [
    { name: 'Users', href: '/admin/users', icon: Users, roles: ['managing_director', 'executive_assistant'] },
    { name: 'Petty Cash', href: '/petty-cash', icon: Wallet, roles: ['managing_director', 'executive_assistant'] },
    { name: 'Settings', href: '/admin/settings', icon: Settings, roles: ['managing_director', 'executive_assistant'] },
  ];

  const isPathActive = (href: string, exact = false) => {
    if (href === '/') return location.pathname === '/';
    if (exact) return location.pathname === href || location.pathname === href + '/';
    return location.pathname === href || location.pathname.startsWith(href + '/');
  };

  const hasAccess = (item: { roles?: string[] }) => !item.roles || item.roles.includes(user.role);
  const adminItems = adminNavigation.filter(hasAccess);

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

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
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
          fixed inset-y-0 left-0 w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transform transition-transform duration-200 ease-in-out z-50
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0
        `}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center justify-center h-24 px-6 border-b border-gray-200 dark:border-gray-700">
            <img src={companyLogo} alt="Colin & Colin Logo" className="max-w-[165px] w-full object-contain" />
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-4 overflow-y-auto">
            <div className="space-y-1">
              {navigation.filter(hasAccess).map((item) => {
                const Icon = item.icon;
                const hasSubmenu = item.submenu && item.submenu.length > 0;
                const isExpanded = expandedMenu === item.name;
                const isSubmenuActive = hasSubmenu && item.submenu.some(sub => isPathActive(sub.href, !!sub.exact));

                if (hasSubmenu) {
                  return (
                    <div key={item.name}>
                      <button
                        onClick={() => setExpandedMenu(isExpanded ? null : item.name)}
                        className={`
                          w-full flex items-center justify-between px-3 py-2 text-sm rounded transition-colors
                          ${isSubmenuActive || isExpanded
                            ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                            : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-100'
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
                          <div className="rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm p-2">
                            {item.submenu.map((sub: any) => {
                              const SubIcon = sub.icon || Briefcase;
                              const subActive = isPathActive(sub.href, !!sub.exact);
                              return (
                                <Link
                                  key={sub.name}
                                  to={sub.href}
                                  className={`
                                    flex items-center gap-2 px-3 py-2 text-sm rounded transition-colors
                                    ${subActive
                                      ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium'
                                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-100'
                                    }
                                  `}
                                  onClick={() => setSidebarOpen(false)}
                                >
                                  <SubIcon className="w-4 h-4 text-gray-400" />
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
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-100'
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
                            : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-100'
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
          <div className="p-4 border-t border-gray-200 dark:border-gray-700">
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
          className="topbar fixed top-0 left-0 right-0 lg:left-64 h-16 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 lg:px-6 z-30"
        >
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden p-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
          >
            {sidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>

          <div className="hidden lg:block" />

          <div className="flex items-center space-x-4">
            <button
              onClick={toggleTheme}
              className="relative z-10 p-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? <Sun className="w-6 h-6" /> : <Moon className="w-6 h-6" />}
            </button>

            <Link to="/notifications" className="relative p-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors">
              <Bell className="w-6 h-6" />
              {notificationCount > 0 && (
                <span className="absolute top-0 right-0 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                  {notificationCount > 99 ? '99+' : notificationCount}
                </span>
              )}
            </Link>

            <div className="lg:hidden w-10 h-10 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center text-gray-600 dark:text-gray-300 font-medium">
              {user.name.split(' ').map((n) => n[0]).join('')}
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
