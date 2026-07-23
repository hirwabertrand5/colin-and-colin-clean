import Complaint from '../../../models/clientExperience/complaintModel';
import type { ComplaintDto } from '../dto/clientExperienceDto';

export const complaintService = {
  async list() {
    return Complaint.find({}).sort({ createdAt: -1 }).lean();
  },

  async create(payload: ComplaintDto) {
    return Complaint.create(payload);
  },

  async update(id: string, payload: Partial<ComplaintDto>) {
    return Complaint.findByIdAndUpdate(id, payload, { new: true });
  },
};

export type ComplaintService = typeof complaintService;
