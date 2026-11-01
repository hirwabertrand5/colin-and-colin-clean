import { API_URL } from './apiConfig';
const API = `${API_URL}/digital-intake`;
export { CLIENT_FIELDS, PARTY_EXTRA_FIELDS, MATTER_FIELDS, ARTICLES_GROUPS, SHAREHOLDER_FIELDS, OFFICIAL_USE_FIELDS } from '../../colin-backend/src/config/digitalIntakeSchema';
export type { IntakeQuestion } from '../../colin-backend/src/config/digitalIntakeSchema';
export const intakeRequest = async (path: string, method = 'GET', body?: unknown, token?: string): Promise<any> => {
  const response = await fetch(`${API}${path}`, {
    method, cache: 'no-store', referrerPolicy: 'no-referrer',
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { 'X-Intake-Token': token } : { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.message || 'The intake service could not complete this request.'), { code: data.code, status: response.status });
  return data;
};
export const uploadIntakeFile = (token: string, file: File, section: string, onProgress: (progress: number) => void): Promise<any> => new Promise((resolve, reject) => {
  const request = new XMLHttpRequest();
  request.open('POST', `${API}/public/files`);
  request.setRequestHeader('X-Intake-Token', token);
  request.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
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
