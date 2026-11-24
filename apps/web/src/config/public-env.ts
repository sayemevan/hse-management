import { z } from 'zod';

/**
 * Public (browser-visible) configuration, validated once at module load.
 * Next.js inlines `process.env.NEXT_PUBLIC_*` only when accessed statically, so each key
 * is read explicitly below. Never put secrets here.
 */
const publicEnvSchema = z.object({
  appName: z.string().min(1),
  // A same-origin path such as /api/v1 (T-4): cookies stay first-party and no CORS is needed.
  apiBaseUrl: z.string().regex(/^\/[a-z0-9/_-]*$/i, 'must be a same-origin path'),
  // Cloudflare Turnstile site key for the public registration form (T-11). Public by design.
  turnstileSiteKey: z.string().min(1),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export const publicEnv: PublicEnv = publicEnvSchema.parse({
  appName: process.env.NEXT_PUBLIC_APP_NAME,
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL,
  turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
});
