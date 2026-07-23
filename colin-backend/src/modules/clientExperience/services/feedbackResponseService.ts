import FeedbackResponse from '../../../models/clientExperience/feedbackResponseModel';
import type { FeedbackResponseDto } from '../dto/clientExperienceDto';

export const feedbackResponseService = {
  async list() {
    return FeedbackResponse.find({}).sort({ createdAt: -1 }).lean();
  },

  async getByFeedbackRequestId(feedbackRequestId: string) {
    return FeedbackResponse.findOne({ feedbackRequestId }).lean();
  },

  async create(payload: FeedbackResponseDto) {
    return FeedbackResponse.create(payload);
  },

  async update(feedbackRequestId: string, payload: Partial<FeedbackResponseDto>) {
    return FeedbackResponse.findOneAndUpdate({ feedbackRequestId }, payload, { new: true, upsert: true });
  },
};

export type FeedbackResponseService = typeof feedbackResponseService;
