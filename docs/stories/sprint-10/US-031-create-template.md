# US-031 — Create Inspection Template

| Field    | Value                                                                                                                       |
| -------- | --------------------------------------------------------------------------------------------------------------------------- |
| Epic     | Epic 05 — Inspection Engine (Doc 14; Doc 19 missing, O-132)                                                                 |
| Priority | Must                                                                                                                        |
| Status   | Approved                                                                                                                    |
| Sources  | Product Book Doc 14, Doc 10 §3, §4, §7–9, §13, §20; Master Rules "Master Data"; T-75, T-76, T-81; O-139–O-144, O-149, O-151 |

## Business Goal

Companies standardise how their sites are inspected (Doc 10 §1) and add new inspection types without code changes (§3). A template is the definition every inspection executes (§2).

## User Story

As an **HSE Manager**, I want to build an inspection template with sections, checklist items, allowed results, evidence rules and scoring, so that every inspector on every project inspects the same way.

## Description

**Settings → Inspection templates** lists the company's templates (Active, Retired, with a "Draft changes" chip where a draft exists) and the **Inspection categories** list. **New template** opens the **builder**, which saves a **draft version** (v1). **Publish** makes it available to every project (O-141). Until it is published nobody can start an inspection with it.

Builder parts:

- **Details**: name (English, Arabic optional, O-143), description, category, **Needs approval** (default on, O-144), **Area required** (default off).
- **Results**: the allowed results (O-139): Pass and Fail always; Observation, Not applicable (default on), Not inspected.
- **Sections and items**: add, rename, reorder (Move up / Move down), remove. Each item: question, expected condition, guidance, weight 1–10, **critical** flag, default priority (Low / Medium / High / Critical), photo required on Fail (default on), photo always required (default off). Comment on Fail is always required.
- **Scoring** (O-140): None, Percentage (optional pass mark 1–100 %), Pass / Fail (critical items and optional pass mark).
- **Preview**: the capture screen as an inspector will see it on a phone, in both languages, with a live score (T-81).

The draft autosaves every few seconds and on leaving a field (`PUT …/draft`); the builder works online only.

**Categories** (O-141): seeded with the twelve Doc 10 §3 types; add, rename (both languages), reorder, deactivate; never deleted once a template uses them.

**Starter template** (O-142): "Daily Site Safety Inspection" / "التفتيش اليومي على سلامة الموقع", published v1 seeded on first use with the Doc 10 §7 sections. Draft items (wording to be confirmed by the PO):

| Section                | Items                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| General Safety         | Site access controlled · Safety signage in place · Emergency contacts displayed · First-aid kit stocked                      |
| Housekeeping           | Walkways clear · Materials stored safely · Waste segregated and removed · No trip hazards                                    |
| PPE                    | Hard hats worn · Safety footwear worn · High-visibility clothing worn · Task-specific PPE in use                             |
| Electrical Safety      | Cables undamaged and routed safely · Distribution boards closed and labelled · RCD protection in use · Portable tools tested |
| Working at Height      | Edge protection in place (critical) · Scaffolds tagged · Harnesses worn and anchored (critical) · Ladders in good condition  |
| Fire Protection        | Extinguishers available and in date · Hot work permit in place · Escape routes clear · Flammables stored correctly           |
| Environmental Controls | Dust controlled · Spill kits available · No leaks or spills · Noise controls in use                                          |

Scoring Percentage, pass mark 85 %, Needs approval on.

## Actors

Holders of `inspections.templates.manage` (O-149: CA, HD, HM). Readers of published templates (see the overview).

## Preconditions

- Signed in on the company's subdomain; company not read-only.
- Fewer than 200 active templates (O-151).

## User Flow

1. Settings → **Inspection templates** → **New template** → name, category → **Create**. The builder opens on draft v1.
2. Add sections and items; set results, scoring and approval; **Preview**.
3. **Publish** → validation (below). With errors: the list of problems, each linking to the field. Without: "Publish v1? Inspectors on every project can use it straight away." → **Publish**.
4. The template shows **Active · v1** in the list.

## Functional Requirements

The system shall:

1. Create a template with draft v1 in one batch; refuse a second template with the same name (either language, ignoring case) among active templates (`409 TEMPLATE_NAME_TAKEN`).
2. Save the whole draft content with `PUT …/draft` (the builder sends the full content and the draft's `updatedAt`; a stale value → `409 TEMPLATE_DRAFT_CHANGED`, so two editors don't overwrite each other).
3. Give every new section and item a UUID `key`; keep keys of existing ones unchanged.
4. Validate on publish with the shared schema: at least one section, every section at least one item, limits of O-151, scoring settings consistent (a pass mark only with Percentage or Pass / Fail; Pass / Fail needs a critical item or a pass mark). Errors → `422 TEMPLATE_INVALID` with `details.paths`.
5. Publish: set the version's state `published`, set `published_at/by`, point the template at it, all in one batch.
6. Seed the categories and the starter template on the company's first use of the module (idempotent, seed keys kept as in Sprint 7).
7. Write audit and activity entries in the same batch.

