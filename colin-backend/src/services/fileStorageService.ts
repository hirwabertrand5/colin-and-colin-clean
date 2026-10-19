import fs from 'fs/promises';
import path from 'path';
import { Request, Response } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { GridFSBucket, ObjectId } from 'mongodb';
import { Readable } from 'stream';

/**
 * File uploads used to be written only to the web server's local `uploads`
 * directory. That directory is ephemeral on most production hosts (including
 * Render), so database records outlived their files after a restart/deploy.
 *
 * New uploads live in GridFS, which is persisted with MongoDB. The local
 * directory remains a read-only compatibility layer for old uploads and for
 * any deployment that still has a persistent disk mounted at UPLOAD_DIR.
 */
const GRIDFS_BUCKET_NAME = 'uploads';
const DEFAULT_MAX_FILE_SIZE_MB = 25;

export const getLegacyUploadsDirectory = () =>
  path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads'));

const getGridFsBucket = () => {
  const db = mongoose.connection.db;
  if (!db) throw new Error('File storage is unavailable because MongoDB is not connected.');
  return new GridFSBucket(db, { bucketName: GRIDFS_BUCKET_NAME });
};

const maxFileSize = () => {
  const configured = Number(process.env.UPLOAD_MAX_FILE_SIZE_MB);
  const megabytes = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_FILE_SIZE_MB;
  return megabytes * 1024 * 1024;
};

// All document-upload routes use this one middleware so no route can
// accidentally fall back to the ephemeral server filesystem again.
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxFileSize() },
});

const safeFilename = (filename: string) => path.basename(filename || 'upload');

const uploadBuffer = async (
  buffer: Buffer,
  filename: string,
  metadata: Record<string, unknown>,
  contentType?: string
) => {
  const bucket = getGridFsBucket();
  const stream = bucket.openUploadStream(safeFilename(filename), {
    ...(contentType ? { contentType } : {}),
    metadata,
  });

  await new Promise<void>((resolve, reject) => {
    stream.on('error', reject);
    stream.on('finish', resolve);
    Readable.from(buffer).pipe(stream);
  });

  return String(stream.id);
};

/** Persist a new multer file and return the stable public download path. */
export const storeUploadedFile = async (file: Express.Multer.File) => {
  if (!file.buffer) throw new Error('The uploaded file could not be read.');

  const id = await uploadBuffer(
    file.buffer,
    file.originalname,
    {
      originalName: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
      uploadedAt: new Date(),
    },
    file.mimetype
  );

  return `/uploads/${id}`;
};

const fileKeyFromUrl = (url: string) => {
  const prefix = '/uploads/';
  if (!url.startsWith(prefix)) return undefined;
  const value = url.slice(prefix.length).split('/')[0];
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
};

/**
 * Serves files stored in GridFS. `app.ts` puts the legacy static directory in
 * front of this handler, so existing filename-based URLs still resolve from a
 * mounted/local legacy directory before this fallback is consulted.
 */
export const serveStoredUpload = async (req: Request, res: Response) => {
  const rawKey = Array.isArray(req.params.fileKey) ? req.params.fileKey[0] : req.params.fileKey;
  const fileKey = rawKey ? decodeURIComponent(rawKey) : '';
  const bucket = getGridFsBucket();

  const file = ObjectId.isValid(fileKey)
    ? await bucket.find({ _id: new ObjectId(fileKey) }).next()
    : await bucket.find({ filename: safeFilename(fileKey) }).sort({ uploadDate: -1 }).next();

  if (!file) {
    return res.status(404).json({
      message: 'The uploaded file is unavailable. It may have been removed before persistent storage was enabled.',
    });
  }

  const metadata = (file.metadata || {}) as { originalName?: unknown; mimeType?: unknown };
  const downloadName = safeFilename(
    typeof metadata.originalName === 'string' ? metadata.originalName : file.filename
  );
  const contentType = typeof metadata.mimeType === 'string' ? metadata.mimeType : 'application/octet-stream';

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', String(file.length));
  res.setHeader('Content-Disposition', `inline; filename="${downloadName.replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'private, max-age=86400');

  const stream = bucket.openDownloadStream(file._id);
  stream.on('error', () => {
    if (!res.headersSent) res.status(500).json({ message: 'Failed to read the uploaded file.' });
    else res.destroy();
  });
  stream.pipe(res);
};

/**
 * Copies legacy filesystem uploads into GridFS without changing their existing
 * URLs. This is safe to run repeatedly and is used at startup as a last chance
 * to preserve files that are still present on a local/persistent disk.
 */
export const migrateLegacyUploadsToGridFs = async () => {
  const directory = getLegacyUploadsDirectory();
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true, encoding: 'utf8' });

    const bucket = getGridFsBucket();
    let migrated = 0;
    let skipped = 0;

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filename = safeFilename(entry.name);
      const existing = await bucket.find({ filename }).limit(1).next();
      if (existing) {
        skipped += 1;
        continue;
      }

      const filePath = path.join(directory, filename);
      const buffer = await fs.readFile(filePath);
      await uploadBuffer(buffer, filename, {
        originalName: filename,
        size: buffer.length,
        migratedFromLegacyDisk: true,
        uploadedAt: new Date(),
      });
      migrated += 1;
    }

    return { migrated, skipped };
  } catch (error: any) {
    if (error?.code === 'ENOENT') return { migrated: 0, skipped: 0 };
    throw error;
  }
};

/** Remove a GridFS file when no database record references it any longer. */
export const deleteStoredFile = async (url: string) => {
  const key = fileKeyFromUrl(url);
  if (!key || !ObjectId.isValid(key)) return;

  try {
    await getGridFsBucket().delete(new ObjectId(key));
  } catch (error: any) {
    // Deletion is intentionally idempotent; records may reference a legacy
    // file or an already-removed GridFS object.
    if (error?.code !== 'ENOENT') throw error;
  }
};
