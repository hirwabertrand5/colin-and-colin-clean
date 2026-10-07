/**
 * RWF-only currency audit (read-only).
 *
 * Scans live collections for any currency code that is not RWF/FRW/blank
 * and prints a per-record report WITHOUT changing any values, so finance
 * can apply exchange rates manually.
 *
 * Usage:
 *   cd colin-backend
 *   npx tsx src/scripts/auditRwfCurrency.ts
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

const isNonRwf = (v: unknown) => {
  const s = String(v ?? '').trim().toUpperCase();
  if (!s) return false;
  return s !== 'RWF' && s !== 'FRW';
};

const run = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set.');
  await mongoose.connect(uri);
  console.log('Connected. Auditing currency codes (values are NOT modified)...\n');

  const findings: Array<{ collection: string; id: string; label: string; field: string; currency: string; amount?: unknown }> = [];

  const prospects = await Prospect.find({}).select('_id prospectNo clientName estimatedMatterValue estimatedFeeValue estimatedMatterCurrency').lean();
  for (const p of prospects as any[]) {
    if (isNonRwf(p.estimatedMatterCurrency)) {
      findings.push({
        collection: 'prospects',
        id: String(p._id),
        label: `${p.prospectNo || ''} ${p.clientName || ''}`.trim(),
        field: 'estimatedMatterCurrency',
        currency: String(p.estimatedMatterCurrency),
        amount: p.estimatedMatterValue ?? p.estimatedFeeValue,
      });
    }
  }

  const cases = await Case.find({}).select('_id caseNo parties budget workflowProgress billingSettings').lean();
  for (const c of cases as any[]) {
    const pv = c?.workflowProgress?.plannedValue?.currency;
    const cv = c?.workflowProgress?.completedValue?.currency;
    const bc = c?.billingSettings?.currency;
    if (isNonRwf(pv)) findings.push({ collection: 'cases', id: String(c._id), label: `${c.caseNo || ''} ${c.parties || ''}`.trim(), field: 'workflowProgress.plannedValue.currency', currency: String(pv), amount: c?.workflowProgress?.plannedValue?.amount ?? c?.budget });
    if (isNonRwf(cv)) findings.push({ collection: 'cases', id: String(c._id), label: `${c.caseNo || ''} ${c.parties || ''}`.trim(), field: 'workflowProgress.completedValue.currency', currency: String(cv), amount: c?.workflowProgress?.completedValue?.amount });
    if (isNonRwf(bc)) findings.push({ collection: 'cases', id: String(c._id), label: `${c.caseNo || ''} ${c.parties || ''}`.trim(), field: 'billingSettings.currency', currency: String(bc), amount: c?.workflowProgress?.plannedValue?.amount ?? c?.budget });
  }

  const funds = await PettyCashFund.find({}).select('_id name currency initialAmount').lean();
  for (const f of funds as any[]) {
    if (isNonRwf(f.currency)) findings.push({ collection: 'pettycashfunds', id: String(f._id), label: String(f.name || ''), field: 'currency', currency: String(f.currency), amount: f.initialAmount });
  }

  const templates = await WorkflowTemplate.find({}).select('_id name matterType stages steps').lean();
  for (const t of templates as any[]) {
    for (const s of [...(t.stages || []), ...(t.steps || [])]) {
      if (s?.fee && isNonRwf(s.fee.currency)) {
        findings.push({ collection: 'workflowtemplates', id: String(t._id), label: `${t.name || ''} / ${s.key || s.title || ''}`, field: 'fee.currency', currency: String(s.fee.currency), amount: s.fee.min ?? s.fee.max });
      }
    }
  }

  const instances = await WorkflowInstance.find({}).select('_id caseId steps').lean();
  for (const inst of instances as any[]) {
    for (const s of inst.steps || []) {
      if (isNonRwf(s?.feeCurrency)) {
        findings.push({ collection: 'workflowinstances', id: String(inst._id), label: `case ${String(inst.caseId)} / ${s.stepKey || s.title || ''}`, field: 'steps.feeCurrency', currency: String(s.feeCurrency), amount: s.feeAmount ?? s.feeRangeMin });
      }
    }
  }

  if (!findings.length) {
    console.log('OK: no non-RWF currency codes found. Nothing to convert.');
  } else {
    console.log(`FOUND ${findings.length} non-RWF currency label(s). Values unchanged — apply exchange rates manually:\n`);
    for (const f of findings) {
      console.log(`- [${f.collection}] ${f.label || f.id} | ${f.field} = ${f.currency} | amount = ${String(f.amount ?? '(none)')} | _id = ${f.id}`);
    }
    console.log('\nTo normalise labels to RWF without changing amounts, run: npx tsx src/scripts/normalizeRwfCurrency.ts --apply');
  }

  await mongoose.disconnect();
};

run().catch((e) => { console.error(e); process.exit(1); });
