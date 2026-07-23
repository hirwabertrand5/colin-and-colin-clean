import FeedbackRequest from '../../../models/clientExperience/feedbackRequestModel';
import type { CreateFeedbackRequestDto, UpdateFeedbackRequestDto } from '../dto/clientExperienceDto';

export const feedbackRequestService = {
  async list() {
    return FeedbackRequest.find({}).populate('templateId').sort({ createdAt: -1 }).lean();
  },

  async getById(id: string) {
    return FeedbackRequest.findById(id).populate('templateId').lean();
  },

  async create(payload: CreateFeedbackRequestDto) {
    return FeedbackRequest.create(payload);
  },

  async update(id: string, payload: UpdateFeedbackRequestDto) {
    return FeedbackRequest.findByIdAndUpdate(id, payload, { new: true });
  },

  async remove(id: string) {
    return FeedbackRequest.findByIdAndDelete(id);
  },
};

export type FeedbackRequestService = typeof feedbackRequestService;
