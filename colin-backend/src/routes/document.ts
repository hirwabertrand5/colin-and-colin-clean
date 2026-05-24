import express from 'express';
import { getDocumentsForCase, addDocumentToCase, deleteDocument, upload } from '../controllers/documentController.js';
import { authenticate } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/cases/:caseId/documents', authenticate, getDocumentsForCase);
router.post('/cases/:caseId/documents', authenticate, upload.single('file'), addDocumentToCase);
router.delete('/documents/:docId', authenticate, deleteDocument);

export default router;