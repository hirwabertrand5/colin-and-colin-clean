import express from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware';
import {
  createAssessment,
  createRequest,
  createTemplate,
  getAssessment,
  getRequest,
  listComplaints,
  listRedFlags,
  listRequests,
  listResponses,
  listTemplates,
  resendRequest,
  sendRequest,
  updateRequest,
} from '../modules/clientExperience/controllers/clientExperienceController';

const router = express.Router();
const clientExperienceRoles = ['managing_director', 'managing_partner', 'executive_managing_partner', 'partner', 'associate_partner', 'executive_assistant', 'associate', 'senior_associate', 'trainee_associate'];

router.get('/templates', authenticate, authorize(clientExperienceRoles), listTemplates);
router.post('/templates', authenticate, authorize(clientExperienceRoles), createTemplate);

router.get('/requests', authenticate, authorize(clientExperienceRoles), listRequests);
router.get('/request/:id', authenticate, authorize(clientExperienceRoles), getRequest);
router.post('/request', authenticate, authorize(clientExperienceRoles), createRequest);
router.post('/request/send', authenticate, authorize(clientExperienceRoles), sendRequest);
router.post('/request/:id/resend', authenticate, authorize(clientExperienceRoles), resendRequest);
router.put('/request/:id', authenticate, authorize(clientExperienceRoles), updateRequest);

router.get('/responses', authenticate, authorize(clientExperienceRoles), listResponses);
router.get('/assessment/:id', authenticate, authorize(clientExperienceRoles), getAssessment);
router.post('/assessment', authenticate, authorize(clientExperienceRoles), createAssessment);

router.get('/redflags', authenticate, authorize(clientExperienceRoles), listRedFlags);
router.get('/complaints', authenticate, authorize(clientExperienceRoles), listComplaints);

export default router;
