import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import Case from '../models/caseModel';
import Invoice from '../models/invoiceModel';
import PettyCashExpense from '../models/pettyCashExpenseModel';
import { ordinaryInvoiceFilter, retainerFinancials } from '../services/retainerAccountingService';
import {
  getCollectedValueFromProgress,
  getDirectMatterCost,
  getContractValue,
} from '../utils/financialMetrics';

const toISODate = (d: Date) => d.toISOString().slice(0, 10);

const monthKey = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

// GET /api/billing/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
export const getBillingSummary = async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = req.query as any;

    const toDate = to ? new Date(String(to)) : new Date();
    const fromDate = from ? new Date(String(from)) : new Date(new Date(toDate).setMonth(toDate.getMonth() - 5));

    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      return res.status(400).json({ message: 'Invalid from/to date.' });
    }

    // Your invoice.date is stored as YYYY-MM-DD string, so string range works.
    const fromStr = toISODate(fromDate);
    const toStr = toISODate(toDate);
    fromDate.setHours(0, 0, 0, 0);
    toDate.setHours(23, 59, 59, 999);

    const [invoices, paidInvoices, matters, expenses] = await Promise.all([
      Invoice.find({ date: { $gte: fromStr, $lte: toStr }, ...ordinaryInvoiceFilter })
        .sort({ date: 1 })
        .lean(),
      Invoice.find({ status: 'Paid', updatedAt: { $gte: fromDate, $lte: toDate }, ...ordinaryInvoiceFilter })
        .select('amount date caseId updatedAt')
        .lean(),
      Case.find({ updatedAt: { $gte: fromDate, $lte: toDate } })
        .select('_id budget updatedAt workflowProgress billingSettings')
        .lean(),
      PettyCashExpense.find({ date: { $gte: fromStr, $lte: toStr } })
        .select('amount refundAmount chargeType caseId')
        .lean(),
    ]);

    const retainers = await retainerFinancials(fromStr, toStr);
    const billed = invoices.reduce((s, i) => s + (Number(i.amount) || 0), 0) + retainers.billed;
    const contractValue = matters.reduce((s, matter: any) => s + getContractValue(matter), 0);
    const progressValue = matters.reduce((s, matter: any) => s + getCollectedValueFromProgress(matter), 0);
    const collected = paidInvoices.reduce((s, i) => s + (Number(i.amount) || 0), 0) + retainers.collected;
    const directMatterCosts = expenses
      .filter((expense: any) => expense.chargeType === 'client' && Boolean(expense.caseId))
      .reduce((s, expense: any) => s + getDirectMatterCost(expense), 0);
    const firmOperatingExpenses = expenses
      .filter((expense: any) => expense.chargeType !== 'client')
      .reduce((s, expense: any) => s + getDirectMatterCost(expense), 0);
    const grossProfit = collected - directMatterCosts;
    const grossProfitMargin = collected > 0 ? Math.round((grossProfit / collected) * 100) : 0;
    const netProfit = grossProfit - firmOperatingExpenses - retainers.staffTpa;
    const netProfitMargin = collected > 0 ? Math.round((netProfit / collected) * 100) : 0;
    const pending = await Invoice.find({ status: { $ne: 'Paid' }, date: { $lte: toStr }, ...ordinaryInvoiceFilter }).select('amount').lean();
    const outstanding = pending.reduce((sum, i) => sum + i.amount, 0) + retainers.outstanding;
    const collectionRate = contractValue > 0 ? Math.round((collected / contractValue) * 100) : 0;

    // monthly trend: invoices drive billed, paid invoices drive collected
    const map = new Map<string, { month: string; billed: number; collected: number }>();
    for (const inv of invoices) {
      const dt = new Date(inv.date);
      const key = monthKey(dt);
      const item = map.get(key) || { month: key, billed: 0, collected: 0 };
      item.billed += Number(inv.amount) || 0;
      map.set(key, item);
    }
    for (const inv of paidInvoices as any[]) {
      const dt = inv.updatedAt ? new Date(inv.updatedAt) : toDate;
      const key = monthKey(dt);
      const item = map.get(key) || { month: key, billed: 0, collected: 0 };
      item.collected += Number(inv.amount) || 0;
      map.set(key, item);
    }

    for (const p of retainers.statements) {
      const key = p.month;
      const item = map.get(key) || { month: key, billed: 0, collected: 0 };
      item.billed += p.feeInRange; map.set(key, item);
    }
    const receipts = (await import('../models/retainerReceiptModel')).default;
    for (const r of await receipts.find({ voidedAt: { $exists: false }, receivedOn: { $gte: fromStr, $lte: toStr } }).lean()) {
      const key = r.receivedOn.slice(0, 7); const item = map.get(key) || { month: key, billed: 0, collected: 0 };
      item.collected += r.amount; map.set(key, item);
    }
    const months = Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));

    res.json({
      from: fromStr,
      to: toStr,
      billed,
      collected,
      progressValue,
      contractValue,
      outstanding,
      collectionRate,
      directMatterCosts,
      firmOperatingExpenses,
      grossProfit,
      grossProfitMargin,
      netProfit,
      netProfitMargin,
      months,
      retainer: retainers,
      retainerStaffTpa: retainers.staffTpa,
    });
  } catch {
    res.status(500).json({ message: 'Failed to fetch billing summary.' });
  }
};
