import { randomUUID } from "node:crypto";

// Uploads a quiz image to the public Supabase Storage `quiz-images` bucket and
// returns its public URL. Keeps images OUT of the quiz JSON payload (URL only),
// so the payload stays small for large lobbies.
//
// Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (server-only). The service
// role bypasses Storage RLS; the bucket is public-read so players load the
// image directly from the CDN.
const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export function isImageUploadConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function uploadQuizImage(buffer: Buffer, contentType: string): Promise<string> {
  const baseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    throw new Error("Image upload is not configured (set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)");
  }

  const ext = EXT_BY_MIME[contentType];
  if (!ext) {
    throw new Error(`Unsupported image type: ${contentType}`);
  }

  const objectPath = `${randomUUID()}.${ext}`;
  const res = await fetch(`${baseUrl}/storage/v1/object/quiz-images/${objectPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": contentType,
      "cache-control": "public, max-age=31536000, immutable",
    },
    body: buffer,
  });

  if (!res.ok) {
    throw new Error(`Supabase Storage upload failed: ${res.status} ${await res.text()}`);
  }

  return `${baseUrl}/storage/v1/object/public/quiz-images/${objectPath}`;
}
