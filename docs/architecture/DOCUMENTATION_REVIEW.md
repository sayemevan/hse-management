# Documentation Review — Conflicts, Gaps and Questions for the Product Owner

Reviewed: `01_PRODUCT_BOOK.md` (Docs 00–32) and `02_MASTER_RULES.md` (all sections), read in full on 2026-11-10.

> **Answers received 2026-11-10:** see [PO_DECISIONS.md](PO_DECISIONS.md). Resolved: C-02–C-06, C-10–C-12, C-16, C-19 and Q-01–Q-03, Q-06, Q-09–Q-12, Q-18, Q-25–Q-27, Q-29.

Status key: **RESOLVED** = decided · **BLOCKING** = must be answered before the named sprint · **OPEN** = needed before that module's design.

---

## 1. Conflicts between documents

| ID   | Topic                           | Product Book says                                                                                                                                                                             | Master Rules / other section says                                                                                                                                                | Status                                                                                        |
| ---- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| C-01 | Technology stack                | Hono, D1, Drizzle, R2, KV, Queues, Cloudflare (Doc 02)                                                                                                                                        | NestJS, Prisma, PostgreSQL, S3, Docker, Vercel/Railway/Hetzner (Reference Guide §3)                                                                                              | **RESOLVED** — [ADR-001](adr/ADR-001-technology-stack.md): Cloudflare stack                   |
| C-02 | Role catalogue                  | System Owner, Company Admin, HSE Director, HSE Manager, Project Manager, Safety Officer, Site Engineer, Supervisor, Foreman, Inspector, Worker, Client, Consultant, Auditor (Docs 00, 06, 07) | Super Admin, Company Admin, Project Manager, HSE Manager, Safety Officer, Supervisor, Employee, Viewer (Platform Guide)                                                          | BLOCKING Sprint 1                                                                             |
| C-03 | Inspection statuses             | Draft → In Progress → Submitted → Under Review → Approved → Closed → Archived (Doc 10)                                                                                                        | Draft, In Progress, Submitted, Approved, Closed (Configuration Guide)                                                                                                            | OPEN                                                                                          |
| C-04 | Permit statuses                 | Draft → Submitted → Safety Review → Approval → Active → Suspended → Completed → Closed → Archived; no "Expired" status, although expiry is required (Doc 12 §6, §12)                          | Draft, Pending, Approved, Active, Closed, **Expired** (Configuration Guide)                                                                                                      | OPEN                                                                                          |
| C-05 | Action statuses                 | Draft → Assigned → Accepted → In Progress → Completed → Verification → Closed → Archived (Doc 13)                                                                                             | Open, In Progress, Completed, Verified, Closed (Configuration Guide)                                                                                                             | OPEN                                                                                          |
| C-06 | Project statuses                | "Suspended" (Doc 06 §9)                                                                                                                                                                       | "On Hold" (Doc 08 §6)                                                                                                                                                            | BLOCKING Sprint 2                                                                             |
| C-07 | Epic numbering                  | Doc 14 backlog: Epic 04 Workforce, 05 Inspection, 06 Safety Event, 07 Permit …                                                                                                                | Docs 16–31: Epic 03 Workforce, 05 Safety Event, 06 Permit …; **Document 19 (Inspection epic) is missing**                                                                        | OPEN                                                                                          |
| C-08 | User-story IDs collide          | Doc 14: US-064–070 = Dashboard & Reports                                                                                                                                                      | Doc 24: US-064–068 = Toolbox Talk                                                                                                                                                | BLOCKING sprint planning                                                                      |
| C-09 | Stories missing from backlog    | Toolbox Talk and PPE are in V1 scope (Doc 00)                                                                                                                                                 | Doc 14 backlog has no Toolbox Talk, PPE, Equipment, Environmental or Emergency stories; Docs 25–28 list un-numbered stories                                                      | OPEN                                                                                          |
| C-10 | Phase 1 scope                   | V1 scope lists 13 items; it omits Workforce, Risk Assessment, Equipment, Environmental, Emergency, Documents (Doc 00 §10)                                                                     | Doc 32 lists 16 Phase 1 modules, including all of those                                                                                                                          | BLOCKING roadmap                                                                              |
| C-11 | Email notifications             | "Current: In-App; Future: Email" (Doc 01 §13)                                                                                                                                                 | Email notifications in Phase 1 (Doc 31, US-072)                                                                                                                                  | OPEN                                                                                          |
| C-12 | Offline                         | Offline inspection/hazard capture with auto-sync (Doc 01 §15, Doc 02 §4)                                                                                                                      | Offline is Phase 2 (Platform Guide roadmap); Doc 21 puts offline permit approval out of scope                                                                                    | BLOCKING Sprint 0 architecture (service worker / local store)                                 |
| C-13 | Action module dependencies      | "The Action Engine should never depend on one specific module" (Doc 13 §3)                                                                                                                    | Doc 22: Action Management _depends on_ Inspection, Safety Event, Permit; dev priority places Actions after them, yet Inspection findings (US-039) and events must create actions | OPEN — recommendation in §4                                                                   |
| C-14 | Permit vs Risk Assessment order | A permit cannot be activated until its risk assessment is approved (Doc 12 §9)                                                                                                                | Dev priority builds Risk Assessment **after** Permit (Doc 14)                                                                                                                    | OPEN — recommendation in §4                                                                   |
| C-15 | API path                        | `POST /api/auth/login` (Doc 15 example)                                                                                                                                                       | `/api/v1/auth` (API Rules)                                                                                                                                                       | RESOLVED — the versioned `/api/v1` from the rules is used; the Doc 15 example is illustrative |
| C-16 | Company membership              | "Same identity may belong to multiple companies (future)" (Doc 07 §3)                                                                                                                         | "Every user belongs to at least one company" (Doc 16)                                                                                                                            | OPEN — Phase 1 = one company per user?                                                        |
| C-17 | Testing bar                     | Unit + Integration + UAT for every feature (Doc 32)                                                                                                                                           | Manual testing; automated "when practical" (Coding Standards)                                                                                                                    | OPEN — the stricter Doc 32 bar is assumed                                                     |
| C-18 | Design principles list          | Doc 00 §6 has a formatting break ("2. Speed")                                                                                                                                                 | —                                                                                                                                                                                | Cosmetic, left verbatim                                                                       |
| C-19 | User vs workforce status        | Workforce: Active, On Leave, Suspended, Inactive, Terminated (Doc 09)                                                                                                                         | Account statuses: Pending Invitation, Active, Suspended, Locked, Archived (Doc 07) — distinct concepts; relationship of user ↔ workforce member undefined                        | RESOLVED — D-09, D-50 (O-78)                                                                  |

