import InternalAssessment from '../../../models/clientExperience/internalAssessmentModel';
import type { InternalAssessmentDto } from '../dto/clientExperienceDto';

export const internalAssessmentService = {
  async getByFeedbackRequestId(feedbackRequestId: string) {
    return InternalAssessment.findOne({ feedbackRequestId }).lean();
  },

  async create(payload: InternalAssessmentDto) {
    return InternalAssessment.create(payload);
  },

  async update(feedbackRequestId: string, payload: Partial<InternalAssessmentDto>) {
    return InternalAssessment.findOneAndUpdate({ feedbackRequestId }, payload, { new: true, upsert: true });
  },
};

export type InternalAssessmentService = typeof internalAssessmentService;
