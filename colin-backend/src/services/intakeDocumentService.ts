import mongoose from 'mongoose';
import { ClientIntakeAttachment } from '../models/digitalIntakeModel';
import Document from '../models/documentModel';

/** Link existing stored bytes into normal matter documents; never copy the file. */
export const linkIntakeDocumentsToMatter = async (submissionId: unknown, matterId: unknown) => {
  if (!submissionId) return;
  const files = await ClientIntakeAttachment.find({ submissionId });
  for (const file of files) {
    const url = `/api/digital-intake/files/${file._id}`;
    await Document.updateOne({ caseId: new mongoose.Types.ObjectId(String(matterId)), url }, { $setOnInsert: {
      name: file.name, category: 'Digital intake', uploadedBy: 'Client intake submission',
      uploadedDate: file.createdAt.toISOString().slice(0, 10), size: `${(file.size / 1048576).toFixed(2)} MB`, version: 1,
    } }, { upsert: true });
    await ClientIntakeAttachment.updateOne({ _id: file._id }, { $set: { matterId: new mongoose.Types.ObjectId(String(matterId)) } });
  }
};
