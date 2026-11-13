import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { getAllCases } from './caseController';
import { getAllTasks } from './taskController';
import { getFirmEvents } from './calendarController';
import { getBillingSummary } from './billingController';
import { getRecentAuditFeed, getMyAuditTrail } from './auditFeedController';
import { getAllProspects } from './prospectController';
import { listInvoices } from './invoiceQueryController';
import { getActiveFund } from './pettyCashController';
import { getStaffUsers } from './userController';
import { getMyPerformance } from './performanceController';
import { listTasks } from '../modules/independentTasks/controllers/independentTaskController';
import { getExecutiveAssistantDashboard, getStaffDashboardSummary } from './dashboardController';
import { localISODate } from '../utils/reportRange';

type ReadHandler = (req: AuthRequest, res: Response) => unknown;
/** Reuse each source's existing visibility and business rules after one auth check. */
const readSection = (req: AuthRequest, handler: ReadHandler, query: Record<string, string> = {}) =>
  new Promise<unknown>((resolve, reject) => {
    let status = 200;
    const sectionReq = Object.create(req) as AuthRequest;
    Object.defineProperty(sectionReq, 'query', { value: query });
    const sectionRes = {
      status(code: number) { status = code; return this; },
      json(data: any) { status >= 400 ? reject(new Error(data?.message || 'Unable to load dashboard section.')) : resolve(data); return this; },
    } as Response;
    Promise.resolve(handler(sectionReq, sectionRes)).catch(reject);
  });

/** One authenticated stream: fast sources render without waiting for slower ones. */
export const getDashboardBootstrap = async (req: AuthRequest, res: Response) => {
  const role = String(req.user?.role || '');
  const management = ['managing_director', 'managing_partner', 'executive_managing_partner'].includes(role);
  const finance = ['managing_director', 'executive_assistant'].includes(role);
  const requestedDay = String(req.query.today || '');
  const today = /^\d{4}-\d{2}-\d{2}$/.test(requestedDay) && Number.isFinite(Date.parse(requestedDay)) ? requestedDay : localISODate(new Date());
  const horizon = new Date(`${today}T12:00:00Z`);
  horizon.setUTCDate(horizon.getUTCDate() + (management ? 14 : 30));
  const read = (handler: ReadHandler, query?: Record<string, string>) => () => readSection(req, handler, query);
  const forbidden = () => Promise.reject(new Error('Forbidden.'));
  const sections: Record<string, () => Promise<unknown>> = role === 'executive_assistant' ? {
    executive: read(getExecutiveAssistantDashboard),
  } : management ? {
    cases: read(getAllCases), tasks: read(getAllTasks),
    billing: finance ? read(getBillingSummary, { from: `${today.slice(0, 4)}-01-01`, to: today }) : forbidden,
    events: read(getFirmEvents, { from: today, to: horizon.toISOString().slice(0, 10), type: 'all' }),
    audit: role === 'managing_director' ? read(getRecentAuditFeed, { limit: '8' }) : forbidden,
    prospects: read(getAllProspects, { includeTerminal: 'true' }),
    invoices: finance ? read(listInvoices, { status: 'Pending' }) : forbidden,
    fund: finance ? read(getActiveFund) : forbidden, staff: read(getStaffUsers),
  } : {
    summary: read(getStaffDashboardSummary), cases: read(getAllCases), tasks: read(getAllTasks),
    events: read(getFirmEvents, { from: today, to: horizon.toISOString().slice(0, 10), type: 'all' }),
    performance: read(getMyPerformance), prospects: read(getAllProspects, { includeTerminal: 'true' }),
    independent: read(listTasks, { limit: '200' }), audit: read(getMyAuditTrail, { limit: '10', page: '1' }),
  };
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const send = (value: unknown) => { if (!res.destroyed && !res.writableEnded) res.write(`${JSON.stringify(value)}\n`); };
  await Promise.all(Object.entries(sections).map(async ([section, load]) => {
    try { send({ section, status: 'fulfilled', value: await load() }); }
    catch (error: any) { send({ section, status: 'rejected', message: error?.message || 'Unable to load dashboard section.' }); }
  }));
  if (!res.destroyed) res.end();
};
