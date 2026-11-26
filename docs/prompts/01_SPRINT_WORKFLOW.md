# Prompt 01 — Sprint Workflow (reference for every sprint command)

Read this file instead of exploring the repository. It is the map and the rules. Read other files only when a step below names them, and read only the part you need (`grep -n`, then `sed -n a,bp` / Read with offset).

## The three stages

| Stage     | Command              | Ends with                                                     |
| --------- | -------------------- | ------------------------------------------------------------- |
| 1. Specs  | `/sprint-spec <N>`   | Draft specs in `docs/stories/sprint-NN/`, PO asked to approve |
| 2. Build  | `/sprint-build <N>`  | Approval recorded, code + tests + docs, PO asked to accept    |
| 3. Accept | `/sprint-accept <N>` | Acceptance recorded, sprint marked done                       |

A sprint starts only when the previous one is done and its specs are approved (`docs/05_SPRINT_PLAN.md`). Never skip a stage. Reply to the user in **English**.

## Where things are

**Docs**

- `docs/05_SPRINT_PLAN.md` — sprint table: goal, scope (story IDs), blockers (`Q-xx`).
- `docs/stories/README.md` — sprint status table. `docs/stories/sprint-NN/` — one overview + one file per story.
- **Format to copy:** `docs/stories/sprint-06/` (overview, `PLT-17-notifications.md`, `US-019-manage-areas.md`). Same headings, same tables.
- `docs/architecture/PO_DECISIONS.md` — decisions `D-xx`; append a "Sprint N approvals" section before `## Still open`.
- `docs/architecture/DOCUMENTATION_REVIEW.md` — open questions `Q-xx`; mark answered with `_Answered: D-xx._`.
- `docs/03_DATABASE.md`, `docs/04_API.md` — add a "Tables / Endpoints (Sprint N)" section each sprint.
- `docs/01_PRODUCT_BOOK.md` (7,400 lines) — never read whole. Document start lines: Doc 04 DB 1291 · Doc 05 Design 1581 · Doc 06 Org 2062 · Doc 07 Roles 2368 · Doc 08 Company/Project 2697 · Doc 09 Workforce 3022 · Doc 10 Inspection 3344 · Doc 11 Safety Event 3744 · Doc 12 Permit 4104 · Doc 13 Action 4461 · Doc 14 Backlog 4786 · Doc 15 Template 5297 · Doc 16–31 Epics 5594–7081 (`grep -n "^# Document"` for exact lines). `docs/02_MASTER_RULES.md` — grep the topic.

**Next IDs** (update this line at the end of every stage): last `D-57`, `T-74`, `O-131`, `PLT-31`. Sprint 8 done. Sprint 9 (Offline foundation) specs approved (D-56, D-57); next stage: build.

**Code** (npm workspaces)

- `packages/shared/src/` — contracts used by API and web: Zod schemas + DTO types per area (`projects/`, `access/permissions.ts` = permission catalogue and default matrix, `api/error-codes.ts`, `notifications/`, `activity/`). Export new files from `index.ts`.
- `apps/api/src/modules/<module>/` — `index.ts` (only public contract; ESLint enforces), `*.routes.ts`, `*.service.ts`, `*.repository.ts`, `*.schema.ts`. Mount routes and tenant middleware in `src/routes/index.ts`; daily jobs in `src/jobs.ts`.
- `apps/api/src/platform/` — shared services: `audit-log`, `activity` (timeline), `notification`, `reminders`, `jobs`, `email`, `file-storage`. Write their statements in the same `UnitOfWork` as the change.
- Permission guards: `requireCompanyPermission` (identity), `requireProjectPermission` + `currentProject(c)` (project). Resolver: `permissionResolverFor(c)`. Who to notify: `ProjectAudience` (identity).
- `apps/api/migrations/` — `npx drizzle-kit generate --name <x>` for tables; `--custom --name <x>` for seeds/triggers. New permissions: add to `permissions.ts` **and** seed them (`sort_order` must follow the array order; see `0009`).
- `apps/api/test/integration/*.test.ts` — real local Workers runtime. Helpers: `test/support/projects.ts` (`company`, `signedIn`, `createProject`, `giveProjectRole`, `makeReadOnly`), `seed.ts`, `http.ts`.
- Read-only mode: every new company write route must be listed in `test/lifecycle.test.ts` (`REVIEWED_BLOCKED` or `REVIEWED_ALLOWED`); the allow-list is in `modules/billing/read-only.middleware.ts`.
- Audit actions: `platform/audit-log/audit-actions.ts`. Timeline actions: `ACTIVITY_ACTIONS`; notification types: `NOTIFICATION_TYPES` (shared).
- `apps/web/src/app/(app)/…` — pages (thin); screens in `apps/web/src/modules/<area>/`. Project tabs use `useCurrentProject()` from `modules/projects/project-context.tsx`. Translations: `apps/web/messages/en.json` + `ar.json` (same keys; `node scripts/check-web-i18n.mjs`). New error codes go in `modules/i18n/use-error-message.ts` and `errors.*`.