## Validation Rules

| Field                        | Rule                                                     | Message                                                     |
| ---------------------------- | -------------------------------------------------------- | ----------------------------------------------------------- |
| Name (en / ar)               | One required, 3–120 characters each; unique among active | "Enter a name." / "Another template already has this name." |
| Description                  | Optional, up to 1,000                                    | "Description is too long."                                  |
| Category                     | Required, active category                                | "Choose a category."                                        |
| Section title                | One language required, 2–120                             | "Enter a section title."                                    |
| Item question                | One language required, 2–300                             | "Enter the question."                                       |
| Expected condition, guidance | Optional, up to 1,000                                    | "Too long."                                                 |
| Weight                       | Integer 1–10                                             | "Use a weight from 1 to 10."                                |
| Pass mark                    | Integer 1–100, only with Percentage or Pass / Fail       | "Use a pass mark from 1 to 100."                            |
| Sections / items             | ≤ 30 sections, ≤ 300 items                               | "A template can have up to 30 sections and 300 items."      |
| Category name                | One language required, 2–80, unique ignoring case        | "This category already exists."                             |

## Permission Rules

`inspections.templates.manage` (company, **new**) for every change and for the management screens. Proposed defaults (O-149): CA ✓, HD ✓, HM ✓, others —. Company-editable.

## Database Impact

`inspection_category`: `id`, `company_id`, `name_en`, `name_ar`, `name_key`, `position`, `active`, `seed_key`, audit columns. Unique (`company_id`, `name_key`).

`inspection_template`: `id`, `company_id`, `category_id`, `name_en`, `name_ar`, `name_key`, `status` (`active` / `retired`), `current_version_id` (nullable until published), `retired_at/by`, `seed_key`, audit columns. Unique (`company_id`, `name_key`) where `status = 'active'`.

`inspection_template_version`: `id`, `company_id`, `template_id`, `version_no`, `state` (`draft` / `published` / `superseded`), `content` (JSON: `{ results, scoring, needsApproval, areaRequired, description, sections: [{ key, title: {en, ar}, items: [{ key, question, expected, guidance, weight, critical, defaultPriority, photoOnFail, photoAlways }] }] }`), `item_count`, `published_at/by`, `superseded_at`, audit columns. Unique (`template_id`, `version_no`); unique (`template_id`) where `state = 'draft'` (T-76).

## API Requirements

- `GET /api/v1/inspection-categories`, `POST`, `PATCH /{id}`, `POST /{id}/move`, `POST /{id}/deactivate`, `POST /{id}/reactivate`.
- `GET /api/v1/inspection-templates?status=active|retired&category=` → list with current version number, item count, draft flag.
- `POST /api/v1/inspection-templates` `{ nameEn?, nameAr?, categoryId }` → `201` with the template and draft v1.
- `GET …/{id}` → template, current version content, draft (to managers).
- `PUT …/{id}/draft` `{ content, expectedUpdatedAt }` → the saved draft.
- `POST …/{id}/publish` → the published version.

## UI Requirements

- Builder as a single page with collapsible sections; on phone, sections stack and item editing opens full screen.
- Language tabs (English / العربية) on text fields; the missing language shows "Shown in English" hints.
- Move up / Move down as menu items (no drag-and-drop needed).
- Preview in a phone-sized frame on desktop, full screen on phone.

## Error Handling

| Case                          | Response                          |
| ----------------------------- | --------------------------------- |
| Name taken                    | `409 TEMPLATE_NAME_TAKEN`         |
| Draft changed by someone else | `409 TEMPLATE_DRAFT_CHANGED`      |
| Invalid on publish            | `422 TEMPLATE_INVALID` with paths |
| 200 active templates          | `422 TEMPLATE_LIMIT_REACHED`      |
| Read-only company             | `403 SUBSCRIPTION_READ_ONLY`      |
| Without permission            | `403 FORBIDDEN`                   |

## Notifications

None.

## Audit Requirements

`inspection_template.created`, `inspection_template.draft_saved` (at most one entry per editor per 10 minutes, with the item count), `inspection_template.published` (version number, item count), `inspection_category.created/updated/moved/deactivated/reactivated`.

## Acceptance Criteria

- An HSE Manager creates "Scaffold Inspection" with two sections and five items, Percentage with pass mark 80 %, and publishes it; a Safety Officer can start it on any project.
- Publishing an empty section is refused with a link to that section.
- A Safety Officer (no template permission) can't open the management screens; the API refuses changes.
- A new company has the twelve categories and the published starter template on first use, once.

## Test Scenarios

- **Positive:** create, save draft, publish; categories CRUD; seed runs once; preview score matches `scoreInspection`.
- **Negative:** each validation rule; stale draft save; name taken in the other language; limits; read-only company; caller without permission; another company's template id.

## Future Improvements

More item types (number, text, date, signature, photo-only); conditional items; per-project availability; template import/export and a shared template library; multi-step approval.
