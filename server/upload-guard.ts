import type { RequestHandler } from "express";
import multer from "multer";

// Route multer failures to clean client errors instead of falling through to
// the default error handler (which reported them to Sentry as unhandled 500s,
// e.g. the 2026-07-19 MulterError on POST /api/upload-image): size limits →
// 413, everything else (bad type, malformed part) → 400.
export function guardUpload(uploader: RequestHandler): RequestHandler {
  return (req, res, next) =>
    uploader(req, res, (err: unknown) => {
      if (!err) return next();
      const tooLarge = err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE";
      const message = err instanceof Error ? err.message : "Upload failed";
      res.status(tooLarge ? 413 : 400).json({ message });
    });
}
