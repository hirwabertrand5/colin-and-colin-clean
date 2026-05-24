import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Invoice from '../models/invoiceModel';
import Counter from '../models/counterModel';
import { writeAudit } from '../services/auditService';

// Get all invoices for a case
export const getInvoicesForCase = async (req: Request, res: Response) => {
  try {
    let caseId = req.params.caseId;
    if (Array.isArray(caseId)) caseId = caseId[0];
    if (!caseId) return res.status(400).json({ message: 'Missing caseId' });

    const invoices = await Invoice.find({
      caseId: new mongoose.Types.ObjectId(caseId),
    }).sort({ date: 1 });

    res.json(invoices);
  } catch {
    res.status(500).json({ message: 'Failed to fetch invoices.' });
  }
};

// Add a new invoice (invoiceNo generated automatically)
export const addInvoiceToCase = async (req: Request, res: Response) => {
  try {
    let caseId = req.params.caseId;
    if (Array.isArray(caseId)) caseId = caseId[0];
    if (!caseId) return res.status(400).json({ message: 'Missing caseId' });

    const { date, amount, notes } = req.body;

    if (!date || amount === undefined) {
      return res.status(400).json({ message: 'date and amount are required' });
    }

    const year = new Date().getFullYear();

    // Atomic global yearly sequence
    const counterKey = `invoice:${year}`;
    const counter = await Counter.findOneAndUpdate(
      { key: counterKey },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    const seqYear = counter.seq;

    // Per-case sequence
    const seqCase =
      (await Invoice.countDocuments({ caseId: new mongoose.Types.ObjectId(caseId) })) + 1;

    // Format: INV-2026-1047-01
    const invoiceNo = `INV-${year}-${seqYear}-${String(seqCase).padStart(2, '0')}`;

    const invoice = new Invoice({
      caseId: new mongoose.Types.ObjectId(caseId),
      invoiceNo,
      year,
      seqYear,
      seqCase,
      date,
      amount,
      status: 'Pending',
      notes,
    });

    await invoice.save();

    // --- AUDIT LOG ---
    const actorName = (req as any).user?.name || 'System';
    const actorUserId = (req as any).user?.id;

    await writeAudit({
      caseId,
      actorName,
      actorUserId,
      action: 'INVOICE_CREATED',
      message: 'Created invoice',
      detail: `${invoiceNo} • RWF ${Number(amount).toLocaleString()}`,
    });

    res.status(201).json(invoice);
  } catch {
    res.status(500).json({ message: 'Failed to create invoice.' });
  }
};

// Mark invoice as paid + upload proof
export const uploadProof = async (req: Request, res: Response) => {
  try {
    const invoiceId = req.params.invoiceId;
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    // First get invoice (to know caseId + invoiceNo for audit)
    const existing = await Invoice.findById(invoiceId);
    if (!existing) return res.status(404).json({ message: 'Invoice not found.' });

    const invoice = await Invoice.findByIdAndUpdate(
      invoiceId,
      { status: 'Paid', proofUrl: `/uploads/${req.file.filename}` },
      { new: true }
    );

    if (!invoice) return res.status(404).json({ message: 'Invoice not found.' });

    // --- AUDIT LOG ---
    const actorName = (req as any).user?.name || 'System';
    const actorUserId = (req as any).user?.id;

    await writeAudit({
      caseId: String(existing.caseId),
      actorName,
      actorUserId,
      action: 'INVOICE_PAID',
      message: 'Uploaded proof (invoice marked Paid)',
      detail: existing.invoiceNo,
    });

    res.json(invoice);
  } catch {
    res.status(500).json({ message: 'Failed to upload proof.' });
  }
};

// ✅ NEW: upload invoice file (separate from proof)
export const uploadInvoiceFile = async (req: Request, res: Response) => {
  try {
    const invoiceId = req.params.invoiceId;
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const existing = await Invoice.findById(invoiceId);
    if (!existing) return res.status(404).json({ message: 'Invoice not found.' });

    const updated = await Invoice.findByIdAndUpdate(
      invoiceId,
      { invoiceFileUrl: `/uploads/${req.file.filename}` },
      { new: true }
    );

    const actorName = (req as any).user?.name || 'System';
    const actorUserId = (req as any).user?.id;

    await writeAudit({
      caseId: String(existing.caseId),
      actorName,
      actorUserId,
      action: 'INVOICE_UPDATED',
      message: 'Uploaded invoice file',
      detail: existing.invoiceNo,
    });

    res.json(updated);
  } catch {
    res.status(500).json({ message: 'Failed to upload invoice file.' });
  }
};

// ✅ NEW: delete invoice
export const deleteInvoice = async (req: Request, res: Response) => {
  try {
    const invoiceId = req.params.invoiceId;

    const existing = await Invoice.findById(invoiceId);
    if (!existing) return res.status(404).json({ message: 'Invoice not found.' });

    await Invoice.findByIdAndDelete(invoiceId);

    const actorName = (req as any).user?.name || 'System';
    const actorUserId = (req as any).user?.id;

    await writeAudit({
      caseId: String(existing.caseId),
      actorName,
      actorUserId,
      action: 'INVOICE_DELETED',
      message: 'Deleted invoice',
      detail: existing.invoiceNo,
    });

    res.json({ message: 'Invoice deleted.' });
  } catch {
    res.status(500).json({ message: 'Failed to delete invoice.' });
  }
};