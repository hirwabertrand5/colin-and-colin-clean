/**
 * Maps every surviving workflow template to the Legal Service Classification
 * decision-tree path(s) that auto-select it in the Create Case wizard.
 *
 * How the wizard decides (CreateCase.tsx):
 *   1. walk the selected service path from the DEEPEST node upwards;
 *   2. the first node carrying `suggestedMatterTypes` contributes its FIRST
 *      entry as the suggested matter type;
 *   3. `findMatchingWorkflowTemplate` requires an active template whose
 *      matterType matches (normalised) AND whose caseType equals the deepest
 *      selected node's caseType.
 *
 * Prints, for each remaining template, the exact breadcrumb to click, then any
 * tree suggestions whose templates were purged (those never auto-select now).
 *
 * Usage: npx tsx scripts/mapTemplatesToLegalPaths.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import connectDB from '../src/config/db';
import WorkflowTemplate from '../src/models/workflowTemplateModel';
// Smoke import: must compile WITHOUT the duplicate entryKey index warning.
import StaffEarningsLedger from '../src/models/staffEarningsLedgerModel';
import { LEGAL_SERVICES_TREE, ServiceNode } from '../../src/constants/legalServicesTree';

type Suggestion = { path: string; suggestion: string; caseType: string };

const collectSuggestions = (nodes: ServiceNode[], labels: string[], out: Suggestion[]): Suggestion[] => {
  for (const node of nodes) {
    const trail = [...labels, node.label];
    const first = node.suggestedMatterTypes?.[0];
    if (first && node.caseType) out.push({ path: trail.join(' / '), suggestion: first, caseType: node.caseType });
    if (node.children?.length) collectSuggestions(node.children, trail, out);
  }
  return out;
};

/** Same normalisation findMatchingWorkflowTemplate applies to matterType. */
const norm = (value: unknown) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

(async () => {
  try {
    await connectDB();

    const suggestions = collectSuggestions(LEGAL_SERVICES_TREE as ServiceNode[], [], []);
    const templates: any[] = await WorkflowTemplate.find({}).sort({ matterType: 1, name: 1 }).lean();

    console.log('');
    console.log('================== TEMPLATE -> LEGAL CLASSIFICATION PATH ==================');

    const claimedPaths = new Set<string>();
    for (const template of templates) {
      const matches = suggestions.filter(
        (s) => norm(s.suggestion) === norm(template.matterType) && s.caseType === template.caseType
      );
      matches.forEach((m) => claimedPaths.add(m.path));

      console.log('');
      console.log(`- ${template.name}  [matterType="${template.matterType}" | caseType="${template.caseType}" | v${template.version}]`);
      if (!matches.length) {
        console.log(
          '    no auto-select path: choose any branch with the same case type, then pick this template manually from the "Workflow Template" dropdown in step 2.'
        );
        continue;
      }
      for (const m of matches) console.log(`    auto-select path: ${m.path}`);
    }

    const orphaned = suggestions.filter((s) => !claimedPaths.has(s.path));
    console.log('');
    console.log('================== TREE SUGGESTIONS WITH NO TEMPLATE (purged) ==================');
    console.log('Selecting these auto-picks nothing - choose a Workflow Template manually instead.');
    for (const s of orphaned) console.log(`  ${s.path}  -> suggests "${s.suggestion}" (${s.caseType})`);

    // The StaffEarningsLedger schema must now declare entryKey exactly once.
    const entryKeyIndexes = ((StaffEarningsLedger.schema as any).indexes() as Array<[any, any]>).filter(
      ([keys]) => keys && keys.entryKey !== undefined
    );
    console.log('');
    console.log(`StaffEarningsLedger entryKey index definitions: ${entryKeyIndexes.length} (expected 1, unique)`);
    for (const [keys, options] of entryKeyIndexes) console.log(`  ${JSON.stringify(keys)} -> ${JSON.stringify(options)}`);
  } finally {
    await mongoose.disconnect();
  }
})().catch((error) => {
  console.error('Mapping failed:', error);
  process.exit(1);
});
