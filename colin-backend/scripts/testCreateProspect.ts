import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import User from '../src/models/userModel';
import Prospect from '../src/models/prospectModel';
import { createProspect } from '../src/controllers/prospectController';
import { AuthRequest } from '../src/middleware/authMiddleware';

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI not set');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('Connected to DB');

  const user = await User.findOne({ isActive: true }).lean();
  if (!user) {
    console.error('No active user found to assign as assignee. Create a user first.');
    process.exit(1);
  }

  // Clean up any test prospects with this client name
  await Prospect.deleteMany({ clientName: 'Test Client (Automated)' });

  const req = {
    body: {
      clientName: 'Test Client (Automated)',
      contact: { name: 'Alice Tester', email: 'alice.tester@example.com', phone: '255700000001' },
      inquiryDescription: 'Automated test prospect',
      stage: 'Inquiry',
      assignedTo: String(user._id),
    },
    user: { id: String(user._id), role: user.role, name: user.name },
  } as unknown as AuthRequest;

  const res: any = {
    status(code: number) {
      this._status = code;
      return this;
    },
    json(payload: any) {
      console.log('Response status:', this._status || 200);
      console.log(JSON.stringify(payload, null, 2));
      return payload;
    },
  };

  try {
    await createProspect(req, res);
  } catch (err: any) {
    console.error('createProspect threw:', err);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
