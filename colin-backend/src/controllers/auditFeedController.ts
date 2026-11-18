import { Response } from 'express';
import AuditLog from '../models/auditLogModel';
import Case from '../models/caseModel';
import { AuthRequest } from '../middleware/authMiddleware';
import { resolveOptionalReportRange } from '../utils/reportRange';
import { AUDIT_RETENTION_LIMIT } from '../utils/auditRetention';

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Attach the matter (case number / parties) to each audit record. */
const withCaseInfo = async (logs: any[]) => {
  const caseIds = Array.from(new Set(logs.map((l: any) => String(l.caseId))));
  const cases = await Case.find({ _id: { $in: caseIds } })
    .select('_id caseNo parties')
    .lean();

  const caseMap = new Map(cases.map((c: any) => [String(c._id), c]));

  return logs.map((l: any) => {
    const c = caseMap.get(String(l.caseId));
    return {
      ...l,
      case: c ? { _id: String(c._id), caseNo: c.caseNo, parties: c.parties } : null,
    };
  });
};

// GET /api/audit/recent?limit=20
export const getRecentAuditFeed = async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(Math.max(Math.floor(Number(req.query.limit) || AUDIT_RETENTION_LIMIT), 1), AUDIT_RETENTION_LIMIT);

    const logs = await AuditLog.find().sort({ createdAt: -1, _id: -1 }).limit(limit).lean();

    res.json(await withCaseInfo(logs));
  } catch {
    res.status(500).json({ message: 'Failed to fetch audit feed.' });
  }
};

// Latest retained activity for the signed-in member, optionally filtered by
// period. Sorting and pagination operate only on this capped twenty-row set.
export const getMyAuditTrail = async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(Math.max(Math.floor(Number(req.query.limit) || AUDIT_RETENTION_LIMIT), 1), AUDIT_RETENTION_LIMIT);
    const requestedPage = Math.max(Math.floor(Number(req.query.page) || 1), 1);

    const userId = String(req.user?.id || '').trim();
    const userName = String(req.user?.name || '').trim();

    const identityClauses: any[] = [];
    if (userId) identityClauses.push({ actorUserId: userId });
    if (userName) identityClauses.push({ actorUserId: null, actorName: new RegExp(`^\\s*${escapeRegex(userName)}\\s*$`, 'i') });

    if (!identityClauses.length) return res.status(401).json({ message: 'Unauthorized.' });

    const resolved = resolveOptionalReportRange(req.query);
    if (resolved && 'error' in resolved) {
      return res.status(400).json({ message: resolved.error });
    }
    const period = resolved || null;

    const query: any = { $or: identityClauses };
    if (period) query.createdAt = { $gte: period.from, $lte: period.to };

    // Server-side sort restricted to real fields so a cross-page sort is always
    // meaningful. "when" defaults to newest-first, matching the dashboard.
    const sortDir = String(req.query.sortDir || 'desc').toLowerCase() === 'asc' ? 1 : -1;
    const SORTABLE_FIELDS: Record<string, string> = {
      when: 'createdAt',
      action: 'action',
      activity: 'message',
    };
    const sortField = SORTABLE_FIELDS[String(req.query.sortBy || '').trim()] || 'createdAt';

    const logs = await AuditLog.find(query).sort({ createdAt: -1, _id: -1 }).limit(AUDIT_RETENTION_LIMIT).lean();
    logs.sort((a: any, b: any) => {
      const comparison = sortField === 'createdAt' ? +new Date(a.createdAt) - +new Date(b.createdAt)
        : String(a[sortField] || '').localeCompare(String(b[sortField] || ''));
      return comparison * sortDir || String(b._id).localeCompare(String(a._id));
    });
    const total = logs.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(requestedPage, pages);
    res.json({
      items: await withCaseInfo(logs.slice((page - 1) * limit, page * limit)),
      total,
      page,
      pages,
      limit,
      retentionLimit: AUDIT_RETENTION_LIMIT,
    });
  } catch {
    res.status(500).json({ message: 'Failed to fetch your activity trail.' });
  }
};
