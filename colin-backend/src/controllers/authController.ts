import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/userModel.js';

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = (req.body || {}) as {
      email?: string;
      password?: string;
    };

    // ✅ Prevent crash when body is missing
    if (!email || !password) {
      return res.status(400).json({ message: 'email and password are required.' });
    }

    const user = await User.findOne({ email });

    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    if (user.lockUntil && user.lockUntil > new Date()) {
      return res.status(403).json({ message: 'Account is locked. Try later.' });
    }

    const valid = await user.comparePassword(password);
    if (!valid) {
      user.loginAttempts += 1;
      if (user.loginAttempts >= 5) {
        user.lockUntil = new Date(Date.now() + 30 * 60 * 1000);
      }
      await user.save();
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    user.loginAttempts = 0;
    user.lockUntil = undefined as any;
    await user.save();

    const secret = process.env.JWT_SECRET as string;
    if (!secret) {
      return res.status(500).json({ message: 'JWT secret not configured.' });
    }

    const token = jwt.sign(
      { id: user._id, name: user.name, role: user.role, email: user.email },
      secret,
      // You can change this later if you want longer sessions
      { expiresIn: '7d' }
    );

    return res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Server error during login.' });
  }
};

// registerUser (kept as you had)
export const registerUser = async (req: Request, res: Response) => {
  try {
    const { name, email, password, role } = (req.body || {}) as any;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: 'name, email, password, role are required.' });
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists.' });
    }

    const user = new User({
      name,
      email,
      passwordHash: password, // Hashing happens in userModel pre-save hook
      role,
    });

    await user.save();
    return res.status(201).json({ message: 'User created successfully.' });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ message: 'Server error during registration.' });
  }
};