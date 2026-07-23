import type { FeedbackRequestStatus, FeedbackResponseSource } from '../../../models/clientExperience/feedbackRequestModel';

export interface CreateFeedbackTemplateDto {
  name: string;
  triggerType: string;
  description?: string;
  googleFormId?: string;
  googleFormUrl?: string;
  emailSubject?: string;
  emailBody?: string;
  isActive?: boolean;
}

export type UpdateFeedbackTemplateDto = Partial<CreateFeedbackTemplateDto>;

export interface CreateFeedbackRequestDto {
  requestNumber?: string;
  clientId?: string;
  clientType?: 'prospect' | 'matter' | 'client';
  prospectId?: string;
  matterId?: string;
  feedbackType: string;
  clientEmail?: string;
  googleFormUrl?: string;
  uniqueToken?: string;
  status?: FeedbackRequestStatus;
  createdBy?: string;
  createdAt?: string;
  sentAt?: string;
  openedAt?: string;
  completedAt?: string;
  expiresAt?: string;
  resendCount?: number;
  lastResentAt?: string;
  reminderState?: 'No Reminder' | 'First Reminder' | 'Second Reminder' | 'Final Reminder';
  reminderSentAt?: string;
}

export type UpdateFeedbackRequestDto = Partial<CreateFeedbackRequestDto>;

export interface FeedbackResponseDto {
  feedbackRequestId: string;
  submittedAt?: string;
  overallRating?: number;
  wouldRecommend?: boolean;
  wouldInstructAgain?: boolean;
  comments?: string;
  rawResponse?: string;
  responseSource?: FeedbackResponseSource;
}

export interface InternalAssessmentDto {
  feedbackRequestId: string;
  completedBy?: string;
  role?: string;
  category?: string;
  wasLossAvoidable?: boolean;
  estimatedConversionProbability?: string;
  improvementRecommendations?: string;
  partnerApprovalStatus?: 'Pending' | 'Approved' | 'Rejected';
  approvedBy?: string;
  approvedAt?: string;
  comments?: string;
}

export interface RedFlagDto {
  clientId?: string;
  matterId?: string;
  feedbackRequestId?: string;
  severity?: 'Low' | 'Medium' | 'High' | 'Critical';
  reason?: string;
  status?: 'Open' | 'In Progress' | 'Resolved' | 'Closed';
  assignedPartner?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolution?: string;
}

export interface ComplaintDto {
  clientId?: string;
  matterId?: string;
  category?: string;
  description?: string;
  priority?: string;
  status?: string;
  assignedTo?: string;
  resolution?: string;
  closedAt?: string;
}