---

## 2. Gaps (information not present in any document)

- No database schema / ERD (`03_DATABASE.md` is a placeholder).
- No API contract (`04_API.md` is a placeholder).
- Only US-001 is fully specified per the Doc 15 template; US-002 … US-085 are titles only.
- No UI wireframes or design tokens (colour hex values, typography scale, spacing).
- No permission matrix (role × permission × scope defaults).
- No numeric security policy (password rules, lockout threshold, session timeouts, token lifetimes).
- No file-upload limits (max size, allowed MIME types per category).
- No subscription / plan model, although projects are limited "depending on the subscription plan" (Doc 08 §5).
- No numbering formats for business records (Permit Number, Inspection Number, Incident Number are searchable — Doc 05 §9).
- No data retention / legal hold policy (Saudi PDPL compliance is not mentioned).
- No email provider, sender domain or templates.
- No report layouts or branding spec.

---

## 3. Questions for Product Owner

### Platform & tenancy

- **Q-01** Who creates a company: platform staff only, or can a customer self-register (Doc 08 "Register their company" vs US-011 "Create Company")?
- **Q-02** Subscriptions/billing: is any plan or limit enforced in Phase 1? If so, which limits (projects, users, storage)?
- **Q-03** Phase 1: can one user belong to more than one company (C-16)?
- **Q-04** Data residency: must data stay in-Kingdom (KSA) or in a specific region? This affects the D1/R2 location hints.
- **Q-05** Is compliance with Saudi PDPL (or any client-imposed standard such as ISO 45001 record keeping) required in Phase 1?

### Identity, roles & permissions

- **Q-06** Which role catalogue is authoritative (C-02)? Are "Super Admin" and "System Owner" the same platform role?
- **Q-07** Are roles a fixed seed list in Phase 1, or can companies create custom roles? (Doc 07 lists custom roles as future.) _Answered: D-44._
- **Q-08** Please provide the default permission matrix (role → permissions → scope). _Answered: D-44._
- **Q-09** Password policy: minimum length, complexity, history, expiry?
- **Q-10** Session policy: inactivity timeout, absolute lifetime, max concurrent sessions, "remember me" duration?
- **Q-11** Failed-login protection: attempts before lock, lock duration, and is admin unlock required? (Doc 16 says "Account Lock (Optional)".)
- **Q-12** Is every user also a workforce member? Must a workforce member have a login? (Workers have "limited access" per Doc 00.)
- **Q-13** Is email verification mandatory, or implied by accepting an invitation?
- **Q-14** Temporary access (external auditor, client rep): who grants it, and what is the default expiry? _Answered: D-44._

