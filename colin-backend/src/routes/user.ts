import express from 'express';
import {
  getAllUsers,
  getStaffUsers,
  addUser,
  resetUserPassword,
  setUserActiveStatus,
  updateUser,
  deleteUser,
} from '../controllers/userController.js';
import { authenticate, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// ✅ Full access for Managing Director + Executive Assistant (as you requested)
const USER_ADMIN_ROLES = ['managing_director', 'executive_assistant'];

// Staff list for assignment dropdowns.
router.get(
  '/staff',
  authenticate,
  authorize([
    'managing_director',
    'managing_partner',
    'executive_managing_partner',
    'senior_partner',
    'partner',
    'executive_partner',
    'associate_partner',
    'executive_associate_partner',
    'senior_associate',
    'senior_executive_assistant',
    'associate',
    'executive_assistant',
    'originating_attorney',
  ]),
  getStaffUsers
);

router.get('/', authenticate, authorize(USER_ADMIN_ROLES), getAllUsers);
router.post('/', authenticate, authorize(USER_ADMIN_ROLES), addUser);
router.post('/reset-password', authenticate, authorize(USER_ADMIN_ROLES), resetUserPassword);
router.post('/set-active', authenticate, authorize(USER_ADMIN_ROLES), setUserActiveStatus);
router.put('/:id', authenticate, authorize(USER_ADMIN_ROLES), updateUser);
router.delete('/:id', authenticate, authorize(USER_ADMIN_ROLES), deleteUser);

export default router;
