/** Read-only report audit. Never initializes indexes, seeds data or starts the app. */
import path from 'node:path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { setServers } from 'node:dns';
import User from '../src/models/userModel';
import { getStaffDashboardSummary } from '../src/controllers/dashboardController';
import { getFirmReports, getMyProductivityEarningsReport } from '../src/controllers/firmReportsController';

async function main() {
  dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
  const [name, from, to] = process.argv.slice(2);
  if (!name || !from || !to) throw new Error('Usage: auditProductivityFees.ts staff-name YYYY-MM-DD YYYY-MM-DD');
  if (!process.env.MONGO_URI) throw new Error('Database connection is not configured.');
  setServers(['8.8.8.8', '1.1.1.1']);
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000, compressors: ['zlib'] });
  try {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const users = await User.find({ name: new RegExp(`^${escaped}(\\s.+)?$`, 'i') }).select('name role email').lean();
    if (users.length !== 1) throw new Error(`Staff match is ambiguous or absent (${users.length} matches).`);
    const user = users[0]!;
    const query = { range: 'custom', from, to };
    const read = async (handler: any, actor = user, reportQuery: any = query) => {
      let status = 200, body: any;
      await handler({ user: { id: String(actor._id), name: actor.name, email: actor.email, role: actor.role }, query: reportQuery }, {
        status(code: number) { status = code; return this; }, json(value: any) { body = value; return value; },
      });
      if (status !== 200) throw new Error(`Report returned status ${status}.`);
      return body;
    };
    const [dashboard, report] = await Promise.all([read(getStaffDashboardSummary), read(getMyProductivityEarningsReport)]);
    const manager = await User.findOne({ role: 'managing_director' }).select('name role email').lean();
    const management = manager ? await read(getFirmReports, manager, { ...query, teamMemberId: String(user._id) }) : null;
    const grouped = new Map<string, any>();
    for (const row of report.productivityRows || []) {
      const group = grouped.get(row.caseId) || { matter: row.matter, completedWorkValue: 0, contributionRecords: 0 };
      group.completedWorkValue += row.feeEarned || 0; group.contributionRecords++;
      grouped.set(row.caseId, group);
    }
    const paymentByCase = new Map((dashboard.rows || []).map((row: any) => [row.caseId, row.earnedFeeInPeriod]));
    console.log(JSON.stringify({
      staff: user.name, range: report.range,
      dashboardFees: dashboard.period?.feesEarned,
      reportFees: report.productivitySummary?.totalFeeEarned,
      managementReportFees: management?.productivitySummary?.totalFeeEarned,
      earningDetailTotal: Math.round((report.productivityEarningsRows || []).reduce((sum: number, row: any) => sum + (row.feeEarned || 0), 0) * 100) / 100,
      managementEarningDetailTotal: management ? Math.round((management.productivityEarningsRows || []).reduce((sum: number, row: any) => sum + (row.feeEarned || 0), 0) * 100) / 100 : null,
      completedWorkValue: report.productivitySummary?.completedWorkFeeValue ?? report.productivitySummary?.totalFeeEarned,
      reportPaymentComparison: report.productivityReconciliation?.selectedPeriod?.feesEarned,
      contributionRecords: report.productivityRows?.length,
      earningsRecords: report.productivityEarningsRows?.length,
      matters: [...grouped].map(([caseId, group]) => ({ ...group,
        completedWorkValue: Math.round(group.completedWorkValue * 100) / 100,
        paymentPeriodFee: paymentByCase.get(caseId) ?? null,
      })),
    }, null, 2));
  } finally { await mongoose.disconnect(); }
}
main().catch(error => {
  const message = String(error?.message || error?.name || 'Unknown error').replace(/mongodb(?:\+srv)?:\/\/\S+/g, '[database connection]');
  console.error(message); process.exitCode = 1;
});
