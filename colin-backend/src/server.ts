import dotenv from 'dotenv';
import path from 'path';
import { startReminderScheduler } from './jobs/reminderScheduler';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import app from './app';
import connectDB from './config/db.js';
import { seedAllWorkflowTemplates } from './seed';
import { reconcileTerminalProspects } from './controllers/prospectController';

const PORT = process.env.PORT || 5000;

connectDB().then(async () => {
  // ✅ seed workflow templates
  await seedAllWorkflowTemplates();
  const reconciledCount = await reconcileTerminalProspects();
  if (reconciledCount > 0) {
    console.log(`[prospectReconciler] synchronized ${reconciledCount} terminal prospect(s)`);
  }

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    startReminderScheduler();
  });
});
