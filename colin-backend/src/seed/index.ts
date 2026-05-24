import { seedDueDiligenceTemplate } from './seedDueDiligence';
import { seedNGORegistrationTemplate } from './seedNGORegistration';
import { seedArbitrationTemplate } from './seedArbitration';
import { seedCommercialWorkflowTemplate } from './seedCommercialWorkflow';
import { seedLaborProcedureTemplate } from './seedLaborProcedure';
import { seedBusinessRegistrationTemplate } from './seedBusinessRegistration';
import { seedCriminalProcedureTemplate } from './seedCriminalProcedure';
import { seedTontineRegistrationTemplate } from './seedTontineRegistration';
import { seedDataProtectionLicensesTemplate } from './seedDataProtectionLicenses';
import { seedImmigrationTemplate } from './seedImmigration';

export const seedAllWorkflowTemplates = async () => {
  await seedDueDiligenceTemplate();
  await seedNGORegistrationTemplate();
  await seedArbitrationTemplate();
  await seedCommercialWorkflowTemplate();
  await seedLaborProcedureTemplate();
  await seedBusinessRegistrationTemplate();
  await seedCriminalProcedureTemplate();
  await seedTontineRegistrationTemplate();
  await seedDataProtectionLicensesTemplate();
  await seedImmigrationTemplate();
};
