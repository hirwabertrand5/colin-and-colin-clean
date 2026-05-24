import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/userModel'; 


export interface AuthRequest extends Request {
  user?: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
}

type JwtPayload = {
  id?: string;
  userId?: string;
  sub?: string;
  role?: string;
  email?: string;
  iat?: number;
  exp?: number;
};

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided.' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'No token provided.' });
  }
  const secret = process.env.JWT_SECRET;
if (!secret) throw new Error('JWT_SECRET is not set in environment variables');


  try {
    const decoded: any = jwt.verify(token, secret);

    // Support different payload keys
    const userId = decoded.id || decoded.userId || decoded._id || decoded.sub;
    if (!userId) {
      return res.status(401).json({ message: 'Invalid token payload (missing user id).' });
    }

    const user = await User.findById(userId).select('name email role isActive');
    if (!user) return res.status(401).json({ message: 'User not found.' });
    if (user.isActive === false) return res.status(403).json({ message: 'User is inactive.' });

    req.user = {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
    };

    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token.' });
  }
};

export const authorize = (roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden.' });
    }
    next();
  };
};
