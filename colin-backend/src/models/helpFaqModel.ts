import mongoose, { Schema, Document } from 'mongoose';

export interface IHelpFaq extends Document {
  question: string;
  answer: string;
  order: number;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const HelpFaqSchema = new Schema<IHelpFaq>(
  {
    question: { type: String, required: true, trim: true },
    answer: { type: String, required: true, trim: true },
    order: { type: Number, default: 0 },
    isPublished: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

export default mongoose.model<IHelpFaq>('HelpFaq', HelpFaqSchema);