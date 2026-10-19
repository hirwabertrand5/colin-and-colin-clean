# Upload storage

All new documents are stored in the MongoDB `uploads.files` and
`uploads.chunks` GridFS collections. This makes uploaded case documents, task
attachments, invoices, proofs, and petty-cash receipts survive backend
restarts and Render deployments.

Existing `/uploads/<filename>` links remain valid:

- If the legacy file is present in `UPLOAD_DIR` (or `./uploads` locally), it is
  served as before.
- On server start, every legacy file still on disk is copied to GridFS. The
  existing URL is then also available from GridFS even after the local copy is
  gone.
- New files are stored directly in GridFS and use an immutable GridFS id in
  their URL.

`UPLOAD_MAX_FILE_SIZE_MB` is optional and defaults to `25`.

Files that were already removed from an ephemeral production filesystem before
this change have no file bytes in MongoDB—the application stored only their
paths—so they must be recovered from a backup or the original uploader. Once a
recovered file is placed in `UPLOAD_DIR` and the backend is started, it is
automatically preserved in GridFS.
