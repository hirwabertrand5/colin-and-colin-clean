import dotenv from 'dotenv';
import path from 'path';
import { startReminderScheduler } from './jobs/reminderScheduler';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import app from './app';
import connectDB from './config/db.js';
import { seedDueDiligenceTemplate } from './seed/seedDueDiligence';

const PORT = process.env.PORT || 5000;

connectDB().then(async () => {
  // ✅ seed workflow templates
  await seedDueDiligenceTemplate();

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    startReminderScheduler();
  });
});