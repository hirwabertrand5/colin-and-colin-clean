import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcrypt'; // native bcrypt — significantly faster than bcryptjs

// bcrypt work factor for password hashing. OWASP recommends 10–12; we use 10 so
// logins stay fast (each step of 1 doubles the CPU cost). Existing cost-12
// hashes are re-hashed to this cost on the user's next successful login.
export const BCRYPT_ROUNDS = 10;

export type UserRole =
  | 'managing_director'
  | 'managing_partner'
  | 'senior_partner'
  | 'partner'
  | 'associate_partner'
  | 'executive_associate_partner'
  | 'senior_associate'
  | 'senior_executive_assistant'
  | 'associate'
  | 'trainee_associate'
  | 'executive_assistant'
  | 'executive_partner'
  | 'executive_managing_partner'
  | 'originating_attorney'
  | 'intern';

export interface IUser extends Document {
  email: string;
  name: string;
  role: UserRole;
  passwordHash: string;
  isActive: boolean;
  loginAttempts: number;
  lockUntil?: Date;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidate: string): Promise<boolean>;
}

const UserSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true },
   role: {
  type: String,
  enum: [
    'managing_director',
    'managing_partner',
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
    'executive_managing_partner',
    'originating_attorney',
    'intern'
  ],
  required: true
},
    passwordHash: { type: String, required: true },
    isActive: { type: Boolean, default: true },
    loginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
  },
  { timestamps: true }
);

// Password comparison method
UserSchema.methods.comparePassword = async function (candidate: string) {
  return bcrypt.compare(candidate, this.passwordHash);
};

// Pre-save hook: Removed 'next' to fix "not callable" error
UserSchema.pre<IUser>('save', async function () {
  if (!this.isModified('passwordHash')) return;

  // NEVER re-hash an already-hashed bcrypt value. Without this guard, any code
  // assigning a pre-hashed passwordHash (e.g. rehash-on-login) would store
  // bcrypt(bcrypt(password)) and permanently break logins for that account.
  if (/^\$2[abxy]\$\d{2}\$/.test(this.passwordHash)) return;

  this.passwordHash = await bcrypt.hash(this.passwordHash, BCRYPT_ROUNDS);
});

export default mongoose.model<IUser>('User', UserSchema);
