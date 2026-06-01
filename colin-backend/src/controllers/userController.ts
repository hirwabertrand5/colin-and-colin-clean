import { Response } from 'express';
import User from '../models/userModel.js';
import { AuthRequest } from '../middleware/authMiddleware.js';

const ASSOCIATE_ASSIGNABLE_ROLES = ['trainee_associate', 'intern'];
const STAFF_ASSIGNABLE_ROLES = [
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
  'trainee_associate',
  'executive_assistant',
  'originating_attorney',
  'intern',
];

// Get all users (excluding passwordHash)
export const getAllUsers = async (req: AuthRequest, res: Response) => {
  try {
    const users = await User.find({}, '-passwordHash -__v');
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch users.' });
  }
};

// ✅ NEW: Get active staff users for assignment dropdown
export const getStaffUsers = async (req: AuthRequest, res: Response) => {
  try {
    const allowedRoles =
      req.user?.role === 'associate'
        ? ASSOCIATE_ASSIGNABLE_ROLES
        : STAFF_ASSIGNABLE_ROLES;

    const staff = await User.find(
      {
        isActive: true,
        role: {
          $in: allowedRoles,
        },
      },
      'name email role isActive'
    ).sort({ name: 1 });

    res.json(staff);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch staff users.' });
  }
};

// Add new user
export const addUser = async (req: AuthRequest, res: Response) => {
  try {
    const { name, email, role, password } = req.body;

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists.' });
    }

    const user = new User({
      name,
      email,
      role,
      passwordHash: password,
      isActive: true,
      loginAttempts: 0,
    });

    await user.save();

    res.status(201).json({
      message: 'User created successfully.',
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create user.' });
  }
};

// Reset user password
export const resetUserPassword = async (req: AuthRequest, res: Response) => {
  try {
    const { userId, newPassword } = req.body;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    user.passwordHash = newPassword;
    await user.save();

    res.json({ message: 'Password reset successfully.' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to reset password.' });
  }
};

// Toggle user active status
export const setUserActiveStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { userId, isActive } = req.body;
    const user = await User.findByIdAndUpdate(userId, { isActive }, { new: true });

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    res.json({
      message: `User ${isActive ? 'activated' : 'deactivated'} successfully.`,
      user,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update user status.' });
  }
};

// Update user
export const updateUser = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, email, role } = req.body;
    const user = await User.findByIdAndUpdate(id, { name, email, role }, { new: true });
    if (!user) return res.status(404).json({ message: 'User not found.' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update user.' });
  }
};

// Delete user
export const deleteUser = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const user = await User.findByIdAndDelete(id);
    if (!user) return res.status(404).json({ message: 'User not found.' });
    res.json({ message: 'User deleted successfully.' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete user.' });
  }
};
