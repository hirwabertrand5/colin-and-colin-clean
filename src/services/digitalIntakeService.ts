import { navigationFetch as fetch } from './navigationRequest';
import { API_URL } from './apiConfig';
const API = `${API_URL}/digital-intake`;
export { CLIENT_FIELDS, PARTY_EXTRA_FIELDS, MATTER_FIELDS, ARTICLES_GROUPS, SHAREHOLDER_FIELDS, OFFICIAL_USE_FIELDS, INTAKE_CONFIRMATION } from '../../colin-backend/src/config/digitalIntakeSchema';
export type { IntakeQuestion } from '../../colin-backend/src/config/digitalIntakeSchema';
export const intakeRequest = async (path: string, method = 'GET', body?: unknown, token?: string): Promise<any> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const isPublic = path.startsWith('/public/');
    const response = await fetch(`${API}${path}`, {
      method, signal: controller.signal, cache: 'no-store', referrerPolicy: 'no-referrer',
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(isPublic ? { 'X-Intake-Token': token || '' } : { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => null);
    if (!data || typeof data !== 'object') throw Object.assign(new Error('The intake service returned an unexpected response. Please contact the firm or try again shortly.'), { code: 'INVALID_API_RESPONSE', status: response.status });
    if (!response.ok) throw Object.assign(new Error(data.message || 'The intake service could not complete this request.'), { code: data.code, status: response.status });
    return data;
  } catch (error: any) {
    if (error.name === 'AbortError') throw new Error('The intake service is taking too long to respond. Please try again. Your entries remain on this page.');
    if (error instanceof TypeError) throw new Error('The intake service could not be reached. Check your connection and try again.');
    throw error;
  } finally { clearTimeout(timer); }
};
export const uploadIntakeFile = (token: string, file: File, section: string, onProgress: (progress: number) => void): Promise<any> => new Promise((resolve, reject) => {
  const request = new XMLHttpRequest();
  request.open('POST', `${API}/public/files`);
  request.setRequestHeader('X-Intake-Token', token);
  request.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
  request.timeout = 120000;
  request.ontimeout = () => reject(new Error('The upload timed out. Please retry.'));
  request.onerror = () => reject(new Error('Upload interrupted. Please retry.'));
  request.onload = () => {
    let data: any; try { data = JSON.parse(request.responseText); } catch { data = {}; }
    if (request.status >= 200 && request.status < 300) resolve(data); else reject(new Error(data.message || 'Upload failed. Please retry.'));
  };
  const body = new FormData(); body.append('file', file); body.append('section', section); request.send(body);
});
export const downloadIntakeDocument = async (id: string, name: string) => {
  const response = await fetch(`${API}/files/${id}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }, cache: 'no-store', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error('You cannot download this document, or it is no longer available.');
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
