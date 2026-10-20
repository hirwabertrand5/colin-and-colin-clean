import dotenv from 'dotenv';
import path from 'path';
import { startReminderScheduler } from './jobs/reminderScheduler';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import app from './app';
import connectDB from './config/db.js';
import { seedAllWorkflowTemplates } from './seed';
import { reconcileTerminalProspects } from './controllers/prospectController';
import { migrateLegacyUploadsToGridFs } from './services/fileStorageService';
import { migrateLegacyRetainerSubscriptions } from './services/retainerService';

const PORT = process.env.PORT || 5000;

connectDB().then(async () => {
  try {
    const legacyUploads = await migrateLegacyUploadsToGridFs();
    if (legacyUploads.migrated > 0) {
      console.log(`[uploads] moved ${legacyUploads.migrated} legacy file(s) into persistent storage`);
    }
  } catch (error) {
    // GridFS is still used for every new upload; a malformed legacy file must
    // not prevent the service from starting.
    console.error('[uploads] legacy-file migration failed', error);
  }
  // ✅ seed workflow templates
  try {
    const retainerMigration = await migrateLegacyRetainerSubscriptions();
    if (retainerMigration.migratedRetainers > 0 || retainerMigration.releasedCaseAllocations > 0) {
      console.log(`[retainers] migrated ${retainerMigration.migratedRetainers} subscription(s) and released ${retainerMigration.releasedCaseAllocations} legacy case allocation(s)`);
    }
  } catch (error) {
    // New retainer links remain safe even if one malformed legacy record
    // cannot be migrated during startup.
    console.error('[retainers] subscription migration failed', error);
  }
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
