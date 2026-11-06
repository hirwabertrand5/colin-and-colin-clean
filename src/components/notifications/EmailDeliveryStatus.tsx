import { useEffect, useState } from 'react';
import { getEmailDeliveryStatus, type EmailDeliveryStatusData } from '../../services/adminEmailService';

export default function EmailDeliveryStatus() {
  const [data, setData] = useState<EmailDeliveryStatusData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  let managingDirector = false;
  try { managingDirector = JSON.parse(localStorage.getItem('user') || '{}').role === 'managing_director'; } catch {}
  const refresh = async () => {
    setLoading(true); setError('');
    try { setData(await getEmailDeliveryStatus()); }
    catch (e: any) { setError(e.message || 'Unable to load email status.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (managingDirector) void refresh(); }, [managingDirector]);
  if (!managingDirector) return null;
  return <div className="mt-4 space-y-3 border-t border-gray-200 pt-4 text-sm text-gray-900 dark:border-gray-700 dark:text-gray-100">
    <div className="flex flex-wrap items-center justify-between gap-3"><span className="font-medium">Email delivery</span><button type="button" disabled={loading} onClick={() => void refresh()} className="rounded border border-gray-300 px-3 py-1 dark:border-gray-600">{loading ? 'Loading…' : 'Refresh status'}</button></div>
    {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
    {data && <>
      <p>{data.configuration.message}</p><p>Automatic notifications: <strong>{data.enabled ? 'Enabled' : 'Disabled'}</strong>. Delivery updates: {data.webhookConfigured ? 'configured' : 'awaiting setup'}.</p>
      {data.queueErrors > 0 && <p role="alert" className="text-red-600 dark:text-red-400">{data.queueErrors} notification(s) awaiting recovery after a queue error.</p>}
      <div className="flex flex-wrap gap-3">{data.counts.map(item => <span key={item._id}>{item._id}: <strong>{item.count}</strong></span>)}</div>
      <div className="max-h-72 overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th className="py-2 pr-3">Recipient</th><th className="pr-3">Status</th><th>Details</th></tr></thead><tbody>{data.recent.map(item => <tr key={item._id} className="border-t border-gray-200 dark:border-gray-700"><td className="py-2 pr-3 break-all">{item.to}</td><td className="pr-3">{item.status}</td><td>{item.lastError || item.lastCode || item.subject}</td></tr>)}</tbody></table></div>
    </>}
  </div>;
}
