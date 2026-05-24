import { IFeeSpec, ISlaSpec, IWorkflowTemplate } from '../models/workflowTemplateModel';

export type WorkflowMoney = {
  amount?: number;
  currency?: string;
  text?: string;
};

export const normalizeCurrency = (raw: string | undefined) => {
  const v = (raw || '').trim().toUpperCase();
  if (!v) return undefined;
  if (v === 'FRW') return 'RWF';
  return v;
};

export const parseFirstNumber = (text: string): number | undefined => {
  const cleaned = String(text || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[, ]+/g, '')
    .trim();
  const m = cleaned.match(/(\d+(\.\d+)?)/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
};

export const feeToMoney = (fee: IFeeSpec | undefined): WorkflowMoney => {
  if (!fee) return {};

  if (fee.type === 'fixed' && typeof fee.min === 'number') {
    const currency = normalizeCurrency(fee.currency);
    return { amount: fee.min, ...(currency ? { currency } : {}), ...(fee.text ? { text: fee.text } : {}) };
  }
  if (fee.type === 'range' && typeof fee.min === 'number') {
    const currency = normalizeCurrency(fee.currency);
    return { amount: fee.min, ...(currency ? { currency } : {}), ...(fee.text ? { text: fee.text } : {}) };
  }
  if (fee.type === 'percentage') return { text: fee.text || `${fee.percentage ?? ''}%` };
  if (fee.type === 'included') return { text: fee.text || 'Included' };

  if (fee.text) {
    const amount = parseFirstNumber(fee.text);
    const currency =
      normalizeCurrency(fee.currency) ||
      (fee.text.toLowerCase().includes('rwf') || fee.text.toLowerCase().includes('frw') ? 'RWF' : undefined);
    return {
      ...(typeof amount === 'number' ? { amount } : {}),
      ...(currency ? { currency } : {}),
      text: fee.text,
    };
  }

  return {};
};

const UNIT_TO_MINUTES: Record<string, number> = {
  hour: 60,
  hours: 60,
  hr: 60,
  hrs: 60,
  h: 60,
  day: 60 * 24,
  days: 60 * 24,
  d: 60 * 24,
  week: 60 * 24 * 7,
  weeks: 60 * 24 * 7,
  w: 60 * 24 * 7,
};

export const slaToMinutes = (sla: ISlaSpec | undefined): { minutes?: number; text?: string } => {
  if (!sla) return {};

  // Prefer numeric config
  if (typeof sla.max === 'number' && sla.unit) {
    const unit = String(sla.unit);
    const mult = UNIT_TO_MINUTES[unit] || (unit === 'hours' ? 60 : unit === 'days' ? 60 * 24 : unit === 'weeks' ? 60 * 24 * 7 : undefined);
    if (mult) {
      const minutes = Math.max(0, Math.round(sla.max * mult));
      return { minutes, ...(sla.text ? { text: sla.text } : {}) };
    }
  }
  if (typeof sla.min === 'number' && sla.unit) {
    const unit = String(sla.unit);
    const mult = UNIT_TO_MINUTES[unit] || (unit === 'hours' ? 60 : unit === 'days' ? 60 * 24 : unit === 'weeks' ? 60 * 24 * 7 : undefined);
    if (mult) {
      const minutes = Math.max(0, Math.round(sla.min * mult));
      return { minutes, ...(sla.text ? { text: sla.text } : {}) };
    }
  }

  const text = (sla.text || '').trim();
  if (!text) return {};

  // Minimal parser for: "48", "48 hours", "1 day 12 hours", "1d 12h"
  const tokens = text
    .toLowerCase()
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // if only a number, assume hours
  if (/^\d+(\.\d+)?$/.test(tokens)) {
    const n = Number(tokens);
    return Number.isFinite(n) ? { minutes: Math.round(n * 60), text } : {};
  }

  let total = 0;
  let matched = false;
  const re = /(\d+(\.\d+)?)\s*(weeks?|w|days?|d|hours?|hrs?|hr|h)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tokens))) {
    const n = Number(m[1]);
    const unit = String(m[3] || '');
    const mult = UNIT_TO_MINUTES[unit];
    if (Number.isFinite(n) && mult) {
      total += n * mult;
      matched = true;
    }
  }

  return matched ? { minutes: Math.max(0, Math.round(total)), text } : { text };
};

export const addMinutes = (start: Date, minutes: number | undefined) => {
  if (!minutes || minutes <= 0) return new Date(start);
  return new Date(start.getTime() + minutes * 60_000);
};

export const buildInstanceSteps = (template: IWorkflowTemplate | any, startDate: Date) => {
  const sorted = (template?.steps || []).slice().sort((a: any, b: any) => (a.order || 0) - (b.order || 0));

  let cursor = new Date(startDate);

  const built = sorted.map((s: any, idx: number) => {
    const slaInfo = slaToMinutes(s.sla);
    const feeInfo = feeToMoney(s.fee);

    const stepStartAt = new Date(cursor);
    const dueAt = addMinutes(stepStartAt, slaInfo.minutes);
    cursor = new Date(dueAt);

    const feeType = String(s?.fee?.type || '');
    const feeCurrency = feeInfo.currency;
    const feeRangeMin = feeType === 'range' && typeof s?.fee?.min === 'number' ? s.fee.min : undefined;
    const feeRangeMax = feeType === 'range' && typeof s?.fee?.max === 'number' ? s.fee.max : undefined;
    const feeInputRequired = false;

    return {
      stepKey: s.key,
      title: s.title,
      stageKey: s.stageKey,
      order: s.order,
      status: idx === 0 ? 'In Progress' : 'Not Started',

      startAt: stepStartAt,
      dueAt,

      feeAmount: typeof feeInfo.amount === 'number' ? feeInfo.amount : undefined,
      feeCurrency,
      feeText: feeInputRequired
        ? feeInfo.text || (typeof feeRangeMin === 'number' && typeof feeRangeMax === 'number'
          ? `Range: ${feeCurrency || ''} ${feeRangeMin} - ${feeRangeMax}`.trim()
          : 'Range')
        : feeInfo.text,
      feeRangeMin,
      feeRangeMax,
      feeInputRequired,
      feeSetByUser: false,

      slaMinutes: typeof slaInfo.minutes === 'number' ? slaInfo.minutes : undefined,
      slaText: slaInfo.text,

      responsibleRole: typeof s.responsibleRole === 'string' ? s.responsibleRole : undefined,

      actions: (s.actions || []).map((text: any) => ({ text: String(text || '').trim(), done: false })),

      outputs: (s.outputs || []).map((o: any) => ({
        key: o.key,
        name: o.name,
        required: Boolean(o.required),
        category: o.category,
      })),
    };
  });

  // Fee smoothing:
  // If a step has no fee defined, split the previous numeric fee in half and assign to both steps.
  for (let i = 1; i < built.length; i += 1) {
    const prev = built[i - 1];
    const cur = built[i];

    const curHasNoFee =
      typeof cur.feeAmount !== 'number' &&
      !cur.feeInputRequired &&
      !cur.feeText;
    const prevHasFee = typeof prev.feeAmount === 'number';

    if (curHasNoFee && prevHasFee) {
      const original = prev.feeAmount as number;
      const prevHalf = Math.floor(original / 2);
      const curHalf = original - prevHalf;
      prev.feeAmount = prevHalf;
      cur.feeAmount = curHalf;
      cur.feeCurrency = cur.feeCurrency || prev.feeCurrency;
    }
  }

  return built;
};
