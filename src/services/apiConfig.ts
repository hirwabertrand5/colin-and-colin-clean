/** Shared API/file origin resolution.
 *
 * Stored uploads are paths (for example `/uploads/<id>`), not frontend URLs.
 * Resolving them in one place prevents a missing optional environment variable
 * from turning a production document link into a request to the frontend such
 * as `https://app.example.com/uploads/...`.
 */
const configuredApiUrl =
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_BACKEND_API_URL ||
  (import.meta.env.VITE_BACKEND_URL ? `${import.meta.env.VITE_BACKEND_URL.replace(/\/$/, '')}/api` : '') ||
  'http://localhost:5000/api';

export const API_URL = configuredApiUrl.replace(/\/$/, '');
export const BACKEND_URL = API_URL.replace(/\/api\/?$/, '');

export const uploadedFileUrl = (storedUrl?: string) => {
  if (!storedUrl) return '';
  if (/^https?:\/\//i.test(storedUrl)) return storedUrl;
  return `${BACKEND_URL}${storedUrl.startsWith('/') ? storedUrl : `/${storedUrl}`}`;
};
