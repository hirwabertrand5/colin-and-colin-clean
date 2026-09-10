import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  FileText,
  Receipt,
  WalletCards,
} from "lucide-react";

import { UserRole } from "../../App";
import {
  getBillingSummary,
  BillingSummary,
} from "../../services/billingService";
import { InvoiceWithCase, listInvoices } from "../../services/invoiceService";
import { getAllCases, CaseData } from "../../services/caseService";
import {
  listExpensesForFund,
  listPettyCashFunds,
  PettyCashExpense,
} from "../../services/pettyCashService";
import {
  FirmReportRange,
  FirmReportResponse,
  getFirmReports,
} from "../../services/firmReportsService";
import {
  LEGAL_SERVICES_TREE,
  ServiceNode,
} from "../../constants/legalServicesTree";

export type BillingFinanceView =
  | "financial-dashboard"
  | "invoicing"
  | "collections"
  | "profitability"
  | "cash-flow"
  | "expenses"
  | "remuneration"
  | "contract-value"
  | "total-billed"
  | "total-collected"
  | "outstanding"
  | "direct-matter-costs"
  | "gross-profit"
  | "gross-profit-margin"
  | "operating-expenses"
  | "net-profit"
  | "net-profit-margin"
  | "all-invoices"
  | "draft"
  | "issued"
  | "paid"
  | "pending"
  | "overdue"
  | "invoice-count"
  | "invoice-total-billed"
  | "recent-invoices"
  | "billing-triggers"
  | "collections-outstanding"
  | "collections-overdue"
  | "collection-rate"
  | "debtor-ageing"
  | "payment-follow-up"
  | "collection-triggers"
  | "firm-profitability"
  | "department-profitability"
  | "matter-profitability"
  | "client-profitability"
  | "staff-profitability"
  | "cash-position"
  | "cash-inflows"
  | "cash-outflows"
  | "cash-forecast"
  | "expense-direct-costs"
  | "expense-operating"
  | "procurement"
  | "fee-earned"
  | "accrued"
  | "payable"
  | "deferred"
  | "remuneration-paid"
  | "by-role"
  | "by-staff"
  | "by-matter";

const managementRoles: UserRole[] = [
  "managing_director",
  "managing_partner",
  "executive_managing_partner",
];
const titles: Record<BillingFinanceView, string> = {
  "financial-dashboard": "Financial Dashboard",
  invoicing: "Billing & Invoicing",
  collections: "Collections & Receivables",
  profitability: "Profitability",
  "cash-flow": "Cash & Cash Flow",
  expenses: "Expenses & Procurement",
  remuneration: "Firm Remuneration",
  "contract-value": "Total Contract Value",
  "total-billed": "Total Billed",
  "total-collected": "Total Collected",
  outstanding: "Outstanding",
  "direct-matter-costs": "Direct Matter Costs",
  "gross-profit": "Gross Profit",
  "gross-profit-margin": "Gross Profit Margin",
  "operating-expenses": "Firm Operating Expenses",
  "net-profit": "Net Profit",
  "net-profit-margin": "Net Profit Margin",
  "all-invoices": "All Invoices",
  draft: "Draft",
  issued: "Issued",
  paid: "Paid",
  pending: "Pending",
  overdue: "Overdue",
  "invoice-count": "No. of Invoices",
  "invoice-total-billed": "Total Billed",
  "recent-invoices": "Recent Invoices",
  "billing-triggers": "Billing Triggers",
  "collections-outstanding": "Outstanding",
  "collections-overdue": "Overdue",
  "collection-rate": "Collection Rate",
  "debtor-ageing": "Debtor Ageing",
  "payment-follow-up": "Payment Follow-Up",
  "collection-triggers": "Collection Triggers",
  "firm-profitability": "Firm Profitability",
  "department-profitability": "Department Profitability",
  "matter-profitability": "Matter Profitability",
  "client-profitability": "Client Profitability",
  "staff-profitability": "Staff Profitability",
  "cash-position": "Cash Position",
  "cash-inflows": "Cash Inflows",
  "cash-outflows": "Cash Outflows",
  "cash-forecast": "Cash Forecast",
  "expense-direct-costs": "Direct Matter Costs",
  "expense-operating": "Operating Expenses",
  procurement: "Procurement",
  "fee-earned": "Fee Earned",
  accrued: "Accrued",
  payable: "Payable",
  deferred: "Deferred",
  "remuneration-paid": "Paid",
  "by-role": "By Role",
  "by-staff": "By Staff",
  "by-matter": "By Matter",
};

const money = (value: number) =>
  `RWF ${Math.round(Number.isFinite(value) ? value : 0).toLocaleString("en-US")}`;
const amount = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : Number(String(value || "").replace(/[^\d.-]/g, "")) || 0;
const dayKey = (value?: string) => (value ? value.slice(0, 10) : "");
const today = () => dayKey(new Date().toISOString());
const isOverdue = (invoice: InvoiceWithCase) =>
  Boolean(invoice.date && invoice.status !== "Paid" && invoice.date < today());
const isWithinRange = (value: string | undefined, from: string, to: string) =>
  Boolean(value && value.slice(0, 10) >= from && value.slice(0, 10) <= to);

const SERVICE_LEVEL_LABELS = [
  "Legal Service",
  "Category",
  "Practice Area",
  "Service Line",
  "Sub-category",
  "Detail",
];

const findServiceNode = (nodes: ServiceNode[], id: string) =>
  nodes.find((node) => node.id === id);

