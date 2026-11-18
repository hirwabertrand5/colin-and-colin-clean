import { ClientSession, Model, Types } from 'mongoose';
import User from '../models/userModel';

export const AUDIT_RETENTION_LIMIT = 20;
const normalizedName = (value: unknown) => String(value || '').trim().toLowerCase();
const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Stable user IDs keep the same retention bucket after an account is renamed. */
export async function assignAuditActor(record: any, session: ClientSession | null = null) {
  if (!record.actorUserId) {
    const matches = await User.find({ name: new RegExp(`^\\s*${escaped(String(record.actorName || '').trim())}\\s*$`, 'i') })
      .select('_id').limit(2).session(session).lean();
    if (matches.length === 1) record.actorUserId = matches[0]!._id;
  }
  record.actorKey = record.actorUserId ? `user:${record.actorUserId}` : `name:${normalizedName(record.actorName)}`;
}

/** Delete only entries older than the twentieth; concurrent newer writes stay safe. */
export async function pruneAuditActor(model: Model<any>, actorKey: string, session: ClientSession | null = null) {
  const [boundary] = await model.find({ actorKey }).select('_id createdAt')
    .sort({ createdAt: -1, _id: -1 }).skip(AUDIT_RETENTION_LIMIT - 1).limit(1).session(session).lean();
  if (!boundary) return 0;
  const result = await model.deleteMany({ actorKey, $or: [
    { createdAt: { $lt: boundary.createdAt } },
    { createdAt: boundary.createdAt, _id: { $lt: boundary._id } },
  ] }).session(session);
  return result.deletedCount;
}

/** Resolve legacy names without loading the full audit history into memory. */
async function auditIdentities(model: Model<any>) {
  const users = await User.find().select('_id name').lean();
  const identities = new Map<string, Set<string>>();
  const add = (name: unknown, id: unknown) => {
    const key = normalizedName(name);
    if (!key) return;
    const ids = identities.get(key) || new Set<string>();
    ids.add(String(id)); identities.set(key, ids);
  };
  users.forEach(user => add(user.name, user._id));
  const records = model.find({ actorUserId: { $ne: null } }).select('actorName actorUserId').lean().cursor({ batchSize: 500 });
  for await (const row of records) add(row.actorName, row.actorUserId);
  return new Map([...identities].filter(([, ids]) => ids.size === 1).map(([name, ids]) => [name, [...ids][0]!]));
}

/** Keep only twenty small records per actor in memory; default is a dry run. */
export async function enforceAuditRetention(model: Model<any>, apply = false) {
  const identities = await auditIdentities(model);
  const cursor = model.find().select('_id actorUserId actorName actorKey createdAt').sort({ _id: 1 }).lean().cursor({ batchSize: 500 });
  let before = 0, deleted = 0, wouldDelete = 0;
  const groups = new Map<string, any[]>();
  let removals: Types.ObjectId[] = [], updates: any[] = [];
  const flush = async () => {
    if (updates.length) { await model.bulkWrite(updates, { ordered: true }); updates = []; }
    if (removals.length) { deleted += (await model.deleteMany({ _id: { $in: removals } })).deletedCount; removals = []; }
  };
  for await (const record of cursor) {
    before++;
    const actorId = record.actorUserId ? String(record.actorUserId) : identities.get(normalizedName(record.actorName));
    const key = actorId ? `user:${actorId}` : `name:${normalizedName(record.actorName)}`;
    const group = groups.get(key) || [];
    const timestamp = record.createdAt ? +new Date(record.createdAt) : (record._id as Types.ObjectId).getTimestamp().getTime();
    group.push({ _id: record._id, actorUserId: record.actorUserId, previousActorKey: record.actorKey, timestamp, missingCreatedAt: !record.createdAt });
    group.sort((a, b) => b.timestamp - a.timestamp || String(b._id).localeCompare(String(a._id)));
    if (group.length > AUDIT_RETENTION_LIMIT) {
      const excess = group.pop()!;
      wouldDelete++;
      if (apply) removals.push(excess._id);
    }
    groups.set(key, group);
    if (apply && removals.length >= 500) await flush();
  }
  for (const [actorKey, group] of groups) for (const record of group) {
    if (apply && (record.previousActorKey !== actorKey || record.missingCreatedAt)) {
      const actorId = actorKey.startsWith('user:') ? actorKey.slice(5) : null;
      updates.push({ updateOne: { filter: { _id: record._id }, update: { $set: {
        actorKey, ...(actorId && !record.actorUserId ? { actorUserId: new Types.ObjectId(actorId) } : {}),
        ...(record.missingCreatedAt ? { createdAt: new Date(record.timestamp) } : {}),
      } } } });
      if (updates.length >= 500) await flush();
    }
  }
  if (apply) await flush();
  return { applied: apply, limitPerStaff: AUDIT_RETENTION_LIMIT, before, retained: before - wouldDelete, wouldDelete, deleted, actorGroups: groups.size };
}
