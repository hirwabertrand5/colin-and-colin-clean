import mongoose, { Schema, Document } from 'mongoose';

export interface ICounter extends Document {
  key: string; // e.g. "invoice:2026"
  seq: number;
}

const CounterSchema = new Schema<ICounter>({
  key: { type: String, required: true, unique: true, index: true },
  seq: { type: Number, required: true, default: 0 },
});

export default mongoose.model<ICounter>('Counter', CounterSchema);