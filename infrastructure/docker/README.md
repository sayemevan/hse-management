# Docker — local development

Docker is a **development convenience only**; production runs on Cloudflare (ADR-001).
Inside the container, Wrangler emulates D1, R2, KV and Queues locally, so no cloud account is needed.

```bash
node scripts/setup.mjs
docker compose -f infrastructure/docker/compose.yaml up
```

| Service | URL                                 |
| ------- | ----------------------------------- |
| api     | http://localhost:8787/api/v1/health |
| web     | http://localhost:3000               |

The `install` service runs `npm ci` once into a named volume before `api` and `web` start.
