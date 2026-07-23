import RedFlag from '../../../models/clientExperience/redFlagModel';
import type { RedFlagDto } from '../dto/clientExperienceDto';

export const redFlagService = {
  async list() {
    return RedFlag.find({}).sort({ createdAt: -1 }).lean();
  },

  async create(payload: RedFlagDto) {
    return RedFlag.create(payload);
  },

  async update(id: string, payload: Partial<RedFlagDto>) {
    return RedFlag.findByIdAndUpdate(id, payload, { new: true });
  },
};

export type RedFlagService = typeof redFlagService;
