# US-024 — Create and Manage Workforce Profiles

| Field    | Value                                                                                                                         |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Epic     | Epic 03 — Workforce Management (Doc 18 "Workforce Profiles", "Personal Information")                                          |
| Priority | Must                                                                                                                          |
| Status   | Approved                                                                                                                      |
| Sources  | Product Book Doc 14, Doc 09 §1–4, §13, §17, §19, Doc 18; D-09; T-47, T-49, T-52, T-53, T-56; O-71–O-74, O-78–O-82, O-85, O-95 |

## Business Goal

One accurate directory of everyone who works for or on behalf of the company, whatever their employment type, so that safety records can name real people and nobody is entered twice (Doc 09 Purpose, §3).

## User Story

As an **HSE Manager or Safety Officer**, I want to create a profile for every worker, contractor and visitor, so that I can assign them to projects and track their competence and fitness.

## Description

The **Workforce** area lists every profile of the company with search and filters. A profile has an **Overview** (personal details, status, compliance summary, current assignments) and tabs for the records of US-025–030 and a **History** tab (T-56). This story covers the directory, creating and editing profiles, the photo, employment status, archive and restore, the optional **user link** (D-09) and the read-only **My workforce record**.

**Profile fields:**

| Field                  | Rule                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Category               | Required: Employee, Contractor, Subcontractor, Temporary worker, Visitor, Consultant, Client representative (Doc 09 §2) |
| Full name              | Required (as on the ID), 2–120                                                                                          |
| Name in other language | Optional, 2–120 (O-81)                                                                                                  |
| Employee ID            | Optional, 1–30, unique in the company (O-80)                                                                            |
| Nationality            | Required, country from the shared country list                                                                          |
| Employer               | Required, 2–120, suggestions; pre-filled with the company name for Employee (O-82)                                      |
| Job position           | Required, active item of the job position list (PLT-21)                                                                 |
| Department             | Optional, up to 80, suggestions (O-95)                                                                                  |
| Mobile number          | Optional, international format (same rule as the user profile)                                                          |
| Email                  | Optional, valid email (not a login)                                                                                     |
| Photo                  | Optional, JPEG / PNG / WebP up to 5 MB (O-71)                                                                           |
| Status                 | Active (default), On Leave, Suspended, Inactive, Terminated (Doc 09 §4); with a "since" date and optional reason (200)  |

**Status rules (O-78):** only Active and On Leave can be given new assignments. Setting Inactive or Terminated offers "End RMX-02 and 1 other current assignment today and cancel 1 upcoming" (ticked by default). Setting Suspended notifies the managers of the person's current projects. The status is separate from any user account status (C-19).

**Archive (O-79):** allowed only for Inactive or Terminated people without current or upcoming assignments; makes the profile and its records read-only and removes the user link. **Restore** returns it as Inactive.

**User link (D-09, T-53):** a profile may be linked to one company user and a user to one profile. The linked user sees **My workforce record** (read-only, O-85) and gets personal expiry notices (PLT-20).

## Actors

Holders of `workforce.view` (read), `workforce.manage` (change), `users.view` + `workforce.manage` (user link); a linked user (own record).

## Preconditions

- Signed in on the company's subdomain.
- To change: `workforce.manage`, the profile isn't archived (except Restore), and the company isn't read-only.

## User Flow

1. Header → **Workforce**: counts (PLT-20), search box, filters (Status, Category, Job position, Nationality, Project, Needs attention, Show archived); a table on desktop, cards on phone; each row: photo, name, employee ID, position, employer, status, compliance badge, current projects.
2. **Add person** → the form → **Save**. If a person with the same full name and nationality exists: "A person with this name and nationality already exists: Ahmed Ali (Welder, Al-Bina Co.)." with **Open** and **Create anyway**.
3. The profile opens on **Overview**: photo, details, status chip with "since", compliance summary, current assignments, linked account.
4. **Edit details**, **Change photo** / **Remove photo**, **Change status** (dialog with date, reason and the assignment option), **Link account** (searchable list of active and invited users not yet linked) / **Unlink**, **Archive** / **Restore**.
5. **History** tab: every change with who and when, newest first.
6. A linked user opens the account menu → **My workforce record**.

## Functional Requirements

The system shall:

