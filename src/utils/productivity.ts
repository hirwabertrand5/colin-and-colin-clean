export const baseNameFromLabel = (label: unknown): string => {
  const value = String(label || '').toLowerCase().trim();
  const cutDash = value.split(' - ')[0];
  const cutParen = cutDash.split('(')[0];
  const cutComma = cutParen.split(',')[0];
  return cutComma.trim().replace(/\s+/g, ' ');
};

export const pctRatio = (n?: number | null): number => Math.max(0, Math.round(Number(n || 0))) / 100;

export const round2 = (n: number): number => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

type MemberRowOptions = { meId?: string; meName?: string };

const ownRows = (rows: any[], opts: MemberRowOptions) => {
  const meId = String(opts.meId || '').trim();
  const meBase = baseNameFromLabel(opts.meName);
  return rows.filter((row) => {
    const staffId = String(row?.staffId || row?.userId || row?.memberId || '').trim();
    if (meId && staffId && staffId === meId) return true;
    return baseNameFromLabel(row?.staff) === meBase;
  });
};

export function computeMemberFeeEarnedFromRows(rows: any[], opts: MemberRowOptions): number {
  const total = ownRows(rows, opts).reduce((sum, row) => {
    const fee = Number(row?.taskFeeCollected ?? row?.taskFee ?? 0);
    const tpa = pctRatio(row?.tpaPercent);
    const timeliness = pctRatio(row?.timelinessScore);
    const quality = pctRatio(row?.qualityScore);
    return sum + round2(fee * tpa * timeliness * quality);
  }, 0);
  return round2(total);
}

export function computeTaskFeeCollectedFromRows(rows: any[], opts: MemberRowOptions): number {
  return round2(
    ownRows(rows, opts).reduce((sum, row) => sum + Number(row?.taskFeeCollected ?? row?.taskFee ?? 0), 0)
  );
}
