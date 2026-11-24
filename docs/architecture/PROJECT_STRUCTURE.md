# Project Structure

```
hse-management/
├── apps/
│   ├── api/                         Hono API on Cloudflare Workers (modular monolith)
│   │   ├── src/
│   │   │   ├── index.ts             Worker entry (fetch; queue/scheduled handlers later)
│   │   │   ├── app.ts               createApp(): middleware + route composition
│   │   │   ├── config/              env schema (Zod) + typed AppConfig
│   │   │   ├── core/                cross-cutting, business-agnostic
│   │   │   │   ├── auth/            password hashing, JWT tokens, auth + permission middleware
│   │   │   │   ├── context/         Hono env/variables typing
│   │   │   │   ├── errors/          AppError hierarchy + global error handler
│   │   │   │   ├── http/            response envelope helpers, validation helper
│   │   │   │   ├── logging/         structured logger with redaction
│   │   │   │   └── middleware/      request-id, request logging, security headers, CORS
│   │   │   ├── database/            Drizzle client factory, shared column helpers, UnitOfWork (D1 batch)
│   │   │   ├── platform/            shared platform services: audit-log (Sprint 1); files, notifications … later
│   │   │   ├── modules/             business modules — Sprint 1+
│   │   │   │   └── <module>/        <m>.routes.ts · <m>.service.ts · <m>.repository.ts
│   │   │   │                        <m>.schema.ts (entity) · <m>.dto.ts · <m>.validator.ts · index.ts
│   │   │   └── routes/              system routes (health) + v1 router composition
│   │   ├── migrations/              Drizzle-generated SQL migrations (D1) + custom SQL (triggers)
│   │   ├── scripts/                 operator commands: bootstrap-system-owner, seed-dev (run with tsx)
│   │   ├── test/                    unit tests; test/integration runs against an in-memory local D1
│   │   ├── drizzle.config.ts
│   │   └── wrangler.jsonc           bindings: DB (D1), FILES (R2), CACHE (KV), JOBS (Queue)
│   └── web/                         Next.js App Router PWA
│       ├── messages/                en.json, ar.json (every user-facing string, PLT-03)
│       └── src/
│           ├── app/                 routes only (thin), manifest; (public) and (app) route groups
│           ├── i18n/                language cookie, RTL direction, next-intl request config
│           ├── components/          shared UI (shadcn/ui primitives in components/ui)
│           ├── modules/             feature folders (UI + hooks per business module)
│           ├── hooks/               shared hooks
│           ├── services/            API client
│           ├── config/              validated public env
│           ├── utils/               cn() and other helpers
│           └── types/
├── packages/
│   ├── shared/                      framework-agnostic contracts: API envelope, error codes, pagination, ids, dates
│   ├── config-typescript/           tsconfig bases (base, worker, nextjs, library)
│   └── config-eslint/               shared ESLint flat config
├── infrastructure/
│   ├── cloudflare/                  resource inventory and provisioning notes per environment
│   └── docker/                      dev container image + compose (local development only)
├── scripts/                         cross-platform Node scripts (setup, checks)
├── tests/                           cross-app tests (e2e — later)
├── docs/                            documentation (see docs/README.md)
├── .github/workflows/ci.yml         lint · typecheck · test · build
└── package.json                     npm workspaces root
```

## Conventions (Master Rules, Reference Guide §1)

| Item                          | Convention                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------- |
| DB tables / columns           | `snake_case`, singular (`inspection`, `work_zone`)                               |
| TS classes / React components | `PascalCase`                                                                     |
| Variables / functions         | `camelCase`                                                                      |
| Files                         | `kebab-case.ts`, with role suffix: `.routes.ts`, `.service.ts`, `.repository.ts` |
| Web routes                    | `kebab-case`                                                                     |
| API                           | `/api/v1/<kebab-plural-resource>`                                                |

## Module rules

- A module's `index.ts` is its only public surface; deep imports across modules are lint errors.
- A repository only touches its own module's tables.
- Services receive dependencies through constructor parameters (no hidden globals), so they are unit-testable.
