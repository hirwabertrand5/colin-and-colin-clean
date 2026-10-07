/**
 * Single-currency policy — Rwandan Franc (RWF) only.
 * Backend mirror of src/constants/currency.ts.
 * Amounts are never auto-converted: only the currency label is normalised.
 */
export const SINGLE_CURRENCY = 'RWF' as const;
export type SingleCurrency = typeof SINGLE_CURRENCY;

export const SINGLE_CURRENCY_LABEL = 'RWF';

export const isRwfCurrency = (value: unknown): boolean => {
  if (value === undefined || value === null || value === '') return true;
  const cleaned = String(value).trim().toUpperCase();
  if (!cleaned) return true;
  return cleaned === 'RWF' || cleaned === 'FRW';
};

/** Normalise any currency input to RWF. Never converts the amount. */
export const normalizeToRwf = (_value?: unknown): SingleCurrency => SINGLE_CURRENCY;
