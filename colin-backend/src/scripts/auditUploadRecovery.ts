/**
 * Read-only audit of upload records. It distinguishes upload URLs whose bytes
 * are available in GridFS/local legacy storage from records that only retain a
 * now-missing filename. Run with: npx tsx src/scripts/auditUploadRecovery.ts
 */
import dotenv from 'dotenv';
import dns from 'dns';
import fs from 'fs';
import mongoose from 'mongoose';
import path from 'path';
import { getLegacyUploadsDirectory } from '../services/fileStorageService';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const sources = [
  ['documents', 'url'],
  ['invoices', 'invoiceFileUrl'],
  ['invoices', 'proofUrl'],
  ['taskattachments', 'url'],
  ['independent_task_attachments', 'url'],
  ['pettycashexpenses', 'receiptUrl'],
  ['pettycashexpenses', 'receiptUrls'],
] as const;

const uploadKey = (url: unknown) => {
  if (typeof url !== 'string') return undefined;
  const match = url.match(/^\/uploads\/([^/?#]+)/);
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
};

const main = async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not configured.');
  dns.setServers(['8.8.8.8', '1.1.1.1']);
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB connection is unavailable.');

  const references = new Map<string, number>();
  const bySource: Record<string, number> = {};

  for (const [collection, field] of sources) {
    let count = 0;
    const cursor = db.collection(collection).find(
      { [field]: { $exists: true, $ne: null } },
      { projection: { [field]: 1 } }
    );

    for await (const record of cursor) {
      const rawValue = record[field];
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      for (const value of values) {
        const key = uploadKey(value);
        if (!key) continue;
        count += 1;
        const url = `/uploads/${key}`;
        references.set(url, (references.get(url) || 0) + 1);
      }
    }
    bySource[`${collection}.${field}`] = count;
  }

  const legacyDirectory = getLegacyUploadsDirectory();
  const localFiles = new Set(fs.existsSync(legacyDirectory) ? fs.readdirSync(legacyDirectory) : []);
  const gridFsFiles = db.collection('uploads.files');
  let gridFs = 0;
  let local = 0;
  let unavailable = 0;
  const unavailableExamples: string[] = [];

  for (const url of references.keys()) {
    const key = uploadKey(url);
    if (!key) continue;

    const stored = mongoose.Types.ObjectId.isValid(key)
      ? await gridFsFiles.findOne({ _id: new mongoose.Types.ObjectId(key) })
      : await gridFsFiles.findOne({ filename: key });

    if (stored) gridFs += 1;
    else if (localFiles.has(key)) local += 1;
    else {
      unavailable += 1;
      if (unavailableExamples.length < 10) unavailableExamples.push(url);
    }
  }

  console.log(
    JSON.stringify(
      {
        totalReferences: [...references.values()].reduce((total, count) => total + count, 0),
        uniqueUploadUrls: references.size,
        recoverableFromGridFs: gridFs,
        recoverableFromLocalLegacyDirectory: local,
        unavailableInBothLocations: unavailable,
        localFilesNotNecessarilyReferenced: localFiles.size,
        referencesBySource: bySource,
        unavailableExamples,
      },
      null,
      2
    )
  );
};

main()
  .catch((error: unknown) => {
    console.error('[upload-recovery-audit]', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
