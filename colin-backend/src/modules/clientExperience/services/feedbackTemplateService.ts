import FeedbackTemplate from '../../../models/clientExperience/feedbackTemplateModel';
import type { CreateFeedbackTemplateDto, UpdateFeedbackTemplateDto } from '../dto/clientExperienceDto';

const normalizeTrigger = (value?: string) => String(value || '').trim().toUpperCase();

export const feedbackTemplateService = {
  async list() {
    return FeedbackTemplate.find({}).sort({ createdAt: -1 }).lean();
  },

  async getById(id: string) {
    return FeedbackTemplate.findById(id).lean();
  },

  async getByTrigger(triggerType?: string) {
    const trigger = normalizeTrigger(triggerType);
    if (!trigger) return null;
    return FeedbackTemplate.findOne({ triggerType: trigger, isActive: true }).lean();
  },

  async getByTriggerOrThrow(triggerType?: string) {
    const template = await this.getByTrigger(triggerType);
    if (!template) {
      throw new Error(`No active feedback template has been configured for ${triggerType || 'this feedback type'}.`);
    }
    return template;
  },

  async create(payload: CreateFeedbackTemplateDto) {
    return FeedbackTemplate.create(payload);
  },

  async update(id: string, payload: UpdateFeedbackTemplateDto) {
    return FeedbackTemplate.findByIdAndUpdate(id, payload, { new: true });
  },

  async remove(id: string) {
    return FeedbackTemplate.findByIdAndDelete(id);
  },

  async upsertByTrigger(payload: CreateFeedbackTemplateDto) {
    const trigger = normalizeTrigger(payload.triggerType);
    if (!trigger) return null;

    return FeedbackTemplate.findOneAndUpdate(
      { triggerType: trigger },
      { $set: { ...payload, triggerType: trigger } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
  },
};

export type FeedbackTemplateService = typeof feedbackTemplateService;
