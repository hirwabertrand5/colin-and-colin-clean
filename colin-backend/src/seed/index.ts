import { seedNGORegistrationTemplate } from './seedNGORegistration';
import { seedBusinessRegistrationTemplateV2 } from './seedBusinessRegistrationV2';
import { seedComprehensiveLegalWorkflows } from './seedComprehensiveLegalWorkflows';
import { seedClientExperienceTemplates } from './seedClientExperienceTemplates';
import WorkflowTemplate from '../models/workflowTemplateModel';
import { normalizeTemplatePercentages } from '../utils/workflowPercentages';

export const seedAllWorkflowTemplates = async () => {
  // ONLY seeds whose templates survived the purge may run here. server.ts calls
  // this on EVERY boot and each seed upserts ($setOnInsert), so re-invoking a
  // purged template's seed resurrects it. Purged (do NOT re-add):
  //  Due Diligence, Arbitration, Commercial Litigation, Labor, Business
  //  Registration v1, Criminal Procedure, Tontine, Data Protection,
  //  Immigration, Vehicle Ownership (+ all non-Auction comprehensive entries,
  //  whitelisted inside seedComprehensiveLegalWorkflows).
  await seedNGORegistrationTemplate();
  await seedBusinessRegistrationTemplateV2();
  await seedComprehensiveLegalWorkflows();
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
