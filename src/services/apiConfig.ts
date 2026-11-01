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

/** Keep restricted intake documents behind bearer authorization in existing document lists. */
export const handleRestrictedIntakeDownload = (event: { preventDefault(): void }, storedUrl: string, name: string, onError?: (message: string) => void) => {
  if (!/^\/api\/digital-intake\/files\/[a-f0-9]{24}$/i.test(storedUrl)) return;
  event.preventDefault();
  void fetch(`${BACKEND_URL}${storedUrl}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }, cache: 'no-store', referrerPolicy: 'no-referrer' }).then(async response => {
    if (!response.ok) throw new Error('You cannot access this document, or it is no longer available.');
    const url = URL.createObjectURL(await response.blob());
    const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }).catch(error => { if (onError) onError(error.message); else window.alert(error.message); });
};
