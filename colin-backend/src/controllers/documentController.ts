import multer, { StorageEngine } from 'multer';
import path from 'path';
import mongoose from 'mongoose';
import { Response } from 'express';

import Document from '../models/documentModel';
import { AuthRequest } from '../middleware/authMiddleware';
import { writeAudit } from '../services/auditService';

const storage: StorageEngine = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

export const upload = multer({ storage });

const actorFromReq = (req: AuthRequest) => ({
  actorName: req.user?.name || 'System',
  actorUserId: req.user?.id as string | undefined,
});

export const getDocumentsForCase = async (req: AuthRequest, res: Response) => {
  try {
    let caseId: any = req.params.caseId;
    if (Array.isArray(caseId)) caseId = caseId[0];
    if (!caseId) return res.status(400).json({ message: 'Missing caseId' });

    const documents = await Document.find({
      caseId: new mongoose.Types.ObjectId(caseId),
    }).sort({ uploadedDate: -1 });

    res.json(documents);
  } catch {
    res.status(500).json({ message: 'Failed to fetch documents.' });
  }
};

export const addDocumentToCase = async (req: AuthRequest, res: Response) => {
  try {
    let caseId: any = req.params.caseId;
    if (Array.isArray(caseId)) caseId = caseId[0];
    if (!caseId) return res.status(400).json({ message: 'Missing caseId' });

    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const userName = req.user?.name || 'Unknown';

    const newDoc = new Document({
      caseId: new mongoose.Types.ObjectId(caseId),
      name: req.body.name,
      category: req.body.category || undefined,

      workflowInstanceId: req.body.workflowInstanceId
        ? new mongoose.Types.ObjectId(req.body.workflowInstanceId)
        : undefined,
      stepKey: req.body.stepKey || undefined,
      outputKey: req.body.outputKey || undefined,

      uploadedBy: userName,
      uploadedDate: new Date().toISOString().slice(0, 10),
      size: (req.file.size / 1024 / 1024).toFixed(2) + ' MB',
      url: `/uploads/${req.file.filename}`,
    });

    await newDoc.save();

    const actor = actorFromReq(req);

    await writeAudit({
      caseId,
      actorName: actor.actorName,
      ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
      action: 'DOCUMENT_UPLOADED',
      message: 'Uploaded document',
      detail: `${newDoc.name || 'Untitled'}${newDoc.stepKey ? ` • Step: ${newDoc.stepKey}` : ''}${
        newDoc.outputKey ? ` • Output: ${newDoc.outputKey}` : ''
      }`,
    });

    res.status(201).json(newDoc);
  } catch {
    res.status(500).json({ message: 'Failed to create document.' });
  }
};

export const deleteDocument = async (req: AuthRequest, res: Response) => {
  try {
    let docId: any = req.params.docId;
    if (Array.isArray(docId)) docId = docId[0];
    if (!docId) return res.status(400).json({ message: 'Missing docId' });

    const deleted = await Document.findByIdAndDelete(docId);
    if (!deleted) return res.status(404).json({ message: 'Document not found.' });

    const actor = actorFromReq(req);

    await writeAudit({
      caseId: String((deleted as any).caseId),
      actorName: actor.actorName,
      ...(actor.actorUserId ? { actorUserId: actor.actorUserId } : {}),
      action: 'DOCUMENT_DELETED',
      message: 'Deleted document',
      detail: `${(deleted as any).name || 'Untitled'}`,
    });

    res.json({ message: 'Document deleted.' });
  } catch {
    res.status(500).json({ message: 'Failed to delete document.' });
  }
};