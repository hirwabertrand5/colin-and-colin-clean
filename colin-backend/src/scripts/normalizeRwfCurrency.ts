/**
 * RWF-only currency normaliser.
 *
 * DEFAULT IS DRY-RUN: lists what would change without touching the DB.
 * With --apply it rewrites ONLY currency labels to 'RWF' and NEVER
 * changes numeric amounts, so finance can apply exchange rates manually.
 *
 * Usage:
 *   cd colin-backend
 *   npx tsx src/scripts/normalizeRwfCurrency.ts          # dry run
 *   npx tsx src/scripts/normalizeRwfCurrency.ts --apply  # apply label-only fix
 */
import mongoose from 'mongoose';
import dns from 'dns';
import path from 'path';
import dotenv from 'dotenv';
import Case from '../models/caseModel';
import Prospect from '../models/prospectModel';
import PettyCashFund from '../models/pettyCashFundModel';
import WorkflowTemplate from '../models/workflowTemplateModel';
import WorkflowInstance from '../models/workflowInstanceModel';

try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch { /* ignore */ }

const scriptDir = __dirname;
dotenv.config({ path: path.resolve(scriptDir, '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'colin-backend/.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const apply = process.argv.includes('--apply');

const isNonRwf = (v: unknown) => {
  const s = String(v ?? '').trim().toUpperCase();
  if (!s) return false;
  return s !== 'RWF' && s !== 'FRW';
};

const run = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set.');
  await mongoose.connect(uri);
  console.log(`Connected. RWF label normalisation (${apply ? 'APPLY MODE — amounts preserved' : 'DRY RUN — no writes'})...\n`);

  const changed: string[] = [];

  // Prospects (direct label-only update: no amount changes, skip validation side-effects)
  const prospects = await Prospect.find({ estimatedMatterCurrency: { $nin: ['RWF', 'FRW', '', null] } }).lean();
  for (const p of prospects as any[]) {
    changed.push(`prospect ${p.prospectNo || p._id} (${p.clientName || ''}) estimatedMatterCurrency ${p.estimatedMatterCurrency} -> RWF | value ${p.estimatedMatterValue ?? p.estimatedFeeValue ?? '(none)'}`);
    if (apply) { await Prospect.updateOne({ _id: p._id }, { $set: { estimatedMatterCurrency: 'RWF' } }); }
  }

  // Cases (direct label-only update: no amount changes)
  const cases = await Case.find({ $or: [
    { 'workflowProgress.plannedValue.currency': { $nin: ['RWF', 'FRW', '', null] } },
    { 'workflowProgress.completedValue.currency': { $nin: ['RWF', 'FRW', '', null] } },
    { 'billingSettings.currency': { $nin: ['RWF', 'FRW', '', null] } },
  ] }).lean();
  for (const c of cases as any[]) {
    const label = `${c.caseNo || c._id} (${c.parties || ''})`;
    const set: Record<string, unknown> = {};
    if (isNonRwf(c?.workflowProgress?.plannedValue?.currency)) {
      changed.push(`case ${label} plannedValue.currency ${c.workflowProgress.plannedValue.currency} -> RWF | amount ${c.workflowProgress.plannedValue.amount ?? c.budget ?? '(none)'}`);
      if (apply) set['workflowProgress.plannedValue.currency'] = 'RWF';
    }
    if (isNonRwf(c?.workflowProgress?.completedValue?.currency)) {
      changed.push(`case ${label} completedValue.currency ${c.workflowProgress.completedValue.currency} -> RWF | amount ${c.workflowProgress.completedValue.amount ?? '(none)'}`);
      if (apply) set['workflowProgress.completedValue.currency'] = 'RWF';
    }
    if (isNonRwf(c?.billingSettings?.currency)) {
      changed.push(`case ${label} billingSettings.currency ${c.billingSettings.currency} -> RWF | amount ${c?.workflowProgress?.plannedValue?.amount ?? c?.budget ?? '(none)'}`);
      if (apply) set['billingSettings.currency'] = 'RWF';
    }
    if (apply && Object.keys(set).length) await Case.updateOne({ _id: c._id }, { $set: set });
  }

  // Petty cash funds
  const funds = await PettyCashFund.find({ currency: { $nin: ['RWF', 'FRW', '', null] } }).lean();
  for (const f of funds as any) {
    changed.push(`petty-cash fund ${f.name || f._id} currency ${f.currency} -> RWF | initialAmount ${f.initialAmount ?? '(none)'}`);
    if (apply) { await PettyCashFund.updateOne({ _id: f._id }, { $set: { currency: 'RWF' } }); }
  }

  // Workflow templates (legacy fee specs)
  const templates = await WorkflowTemplate.find({});
  for (const t of templates as any) {
    let dirty = false;
    for (const s of [...(t.stages || []), ...(t.steps || [])]) {
      if (s?.fee && isNonRwf(s.fee.currency)) {
        changed.push(`workflow template ${t.name || t._id} [${s.key || s.title}] fee.currency ${s.fee.currency} -> RWF | min/max ${s.fee.min ?? ''}/${s.fee.max ?? ''}`);
        if (apply) { s.fee.currency = 'RWF'; dirty = true; }
      }
    }
    if (apply && dirty) { t.markModified('stages'); t.markModified('steps'); await t.save(); }
  }

  // Workflow instances (legacy fee snapshots)
  const instances = await WorkflowInstance.find({});
  for (const inst of instances as any) {
    let dirty = false;
    for (const s of inst.steps || []) {
      if (isNonRwf(s?.feeCurrency)) {
        changed.push(`workflow instance ${inst._id} [${s.stepKey || s.title}] feeCurrency ${s.feeCurrency} -> RWF | amount ${s.feeAmount ?? s.feeRangeMin ?? '(none)'}`);
        if (apply) { s.feeCurrency = 'RWF'; dirty = true; }
      }
    }
    if (apply && dirty) { inst.markModified('steps'); await inst.save(); }
  }

  // Blank/FRW cleanup to canonical RWF label (label-only, amounts untouched)
  if (apply) {
    await Prospect.updateMany({ estimatedMatterCurrency: { $in: ['FRW', '', null] } }, { $set: { estimatedMatterCurrency: 'RWF' } });
    await Case.updateMany({ 'workflowProgress.plannedValue.currency': { $in: ['FRW', '', null] } }, { $set: { 'workflowProgress.plannedValue.currency': 'RWF' } });
    await Case.updateMany({ 'workflowProgress.completedValue.currency': { $in: ['FRW', '', null] } }, { $set: { 'workflowProgress.completedValue.currency': 'RWF' } });
    await Case.updateMany({ 'billingSettings.currency': { $in: ['FRW', '', null] } }, { $set: { 'billingSettings.currency': 'RWF' } });
    await PettyCashFund.updateMany({ currency: { $in: ['FRW', '', null] } }, { $set: { currency: 'RWF' } });
  }

  if (!changed.length) console.log('OK: no non-RWF currency labels found. Nothing to change.');
  else {
    console.log(`${apply ? 'NORMALISED' : 'WOULD NORMALISE'} ${changed.length} label(s) — amounts unchanged:\n`);
    changed.forEach((c) => console.log(`- ${c}`));
    if (!apply) console.log('\nRe-run with --apply to write label-only changes.');
  }

  await mongoose.disconnect();
};

run().catch((e) => { console.error(e); process.exit(1); });
