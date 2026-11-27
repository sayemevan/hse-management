import 'fake-indexeddb/auto';

// The web app reads its public configuration at import time (src/config/public-env.ts).
process.env.NEXT_PUBLIC_APP_NAME ??= 'HSE Platform';
process.env.NEXT_PUBLIC_API_BASE_URL ??= '/api/v1';
process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ??= 'test-site-key';
