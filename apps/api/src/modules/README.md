# Business modules

Each module is added by its sprint (see `docs/05_SPRINT_PLAN.md`). Sprint 5 added `project` (projects) and `access` (role and permission administration).
Sprint 6 added places, the timeline and the switcher to `project`, project members and the daily
access-ending job to `access`, and `notifications` (the signed-in user's notification centre).
Sprint 8 added `action` (the one action engine: actions from any source, owner and collaborators, progress and evidence, the Open → In Progress → Completed → Verified → Closed workflow, voiding, comments through the platform comment service, My actions and the daily `actions.due` job). Source modules register an `ActionSource` and create actions with `ActionEngine.prepare` inside `withActionNumber` (T-57, T-60). The `project` module gained `RecordNumbers` (per-project numbers) and `PlaceDirectory.resolveMany`.
Sprint 9 added `sync` (the user's offline conflicts and the daily `sync.maintenance` job) and `sync-probe` (development and test only: a versioned record with photos that proves the offline layer, O-116); `project` gained the offline profile and the project offline pack.
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
