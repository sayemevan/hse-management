# Implementation Plan — HSE Management Platform

Derived from `01_PRODUCT_BOOK.md` and `02_MASTER_RULES.md`. Stack per [ADR-001](adr/ADR-001-technology-stack.md). Open issues are tracked in [DOCUMENTATION_REVIEW.md](DOCUMENTATION_REVIEW.md).

---

## 1. Architecture

```
 Users (mobile first, PWA)
        │  HTTPS
        ▼
 ┌───────────────────────────┐      ┌──────────────────────────────────────────┐
 │ apps/web — Next.js PWA    │ ───▶ │ apps/api — Hono Worker (modular monolith)│
 │ Presentation layer only   │ REST │                                          │
 │ (no business logic)       │ /api │  core/      cross-cutting (http, auth,   │
 └───────────────────────────┘  /v1 │             logging, config, middleware) │
                                    │  platform/  shared services (audit,      │
                                    │             files, notifications, search,│
                                    │             comments, timeline, reports) │
                                    │  modules/   business modules             │
                                    │    routes (controller) → service →       │
                                    │    repository → Drizzle                  │
                                    └──────┬─────────┬─────────┬──────────┬────┘
                                           ▼         ▼         ▼          ▼
                                          D1        R2        KV       Queues
                                      (records)  (files)   (cache)   (async jobs)
```

**Layer rules (Doc 01 §3–4, Architecture Rules):**

| Layer            | Lives in                    | May call                                                                       | Never                     |
| ---------------- | --------------------------- | ------------------------------------------------------------------------------ | ------------------------- |
| Presentation     | `apps/web`                  | API client                                                                     | business rules, direct DB |
| API (controller) | `modules/*/x.routes.ts`     | its own service                                                                | business rules, Drizzle   |
| Business         | `modules/*/x.service.ts`    | own repository, other modules' **public service interface**, platform services | HTTP objects, Drizzle     |
| Data             | `modules/*/x.repository.ts` | Drizzle, own tables only                                                       | other modules' tables     |

**Module isolation:** each module exports one `index.ts` (its public contract). An ESLint rule (`no-restricted-imports`) forbids deep imports into another module.

**Multi-tenancy:** every business table has `company_id`; operational tables add `project_id` (plus optional `area_id`, `location_id`, `work_zone_id`). Repositories take a `TenantScope` argument and always filter by it. No tenant-agnostic repository method exists, except in the platform-admin module.

**Authorization:** Identity → Role → Permission → Scope (Doc 07). Authentication middleware establishes the principal; `requirePermission(permission, scopeResolver)` asks a `PermissionChecker`; deny by default.

---

## 2. Module hierarchy

```
core            (no business logic)  config · http · logging · auth primitives · middleware · database client
 └─ platform    (shared services)    audit-log · file-storage · notification · comment · activity-timeline · search · report-export · workflow
     └─ foundation modules           tenancy (registration, subdomain, plans, subscription, verification) · identity (users, sessions, roles, permissions) · company · project (area, location, work zone, members)
         └─ engines                  workforce · action · inspection · safety-event · risk-assessment · permit
             └─ feature modules      toolbox-talk · equipment · ppe · environmental · emergency · document
                 └─ aggregation      dashboard · report · calendar / activity center · administration
```

Dependencies only point **downward**. Aggregation modules read through other modules' public services, never their tables.

---

## 3. Technology stack

See ADR-001. Supporting choices made in Sprint 0 (each is native or already mandated):

| Concern          | Choice                                                | Why                                                                                                                                                   |
| ---------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo         | npm workspaces                                        | Native to Node; Dependency Policy says to prefer native                                                                                               |
| Language         | TypeScript 6.0, `strict` + `noUncheckedIndexedAccess` | Doc 02 §14 ("strict typing")                                                                                                                          |
| Validation       | Zod 4 + `@hono/zod-validator`                         | One schema language for API and web                                                                                                                   |
| Logging          | In-house structured JSON logger (no dependency)       | Workers Logs ingests JSON; redaction built in                                                                                                         |
| Password hashing | WebCrypto PBKDF2-SHA-256                              | Native to Workers; see ADR-001                                                                                                                        |
| JWT              | `hono/jwt` (HS256)                                    | Already part of Hono                                                                                                                                  |
| Lint / format    | ESLint 9 (flat config) + typescript-eslint + Prettier | ESLint 10 is blocked: `eslint-plugin-react`, `-import` and `-jsx-a11y` (required by `eslint-config-next`) do not support it yet. Upgrade when they do |
| Tests            | Vitest                                                | TypeScript native; works for Workers code                                                                                                             |

