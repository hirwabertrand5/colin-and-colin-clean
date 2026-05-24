import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';
import Invoice from '../models/invoiceModel';
import Case from '../models/caseModel';

const attachCaseInfo = async (invoices: any[]) => {
  const caseIds = Array.from(new Set(invoices.map((i) => String(i.caseId))));
  const cases = await Case.find({ _id: { $in: caseIds } }).select('_id caseNo parties').lean();
  const caseMap = new Map(cases.map((c: any) => [String(c._id), c]));
  return invoices.map((inv) => ({ ...inv, case: caseMap.get(String(inv.caseId)) || null }));
};

// GET /api/invoices/recent?limit=10
export const getRecentInvoices = async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 10, 50);

    const invoices = await Invoice.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json(await attachCaseInfo(invoices));
  } catch {
    res.status(500).json({ message: 'Failed to fetch recent invoices.' });
  }
};

// GET /api/invoices?status=Paid|Pending&q=...&caseId=...&from=...&to=...
export const listInvoices = async (req: AuthRequest, res: Response) => {
  try {
    const { status, q, caseId, from, to } = req.query as any;
    const filter: any = {};

    if (status && ['Paid', 'Pending'].includes(String(status))) filter.status = String(status);

    if (caseId) {
      if (!mongoose.Types.ObjectId.isValid(String(caseId))) {
        return res.status(400).json({ message: 'Invalid caseId.' });
      }
      filter.caseId = new mongoose.Types.ObjectId(String(caseId));
    }

    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = String(from);
      if (to) filter.date.$lte = String(to);
    }

    if (q && String(q).trim()) {
      const regex = new RegExp(String(q).trim(), 'i');
      filter.$or = [{ invoiceNo: regex }, { notes: regex }];
    }

    const invoices = await Invoice.find(filter).sort({ date: -1, createdAt: -1 }).lean();
    res.json(await attachCaseInfo(invoices));
  } catch {
    res.status(500).json({ message: 'Failed to list invoices.' });
  }
};