import { navigationFetch as fetch } from './navigationRequest';
import { UserRole } from '../App';
import { pageModules } from '../navigation/pageModules';
import { API_URL } from './apiConfig';

let preparedAt = 0;
/** Start connection/server setup while the user enters credentials. */
export const prepareSignIn = () => {
  if (Date.now() - preparedAt < 60000) return;
  preparedAt = Date.now();
  try {
    const origin = new URL(API_URL, location.origin).origin;
    if (!document.querySelector('link[data-sign-in-preconnect]')) {
      const link = document.createElement('link'); link.rel = 'preconnect'; link.href = origin; link.crossOrigin = 'anonymous'; link.dataset.signInPreconnect = 'true'; document.head.appendChild(link);
    }
  } catch { /* The request below reports an invalid API address normally. */ }
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
    // A safelisted form body avoids an extra cross-origin OPTIONS round trip.
    // Credentials stay in the HTTPS request body, never in its URL.
    body: new URLSearchParams({ email: email.trim().toLowerCase(), password }),
    cache: 'no-store',
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.message || 'Login failed');
  }

  return data as LoginResponse;
};
