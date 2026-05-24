import mongoose, { Schema, Document } from 'mongoose';

export interface IHelpArticle extends Document {
  title: string;
  description: string;
  category: string; // e.g. "getting-started"
  type: 'Guide' | 'Tutorial' | 'Policy';
  contentMd: string; // markdown text
  isPublished: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const HelpArticleSchema = new Schema<IHelpArticle>(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    category: { type: String, required: true, index: true },
    type: { type: String, enum: ['Guide', 'Tutorial', 'Policy'], default: 'Guide' },
    contentMd: { type: String, required: true },
    isPublished: { type: Boolean, default: true, index: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

HelpArticleSchema.index({ title: 'text', description: 'text', contentMd: 'text' });

export default mongoose.model<IHelpArticle>('HelpArticle', HelpArticleSchema);