### Organisation structure

- **Q-15** Project status list: "Suspended" or "On Hold" (C-06)? Who may change status, and which transitions are allowed? _Answered: D-44._
- **Q-16** "Only active projects may receive new operational records" — does "Mobilization" count as active? _Answered: D-44._
- **Q-17** Are Area / Location / Work Zone mandatory on operational records, or optional (Doc 06 §16 says optional)? _Answered: D-47._

### Workflows

- **Q-18** Confirm the authoritative status lifecycles for Inspection, Permit and Action (C-03, C-04, C-05). _Answered: D-12; for actions confirmed in D-53 (O-96); for inspections in D-60 (O-133); for safety events in D-63 (O-157)._
- **Q-19** Can a closed or approved record be reopened? By whom? (Doc 01 lists "Reopened" as an audit event.) _Answered for actions: D-53 (O-97); inspections: D-60 (O-134); safety events: D-63 (O-158); other records with their modules._
- **Q-20** Permit expiry: is "Expired" a status, or a derived state of "Active" past its end time?
- **Q-21** Which safety-event types require mandatory investigation ("high severity" — High only, or High + Critical)? _Answered: D-63 (O-159)._
- **Q-22** Default risk matrix: 5×5 or 4×4? What are the probability/severity labels and score bands? _Answered: D-63 (O-160)._
- **Q-23** Record numbering format (e.g. `PTW-{PROJECT}-{YYYY}-{0001}`)? Per project or per company? _Answered for actions: D-53 (O-98); inspections: D-60 (O-135); safety events: D-63 (O-161); other records with their modules._
- **Q-24** Digital signatures (Toolbox Talk, Doc 24) are in Phase 1 scope but "future" elsewhere — is a drawn signature image enough?

### Scope & roadmap

- **Q-25** Authoritative Phase 1 module list (C-10)? Doc 32 (16 modules) or Doc 00 (13 items)?
- **Q-26** Is offline capture in Phase 1 (C-12)? If yes, which flows: inspection, hazard report, photos? _Answered: D-11; confirmed for the sync layer: D-57 (O-115); extended to every safety event report: D-63 (O-163)._
- **Q-27** Email notifications in Phase 1 (C-11)? Which provider and sender domain?
- **Q-28** Please renumber epics and user stories (C-07, C-08, C-09) and supply Document 19 (Inspection epic). _Answered for inspections: D-60 (O-132) — Doc 14 numbering, content from Doc 10; C-08 and C-09 stay open for their sprints; for safety events in D-63 (O-156)._
- **Q-29** Is Arabic/RTL in Phase 1 or Version 2? (Doc 02 says Version 2; Doc 00 says "Arabic Ready".) We will build i18n-ready from day one either way.
- **Q-30** Hijri calendar: display only, or also input?

### Files, reports & search

- **Q-31** Maximum upload size and allowed file types per category? _Answered for workforce files: D-50; action files: D-53; inspection files: D-60 (O-136); safety event files: D-63 (O-162); other categories with their modules._
- **Q-32** Do videos need support in Phase 1? (Marked "Future" in Docs 10 and 11.)
- **Q-33** PDF report look: is there a reference template or branding guideline?
- **Q-34** "Scheduled report generation/delivery" (Docs 10, 11, 13) — Phase 1 or later?
- **Q-35** Global search: which entities and fields are indexed in Phase 1? Is Arabic text search required?

### Operations

- **Q-36** Environments needed: dev, staging, production? Custom domain names?
- **Q-37** Backup and restore objectives (RPO / RTO)? "Backup before release" is a rule — D1 Time Travel covers 30 days; is that sufficient?
- **Q-38** Which observability tool (Cloudflare Workers Logs only, or Sentry / Datadog)?

---

## 4. Recommendations (pending approval)

1. **Build the Action Engine before the Inspection Engine** as a source-agnostic engine (`source_module`, `source_record_id`). This satisfies Doc 13 §3 and unblocks US-039 and the event-to-action flows.
2. **Build Risk Assessment before Permit activation** (US-051), or ship Permit activation behind the risk-assessment rule only once Risk Assessment exists.
3. **Build platform services before business modules**: audit log, file upload, comments, activity timeline and the in-app notification core. All modules depend on them (Master Rules §5–9).
4. **Adopt a single workflow (state-machine) definition format** shared by Inspection, Safety Event, Permit, Action and Risk Assessment. The docs require configurable, non-hard-coded workflows (Doc 03 Rule 16).
5. **Make status lists configuration data, not enums in code**, where the docs say "configurable".
