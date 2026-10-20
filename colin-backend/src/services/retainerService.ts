import mongoose from 'mongoose';
import Case from '../models/caseModel';
import Retainer, { IRetainer } from '../models/retainerModel';
import RetainerActivity from '../models/retainerActivityModel';

type Actor = { name?: string; userId?: string };

const today = () => new Date().toISOString().slice(0, 10);
const money = (value: unknown) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0;
};

export const retainerIsUsable = (retainer: Pick<IRetainer, 'status' | 'startDate' | 'endDate'>) =>
  retainer.status === 'Active' && retainer.startDate <= today() && (!retainer.endDate || retainer.endDate >= today());

const actorFields = (actor: Actor) => ({
  ...(actor.name ? { createdBy: actor.name } : {}),
  ...(actor.userId && mongoose.Types.ObjectId.isValid(actor.userId)
    ? { createdByUserId: new mongoose.Types.ObjectId(actor.userId) }
    : {}),
});

const snapshot = (retainer: IRetainer | any) => ({
  retainerNo: String(retainer.retainerNo),
  name: String(retainer.name),
  clientName: String(retainer.clientName),
  billingModel: retainer.billingModel,
});

/**
 * Converts the first version of retainers (which reserved individual case
 * amounts) into the shared-subscription model. It is idempotent and safe to
 * run at each service start: existing case links are retained, but every
 * subscription again exposes its whole contract value to all of its cases.
 */
export const migrateLegacyRetainerSubscriptions = async () => {
  const retainers = await Retainer.find({
    $or: [{ contractValue: { $exists: false } }, { reservedAmount: { $gt: 0 } }],
  }).select('_id contractValue totalFunded availableBalance reservedAmount');

  let migratedRetainers = 0;
  for (const retainer of retainers as any[]) {
    const contractValue = money(retainer.contractValue) || money(retainer.totalFunded) || money(retainer.availableBalance);
    await Retainer.updateOne(
      { _id: retainer._id },
      { $set: { contractValue, totalFunded: contractValue, availableBalance: contractValue, reservedAmount: 0 } }
    );
    migratedRetainers += 1;
  }

  const releasedAllocations = await Case.updateMany(
    { retainerAllocation: { $gt: 0 } },
    { $set: { retainerAllocation: 0 } }
  );

  return { migratedRetainers, releasedCaseAllocations: releasedAllocations.modifiedCount || 0 };
};

/**
 * The only supported way to attach or detach a case from a retainer. A
 * retainer is a shared subscription: linking a case never reserves, deducts,
 * or limits its own contract value. Each case keeps its own contract value,
 * invoices, collections, workflow, and lifecycle.
 */
export const linkCaseToRetainer = async (params: {
  caseId: string;
  retainerId?: string | null;
  actor: Actor;
}) => {
  const { caseId, retainerId, actor } = params;
  if (!mongoose.Types.ObjectId.isValid(caseId)) throw new Error('Invalid case id.');
  if (retainerId && !mongoose.Types.ObjectId.isValid(retainerId)) throw new Error('Invalid retainer id.');

  const session = await mongoose.startSession();
  try {
    let result: any;
    await session.withTransaction(async () => {
      const caseDoc: any = await Case.findById(caseId).session(session);
      if (!caseDoc) throw new Error('Case not found.');

      const previousRetainerId = caseDoc.retainerId ? String(caseDoc.retainerId) : '';
      const targetRetainerId = String(retainerId || '');

      if (!retainerId) {
        if (previousRetainerId) {
          await RetainerActivity.create(
            [{
              retainerId: new mongoose.Types.ObjectId(previousRetainerId),
              caseId: caseDoc._id,
              type: 'CASE_UNLINKED',
              amount: 0,
              balanceAfter: 0,
              note: `${caseDoc.caseNo || 'Case'} was removed from the retainer subscription.`,
              ...actorFields(actor),
            }],
            { session }
          );
        }
        caseDoc.billingArrangement = 'standard';
        caseDoc.retainerId = undefined;
        caseDoc.retainerAllocation = 0;
        caseDoc.retainerSnapshot = undefined;
        await caseDoc.save({ session });
        result = caseDoc;
        return;
      }

      const retainer: any = await Retainer.findById(retainerId).session(session);
      if (!retainer) throw new Error('Retainer not found.');
      if (!retainerIsUsable(retainer)) throw new Error('Only an active, in-term retainer can be selected for a case.');

      if (previousRetainerId && previousRetainerId !== targetRetainerId) {
        await RetainerActivity.create(
          [{
            retainerId: new mongoose.Types.ObjectId(previousRetainerId),
            caseId: caseDoc._id,
            type: 'CASE_UNLINKED',
            amount: 0,
            balanceAfter: 0,
            note: `${caseDoc.caseNo || 'Case'} was moved to another retainer subscription.`,
            ...actorFields(actor),
          }],
          { session }
        );
      }

      caseDoc.billingArrangement = 'retainer';
      caseDoc.retainerId = retainer._id;
      // This legacy field stays at zero so older clients cannot reintroduce
      // per-case reservations.
      caseDoc.retainerAllocation = 0;
      caseDoc.retainerSnapshot = snapshot(retainer);
      await caseDoc.save({ session });

      if (previousRetainerId !== targetRetainerId) {
        await RetainerActivity.create(
          [{
            retainerId: retainer._id,
            caseId: caseDoc._id,
            type: 'CASE_LINKED',
            amount: 0,
            balanceAfter: money(retainer.contractValue) || money(retainer.totalFunded),
            note: `${caseDoc.caseNo || 'Case'} was linked to this retainer subscription.`,
            ...actorFields(actor),
          }],
          { session }
        );
      }
      result = caseDoc;
    });
    return result;
  } finally {
    await session.endSession();
  }
};

export const retainerSnapshotFor = snapshot;
