import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Invoice from '../models/invoiceModel';
import Counter from '../models/counterModel';
import { writeAudit } from '../services/auditService';
import { storeUploadedFile } from '../services/fileStorageService';

const paramValue = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const validDay = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

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
    if (!mongoose.Types.ObjectId.isValid(caseId)) {
      return res.status(400).json({ message: 'Invalid caseId' });
    }

    const { date, dueDate, amount, notes } = req.body;
    const invoiceAmount = Number(amount);

    if (!validDay(date) || !Number.isFinite(invoiceAmount) || invoiceAmount <= 0) {
      return res.status(400).json({ message: 'date and a valid amount are required' });
    }

    if (dueDate && (!validDay(dueDate) || dueDate < date)) {
      return res.status(400).json({ message: 'Due date must be a valid date on or after the invoice date.' });
    }

    const invoiceFileUrl = req.file ? await storeUploadedFile(req.file) : undefined;
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
      ...(dueDate ? { dueDate } : {}),
      amount: invoiceAmount,
      status: 'Pending',
      notes,
      ...(invoiceFileUrl ? { invoiceFileUrl } : {}),
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
      detail: `${invoiceNo} • RWF ${invoiceAmount.toLocaleString()}`,
    });

    res.status(201).json(invoice);
  } catch (error: any) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'Invoice number conflict. Please try creating the invoice again.' });
    }
    res.status(500).json({ message: error?.message || 'Failed to create invoice.' });
  }
};

/** Payment terms are explicit; never invent a due date for legacy invoices. */
export const updateInvoiceTerms = async (req: Request, res: Response) => {
  try {
    const id = paramValue(req.params.invoiceId);
    if (!id || !mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid invoiceId.' });
    const invoice = await Invoice.findById(id);
    if (!invoice) return res.status(404).json({ message: 'Invoice not found.' });
    const dueDate = req.body.dueDate;
    if (dueDate !== null && dueDate !== '' && (!validDay(dueDate) || dueDate < invoice.date)) {
      return res.status(400).json({ message: 'Due date must be a valid date on or after the invoice date.' });
    }
    const update = { ...(dueDate ? { $set: { dueDate, ...(invoice.status === 'Paid' && !invoice.paidAt ? { paidAt: invoice.updatedAt } : {}) } }
      : { $unset: { dueDate: 1 }, ...(invoice.status === 'Paid' && !invoice.paidAt ? { $set: { paidAt: invoice.updatedAt } } : {}) }) };
    const saved = await Invoice.findByIdAndUpdate(id, update, { new: true });
    await writeAudit({ caseId: String(invoice.caseId), actorName: (req as any).user?.name || 'System', actorUserId: (req as any).user?.id,
      action: 'INVOICE_UPDATED', message: 'Updated invoice payment terms', detail: `${invoice.invoiceNo} · Due date: ${dueDate || 'not recorded'}` });
    return res.json(saved);
  } catch {
    return res.status(500).json({ message: 'Unable to save payment terms.' });
  }
};

// Mark invoice as paid + upload proof
export const uploadProof = async (req: Request, res: Response) => {
  try {
    const invoiceId = paramValue(req.params.invoiceId);
    if (!invoiceId || !mongoose.Types.ObjectId.isValid(invoiceId)) {
      return res.status(400).json({ message: 'Invalid invoiceId' });
    }
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    // First get invoice (to know caseId + invoiceNo for audit)
    const existing = await Invoice.findById(invoiceId);
    if (!existing) return res.status(404).json({ message: 'Invoice not found.' });
    const proofUrl = await storeUploadedFile(req.file);

    const invoice = await Invoice.findByIdAndUpdate(
      invoiceId,
      { status: 'Paid', proofUrl, paidAt: existing.paidAt || (existing.status === 'Paid' ? existing.updatedAt : new Date()) },
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
  } catch (error: any) {
    res.status(500).json({ message: error?.message || 'Failed to upload proof.' });
  }
};

// ✅ NEW: upload invoice file (separate from proof)
export const uploadInvoiceFile = async (req: Request, res: Response) => {
  try {
    const invoiceId = paramValue(req.params.invoiceId);
    if (!invoiceId || !mongoose.Types.ObjectId.isValid(invoiceId)) {
      return res.status(400).json({ message: 'Invalid invoiceId' });
    }
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const existing = await Invoice.findById(invoiceId);
    if (!existing) return res.status(404).json({ message: 'Invoice not found.' });
    const invoiceFileUrl = await storeUploadedFile(req.file);

    const updated = await Invoice.findByIdAndUpdate(
      invoiceId,
      { invoiceFileUrl, ...(existing.status === 'Paid' && !existing.paidAt ? { paidAt: existing.updatedAt } : {}) },
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
  } catch (error: any) {
    res.status(500).json({ message: error?.message || 'Failed to upload invoice file.' });
  }
};

// ✅ NEW: delete invoice
export const deleteInvoice = async (req: Request, res: Response) => {
  try {
    const invoiceId = paramValue(req.params.invoiceId);
    if (!invoiceId || !mongoose.Types.ObjectId.isValid(invoiceId)) {
      return res.status(400).json({ message: 'Invalid invoiceId' });
    }

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
