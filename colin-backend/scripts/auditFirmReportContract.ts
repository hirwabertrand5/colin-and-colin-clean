/** Read-only comparison of source and deployed report contracts; no tokens are printed. */
import path from 'node:path';
import fs from 'node:fs';
import { setServers } from 'node:dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import User from '../src/models/userModel';
import { getFirmReports } from '../src/controllers/firmReportsController';

const summarize = (body: any) => ({
  range: body.range, summary: body.productivitySummary,
  completionRows: body.productivityRows?.length,
  earningRows: body.productivityEarningsRows?.length,
  hasReconciliation: Object.hasOwn(body, 'productivityReconciliation'),
  reconciliationFees: body.productivityReconciliation?.selectedPeriod?.feesEarned,
  earningRowsTotal: body.productivityEarningsRows ? Math.round(body.productivityEarningsRows.reduce((sum: number, row: any) => sum + (row.feeEarned || 0), 0) * 100) / 100 : null,
});

async function main() {
  dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
  setServers(['8.8.8.8', '1.1.1.1']);
  await mongoose.connect(process.env.MONGO_URI!, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000, compressors: ['zlib'] });
  try {
    const actor = await User.findOne({ role: 'managing_director', isActive: { $ne: false } }).select('name email role').lean();
    if (!actor) throw new Error('No active management account.');
    const query = { range: 'custom', from: '2026-01-01', to: '2026-11-18', basis: 'invoiceDate' };
    const req: any = { user: { id: String(actor._id), name: actor.name, email: actor.email, role: actor.role }, query };
    let status = 200, body: any;
    await getFirmReports(req, { status(code: number) { status = code; return this; }, json(value: any) { body = value; return value; } } as any);
    if (status !== 200) throw new Error(`Source report returned ${status}.`);
    console.log(JSON.stringify({ source: summarize(body) }));
    if (process.argv.includes('--remote')) {
      const configured = fs.readFileSync(path.resolve(__dirname, '../../.env.production'), 'utf8').match(/^VITE_API_URL=(.*)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
      if (!configured || !process.env.JWT_SECRET) throw new Error('Remote audit configuration missing.');
      const response = await fetch(`${configured}/reports/firm?${new URLSearchParams(query)}`, {
        headers: { Authorization: `Bearer ${jwt.sign({ id: String(actor._id) }, process.env.JWT_SECRET, { expiresIn: '2m' })}` },
        signal: AbortSignal.timeout(120000),
      });
      if (!response.ok) { console.log(JSON.stringify({ deployedStatus: response.status })); return; }
      console.log(JSON.stringify({ deployed: summarize(await response.json()) }));
    }
  } finally { await mongoose.disconnect(); }
}
main().catch(error => {
  console.error(String(error?.message || 'Report audit failed').replace(/mongodb(?:\+srv)?:\/\/\S+/g, '[database connection]'));
  process.exitCode = 1;
});