## Conventions that save time

- Shell is Git Bash on Windows. **Heredocs containing apostrophes fail** in the Bash tool: write multi-line edits as a Node script with the Write tool into the scratchpad, then `node script.cjs`. Python is not installed.
- Git repository (`origin` = GitHub `sayemevan/hse-management`, branch `main`). Commit at the end of each stage when the user asks.
- UI rules: logical `start/end` classes only; codes, dates, emails in `<bdi dir="ltr">`; status never by colour alone; cards at every width; dialogs full-screen on phone.
- Lint traps seen before: no `Date.now()` in render (use `useState(() => Date.now())`), no JSX literal punctuation (put it in translations), `??` not `||`, braces on void arrow bodies.
- Dev data: `apps/api/scripts/seed-dev.ts` (accounts and `DEV_PASSWORD`). Company `demo` at `http://demo.localhost:3000`. Apply migrations with `npm run db:migrate:local --workspace @hse/api`.
- Browser check: `preview_start` `api` and `web` (`.claude/launch.json`). If the pane is hidden, drive the page with `javascript_tool` and read with `get_page_text`. Stop both servers before `npm run build`.

## Stage 1 — Specs (`/sprint-spec N`)

1. Read the sprint's row in `05_SPRINT_PLAN.md`, its blockers in `DOCUMENTATION_REVIEW.md`, and the previous sprint overview's "Out of scope" and "Known gaps" (grep the sprint number in `docs/stories/`).
2. Read only the Product Book sections for the scope (backlog entries in Doc 14, the module doc, the epic doc).
3. Read the code only where the specs must fit it (the module the sprint extends).
4. Write `docs/stories/sprint-NN/00_SPRINT_NN_OVERVIEW.md` (status DRAFT) and one spec per story/enabler, copying the Sprint 6 format. Number new technical decisions `T-`, open points `O-` (with a proposed answer each), enablers `PLT-` from the next IDs. Propose default permission rows for every new permission. Answer each blocking `Q-xx` with an `O-xx`.
5. Add the sprint to `docs/stories/README.md` as Draft; run `npx prettier --write docs`.
6. Reply with a short summary and the decisions the PO must make. Ask: "Approve the Sprint N specs as written?"

## Stage 2 — Build (`/sprint-build N`)

1. Record approval: `D-xx` (specs and T-ids) and `D-xx` (open points) in `PO_DECISIONS.md`; mark `Q-xx` answered; specs Status → Approved; overview → IN PROGRESS; `05_SPRINT_PLAN.md` blockers updated; stories README → In progress.
2. Build in this order: shared contracts → schemas + migrations → services/routes → integration tests → web screens + translations → docs.
3. Keep checking as you go: `npx tsc --noEmit -p apps/api/tsconfig.json`, `npx vitest run <file>` in `apps/api`, `npx eslint <path> --max-warnings=0`.
4. Finish: `npm run check`, migrations on local D1, browser check in Arabic and English at 375 px (per the overview's Definition of Done), `npm run build`.
5. Update `03_DATABASE.md`, `04_API.md`, module/platform READMEs, and the overview's "Implementation notes" (refinements table: approved text / as built / why; added beyond specs; known gaps; verification with test counts). Overview → IMPLEMENTED; stories README → Implemented, awaiting acceptance.
6. Reply with what was built, refinements, and what wasn't checked. Ask: "Accept Sprint N as built?"

## Stage 3 — Accept (`/sprint-accept N`)

1. Append `D-xx` "Sprint N accepted as built on <date>, including the implementation refinements (…) and the known gaps" to the Sprint N approvals table.
2. Overview status → `DONE — accepted by the Product Owner on <date> (D-xx).`; stories README → `Done (accepted <date>)`; sprint plan row → `(done)`.
3. Update "Next IDs" in this file. `npx prettier --write docs`.
4. Reply in two or three lines and name the next sprint.