---

## 4. Development phases

| Phase           | Content                                                                                                  | Source                   |
| --------------- | -------------------------------------------------------------------------------------------------------- | ------------------------ |
| 0 — Foundation  | Repo, tooling, core libraries, CI, Docker dev environment                                                | This bootstrap           |
| 1 — Phase 1 MVP | All 16 modules of Doc 32 (D-15), plus tenant registration, subscriptions, offline capture and Arabic/RTL | Docs 14–32, PO_DECISIONS |
| 2 — AI & field  | AI features, offline, QR, automation                                                                     | Platform Guide roadmap   |
| 3 — Enterprise  | IoT, Power BI, enterprise integrations                                                                   | Platform Guide roadmap   |

The sprint breakdown is in [05_SPRINT_PLAN.md](../05_SPRINT_PLAN.md).

---

## 5. Risks

| #    | Risk                                                                                                                            | Impact                        | Mitigation                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| R-1  | D1 size cap and single writer vs. "millions of records"                                                                         | High (long term)              | Repository boundary; size monitoring; Postgres/Hyperdrive or per-tenant sharding path                                     |
| R-2  | No interactive transactions on D1                                                                                               | High (workflow integrity)     | Batch-based unit of work; design transitions as single atomic batches                                                     |
| R-3  | Role and status conflicts (C-02 … C-06) — now resolved by D-02, D-12, D-13; short status lists may hide required approval steps | Medium                        | Model approvals as workflow records; confirm when Sprints 8, 10, 13 are specified                                         |
| R-4  | Only 1 of 85 user stories is fully specified                                                                                    | High (scope creep / guessing) | Each story is specified per Doc 15 and approved before its sprint starts                                                  |
| R-5  | Offline capture is in Phase 1 for inspections and hazard reports (D-11); sync conflicts and photo uploads on poor networks      | High                          | Dedicated offline-foundation sprint (Sprint 9); idempotent writes; conflicts flagged for review, never overwritten (D-20) |
| R-6  | PDF/Excel generation inside Worker CPU limits                                                                                   | Medium                        | Queue-based generation; spike before the Reports sprint                                                                   |
| R-7  | Next.js on Workers (OpenNext) feature gaps                                                                                      | Medium                        | Keep the web app mostly client/RSC-simple; verify each Next.js upgrade with an OpenNext preview build                     |
| R-8  | PBKDF2 at 100k iterations is below the OWASP recommendation for SHA-256                                                         | Medium                        | Self-describing hash for transparent rehash; rate limiting and lockout on login                                           |
| R-9  | Arabic/RTL ships in Phase 1 (D-14); retrofitting it would touch every screen                                                    | High                          | i18n keys and logical CSS properties (`ms-`/`me-`) from Sprint 1, before the first screen                                 |
| R-10 | Data residency (Q-04)                                                                                                           | Unknown                       | Resolve before production provisioning                                                                                    |
| R-11 | Self-registration with manual payment (D-06, D-07) adds an onboarding queue and subscription states to every request            | Medium                        | Subscription status resolved once per request with the tenant; read-only mode enforced centrally, not per module          |

---

## 6. Missing information

See [DOCUMENTATION_REVIEW.md §2–3](DOCUMENTATION_REVIEW.md) and the open items in [PO_DECISIONS.md](PO_DECISIONS.md). Most urgent: Q-08 (permission matrix, Sprint 5), F-01a, F-02a, F-04a and F-07 (Sprint 2), and story renumbering (Q-28).

---

## 7. Suggested improvements

1. Write a **permission matrix** document (`docs/architecture/PERMISSIONS.md`) as the single seed source.
2. Add a **workflow definition** spec shared by all engines (states, transitions, guard permissions, required fields, notifications).
3. Define **record numbering** once, as a platform service.
4. Add **data retention and privacy** rules (PDPL) to the Master Rules.
5. Re-sequence the backlog: platform services → Action engine → Inspection; Risk Assessment → Permit activation.
6. Add **design tokens** (colours, type scale, spacing) to `docs/ui/` before the first screen.
7. Replace ambiguous "should" with "must" / "may" in the business rules during story specification.
