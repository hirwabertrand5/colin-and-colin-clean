/** The shared presets for Firm Reports and Billing & Finance profitability. */
export const REPORT_PERIOD_OPTIONS = [
  { value: 'daily', label: 'Today' },
  { value: 'weekly', label: 'Last 7 Days' },
  { value: 'monthly', label: 'This Month' },
  { value: 'quarterly', label: 'Last Quarter' },
  { value: 'yearly', label: 'Last Year' },
  { value: 'ytd', label: 'Year to Date' },
  { value: 'custom', label: 'Custom Range' },
] as const;
export const REPORT_PERIOD_LABELS = Object.fromEntries(REPORT_PERIOD_OPTIONS.map(option => [option.value, option.label])) as Record<typeof REPORT_PERIOD_OPTIONS[number]['value'], string>;
