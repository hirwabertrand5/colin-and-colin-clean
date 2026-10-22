import { Response } from 'express';

import { AuthRequest } from '../middleware/authMiddleware';
import Case from '../models/caseModel';
import Invoice from '../models/invoiceModel';
import PettyCashExpense from '../models/pettyCashExpenseModel';
import { getContractValue, getDirectMatterCost } from '../utils/financialMetrics';
import { resolveOptionalReportRange } from '../utils/reportRange';

type MatterFinancials = {
  id: string;
  matterNo: string;
  client: string;
  practiceArea: string;
  status: string;
  contractValue: number;
  billed: number;
  collected: number;
  outstanding: number;
  directMatterCosts: number;
};

const roundMoney = (value: number) => Math.round((Number(value) || 0) * 100) / 100;
const percent = (numerator: number, denominator: number) =>
  denominator > 0 ? roundMoney((numerator / denominator) * 100) : null;
const normaliseName = (value: unknown) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const day = (value: unknown) =>
  value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value || '').slice(0, 10);
const isOpenMatter = (status: unknown) => !['closed', 'completed', 'cancelled'].includes(normaliseName(status));

const practiceAreaOf = (matter: any) => {
  const path = Array.isArray(matter?.legalServicePath) ? matter.legalServicePath : [];
  // The first service-path segment is the firm's designated practice area.
  // We do not fall back to a generic case type, because that would falsely
  // classify a matter into a practice area it has not been assigned to.
  return String(path[0]?.label || 'Unclassified').trim() || 'Unclassified';
};

const clientOf = (matter: any) =>
  String(matter?.parties || matter?.clientName || matter?.caseNo || 'Unassigned client').trim() || 'Unassigned client';

const withinDateRange = (value: unknown, from: string | null, to: string | null) => {
  if (!from || !to) return true;
  const valueDay = day(value);
  return Boolean(valueDay && valueDay >= from && valueDay <= to);
};

const invoicePaymentDate = (invoice: any) => invoice?.updatedAt || null;

const emptyRollup = (label: string) => ({
  label,
  matterCount: 0,
  activeMatters: 0,
  contractValue: 0,
  billed: 0,
  collected: 0,
  outstanding: 0,
  directMatterCosts: 0,
});

/**
 * A focused profitability read-model.
 *
 * This deliberately reads the same authoritative Case, Invoice and Petty Cash
 * records as the rest of the product. Staff dashboard KPIs use the established
 * Firm Reports read-model so their values remain consistent with staff views.
 */
