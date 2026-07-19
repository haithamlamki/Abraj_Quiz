import { z } from "zod";

// Body for POST /api/generate-background. Either a free-text prompt (drives
// the image) or a quiz title (legacy fallback) must carry >= 3 usable chars.
export const generateBackgroundBodySchema = z
  .object({
    prompt: z.string().trim().min(3).max(300).optional(),
    title: z.string().trim().max(100).optional(),
    description: z.string().trim().max(500).optional(),
  })
  .refine((b) => (b.prompt?.length ?? 0) >= 3 || (b.title?.length ?? 0) >= 3, {
    message: "Provide a prompt (or quiz title) of at least 3 characters",
  });

export type GenerateBackgroundBody = z.infer<typeof generateBackgroundBodySchema>;
