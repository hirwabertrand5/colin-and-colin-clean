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
import { seedComprehensiveLegalWorkflows } from './seedComprehensiveLegalWorkflows';
import { seedVehicleOwnershipTransferTemplate } from './seedVehicleOwnershipTransfer';
import { seedClientExperienceTemplates } from './seedClientExperienceTemplates';
import WorkflowTemplate from '../models/workflowTemplateModel';
import { normalizeTemplatePercentages } from '../utils/workflowPercentages';

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
  await seedComprehensiveLegalWorkflows();
  await seedVehicleOwnershipTransferTemplate();
  await seedClientExperienceTemplates();

  // Clamp any manual percentages already stored on the templates so earned-fee
  // calculations always read valid 0–100 values (manual values are preserved).
  const templates: any[] = await WorkflowTemplate.find({}).lean();
  for (const template of templates) {
    const stored = JSON.stringify({ stages: template.stages, steps: template.steps });
    normalizeTemplatePercentages(template);
    const cast = template as any;
    const normalized = JSON.stringify({ stages: cast.stages, steps: cast.steps });
    // Only rewrite a record when normalization actually changed it — a boot
    // must never race an admin editing a workflow.
    if (stored === normalized) continue;
    await WorkflowTemplate.updateOne(
      { _id: template._id },
      {
        $set: {
          stages: cast.stages,
          steps: cast.steps,
        },
      }
    );
  }
};
