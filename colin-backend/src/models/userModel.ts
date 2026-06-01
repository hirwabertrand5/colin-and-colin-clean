import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs'; // Using bcryptjs for better compatibility

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

  const salt = await bcrypt.genSalt(12);
  this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
});

export default mongoose.model<IUser>('User', UserSchema);
