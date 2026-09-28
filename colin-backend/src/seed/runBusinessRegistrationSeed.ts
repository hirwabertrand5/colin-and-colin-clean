import 'dotenv/config';
import connectDB from '../config/db';
import { seedBusinessRegistrationTemplateV2 } from './seedBusinessRegistrationV2';

/**
 * Targeted runner: publishes the Business Registration Procedure v2 template
 * (source: the firm's "BUSINESS REGISTRATION WORKFLOW WITH PERCENTAGE"
 * document) without touching any other workflow template.
 * Run with: npm run seed:business-registration
 */
const run = async () => {
  await connectDB();
  const template: any = await seedBusinessRegistrationTemplateV2();
  console.log(`Seeded "${template?.name}" v${template?.version} (active: ${template?.active})`);
  console.log(`Sections: ${(template?.stages || []).length}, Key Actions: ${(template?.steps || []).length}`);
  process.exit(0);
};

run().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
