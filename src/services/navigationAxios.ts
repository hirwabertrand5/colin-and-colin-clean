import axios from 'axios';
import { clearNavigationRequests } from './navigationRequest';

// Keep Axios response/error behavior while invalidating speculative reads on writes.
const client = axios.create();
const writes = (method?: string) => !['get', 'head', 'options'].includes((method || 'get').toLowerCase());
client.interceptors.request.use(config => { if (writes(config.method)) clearNavigationRequests(); return config; });
client.interceptors.response.use(response => {
  if (writes(response.config.method)) clearNavigationRequests();
  return response;
}, error => {
  if (writes(error.config?.method) || [401, 403].includes(error.response?.status)) clearNavigationRequests();
  return Promise.reject(error);
});
export default client;
