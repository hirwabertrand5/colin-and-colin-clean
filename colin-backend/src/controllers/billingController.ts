import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import Case from '../models/caseModel';
import Invoice from '../models/invoiceModel';
import PettyCashExpense from '../models/pettyCashExpenseModel';
import TaskTimeLog from '../models/taskTimeLogModel';
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

    const [invoices, paidInvoices, matters, expenses] = await Promise.all([
      Invoice.find({ date: { $gte: fromStr, $lte: toStr } })
        .sort({ date: 1 })
        .lean(),
      Invoice.find({ status: 'Paid', updatedAt: { $gte: fromDate, $lte: toDate } })
        .select('amount date caseId updatedAt')
        .lean(),
      Case.find({ updatedAt: { $gte: fromDate, $lte: toDate } })
        .select('_id budget updatedAt workflowProgress billingSettings')
        .lean(),
      PettyCashExpense.find({ date: { $gte: fromStr, $lte: toStr } })
        .select('amount refundAmount chargeType caseId')
        .lean(),
    ]);

    const billed = invoices.reduce((s, i) => s + (Number(i.amount) || 0), 0);
    const contractValue = matters.reduce((s, matter: any) => s + getContractValue(matter), 0);
    const progressValue = matters.reduce((s, matter: any) => s + getCollectedValueFromProgress(matter), 0);
    const collected = paidInvoices.reduce((s, i) => s + (Number(i.amount) || 0), 0);
    const directMatterCosts = expenses
      .filter((expense: any) => expense.chargeType === 'client' && Boolean(expense.caseId))
      .reduce((s, expense: any) => s + getDirectMatterCost(expense), 0);
    const firmOperatingExpenses = expenses
      .filter((expense: any) => expense.chargeType !== 'client')
      .reduce((s, expense: any) => s + getDirectMatterCost(expense), 0);
    const grossProfit = collected - directMatterCosts;
    const grossProfitMargin = collected > 0 ? Math.round((grossProfit / collected) * 100) : 0;
    const netProfit = grossProfit - firmOperatingExpenses;
    const netProfitMargin = collected > 0 ? Math.round((netProfit / collected) * 100) : 0;
    const outstanding = Math.max(0, contractValue - collected);
    const collectionRate = contractValue > 0 ? Math.round((collected / contractValue) * 100) : 0;
    const hoursAgg = await TaskTimeLog.aggregate([
      { $match: { loggedAt: { $gte: fromDate, $lte: toDate } } },
      { $group: { _id: null, totalHours: { $sum: '$hours' } } },
    ]);
    const billableHours = Math.round((((hoursAgg?.[0]?.totalHours as number) || 0) * 10)) / 10;

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
      billableHours,
      directMatterCosts,
      firmOperatingExpenses,
      grossProfit,
      grossProfitMargin,
      netProfit,
      netProfitMargin,
      months,
    });
  } catch {
    res.status(500).json({ message: 'Failed to fetch billing summary.' });
  }
};
