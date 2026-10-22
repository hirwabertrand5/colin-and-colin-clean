import { FirmReportRange } from './firmReportsService';

const API_URL = import.meta.env.VITE_API_URL;
const getToken = () => localStorage.getItem('token');

export type ProfitabilityRow = {
  label?: string;
  id?: string;
  matterNo?: string;
  client?: string;
  practiceArea?: string;
  status?: string;
  matterCount: number;
  activeMatters?: number;
  contractValue: number;
  billed: number;
  collected: number;
  outstanding: number;
  directMatterCosts: number;
  grossContribution: number;
  contributionMargin: number | null;
  costRatio?: number | null;
  allocatedStaffCosts?: number | null;
  allocatedOverhead?: number | null;
  netContribution?: number | null;
};

export type ProfitabilityResponse = {
  range: { from: string | null; to: string | null; label: string };
  currency: 'RWF';
  dataAvailability: {
    taskFeeRecognition: boolean;
    staffCostRegister: boolean;
    allocatedOverhead: boolean;
    taxAndNonOperatingItems: boolean;
    paymentStatusHistory: boolean;
  };
  firm: {
    activeMatters: number;
    contractValue: number;
    billed: number;
    recognisedCollectedRevenue: number;
    totalReceivables: number;
    directMatterCosts: number;
    generalOverheads: number;
    totalFirmCosts: number;
    grossContribution: number;
    grossMargin: number | null;
    netProfit: number;
    netProfitMargin: number | null;
    costRatio: number | null;
    collectionRate: number | null;
  };
  ageing: {
    current: number;
    days31to60: number;
    days61to90: number;
    over90: number;
  };
  matterRows: ProfitabilityRow[];
  clientRows: ProfitabilityRow[];
  practiceAreaRows: ProfitabilityRow[];
};

export const getProfitabilityReport = async (
  params: { range?: FirmReportRange; from?: string; to?: string },
  signal?: AbortSignal,
): Promise<ProfitabilityResponse> => {
  const query = new URLSearchParams();
  if (params.range) query.set('range', params.range);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  const response = await fetch(`${API_URL}/reports/profitability?${query.toString()}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
    signal,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.message || 'Failed to load profitability report.');
  return body as ProfitabilityResponse;
};
