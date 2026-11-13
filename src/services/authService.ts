import { navigationFetch as fetch } from './navigationRequest';
import { UserRole } from '../App';
import { pageModules } from '../navigation/pageModules';

const API_URL = import.meta.env.VITE_API_URL;

let prepared = false;
/** Start connection/server setup while the user enters credentials. */
export const prepareSignIn = () => {
  if (prepared) return;
  prepared = true;
  void globalThis.fetch(`${API_URL}/health`, { cache: 'no-store' }).catch(() => {});
};

let dashboardsPrepared = false;
export const prepareSignInDashboards = () => {
  if (dashboardsPrepared) return;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData || ['slow-2g', '2g'].includes(connection?.effectiveType || '')) return;
  dashboardsPrepared = true;
  // Code only: authenticated data still loads after successful verification.
  void Promise.allSettled([pageModules.ManagingPartnerDashboard(), pageModules.AssociateDashboard(), pageModules.ExecutiveAssistantDashboard()]);
};

export interface LoginResponse {
  token: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: UserRole; // ✅ change from string to UserRole
  };
}

export const loginApi = async (
  email: string,
  password: string
): Promise<LoginResponse> => {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.message || 'Login failed');
  }

  return data as LoginResponse;
};
