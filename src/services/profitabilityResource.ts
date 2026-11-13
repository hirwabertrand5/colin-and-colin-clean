import { getFirmReports } from './firmReportsService';
import { getProfitabilityReport, type ProfitabilityPeriod } from './profitabilityService';
import { getDataRevision } from './navigationRequest';

type Params = { range: ProfitabilityPeriod; from?: string; to?: string };
const results = new Map<string, { expires: number; promise: Promise<unknown> }>();
const MAX_ENTRIES = 12;
const FRESH_MS = 15000;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kigali' }).format(new Date());
export const profitabilityScopeKey = (params: Params) => JSON.stringify([
  localStorage.getItem('token'), getDataRevision(), today(), params.range,
  params.range === 'custom' ? params.from : '', params.range === 'custom' ? params.to : '',
]);

function read<T>(kind: string, params: Params, load: () => Promise<T>, refresh = false): Promise<T> {
  const key = `${kind}:${profitabilityScopeKey(params)}`;
  const current = results.get(key);
  if (!refresh && current && current.expires > Date.now()) return current.promise as Promise<T>;
  while (results.size >= MAX_ENTRIES) results.delete(results.keys().next().value!);
  const entry = { expires: Date.now() + FRESH_MS, promise: load() };
  results.set(key, entry);
  void entry.promise.catch(() => { if (results.get(key) === entry) results.delete(key); });
  return entry.promise;
}

/** Hold both views briefly so tab switches reuse the same period's read. */
export const readFinancialProfitability = (params: Params, refresh = false) => read('financial', params, async () => {
  const report = await withDeadline(signal => getProfitabilityReport(params, signal));
  if (!report?.firm || !report?.range || !report?.ageing || !Array.isArray(report.matterRows) || !Array.isArray(report.clientRows) || !Array.isArray(report.practiceAreaRows)) {
    throw new Error('The server returned an incomplete financial report.');
  }
  return report;
}, refresh);
export const readStaffProfitability = (params: Params, refresh = false) => read('staff', params, async () => {
  const report = await withDeadline(signal => getFirmReports({ ...params, basis: 'paymentDate', scope: 'profitability' }, signal));
  if (!Array.isArray(report?.team) || !report?.range) throw new Error('The server returned an incomplete staff report.');
  return report;
}, refresh);

async function withDeadline<T>(load: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try { return await load(controller.signal); }
  catch (error: any) {
    if (controller.signal.aborted) throw new Error('The report request timed out.');
    throw error;
  } finally { clearTimeout(timer); }
}
