# Business modules

Each module is added by its sprint (see `docs/05_SPRINT_PLAN.md`). Sprint 5 added `project` (projects) and `access` (role and permission administration).
Sprint 6 added places, the timeline and the switcher to `project`, project members and the daily
access-ending job to `access`, and `notifications` (the signed-in user's notification centre).
Sprint 7 added `workforce` (profiles, project assignments, training, certificates, medical,
contacts, personal documents, workforce lists and the daily `workforce.expiry` job). Other modules
use `WorkforceDirectory` (who is this person, are they available and fit for work on a project).

## Module template

```
modules/<module>/
├── index.ts               public contract: the only file other modules may import
├── <module>.routes.ts     controller: HTTP only (parse → call service → respond)
├── <module>.service.ts    business rules, workflow, permission-sensitive logic
├── <module>.repository.ts the only code touching this module's tables (tenant-scoped)
├── <module>.schema.ts     Drizzle table definitions (entity)
├── <module>.dto.ts        request/response types
└── <module>.validator.ts  Zod schemas for input validation
```

Rules: never access another module's tables; cross-module calls go through `index.ts`
(enforced by ESLint); audit every important action; return the standard envelope.