1. List profiles of the company, 25 per page, ordered by name, with search on both names, employee ID and employer (T-52), the filters above and the counts of PLT-20. Archived profiles only with `archived=true`.
2. Create a profile, enforcing the field rules, Employee ID uniqueness and the 20,000-profile guard (O-72); return `duplicates` (same full name and nationality) on a dry-run check the form calls before saving.
3. Edit details with audit of old and new values; refuse an inactive job position unless it is the current value.
4. Store the photo through the file storage service in category `workforce_photo` (T-49); serve it through `GET /workforce/{id}/photo` with `workforce.view` or `projects.workforce.view` on a project the person is assigned to.
5. Change status with a since date (not more than 1 year back, not in the future), ending and cancelling assignments in the same batch when chosen (US-025 rules), and notifying on Suspended.
6. Archive and restore as in the description; refuse archive otherwise (`WORKFORCE_ARCHIVE_REFUSED` with the reason).
7. Link and unlink a user: the user must be in the company, not System Owner, and not linked elsewhere (`WORKFORCE_USER_ALREADY_LINKED`).
8. Return `GET /me/workforce` with the caller's linked profile and all its records (including contacts and documents, O-85), or `404` when not linked.
9. Expose `WorkforceDirectory` in the module contract (T-47): `resolve(memberIds)` → names, position, status, photo; `search(companyId, query, filters)`; `availability(memberId, projectId, onDate)` → `{ status, assignment, compliance }`.
10. Write the audit entry and the profile History entry in the same batch as each change; never delete a profile.

## Validation Rules

| Field         | Rule                                    | Message                                                         |
| ------------- | --------------------------------------- | --------------------------------------------------------------- |
| Category      | One of the seven                        | "Choose a category."                                            |
| Full name     | 2–120 after trimming                    | "Enter the full name."                                          |
| Employee ID   | 1–30 letters, numbers, `-` `/`; unique  | "This employee ID is already used by {name}."                   |
| Nationality   | Country code from the list              | "Choose a nationality."                                         |
| Employer      | 2–120                                   | "Enter the employer."                                           |
| Job position  | Active list item                        | "Choose a job position."                                        |
| Mobile, email | Valid formats                           | "Enter a valid mobile number." / "Enter a valid email address." |
| Status date   | Not in the future, within the last year | "Choose a date in the last year."                               |
| Photo         | Type and size (O-71)                    | "Use a JPEG, PNG or WebP image up to 5 MB."                     |

## Permission Rules

- **`workforce.view`** (company, new). Proposed defaults (O-73): CA ✓, HD ✓, HM ✓, PM ✓, SO ✓, SE ✓, SV ✓, FM —, IN —, WK —, CL —, CO —, AU —.
- **`workforce.manage`** (company, new). Proposed defaults (O-74): CA ✓, HD ✓, HM ✓, PM —, SO ✓, SE —, SV —, FM —, IN —, WK —, CL —, CO —, AU —.
- User link: `workforce.manage` and `users.view`.
- My workforce record: the linked user, whatever their role. All company-editable.

## Database Impact

New table `workforce_member`:

| Column                                    | Type / rule                                                 |
| ----------------------------------------- | ----------------------------------------------------------- |
| `id`                                      | UUID v7                                                     |
| `company_id`                              | not null                                                    |
| `category`                                | text enum (seven values)                                    |
| `full_name`, `alt_name`                   | text; `alt_name` nullable                                   |
| `employee_id`                             | text, nullable; `employee_id_key` upper-cased               |
| `nationality`                             | ISO 3166-1 alpha-2                                          |
| `employer`, `department`                  | text; `department` nullable                                 |
| `job_position_id`                         | FK `workforce_list_item`                                    |
| `mobile`, `email`                         | nullable                                                    |
| `photo_file_id`                           | nullable (no FK, as `company.logo_file_id`)                 |
| `status`, `status_since`, `status_reason` | `active`, `on_leave`, `suspended`, `inactive`, `terminated` |
| `search_key`                              | normalised text (T-52)                                      |
| `archived_at`, `archived_by`              | nullable                                                    |
| audit columns                             | `created_at/by`, `updated_at/by`                            |

Indexes: unique (`company_id`, `employee_id_key`) where not null; (`company_id`, `archived_at`, `status`); (`company_id`, `category`); (`company_id`, `job_position_id`); (`company_id`, `nationality`). `user`: unique index on `workforce_member_id` where not null (T-53).

