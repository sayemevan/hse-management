# US-026 — Training Records

| Field    | Value                                                                                     |
| -------- | ----------------------------------------------------------------------------------------- |
| Epic     | Epic 03 — Workforce Management (Doc 18 "Training: Records, Expiry, History")              |
| Priority | Must                                                                                      |
| Status   | Approved                                                                                  |
| Sources  | Product Book Doc 14, Doc 09 §7, §8, §19, Doc 18; T-48, T-49, T-50, T-56; O-71, O-74, O-83 |

## Business Goal

Auditors and clients ask for proof that each worker was trained for the work they do. Training history must be complete and never lost (Doc 09 §8).

## User Story

As a **Safety Officer**, I want to record each person's training with its expiry and a copy of the certificate, so that I can prove competence and know when refresher training is due.

## Description

The profile's **Training** tab lists training records, current first, with their expiry badge (PLT-20). A record can name the **competency** it gives (PLT-21), so later modules can check "has a valid Working at Height training". Records are corrected or voided, never deleted; a refresher is added as a **new record that replaces** the earlier one (T-48).

**Fields:** training name (required), competency (optional, from the list), provider (optional), completion date (required), expiry date (optional), certificate reference (optional), copy (optional, PDF / JPEG / PNG, 10 MB, O-71), note (optional).

## Actors

Holders of `workforce.view` (read), `workforce.manage` (change); the linked user (own, read-only).

## Preconditions

- The profile exists and isn't archived (to change); the company isn't read-only.

## User Flow

1. Profile → **Training**: rows show name, competency, provider, completed, expiry badge, a paper-clip when a copy exists; "Show replaced and voided" reveals history.
2. **Add training** → the form → **Save**. The training name field suggests names already used in the company.
3. Row menu: **Open copy**, **Edit**, **Add refresher** (opens the form pre-filled, saved as a replacement), **Void** (reason required: "Void this record? It stays in the history as voided.").

## Functional Requirements

The system shall:

1. List a person's training records with expiry state; current only unless `include=history`.
2. Create a record with an optional copy stored in category `workforce_attachment` (T-49), counting against storage.
3. Edit any field of a current record (including replacing or removing the copy), keeping the old values in the audit; the old copy is kept for 30 days by the file storage service's normal deletion rule.
4. Add a refresher: a new record with `replaces_id`; the old one becomes Replaced (not current) in the same batch.
5. Void a record with a reason (5–200); voided records can't be edited or replaced (`WORKFORCE_RECORD_VOIDED`).
6. Serve the copy through `GET …/trainings/{id}/file` with `workforce.view` (or own linked record).
7. Provide training name suggestions (10, from the company's records).
8. Expose current training per competency to later modules through `WorkforceDirectory`.

## Validation Rules

| Field                 | Rule                                | Message                                              |
| --------------------- | ----------------------------------- | ---------------------------------------------------- |
| Training name         | Required, 2–120                     | "Enter the training name."                           |
| Competency            | Optional active competency          | "Choose a competency from the list."                 |
| Provider              | Optional, up to 120                 | "Provider is too long."                              |
| Completion date       | Required, not in the future         | "The completion date can't be in the future."        |
| Expiry date           | Optional, after the completion date | "The expiry date must be after the completion date." |
| Certificate reference | Optional, up to 60                  | "Reference is too long."                             |
| Copy                  | PDF, JPEG or PNG, up to 10 MB       | "Use a PDF, JPEG or PNG file up to 10 MB."           |
| Void reason           | 5–200                               | "Give a reason."                                     |

## Permission Rules

- `workforce.view` (read and open copies); `workforce.manage` (change). Defaults in O-73 / O-74. No new permission.

## Database Impact

New table `workforce_training`: `id`, `company_id`, `workforce_member_id`, `name`, `competency_id` (nullable), `provider`, `completed_on`, `expires_on` (nullable), `reference`, `file_id` (nullable), `note`, `replaces_id` (nullable), `replaced_at`, `voided_at`, `voided_by`, `void_reason`, audit columns. Indexes: (`workforce_member_id`, `voided_at`, `replaced_at`); (`company_id`, `expires_on`); (`company_id`, `competency_id`).

## API Requirements

- `GET /api/v1/workforce/{memberId}/trainings?include=history` → `{ items: [{ id, name, competency, provider, completedOn, expiresOn, expiryState, reference, hasFile, state: 'current'|'replaced'|'voided', replacesId, voidReason }] }`.
- `POST …/trainings` (multipart: fields + optional `file`; `replacesId` for a refresher) → `201`.
- `PATCH …/trainings/{id}` (multipart; `removeFile=true` to remove the copy).
- `POST …/trainings/{id}/void` `{ reason }`.
- `GET …/trainings/{id}/file`.
- `GET /workforce/suggestions?field=training&q=`.

## UI Requirements

- Shared record list and form components reused by US-027, US-028 and US-030.
- Expiry badge (PLT-20); dates in `<bdi dir="ltr">`; form full-screen on phone; the file picker accepts the camera on phones.

## Error Handling

| Case              | Response                                       |
| ----------------- | ---------------------------------------------- |
| Record voided     | `409 WORKFORCE_RECORD_VOIDED`                  |
| Profile archived  | `409 WORKFORCE_ARCHIVED`                       |
| File type or size | `422 FILE_TYPE_NOT_ALLOWED` / `FILE_TOO_LARGE` |
| Storage full      | `422 PLAN_LIMIT_REACHED`                       |
| Read-only company | `403 SUBSCRIPTION_READ_ONLY`                   |

## Notifications

Expiry reminders through PLT-20. None on create.

## Audit Requirements

`workforce.training.created`, `.updated` (old and new), `.renewed` (old and new ids), `.voided` (reason). Profile History entries (T-56).

## Acceptance Criteria

- Working at Height training completed today with expiry in 20 days shows "Expires in 20 days".
- Adding a refresher makes the earlier record "Replaced"; both are visible under "Show replaced and voided", and only the new one counts in the compliance summary.
- No route deletes a training record.
- A Supervisor can open the copy but sees no edit controls.

## Test Scenarios

- **Positive:** create with and without copy; edit; replace copy; refresher; void; history listing; suggestions; linked user reads own.
- **Negative:** each validation rule; editing voided or replaced records; archived profile; file rules; storage limit; read-only company; no permission; another company's ids; a record id of another person in the URL.

## Future Improvements

Training plans and "pending trainings" (Doc 09 §14); training matrix per position; integration with toolbox talks (Epic 09) and e-learning.