export const getProfitabilityReport = async (req: AuthRequest, res: Response) => {
  try {
    const range = resolveOptionalReportRange(req.query as Record<string, unknown>);
    if (range && 'error' in range) return res.status(400).json({ message: range.error });

    const from = range?.fromISO || null;
    const to = range?.toISO || null;
    const invoiceQuery: Record<string, unknown> = to ? { date: { $lte: to } } : {};
    const expenseQuery: Record<string, unknown> = from && to ? { date: { $gte: from, $lte: to } } : {};

    // The prior profitability screen made a broad finance request, then a
    // second full Firm Reports request. These small projections are fetched in
    // parallel and are the only records this page needs. Staff KPIs load only
    // when their dedicated tab is opened, from the shared dashboard source.
    const [matters, invoices, expenses] = await Promise.all([
      Case.find({})
        .select('_id caseNo parties status assignedTo legalServicePath budget workflowProgress billingSettings')
        .lean(),
      Invoice.find(invoiceQuery)
        .select('caseId invoiceNo date amount status updatedAt')
        .lean(),
      PettyCashExpense.find(expenseQuery)
        .select('caseId date amount refundAmount chargeType')
        .lean(),
    ]);

    const financialsByMatter = new Map<string, MatterFinancials>();
    for (const matter of matters as any[]) {
      const id = String(matter._id);
      financialsByMatter.set(id, {
        id,
        matterNo: String(matter.caseNo || 'Unnumbered matter'),
        client: clientOf(matter),
        practiceArea: practiceAreaOf(matter),
        status: String(matter.status || 'Open'),
        contractValue: roundMoney(getContractValue(matter)),
        billed: 0,
        collected: 0,
        outstanding: 0,
        directMatterCosts: 0,
      });
    }

    let totalBilled = 0;
    let recognisedCollectedRevenue = 0;
    let totalReceivables = 0;
    const ageing = { current: 0, days31to60: 0, days61to90: 0, over90: 0 };
    const referenceDate = range?.to || new Date();

    for (const invoice of invoices as any[]) {
      const amount = Math.max(0, Number(invoice.amount) || 0);
      const matter = financialsByMatter.get(String(invoice.caseId || ''));
      const issuedInRange = withinDateRange(invoice.date, from, to);
      const paymentInRange = invoice.status === 'Paid' && withinDateRange(invoicePaymentDate(invoice), from, to);
      const isOpenReceivable = invoice.status !== 'Paid' && (!to || day(invoice.date) <= to);

      if (issuedInRange) {
        totalBilled += amount;
        if (matter) matter.billed += amount;
      }
      if (paymentInRange) {
        recognisedCollectedRevenue += amount;
        if (matter) matter.collected += amount;
      }
      if (isOpenReceivable) {
        totalReceivables += amount;
        if (matter) matter.outstanding += amount;
        const issued = new Date(`${day(invoice.date)}T00:00:00`);
        const age = Number.isFinite(issued.getTime())
          ? Math.max(0, Math.floor((referenceDate.getTime() - issued.getTime()) / 86_400_000))
          : 0;
        if (age <= 30) ageing.current += amount;
        else if (age <= 60) ageing.days31to60 += amount;
        else if (age <= 90) ageing.days61to90 += amount;
        else ageing.over90 += amount;
      }
    }

    let directMatterCosts = 0;
    let generalOverheads = 0;
    for (const expense of expenses as any[]) {
      const cost = getDirectMatterCost(expense);
      if (expense.chargeType === 'client' && expense.caseId) {
        directMatterCosts += cost;
        const matter = financialsByMatter.get(String(expense.caseId));
        if (matter) matter.directMatterCosts += cost;
      } else {
        generalOverheads += cost;
      }
    }

    const matterRows = Array.from(financialsByMatter.values())
      .map((row) => {
        const grossContribution = row.collected - row.directMatterCosts;
        return {
          ...row,
          contractValue: roundMoney(row.contractValue),
          billed: roundMoney(row.billed),
          collected: roundMoney(row.collected),
          outstanding: roundMoney(row.outstanding),
          directMatterCosts: roundMoney(row.directMatterCosts),
          grossContribution: roundMoney(grossContribution),
          contributionMargin: percent(grossContribution, row.collected),
          costRatio: percent(row.directMatterCosts, row.collected),
          allocatedStaffCosts: null,
          allocatedOverhead: null,
          netContribution: null,
        };
      })
      .sort((a, b) => b.grossContribution - a.grossContribution || a.matterNo.localeCompare(b.matterNo));

    const rollup = (keyOf: (row: (typeof matterRows)[number]) => string) => {
      const rows = new Map<string, ReturnType<typeof emptyRollup>>();
      for (const matter of matterRows) {
        const label = keyOf(matter);
        const current = rows.get(label) || emptyRollup(label);
        current.matterCount += 1;
        if (isOpenMatter(matter.status)) current.activeMatters += 1;
        current.contractValue += matter.contractValue;
        current.billed += matter.billed;
        current.collected += matter.collected;
        current.outstanding += matter.outstanding;
        current.directMatterCosts += matter.directMatterCosts;
        rows.set(label, current);
      }
      return Array.from(rows.values())
        .map((row) => {
          const grossContribution = row.collected - row.directMatterCosts;
          return {
            ...row,
            contractValue: roundMoney(row.contractValue),
            billed: roundMoney(row.billed),
            collected: roundMoney(row.collected),
            outstanding: roundMoney(row.outstanding),
            directMatterCosts: roundMoney(row.directMatterCosts),
            grossContribution: roundMoney(grossContribution),
            contributionMargin: percent(grossContribution, row.collected),
            allocatedStaffCosts: null,
            allocatedOverhead: null,
            netContribution: null,
          };
        })
        .sort((a, b) => b.grossContribution - a.grossContribution || a.label.localeCompare(b.label));
    };

    const totalContractValue = matterRows.reduce((sum, row) => sum + row.contractValue, 0);
    const activeMatters = matterRows.filter((row) => isOpenMatter(row.status)).length;
    const grossContribution = recognisedCollectedRevenue - directMatterCosts;
    const totalFirmCosts = directMatterCosts + generalOverheads;
    const netProfit = recognisedCollectedRevenue - totalFirmCosts;

    return res.json({
      range: range
        ? { from: range.displayFrom, to: range.displayTo, label: range.label }
        : { from: null, to: null, label: 'All time' },
      currency: 'RWF',
      dataAvailability: {
        taskFeeRecognition: false,
        staffCostRegister: false,
        allocatedOverhead: false,
        taxAndNonOperatingItems: false,
        paymentStatusHistory: false,
      },
      firm: {
        activeMatters,
        contractValue: roundMoney(totalContractValue),
        billed: roundMoney(totalBilled),
        recognisedCollectedRevenue: roundMoney(recognisedCollectedRevenue),
        totalReceivables: roundMoney(totalReceivables),
        directMatterCosts: roundMoney(directMatterCosts),
        generalOverheads: roundMoney(generalOverheads),
        totalFirmCosts: roundMoney(totalFirmCosts),
        grossContribution: roundMoney(grossContribution),
        grossMargin: percent(grossContribution, recognisedCollectedRevenue),
        netProfit: roundMoney(netProfit),
        netProfitMargin: percent(netProfit, recognisedCollectedRevenue),
        costRatio: percent(totalFirmCosts, recognisedCollectedRevenue),
        collectionRate: percent(recognisedCollectedRevenue, totalBilled),
      },
      ageing: Object.fromEntries(Object.entries(ageing).map(([key, value]) => [key, roundMoney(value)])),
      matterRows,
      clientRows: rollup((row) => row.client),
      practiceAreaRows: rollup((row) => row.practiceArea),
    });
  } catch (error: any) {
    return res.status(500).json({ message: error?.message || 'Failed to load profitability report.' });
  }
};