## API Requirements

- `GET /api/v1/workforce?search=&status=&category=&position=&nationality=&project=&attention=&archived=&page=` → `{ items: [{ id, fullName, altName, employeeId, category, position, employer, status, photoUrl, compliance, currentProjects: [{ id, code }] }], page, total }`.
- `POST /workforce` → `201`; `POST /workforce?dryRun=true` → `{ duplicates: [...] }` without saving.
- `GET /workforce/{memberId}` → profile, compliance, current assignments, linked user `{ id, name }`, `can` flags for the caller.
- `PATCH /workforce/{memberId}`; `POST …/status` `{ status, since, reason?, endAssignments }`; `POST …/archive`; `POST …/restore`.
- `PUT …/photo` (multipart), `DELETE …/photo`, `GET …/photo`.
- `PUT …/user-link` `{ userId }`, `DELETE …/user-link`.
- `GET …/history?before=` (25 per page); `GET /workforce/suggestions?field=employer|department&q=` (10).
- `GET /api/v1/me/workforce`.

## UI Requirements

- Workforce link in the header for holders of `workforce.view`; "My workforce record" in the account menu for linked users.
- Profile tabs scroll horizontally on phone; dialogs full-screen on phone.
- Status chip with icon and text; archived banner on archived profiles.
- Names in Arabic or English follow the reader's language when both exist (O-81); employee IDs, phone numbers and emails in `<bdi dir="ltr">`.
- Controls hidden without the permission.

## Error Handling

| Case                | Response                                                  |
| ------------------- | --------------------------------------------------------- |
| Employee ID taken   | `409 WORKFORCE_EMPLOYEE_ID_TAKEN`                         |
| Profile archived    | `409 WORKFORCE_ARCHIVED`                                  |
| Archive not allowed | `422 WORKFORCE_ARCHIVE_REFUSED`                           |
| User already linked | `409 WORKFORCE_USER_ALREADY_LINKED`                       |
| Profile limit       | `422 WORKFORCE_LIMIT_REACHED`                             |
| Photo type or size  | `422 FILE_TYPE_NOT_ALLOWED` / `FILE_TOO_LARGE` (existing) |
| Storage full        | `422 PLAN_LIMIT_REACHED` (existing, storage)              |
| Read-only company   | `403 SUBSCRIPTION_READ_ONLY`                              |
| Invalid input       | `422 VALIDATION_FAILED` per field                         |

## Notifications

| Type                         | To                                                                                     | Text                               |
| ---------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------- |
| `workforce.member.suspended` | holders of `projects.workforce.manage` on the person's current projects; not the actor | "{name} was suspended from {date}" |

## Audit Requirements

`workforce.member.created`, `.updated` (old and new), `.status_changed` (old, new, since, reason, assignments ended), `.photo_changed`, `.photo_removed`, `.archived`, `.restored`, `.user_linked`, `.user_unlinked`. Matching profile History entries (T-56).

## Acceptance Criteria

- An HSE Manager creates "Ahmed Ali", Contractor, Welder, employer "Al-Bina Co.", with the Arabic name "أحمد علي"; searching "احمد" finds him.
- Creating a second Ahmed Ali of the same nationality shows the warning; **Create anyway** saves it.
- A duplicate Employee ID is refused naming the other person.
- A Supervisor sees the directory and profile but no edit controls; a Foreman doesn't see the Workforce link.
- Setting a person Terminated with "end assignments" ticked ends their current assignments today; archive is then allowed.
- A linked user opens My workforce record and sees their own documents, while the same user can't open anybody else's profile.

## Test Scenarios

- **Positive:** create each category; edit; photo upload and removal; each status change; archive and restore; link and unlink; dry-run duplicates; search with Arabic normalisation; each filter; My workforce record.
- **Negative:** each validation rule; inactive position; Employee ID clash ignoring case; archive with current assignment or Active status; editing an archived profile; linking a user of another company, a System Owner, or an already linked user; profile limit; read-only company; caller without the permission; another company's ids.

## Future Improvements

Spreadsheet import; contractor companies as records; badge printing with QR (Doc 09 §18); profile merge for duplicates; self-service updates by linked users.
