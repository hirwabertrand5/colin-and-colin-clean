import { Response } from 'express';
import AuditLog from '../models/auditLogModel';
import Case from '../models/caseModel';
import { AuthRequest } from '../middleware/authMiddleware';
import { resolveOptionalReportRange } from '../utils/reportRange';

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
    const limit = Math.min(Number(req.query.limit) || 20, 50);

    const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(limit).lean();

    res.json(await withCaseInfo(logs));
  } catch {
    res.status(500).json({ message: 'Failed to fetch audit feed.' });
  }
};

// GET /api/audit/mine?limit=50&range=weekly | from=YYYY-MM-DD&to=YYYY-MM-DD
// The signed-in user's own activity trail — every recorded action they carried
// out, newest first, with the related matter attached. Members are matched by
// user id, with a name fallback for older records stored before actorUserId.
// The optional period uses the same range rules as the staff dashboard summary,
// so the trail always describes the exact window shown on the dashboard.
export const getMyAuditTrail = async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    const userId = String(req.user?.id || '').trim();
    const userName = String(req.user?.name || '').trim();

    const identityClauses: any[] = [];
    if (userId) identityClauses.push({ actorUserId: userId });
    if (userName) identityClauses.push({ actorName: new RegExp(`^\\s*${escapeRegex(userName)}\\s*$`, 'i') });

    if (!identityClauses.length) return res.status(401).json({ message: 'Unauthorized.' });

    const resolved = resolveOptionalReportRange(req.query);
    if (resolved && 'error' in resolved) {
      return res.status(400).json({ message: resolved.error });
    }
    const period = resolved || null;

    const query: any = { $or: identityClauses };
    if (period) query.createdAt = { $gte: period.from, $lte: period.to };

    const logs = await AuditLog.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json(await withCaseInfo(logs));
  } catch {
    res.status(500).json({ message: 'Failed to fetch your activity trail.' });
  }
};