import express from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware';
import {
  getInvoicesForCase,
  addInvoiceToCase,
  uploadProof,
  uploadInvoiceFile,
  deleteInvoice,
} from '../controllers/invoiceController';
import { upload } from '../controllers/documentController';
import { getRecentInvoices, listInvoices } from '../controllers/invoiceQueryController';

const router = express.Router();

const FINANCE_ROLES = ['managing_director', 'executive_assistant'];

// Case-specific
router.get('/cases/:caseId/invoices', authenticate, getInvoicesForCase);

router.post(
  '/cases/:caseId/invoices',
  authenticate,
  authorize(FINANCE_ROLES),
  addInvoiceToCase
);

// Proof of payment (marks Paid)
router.post(
  '/invoices/:invoiceId/proof',
  authenticate,
  authorize(FINANCE_ROLES),
  upload.single('file'),
  uploadProof
);

// ✅ NEW: Upload invoice file (does NOT mark paid)
router.post(
  '/invoices/:invoiceId/file',
  authenticate,
  authorize(FINANCE_ROLES),
  upload.single('file'),
  uploadInvoiceFile
);

// ✅ NEW: Delete invoice
router.delete(
  '/invoices/:invoiceId',
  authenticate,
  authorize(FINANCE_ROLES),
  deleteInvoice
);

// Firm-wide invoice queries
router.get(
  '/invoices',
  authenticate,
  authorize(FINANCE_ROLES),
  listInvoices
);

router.get(
  '/invoices/recent',
  authenticate,
  authorize(FINANCE_ROLES),
  getRecentInvoices
);

export default router;