const getServiceLevels = (path: string[]) => {
  const levels: Array<{
    label: string;
    options: ServiceNode[];
    value: string;
  }> = [];
  let options = LEGAL_SERVICES_TREE;
  let depth = 0;

  while (options.length > 0) {
    levels.push({
      label: SERVICE_LEVEL_LABELS[depth] || `Level ${depth + 1}`,
      options,
      value: path[depth] || "",
    });
    const selected = path[depth]
      ? findServiceNode(options, path[depth])
      : undefined;
    if (!selected?.children?.length) break;
    options = selected.children;
    depth += 1;
  }

  return levels;
};

const caseMatchesServicePath = (matter: CaseData, selectedPath: string[]) => {
  if (!selectedPath.length) return true;
  const matterPath = (matter.legalServicePath || []).map((item) => item.id);
  return selectedPath.every((id, index) => matterPath[index] === id);
};

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs uppercase tracking-[0.16em] text-gray-500">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold text-gray-900">{value}</div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-56 animate-pulse rounded bg-gray-200" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-24 animate-pulse rounded-lg border border-gray-200 bg-white"
          />
        ))}
      </div>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white p-4">
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="flex gap-3">
              <div className="h-9 w-10 animate-pulse rounded bg-gray-200" />
              <div className="h-9 flex-1 animate-pulse rounded bg-gray-200" />
              <div className="hidden h-9 w-32 animate-pulse rounded bg-gray-200 md:block" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Pagination({
  page,
  pages,
  total,
  onChange,
}: {
  page: number;
  pages: number;
  total: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-5 py-4 text-sm text-gray-600">
      <span>
        Showing {(page - 1) * 10 + 1}–{Math.min(page * 10, total)} of {total}
      </span>
      <div className="flex gap-1">
        <button
          type="button"
          disabled={page === 1}
          onClick={() => onChange(page - 1)}
          className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-40"
        >
          Previous
        </button>
        {Array.from({ length: pages }, (_, index) => index + 1).map(
          (number) => (
            <button
              type="button"
              key={number}
              onClick={() => onChange(number)}
              className={`rounded border px-3 py-1.5 ${number === page ? "border-gray-800 bg-gray-800 text-white" : "border-gray-300 bg-white"}`}
            >
              {number}
            </button>
          ),
        )}
        <button
          type="button"
          disabled={page === pages}
          onClick={() => onChange(page + 1)}
          className="rounded border border-gray-300 px-3 py-1.5 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

export default function BillingFinancePage({
  view,
  userRole,
}: {
  view: BillingFinanceView;
  userRole: UserRole;
}) {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [invoices, setInvoices] = useState<InvoiceWithCase[]>([]);
  const [cases, setCases] = useState<CaseData[]>([]);
  const [expenses, setExpenses] = useState<PettyCashExpense[]>([]);
  const [report, setReport] = useState<FirmReportResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dateRange, setDateRange] = useState<FirmReportRange>("ytd");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(
    null,
  );
  const [classificationPath, setClassificationPath] = useState<string[]>([]);
  const permitted = managementRoles.includes(userRole);
  const title = titles[view];

  useEffect(() => {
    if (!permitted) return;
    if (dateRange === "custom" && (!customFrom || !customTo)) {
      setLoading(false);
      setPeriod(null);
      return;
    }
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const firmReport = await getFirmReports({
          range: dateRange,
          from: dateRange === "custom" ? customFrom : undefined,
          to: dateRange === "custom" ? customTo : undefined,
          basis: "invoiceDate",
        });
        const { from, to } = firmReport.range;
        const [billing, invoiceData, caseData, funds] = await Promise.all([
          getBillingSummary({ from, to }),
          listInvoices({ from, to }),
          getAllCases(),
          listPettyCashFunds().catch(() => []),
        ]);
        const expenseData = (
          await Promise.all(
            funds.map((fund) => listExpensesForFund(fund._id).catch(() => [])),
          )
        ).flat();
        if (!mounted) return;
        setSummary(billing);
        setInvoices(invoiceData);
        setCases(
          caseData.filter((matter) =>
            isWithinRange(matter.updatedAt || matter.createdAt, from, to),
          ),
        );
        setExpenses(
          expenseData.filter((expense) =>
            isWithinRange(expense.date, from, to),
          ),
        );
        setReport(firmReport);
        setPeriod({ from, to });
      } catch (loadError: any) {
        if (mounted)
          setError(loadError?.message || "Failed to load finance data.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [permitted, dateRange, customFrom, customTo]);

  const filteredCases = useMemo(
    () =>
      cases.filter((matter) =>
        caseMatchesServicePath(matter, classificationPath),
      ),
    [cases, classificationPath],
  );
  const filteredCaseIds = useMemo(
    () => new Set(filteredCases.map((matter) => String(matter._id))),
    [filteredCases],
  );
  const classificationInvoices = useMemo(
    () =>
      invoices.filter((invoice) => filteredCaseIds.has(String(invoice.caseId))),
    [filteredCaseIds, invoices],
  );
  const classificationExpenses = useMemo(
    () =>
      expenses.filter(
        (expense) =>
          !classificationPath.length ||
          (expense.caseId && filteredCaseIds.has(String(expense.caseId))),
      ),
    [classificationPath, expenses, filteredCaseIds],
  );
  const filteredInvoices = useMemo(() => {
    if (view === "paid")
      return classificationInvoices.filter(
        (invoice) => invoice.status === "Paid",
      );
    if (view === "pending" || view === "issued")
      return classificationInvoices.filter(
        (invoice) => invoice.status === "Pending",
      );
    if (view === "overdue") return classificationInvoices.filter(isOverdue);
    if (view === "recent-invoices")
      return [...classificationInvoices]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 10);
    return classificationInvoices;
  }, [classificationInvoices, view]);
  const pages = Math.max(1, Math.ceil(filteredInvoices.length / 10));
  const visibleInvoices = filteredInvoices.slice((page - 1) * 10, page * 10);
  useEffect(() => setPage(1), [classificationPath, view]);
  useEffect(
    () => setPage((currentPage) => Math.min(currentPage, pages)),
    [pages],
  );

  const directCosts = classificationExpenses
    .filter((expense) => expense.chargeType === "client")
    .reduce(
      (sum, expense) =>
        sum +
        Math.max(0, amount(expense.amount) - amount(expense.refundAmount)),
      0,
    );
  const operatingExpenses = classificationExpenses
    .filter((expense) => expense.chargeType !== "client")
    .reduce(
      (sum, expense) =>
        sum +
        Math.max(0, amount(expense.amount) - amount(expense.refundAmount)),
      0,
    );
  const billed = classificationInvoices.reduce(
    (sum, invoice) => sum + amount(invoice.amount),
    0,
  );
  const collected = classificationInvoices
    .filter((invoice) => invoice.status === "Paid")
    .reduce((sum, invoice) => sum + amount(invoice.amount), 0);
  const revenue = collected;
  const grossProfit = revenue - directCosts;
  const netProfit = grossProfit - operatingExpenses;
  const outstanding = Math.max(0, billed - collected);
  const margin = revenue > 0 ? (grossProfit / revenue) * 100 : null;
  const netMargin = revenue > 0 ? (netProfit / revenue) * 100 : null;
  const contractValue = filteredCases.reduce(
    (sum, matter) =>
      sum +
      Math.max(
        amount(matter.workflowProgress?.plannedValue?.amount),
        amount(matter.budget),
      ),
    0,
  );
  const activeMatterCount = filteredCases.length;
  const billedIssuedInvoices = classificationInvoices.filter(
    (invoice) =>
      invoice.status === "Issued" ||
      invoice.status === "Paid" ||
      invoice.status === "Pending",
  );
  const issuedCount = billedIssuedInvoices.length;
  const draftedCount = classificationInvoices.filter(
    (invoice) => invoice.status === "Draft",
  ).length;
  const paidCount = classificationInvoices.filter(
    (invoice) => invoice.status === "Paid",
  ).length;
  const pendingCount = classificationInvoices.filter(
    (invoice) => invoice.status === "Pending",
  ).length;
  const overdueCount = classificationInvoices.filter(isOverdue).length;
  const invoiceOutstanding = Math.max(0, billed - collected);
  const billingCompletionRate =
    issuedCount + pendingCount > 0
      ? ((issuedCount + pendingCount) /
          Math.max(1, issuedCount + pendingCount + draftedCount)) *
        100
      : 0;
  const collectionRate = billed > 0 ? (collected / billed) * 100 : 0;
  const avgRevenuePerMatter =
    activeMatterCount > 0 ? revenue / activeMatterCount : 0;
  const avgInvoiceValue = issuedCount > 0 ? billed / issuedCount : 0;
  const currentMetric =
    view === "financial-dashboard"
      ? money(contractValue)
      : view === "invoicing"
        ? money(billed)
        : view === "collections"
          ? money(outstanding)
          : view === "profitability"
            ? money(grossProfit)
            : view === "cash-flow"
              ? money(collected)
              : view === "expenses"
                ? money(directCosts + operatingExpenses)
                : view === "remuneration"
                  ? money(0)
                  : view === "contract-value"
                    ? money(contractValue)
                    : view === "total-billed" || view === "invoice-total-billed"
                      ? money(billed)
                      : view === "total-collected"
                        ? money(collected)
                        : view === "outstanding" ||
                            view === "collections-outstanding"
                          ? money(outstanding)
                          : view === "direct-matter-costs" ||
                              view === "expense-direct-costs"
                            ? money(directCosts)
                            : view === "gross-profit"
                              ? money(grossProfit)
                              : view === "gross-profit-margin"
                                ? margin === null
                                  ? "—"
                                  : `${Math.round(margin)}%`
                                : view === "operating-expenses" ||
                                    view === "expense-operating"
                                  ? money(operatingExpenses)
                                  : view === "net-profit"
                                    ? money(netProfit)
                                    : view === "net-profit-margin"
                                      ? netMargin === null
                                        ? "—"
                                        : `${Math.round(netMargin)}%`
                                      : view === "cash-inflows"
                                        ? money(collected)
                                        : view === "cash-outflows"
                                          ? money(
                                              directCosts + operatingExpenses,
                                            )
                                          : view === "collection-rate"
                                            ? billed > 0
                                              ? `${Math.round((collected / billed) * 100)}%`
                                              : "—"
                                            : view === "invoice-count" ||
                                                view === "all-invoices"
                                              ? String(classificationInvoices.length)
                                              : view === "paid"
                                                ? String(paidCount)
                                                : view === "overdue" ||
                                                    view ===
                                                      "collections-overdue"
                                                  ? String(overdueCount)
                                                  : view === "pending"
                                                    ? String(pendingCount)
                                                    : view === "issued"
                                                      ? String(issuedCount)
                                                      : view === "fee-earned"
                                                        ? money(
                                                            report
                                                              ?.productivitySummary
                                                              ?.totalFeeEarned ||
                                                              0,
                                                          )
                                                        : "—";

  const sectionMetrics: Record<
    BillingFinanceView,
    Array<{ label: string; value: string }>
  > = {
    "financial-dashboard": [
      { label: "Total Contract Value", value: money(contractValue) },
      { label: "Total Billed", value: money(billed) },
      { label: "Total Collected", value: money(collected) },
      { label: "Outstanding", value: money(outstanding) },
      { label: "Direct Matter Costs", value: money(directCosts) },
      { label: "Gross Profit", value: money(grossProfit) },
      {
        label: "Gross Profit Margin",
        value: margin === null ? "—" : `${Math.round(margin)}%`,
      },
      { label: "Firm Operating Expenses", value: money(operatingExpenses) },
      { label: "Net Profit", value: money(netProfit) },
      {
        label: "Net Profit Margin",
        value: netMargin === null ? "—" : `${Math.round(netMargin)}%`,
      },
      {
        label: "Collection Rate",
        value: billed > 0 ? `${Math.round(collectionRate)}%` : "—",
      },
      {
        label: "Average Revenue per Matter",
        value: money(avgRevenuePerMatter),
      },
    ],
    invoicing: [
      { label: "All Invoices", value: String(classificationInvoices.length) },
      { label: "Draft", value: String(draftedCount) },
      { label: "Issued", value: String(issuedCount) },
      { label: "Paid", value: String(paidCount) },
      { label: "Pending", value: String(pendingCount) },
      { label: "Overdue", value: String(overdueCount) },
      {
        label: "No. of Invoices",
        value: String(classificationInvoices.length),
      },
      { label: "Total Billed", value: money(billed) },
      { label: "Invoice Outstanding", value: money(invoiceOutstanding) },
      {
        label: "Billing Completion Rate",
        value: `${Math.round(billingCompletionRate)}%`,
      },
      { label: "Average Invoice Value", value: money(avgInvoiceValue) },
    ],
    collections: [
      { label: "Outstanding", value: money(outstanding) },
      { label: "Overdue", value: money(outstanding) },
      {
        label: "Collection Rate",
        value: billed > 0 ? `${Math.round(collectionRate)}%` : "—",
      },
      { label: "Current Receivables", value: money(outstanding) },
      { label: "1–30 Days", value: money(0) },
      { label: "31–60 Days", value: money(0) },
      { label: "61–90 Days", value: money(0) },
      { label: "91–120 Days", value: money(0) },
      { label: "120+ Days", value: money(0) },
      { label: "Average Debtor Age", value: "—" },
      {
        label: "Collection Effectiveness",
        value: billed > 0 ? `${Math.round(collectionRate)}%` : "—",
      },
      { label: "Bad / Doubtful Receivables", value: money(0) },
    ],
    profitability: [
      {
        label: "Firm Profitability",
        value: money(grossProfit - operatingExpenses),
      },
      { label: "Department Profitability", value: money(grossProfit) },
      { label: "Matter Profitability", value: money(grossProfit) },
      { label: "Client Profitability", value: money(grossProfit) },
      { label: "Staff Profitability", value: money(grossProfit) },
      {
        label: "Net Profit Margin",
        value: netMargin === null ? "—" : `${Math.round(netMargin)}%`,
      },
      {
        label: "Matter Profit Margin",
        value: margin === null ? "—" : `${Math.round(margin)}%`,
      },
      {
        label: "Client Profit Margin",
        value: margin === null ? "—" : `${Math.round(margin)}%`,
      },
    ],
    "cash-flow": [
      { label: "Cash Position", value: money(collected) },
      { label: "Cash Inflows", value: money(collected) },
      { label: "Cash Outflows", value: money(directCosts + operatingExpenses) },
      { label: "Cash Forecast", value: money(collected) },
      {
        label: "Net Cash Flow",
        value: money(collected - (directCosts + operatingExpenses)),
      },
      { label: "Closing Cash", value: money(collected) },
      { label: "Expected Collections", value: money(collected) },
      { label: "Forecast Variance", value: money(0) },
    ],
    expenses: [
      { label: "Expenses", value: money(directCosts + operatingExpenses) },
      { label: "Direct Matter Costs", value: money(directCosts) },
      { label: "Operating Expenses", value: money(operatingExpenses) },
      { label: "Procurement", value: String(classificationExpenses.length) },
      {
        label: "Total Expenses",
        value: money(directCosts + operatingExpenses),
      },
      {
        label: "Expense by Category",
        value: money(directCosts + operatingExpenses),
      },
      { label: "Expense by Matter", value: money(directCosts) },
      { label: "Budget Variance", value: money(0) },
      { label: "Procurement Variance", value: money(0) },
    ],
    remuneration: [
      { label: "Fee Earned", value: money(0) },
      { label: "Accrued", value: money(0) },
      { label: "Payable", value: money(0) },
      { label: "Deferred", value: money(0) },
      { label: "Paid", value: money(0) },
      { label: "By Role", value: money(0) },
      { label: "By Staff", value: money(0) },
      { label: "By Matter", value: money(0) },
    ],
  };

  if (!permitted)
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h1 className="text-xl font-semibold text-gray-900">Access denied</h1>
        <p className="mt-2 text-gray-600">
          You do not have permission to view Billing & Finance.
        </p>
      </div>
    );
  if (loading) return <LoadingSkeleton />;

  const sectionViewNames = new Set([
    "financial-dashboard",
    "invoicing",
    "collections",
    "profitability",
    "cash-flow",
    "expenses",
    "remuneration",
  ]);
  const isInvoiceView =
    view.includes("invoice") ||
    ["draft", "issued", "paid", "pending", "overdue", "total-billed"].includes(
      view,
    );
  const unsupportedViews: BillingFinanceView[] = [
    "draft",
    "issued",
    "accrued",
    "payable",
    "deferred",
    "remuneration-paid",
    "by-role",
    "by-matter",
    "department-profitability",
    "client-profitability",
    "cash-position",
    "cash-forecast",
    "procurement",
    "billing-triggers",
    "payment-follow-up",
    "collection-triggers",
  ];
  const hasSupportedTable =
    isInvoiceView ||
    [
      "financial-dashboard",
      "expenses",
      "expense-direct-costs",
      "expense-operating",
      "fee-earned",
      "by-staff",
      "contract-value",
      "total-collected",
      "matter-profitability",
      "staff-profitability",
    ].includes(view);
  const sectionMetricsToShow = sectionViewNames.has(view)
    ? sectionMetrics[view]
    : [];
  const summaryMetrics = sectionMetricsToShow.length
    ? sectionMetricsToShow
    : [
        { label: title, value: currentMetric },
        { label: "Total Billed", value: money(billed) },
        { label: "Total Collected", value: money(collected) },
        { label: "Outstanding", value: money(outstanding) },
      ];
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            to="/billing"
            className="mb-3 inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft size={16} /> Billing & Finance
          </Link>
          <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
          <p className="mt-1 text-gray-600">
            {period
              ? `Period: ${period.from} → ${period.to}`
              : "Select a reporting period."}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <span className="w-full text-sm text-gray-700">
              Legal Service Classification
            </span>
            {getServiceLevels(classificationPath).map((level, index) => (
              <select
                key={level.label}
                aria-label={level.label}
                value={level.value}
                onChange={(event) =>
                  setClassificationPath((current) => {
                    const next = current.slice(0, index);
                    if (event.target.value) next[index] = event.target.value;
                    return next;
                  })
                }
                className="max-w-xs rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              >
                <option value="">
                  {index === 0
                    ? "All legal services"
                    : `All ${level.label.toLowerCase()}s`}
                </option>
                {level.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            ))}
          </div>
          <label className="flex flex-col text-sm text-gray-700">
            Period
            <select
              value={dateRange}
              onChange={(event) =>
                setDateRange(event.target.value as FirmReportRange)
              }
              className="mt-1 rounded border border-gray-300 bg-white px-3 py-2 text-gray-900"
            >
              <option value="daily">Last Day</option>
              <option value="weekly">Last Week</option>
              <option value="monthly">Last Month</option>
              <option value="quarterly">Last Quarter</option>
              <option value="yearly">Last Year</option>
              <option value="ytd">Year to Date</option>
              <option value="custom">Custom Range</option>
            </select>
          </label>
          {dateRange === "custom" && (
            <>
              <label className="flex flex-col text-sm text-gray-700">
                From
                <input
                  type="date"
                  value={customFrom}
                  onChange={(event) => setCustomFrom(event.target.value)}
                  className="mt-1 rounded border border-gray-300 bg-white px-3 py-2 text-gray-900"
                />
              </label>
              <label className="flex flex-col text-sm text-gray-700">
                To
                <input
                  type="date"
                  value={customTo}
                  onChange={(event) => setCustomTo(event.target.value)}
                  className="mt-1 rounded border border-gray-300 bg-white px-3 py-2 text-gray-900"
                />
              </label>
            </>
          )}
        </div>
      </div>
      {error && (
        <div className="mb-5 flex items-center gap-2 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={17} />
          {error}
        </div>
      )}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summaryMetrics.map((metric) => (
          <Metric
            key={metric.label}
            label={metric.label}
            value={metric.value}
          />
        ))}
      </div>
      {view === "net-profit" && !summary?.netProfit && (
        <div className="mb-5 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Net profit uses the existing firm-level calculation. Matter-level
          allocation is not available in the current financial model.
        </div>
      )}
      {unsupportedViews.includes(view) && (
        <div className="mb-5 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          The current application has no dedicated source record or API for this
          metric. No unrelated records are substituted.
        </div>
      )}
      {isInvoiceView ? (
        <InvoiceTable
          invoices={visibleInvoices}
          page={page}
          pages={pages}
          total={filteredInvoices.length}
          onPageChange={setPage}
        />
      ) : hasSupportedTable ? (
        <FinanceTable
          view={view}
          cases={filteredCases}
          expenses={classificationExpenses}
          report={report}
          invoices={classificationInvoices}
          period={period}
        />
      ) : (
        !sectionViewNames.has(view) && (
          <div className="rounded-lg border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
            No supporting financial data is available for this view.
          </div>
        )
      )}
    </div>
  );
}

function InvoiceTable({
  invoices,
  page,
  pages,
  total,
  onPageChange,
}: {
  invoices: InvoiceWithCase[];
  page: number;
  pages: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="overflow-x-auto">
        {invoices.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">
            No invoices found.
          </div>
        ) : (
          <table className="min-w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-5 py-3">#</th>
                <th className="px-5 py-3">Invoice</th>
                <th className="px-5 py-3">Matter / Client</th>
                <th className="px-5 py-3">Amount</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Invoice Date</th>
                <th className="px-5 py-3">Recorded</th>
                <th className="px-5 py-3">Recorded By</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice, index) => (
                <tr key={invoice._id} className="border-t border-gray-100">
                  <td className="px-5 py-4 text-gray-500">
                    {(page - 1) * 10 + index + 1}
                  </td>
                  <td className="px-5 py-4 font-medium text-gray-900">
                    {invoice.invoiceNo}
                  </td>
                  <td className="px-5 py-4">
                    {invoice.case?.caseNo || "Matter unavailable"}
                    <div className="text-xs text-gray-500">
                      {invoice.case?.parties || "Client unavailable"}
                    </div>
                  </td>
                  <td className="px-5 py-4 font-semibold">
                    {money(amount(invoice.amount))}
                  </td>
                  <td className="px-5 py-4">{invoice.status}</td>
                  <td className="px-5 py-4">{invoice.date}</td>
                  <td className="px-5 py-4">
                    {invoice.createdAt
                      ? new Date(invoice.createdAt).toLocaleString()
                      : "Timestamp unavailable"}
                  </td>
                  <td className="px-5 py-4">Actor unavailable</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {total > 0 && (
        <Pagination
          page={page}
          pages={pages}
          total={total}
          onChange={onPageChange}
        />
      )}
    </div>
  );
}

const MEASURE_OPTIONS: Array<{ key: string; label: string }> = [
  { key: "contract-value", label: "Total Contract Value" },
  { key: "total-billed", label: "Total Billed" },
  { key: "total-collected", label: "Total Collected" },
  { key: "outstanding", label: "Outstanding" },
  { key: "direct-matter-costs", label: "Direct Matter Costs" },
  { key: "operating-expenses", label: "Firm Operating Expenses" },
  { key: "gross-profit", label: "Gross Profit" },
];

type DashboardDetailRecord = {
  measure: string;
  measureLabel: string;
  recordId: string;
  description: string;
  value: number;
  date: string;
  timestamp?: string;
  actor?: string;
  reference: string;
};

const measureChipClass = (key: string) =>
  key === "direct-matter-costs" || key === "operating-expenses"
    ? "border-amber-100 bg-amber-50 text-amber-700"
    : key === "total-billed"
      ? "border-blue-200 bg-blue-50 text-blue-700"
      : key === "contract-value" || key === "gross-profit"
        ? "border-green-100 bg-green-50 text-green-700"
        : "border-indigo-100 bg-indigo-50 text-indigo-700";

function FinancialDashboardDetailTable({
  cases,
  invoices,
  expenses,
}: {
  cases: CaseData[];
  invoices: InvoiceWithCase[];
  expenses: PettyCashExpense[];
}) {
  const [measure, setMeasure] = useState("all");
  const [page, setPage] = useState(1);

  const matterByCaseId = new Map<string, CaseData>();
  for (const matter of cases) {
    if (matter._id) matterByCaseId.set(String(matter._id), matter);
  }
  const matterLabel = (matter?: CaseData) => (matter ? matter.caseNo : "");
  const clientLabel = (matter?: CaseData) => (matter ? matter.parties : "");
  const matterActor = (matter?: CaseData) =>
    matter ? matterActorLabel(matter) : "";
  const expenseNet = (expense: PettyCashExpense) =>
    Math.max(0, amount(expense.amount) - amount(expense.refundAmount));
  const contractValueOf = (matter: CaseData) =>
    Math.max(
      amount(matter.workflowProgress?.plannedValue?.amount),
      amount(matter.budget),
    );
  const invoiceDetail = (invoice: InvoiceWithCase) => {
    const matter = invoice.caseId
      ? matterByCaseId.get(String(invoice.caseId))
      : undefined;
    return `${matterLabel(matter) || invoice.case?.caseNo || "Matter unavailable"} — ${clientLabel(matter) || invoice.case?.parties || "Client unavailable"}`;
  };

  const records: DashboardDetailRecord[] = [
    // Total Contract Value — one row per matter
    ...cases.map((matter) => ({
      measure: "contract-value",
      measureLabel: "Total Contract Value",
      recordId: matter.caseNo,
      description: matter.parties,
      value: contractValueOf(matter),
      date: dayKey(matter.createdAt || matter.updatedAt || ""),
      timestamp: matter.updatedAt || matter.createdAt,
      actor: matterActor(matter) || "System",
      reference: matter.status || "Status unavailable",
    })),
    // Total Billed — one row per invoice
    ...invoices.map((invoice) => {
      const matter = invoice.caseId
        ? matterByCaseId.get(String(invoice.caseId))
        : undefined;
      return {
        measure: "total-billed",
        measureLabel: "Total Billed",
        recordId: invoice.invoiceNo,
        description: invoiceDetail(invoice),
        value: amount(invoice.amount),
        date: invoice.date,
        timestamp: invoice.createdAt || invoice.updatedAt,
        actor: matterActor(matter) || "System",
        reference: invoice.status,
      };
    }),
    // Total Collected — one row per paid invoice
    ...invoices
      .filter((invoice) => invoice.status === "Paid")
      .map((invoice) => {
        const matter = invoice.caseId
          ? matterByCaseId.get(String(invoice.caseId))
          : undefined;
        return {
          measure: "total-collected",
          measureLabel: "Total Collected",
          recordId: invoice.invoiceNo,
          description: invoiceDetail(invoice),
          value: amount(invoice.amount),
          date: invoice.date,
          timestamp: invoice.updatedAt || invoice.createdAt,
          actor: matterActor(matter) || "System",
          reference: "Paid",
        };
      }),
    // Outstanding — one row per unpaid invoice
    ...invoices
      .filter((invoice) => invoice.status !== "Paid")
      .map((invoice) => {
        const matter = invoice.caseId
          ? matterByCaseId.get(String(invoice.caseId))
          : undefined;
        return {
          measure: "outstanding",
          measureLabel: "Outstanding",
          recordId: invoice.invoiceNo,
          description: invoiceDetail(invoice),
          value: amount(invoice.amount),
          date: invoice.date,
          timestamp: invoice.createdAt || invoice.updatedAt,
          actor: matterActor(matter) || "System",
          reference: `Due ${invoice.date}`,
        };
      }),
    // Direct Matter Costs — one row per client-tagged expense
    ...expenses
      .filter((expense) => expense.chargeType === "client")
      .map((expense) => ({
        measure: "direct-matter-costs",
        measureLabel: "Direct Matter Costs",
        recordId: expense.receiptRef || expense.expenseId || "Expense",
        description: expense.caseNoSnapshot
          ? `${expense.title} — ${expense.caseNoSnapshot}`
          : expense.title,
        value: expenseNet(expense),
        date: expense.date,
        timestamp: expense.createdAt,
        actor: expense.createdByName || "System",
        reference: expense.category || "Unclassified",
      })),
    // Firm Operating Expenses — one row per internal expense
    ...expenses
      .filter((expense) => expense.chargeType !== "client")
      .map((expense) => ({
        measure: "operating-expenses",
        measureLabel: "Firm Operating Expenses",
        recordId: expense.receiptRef || expense.expenseId || "Expense",
        description: expense.title,
        value: expenseNet(expense),
        date: expense.date,
        timestamp: expense.createdAt,
        actor: expense.createdByName || "System",
        reference: expense.category || "Unclassified",
      })),
    // Gross Profit — one row per matter (collected − direct costs)
    ...cases.map((matter) => {
      const key = String(matter._id);
      const matterCollected = invoices
        .filter(
          (invoice) =>
            String(invoice.caseId) === key && invoice.status === "Paid",
        )
        .reduce((sum, invoice) => sum + amount(invoice.amount), 0);
      const matterCosts = expenses
        .filter(
          (expense) =>
            expense.caseId &&
            String(expense.caseId) === key &&
            expense.chargeType === "client",
        )
        .reduce((sum, expense) => sum + expenseNet(expense), 0);
      return {
        measure: "gross-profit",
        measureLabel: "Gross Profit",
        recordId: matter.caseNo,
        description: matter.parties,
        value: matterCollected - matterCosts,
        date: dayKey(matter.updatedAt || matter.createdAt || ""),
        timestamp: matter.updatedAt || matter.createdAt,
        actor: matterActor(matter) || "System",
        reference: matter.status || "Status unavailable",
      };
    }),
  ];
const totals = new Map<string, { count: number; total: number }>();
  for (const record of records) {
    const entry = totals.get(record.measure) || { count: 0, total: 0 };
    entry.count += 1;
    entry.total += record.value;
    totals.set(record.measure, entry);
  }
  // Sort by the selected card's value (highest first); in "All" mode group by card.
  const visibleRecords =
    measure === "all"
      ? [...records].sort(
          (a, b) =>
            a.measure === b.measure
              ? b.value - a.value
              : a.measure.localeCompare(b.measure),
        )
      : records
          .filter((record) => record.measure === measure)
          .sort((a, b) => b.value - a.value);

  const totalPages = Math.max(1, Math.ceil(visibleRecords.length / 12));
  const pageRecords = visibleRecords.slice((page - 1) * 12, page * 12);
  useEffect(() => setPage(1), [measure, visibleRecords.length]);

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-3">
        <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Sort by
        </span>
        <button
          type="button"
          onClick={() => setMeasure("all")}
          className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${measure === "all" ? "border-gray-800 bg-gray-800 text-white" : "border-gray-300 bg-white text-gray-600"}`}
        >
          All ({records.length})
        </button>
        {MEASURE_OPTIONS.map((option) => {
          const entry = totals.get(option.key);
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => setMeasure(option.key)}
              className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${measure === option.key ? "border-gray-800 bg-gray-800 text-white" : "border-gray-300 bg-white text-gray-700"}`}
              title={`Sort by ${option.label}`}
            >
              {option.label} ({entry ? entry.count : 0})
            </button>
          );
        })}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-5 py-3.5 font-medium">#</th>
              <th className="px-5 py-3.5 font-medium">Type</th>
              <th className="px-5 py-3.5 font-medium">Reference</th>
              <th className="px-5 py-3.5 text-right font-medium">Value</th>
              <th className="px-5 py-3.5 font-medium">Timestamp</th>
              <th className="px-5 py-3.5 font-medium">Done By</th>
            </tr>
          </thead>
          <tbody>
            {pageRecords.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-gray-500">
                  No supporting records are available for this card in the selected
                  period.
                </td>
              </tr>
            ) : (
              pageRecords.map((record, index) => (
                <tr
                  key={`${record.measure}-${record.recordId}-${index}`}
                  className="border-t border-gray-100 align-top transition-colors hover:bg-gray-50/60"
                >
                  <td className="px-5 py-3.5 text-gray-500">
                    {(page - 1) * 12 + index + 1}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3.5">
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${measureChipClass(record.measure)}`}
                    >
                      {record.measureLabel}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="font-medium text-gray-900">{record.recordId}</div>
                    {record.description ? (
                      <div className="text-xs text-gray-500">
                        {record.description}
                      </div>
                    ) : null}
                  </td>
                  <td
                    className={`whitespace-nowrap px-5 py-3.5 text-right font-semibold tabular-nums ${record.measure === "gross-profit" && record.value < 0 ? "text-red-700" : "text-gray-900"}`}
                  >
                    {money(record.value)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3.5 text-gray-600">
                    {record.timestamp
                      ? new Date(record.timestamp).toLocaleString()
                      : "—"}
                  </td>
                  <td className="px-5 py-3.5 font-medium text-gray-800">
                    {record.actor || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {pageRecords.length > 0 && (
        <Pagination
          page={page}
          pages={totalPages}
          total={visibleRecords.length}
          onChange={setPage}
        />
      )}
    </div>
  );
}

function FinanceTable({
  view,
  cases,
  expenses,
  report,
  invoices,
  period,
}: {
  view: BillingFinanceView;
  cases: CaseData[];
  expenses: PettyCashExpense[];
  report: FirmReportResponse | null;
  invoices: InvoiceWithCase[];
  period: { from: string; to: string } | null;
}) {
  const rows =
    view === "financial-dashboard"
      ? []
      : view === "expenses" ||
    view === "expense-direct-costs" ||
    view === "expense-operating"
      ? expenses
          .filter((expense) =>
            view === "expense-direct-costs"
              ? expense.chargeType === "client"
              : view === "expense-operating"
                ? expense.chargeType !== "client"
                : true,
          )
          .map((expense) => ({
            label: expense.title,
            detail: `${expense.date} • ${expense.category || "Unclassified"} • ${expense.chargeType === "client" ? "Client" : "Internal"}`,
            value: money(
              Math.max(
                0,
                amount(expense.amount) - amount(expense.refundAmount),
              ),
            ),
            date: expense.date,
            timestamp: expense.createdAt,
            actor: expense.createdByName,
            reference:
              expense.receiptRef || expense.caseNoSnapshot || "No reference",
          }))
      : view === "staff-profitability" ||
          view === "fee-earned" ||
          view === "by-staff"
        ? (report?.team || []).map((member) => ({
            label: member.name,
            detail: member.role,
            value: money(member.earnedFees || member.revenueAttributed || 0),
            date: "Period total",
            timestamp: undefined,
            actor: member.name,
            reference: `${member.tasksCompleted} tasks`,
          }))
        : cases.map((matter) => {
            const matterInvoices = invoices.filter(
              (invoice) => String(invoice.caseId) === String(matter._id),
            );
            const matterBilled = matterInvoices.reduce(
              (sum, invoice) => sum + amount(invoice.amount),
              0,
            );
            const matterCollected = matterInvoices
              .filter((invoice) => invoice.status === "Paid")
              .reduce((sum, invoice) => sum + amount(invoice.amount), 0);
            return {
              label: matter.caseNo,
              detail: matter.parties,
              value: money(
                view === "contract-value"
                  ? Math.max(
                      amount(matter.workflowProgress?.plannedValue?.amount),
                      amount(matter.budget),
                    )
                  : view === "total-collected"
                    ? matterCollected
                    : matterBilled,
              ),
              date: matter.updatedAt || matter.createdAt || "Date unavailable",
              timestamp: matter.updatedAt || matter.createdAt,
              actor: matterActorLabel(matter) || "System",
              reference: matter.status || "Status unavailable",
            };
          });
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / 10));
  const visibleRows = rows.slice((page - 1) * 10, page * 10);
  useEffect(() => setPage(1), [view, rows.length]);

  return view === "financial-dashboard" ? (
    <FinancialDashboardDetailTable
      cases={cases}
      invoices={invoices}
      expenses={expenses}
    />
  ) : (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-5 py-3">#</th>
              <th className="px-5 py-3">Record</th>
              <th className="px-5 py-3">Details</th>
              <th className="px-5 py-3">Value</th>
              <th className="px-5 py-3">Date</th>
              <th className="px-5 py-3">Timestamp</th>
              <th className="px-5 py-3">Recorded By</th>
              <th className="px-5 py-3">Reference</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-5 py-10 text-center text-gray-500"
                >
                  No supporting records are available.
                </td>
              </tr>
            ) : (
              visibleRows.map((row, index) => (
                <tr
                  key={`${row.label}-${index}`}
                  className="border-t border-gray-100"
                >
                  <td className="px-5 py-4 text-gray-500">
                    {(page - 1) * 10 + index + 1}
                  </td>
                  <td className="px-5 py-4 font-medium text-gray-900">
                    {row.label || "Unavailable"}
                  </td>
                  <td className="px-5 py-4 text-gray-600">
                    {row.detail || "Unavailable"}
                  </td>
                  <td className="px-5 py-4 font-semibold text-gray-900">
                    {row.value}
                  </td>
                  <td className="px-5 py-4">{row.date}</td>
                  <td className="px-5 py-4">
                    {row.timestamp
                      ? new Date(row.timestamp).toLocaleString()
                      : "Timestamp unavailable"}
                  </td>
                  <td className="px-5 py-4">
                    {row.actor || "Actor unavailable"}
                  </td>
                  <td className="px-5 py-4 text-gray-600">{row.reference}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {rows.length > 0 && (
        <Pagination
          page={page}
          pages={totalPages}
          total={rows.length}
          onChange={setPage}
        />
      )}
    </div>
  );
}

const matterActorLabel = (matter: CaseData) =>
  matter.caseAssignments?.initiator ||
  matter.caseAssignments?.reviewer ||
  matter.caseAssignments?.signerApprover ||
  matter.assignedTo ||
  matter.takeRequestState?.decisionByName ||
  "";
