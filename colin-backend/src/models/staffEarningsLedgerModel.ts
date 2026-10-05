import mongoose, { Schema, Document } from 'mongoose';

/**
 * StaffEarningsLedger — an immutable, event-time snapshot of ONE staff earned-fee
 * calculation for ONE Key Action.
 *
 * Why this exists
 * ---------------
 * The live earned-fee engine is a *projection*: it reads today's TPA table,
 * today's Quality Score, today's workflow percentages and today's matter
 * assignments. Editing any of those would silently rewrite what a closed
 * period "earned" last quarter. This ledger freezes the exact inputs used at
 * the moment of completion so a historical report stays auditable and
 * reproducible even after the inputs change.
 *
 * Identity / duplicate prevention
 * -------------------------------
 * `entryKey` is a deterministic function of (matter, Key Action, staff member,
 * assignment role, completion timestamp). A re-run of the aggregation for the
 * same event produces the SAME key, so the unique index makes persistence
 * idempotent — a correction supersedes (revision 2) instead of inserting a
 * second earning for the same work. That is what prevents double-counting when
 * an action is re-opened and re-ticked, or when a report is regenerated.
 *
 * The authoritative amount is always the live engine's
 * `computeCaseEarnedFees` output (`earnedFee`), so this record can never
 * become a competing fee formula.
 */
export interface IStaffEarningsLedger extends Document {
  /** Deterministic identity of this earning event (see note above). */
  entryKey: string;
  /** Bumped when the same event is recalculated with different inputs. */
  revision: number;

  caseId: mongoose.Types.ObjectId;
  /** Workflow template step key of the completed Key Action. */
  keyActionKey: string;
  keyActionTitle: string;
  stageKey: string | null;
  stageTitle: string | null;

  /** Normalized staff identity (base name, lower case) — see workflowPercentages. */
  staffKey: string;
  staffName: string;
  /** System role from the user record — the source of the TPA share. */
  systemRole: string | null;
  assignmentRole: string;
  tpaSource: string | null;

  /** The period this earning is attributed to, from the completion timestamp. */
  completionAt: Date;
  /** Which stored timestamp produced completionAt (submitted/lastActionTicked/...). */
  completionSource: string | null;
  /** IANA zone of the server that recorded the event, when known. */
  timeZone: string | null;

  /** ---- Frozen calculation inputs (the audit trail) ---- */
  contractValue: number;
  keyActionPercent: number | null;
  grossActionValue: number;
  collectedAmount: number;
  eligibleCollectedBase: number;
  tpaPercent: number;
  timelinessScore: number | null;
  qualityScore: number | null;
  earnedFee: number | null;
  currency: string;

  /** Free-text reason the amount is null / not yet eligible. */
  statusNote: string | null;
  /** Set when a reopened or corrected action superseded an earlier revision. */
  supersededByEntryKey: string | null;
  correctionReason: string | null;

  recordedBy: string;
}

const StaffEarningsLedgerSchema = new Schema<IStaffEarningsLedger>(
  {
    entryKey: { type: String, required: true, index: true },
    revision: { type: Number, required: true, default: 1 },

    caseId: { type: Schema.Types.ObjectId, ref: 'Case', required: true, index: true },
    keyActionKey: { type: String, required: true },
    keyActionTitle: { type: String, default: '' },
    stageKey: { type: String, default: null },
    stageTitle: { type: String, default: null },

    staffKey: { type: String, required: true, index: true },
    staffName: { type: String, required: true },
    systemRole: { type: String, default: null },
    assignmentRole: { type: String, default: '' },
    tpaSource: { type: String, default: null },

    completionAt: { type: Date, required: true, index: true },
    completionSource: { type: String, default: null },
    timeZone: { type: String, default: null },

    contractValue: { type: Number, default: 0 },
    keyActionPercent: { type: Number, default: null },
    grossActionValue: { type: Number, default: 0 },
    collectedAmount: { type: Number, default: 0 },
    eligibleCollectedBase: { type: Number, default: 0 },
    tpaPercent: { type: Number, default: 0 },
    timelinessScore: { type: Number, default: null },
    qualityScore: { type: Number, default: null },
    earnedFee: { type: Number, default: null },
    currency: { type: String, default: 'RWF' },

    statusNote: { type: String, default: null },
    supersededByEntryKey: { type: String, default: null },
    correctionReason: { type: String, default: null },

    recordedBy: { type: String, default: 'System' },
  },
  { timestamps: true }
);

// One row per earning event — re-running the report can never double-count.
StaffEarningsLedgerSchema.index({ entryKey: 1 }, { unique: true });
// Reporting queries: a period, then staff within it.
StaffEarningsLedgerSchema.index({ completionAt: 1, staffKey: 1 });
StaffEarningsLedgerSchema.index({ caseId: 1, keyActionKey: 1 });

export default mongoose.model<IStaffEarningsLedger>('StaffEarningsLedger', StaffEarningsLedgerSchema);
