import express from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware';
import {
  getActiveFund,
  listFunds,
  createFund,
  closeActiveFund,
  topUpActiveFund,
  listExpensesForFund,
  listExpensesForCase,
  createExpense,
  deleteExpense,
  addRefundToExpense,
} from '../controllers/pettyCashController';
import { upload } from '../controllers/documentController';

const router = express.Router();

const ROLES = ['managing_director', 'executive_assistant'];

// Funds
router.get('/funds/active', authenticate, authorize(ROLES), getActiveFund);
router.get('/funds', authenticate, authorize(ROLES), listFunds);
router.post('/funds', authenticate, authorize(ROLES), createFund);
router.post('/funds/close', authenticate, authorize(ROLES), closeActiveFund);
router.post('/funds/top-up', authenticate, authorize(ROLES), topUpActiveFund);

// Expenses
router.get('/funds/:fundId/expenses', authenticate, authorize(ROLES), listExpensesForFund);
router.get('/cases/:caseId/expenses', authenticate, authorize(ROLES), listExpensesForCase);

// Optional receipt upload: multipart/form-data with "files" (multiple)
router.post(
  '/funds/:fundId/expenses',
  authenticate,
  authorize(ROLES),
  upload.array('files'),
  createExpense
);

router.delete('/expenses/:expenseId', authenticate, authorize(ROLES), deleteExpense);
router.post('/expenses/:expenseId/refund', authenticate, authorize(ROLES), addRefundToExpense);

export default router;
