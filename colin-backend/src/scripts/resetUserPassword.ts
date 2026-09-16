/**
 * CLI helper to reset a user's password (and clear any failed-attempt/lock data).
 * Also fixes accounts that were accidentally doubly-hashed by the old
 * rehash-on-login path (permanently broken passwords) — a reset is required for those.
 *
 * Usage (from colin-backend):
 *   npm run reset:password -- --list                        # list users
 *   npm run reset:password -- <email> <newPassword>         # reset one user
 *   npm run reset:password -- <email> --unlock              # only clear lock/attempts
 *   npm run reset:password -- --all <newPassword>           # reset EVERY user's password
 */
import 'dotenv/config';
import connectDB from '../config/db';
import User from '../models/userModel';

async function run() {
  const [, , arg1, arg2] = process.argv;

  const listOnly = arg1 === '--list';
  const resetAll = arg1 === '--all';
  const email = String(arg1 || '').trim().toLowerCase();
  const unlockOnly = arg2 === '--unlock';
  const newPassword = resetAll ? String(arg2 || '') : unlockOnly ? '' : String(arg2 || '');

  if (listOnly) {
    await connectDB();
    const users = await User.find({}).select('name email role isActive createdAt').sort({ email: 1 }).lean();
    console.log('Users in the database:');
    for (const user of users as any[]) {
      console.log(
        `- ${user.email}  [${user.role || 'no-role'}]  active=${user.isActive ? 'yes' : 'no'}  (${user.name || ''})`
      );
    }
    console.log(`Total: ${users.length}`);
    process.exit(0);
  }

  if (resetAll) {
    if (newPassword.length < 6) {
      console.error('New password must be at least 6 characters.');
      process.exit(1);
    }
    if (Buffer.byteLength(newPassword, 'utf8') > 72) {
      console.error('New password must be 72 bytes or fewer (bcrypt limit).');
      process.exit(1);
    }
    await connectDB();
    const users = await User.find({ isActive: { $ne: false } });
    let updated = 0;
    for (const user of users as any[]) {
      user.passwordHash = newPassword; // plaintext -> pre-save hook hashes it once
      user.loginAttempts = 0;
      user.lockUntil = undefined as any;
      await user.save();
      updated += 1;
    }
    console.log(
      `✅ Reset password for ${updated} active user(s) to the new password and cleared lock state.`
    );
    process.exit(0);
  }

  if (!email) {
    console.error('Usage:');
    console.error('  npm run reset:password -- --list');
    console.error('  npm run reset:password -- <email> <newPassword>');
    console.error('  npm run reset:password -- <email> --unlock');
    console.error('  npm run reset:password -- --all <newPassword>');
    process.exit(1);
  }

  if (!unlockOnly && newPassword.length < 6) {
    console.error('New password must be at least 6 characters.');
    process.exit(1);
  }
  if (!unlockOnly && Buffer.byteLength(newPassword, 'utf8') > 72) {
    console.error('New password must be 72 bytes or fewer (bcrypt limit).');
    process.exit(1);
  }

  await connectDB();

  const user = await User.findOne({ email });
  if (!user) {
    console.error(`User not found for email: ${email}`);
    process.exit(1);
  }

  if (!unlockOnly) {
    // Plaintext so the model's pre-save hook hashes it exactly once.
    user.passwordHash = newPassword;
  }
  user.loginAttempts = 0;
  user.lockUntil = undefined as any;
  await user.save();

  console.log(
    unlockOnly
      ? `✅ Lock/attempt state cleared for ${email} (password unchanged).`
      : `✅ Password reset for ${email} and lock/attempt state cleared.`
  );
  process.exit(0);
}

run().catch((error) => {
  console.error('Failed to reset password:', error);
  process.exit(1);
});