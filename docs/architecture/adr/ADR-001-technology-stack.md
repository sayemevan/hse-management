# ADR-001 — Technology Stack

| Field    | Value                                                                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------- |
| Status   | **Accepted**                                                                                               |
| Date     | 2026-11-10                                                                                                 |
| Decider  | Product Owner                                                                                              |
| Replaces | Tech Stack in `02_MASTER_RULES.md` (MASTER_REFERENCE_GUIDE §3), "One PostgreSQL database" (DATABASE rules) |

## Context

The two source-of-truth documents specified incompatible stacks:

| Concern     | Product Book — Doc 02            | Master Rules — Reference Guide §3 |
| ----------- | -------------------------------- | --------------------------------- |
| Backend     | Hono + TypeScript                | NestJS                            |
| Database    | Cloudflare D1 (PostgreSQL later) | PostgreSQL                        |
| ORM         | Drizzle                          | Prisma                            |
| Storage     | Cloudflare R2                    | S3-compatible storage             |
| Cache/Queue | Cloudflare KV / Queues           | not specified                     |
| Hosting     | Cloudflare (serverless first)    | Docker, Vercel, Railway / Hetzner |

## Decision

The **Cloudflare serverless stack from Product Book Doc 02** is authoritative.

| Layer      | Choice                                                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend   | Next.js (App Router), React, TypeScript, Tailwind CSS, shadcn/ui — deployed to Cloudflare Workers via `@opennextjs/cloudflare`; installable PWA |
| API        | Hono on Cloudflare Workers — one Worker, organised as a **modular monolith**                                                                    |
| Database   | Cloudflare D1 through Drizzle ORM (repositories only)                                                                                           |
| Files      | Cloudflare R2 (metadata in D1)                                                                                                                  |
| Cache      | Cloudflare KV (settings, temporary data only)                                                                                                   |
| Async jobs | Cloudflare Queues (notifications, email, image processing)                                                                                      |
| Validation | Zod (shared between API and web)                                                                                                                |
| Monorepo   | npm workspaces (native, no extra tool — Dependency Policy)                                                                                      |
| Docker     | Local development and CI parity only; **not** a production runtime                                                                              |

Rules from `02_MASTER_RULES.md` that remain in force: modular monolith, controller / service / repository per module, repository-only data access, UUID primary keys, snake_case, audit columns, `/api/v1`, `{ success, message, data, meta }` envelope, JWT + RBAC, deny by default.

## Consequences and mitigations

| Consequence                                                                                                                                                                     | Mitigation                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 has a per-database size cap (10 GB at time of writing) and a single writer per database. This conflicts with "millions of records / unlimited companies" over the long term. | Business logic never touches Drizzle directly; repositories are the only DB boundary. The PostgreSQL upgrade path (via Hyperdrive) or per-tenant D1 sharding stays open. Monitor size from Sprint 1. |
| D1 has **no interactive transactions**; only atomic `batch()`.                                                                                                                  | Repositories expose batch-based unit-of-work helpers. Workflow transitions must be designed as one atomic batch, never read-modify-write across round trips.                                         |
| SQLite types: no native UUID, JSON or timestamp types.                                                                                                                          | UUID stored as `TEXT`, timestamps as integer epoch-milliseconds (UTC), JSON as `TEXT` with Zod parsing.                                                                                              |
| Worker CPU limits make heavy PDF/Excel generation awkward.                                                                                                                      | Report generation runs as queued jobs. The PDF strategy (Browser Rendering vs library) is decided before Sprint "Reports".                                                                           |
| Workers have no native Argon2/bcrypt; WebCrypto PBKDF2 is capped at 100,000 iterations.                                                                                         | PBKDF2-SHA-256 at the Workers maximum, with a self-describing hash format (`pbkdf2$sha256$iterations$salt$hash`) so the algorithm can be upgraded on next login without migration.                   |
| The Docker request in the bootstrap prompt does not apply to production.                                                                                                        | Docker is provided for a reproducible local dev environment (Wrangler/Miniflare emulate D1, R2, KV and Queues locally).                                                                              |
