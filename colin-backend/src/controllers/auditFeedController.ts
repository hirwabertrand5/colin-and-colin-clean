import { Response } from 'express';
import AuditLog from '../models/auditLogModel';
import Case from '../models/caseModel';
import { AuthRequest } from '../middleware/authMiddleware';

// GET /api/audit/recent?limit=20
export const getRecentAuditFeed = async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50);

    const logs = await AuditLog.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const caseIds = Array.from(new Set(logs.map((l: any) => String(l.caseId))));
    const cases = await Case.find({ _id: { $in: caseIds } })
      .select('_id caseNo parties')
      .lean();

    const caseMap = new Map(cases.map((c: any) => [String(c._id), c]));

    res.json(
      logs.map((l: any) => {
        const c = caseMap.get(String(l.caseId));
        return {
          ...l,
          case: c ? { _id: String(c._id), caseNo: c.caseNo, parties: c.parties } : null,
        };
      })
    );
  } catch {
    res.status(500).json({ message: 'Failed to fetch audit feed.' });
  }
};