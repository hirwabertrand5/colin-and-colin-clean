/**
 * Single-currency policy — Rwandan Franc (RWF) only.
 *
 * The whole system operates in RWF. No other currency may be entered,
 * stored, or selected. Amounts are never auto-converted: when legacy
 * records with a different currency code are normalised, only the
 * currency label changes to RWF and the numeric value is preserved
 * so the finance team can review / re-enter exchange-adjusted values.
 */
export const SINGLE_CURRENCY = 'RWF' as const;
export type SingleCurrency = typeof SINGLE_CURRENCY;

export const SINGLE_CURRENCY_LABEL = 'RWF';

export const isRwfCurrency = (value: unknown): boolean => {
  if (value === undefined || value === null || value === '') return true;
  const cleaned = String(value).trim().toUpperCase();
  if (!cleaned) return true;
  // Accept the common alternate spelling and normalise it to RWF.
  return cleaned === 'RWF' || cleaned === 'FRW';
};

/** Normalise any currency input to RWF. Never throws, never converts amounts. */
export const normalizeToRwf = (_value?: unknown): SingleCurrency => SINGLE_CURRENCY;

/** Format an amount in RWF. Amount is never converted. */
export const formatRwf = (value: unknown): string => {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(n)) return `RWF —`;
  return `RWF ${Math.round(n).toLocaleString('en-US')}`;
};
