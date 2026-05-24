import 'dotenv/config';
import connectDB from '../config/db';
import { seedAllWorkflowTemplates } from './index';

async function run() {
  await connectDB();
  await seedAllWorkflowTemplates();
  console.log('✅ Seeded workflow templates successfully');
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Seeding failed:', err);
  process.exit(1);
});