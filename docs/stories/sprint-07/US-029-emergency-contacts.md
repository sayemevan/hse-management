# US-029 — Emergency Contacts

| Field    | Value                                                                           |
| -------- | ------------------------------------------------------------------------------- |
| Epic     | Epic 03 — Workforce Management (Doc 18 "Emergency Contact: Primary, Secondary") |
| Priority | Must                                                                            |
| Status   | Approved                                                                        |
| Sources  | Product Book Doc 14, Doc 09 §11, Doc 18; T-56; O-74, O-75, O-89                 |

## Business Goal

After an injury on site, the supervisor must reach the person's family quickly. Contacts are private and shown only to people who act in emergencies (Doc 09 §11).

## User Story

As a **Supervisor**, I want to see a worker's emergency contacts, so that I can call their family if something happens on site.

## Description

The profile's **Contacts** tab holds up to **3 contacts in order**; the first is **Primary**, the second **Secondary** (O-89). Contacts are edited as one list (add, edit, remove, reorder) and saved together. Removing a contact really deletes it (contacts aren't history, T-48); the audit keeps the change.

**Fields:** name (required), relationship (required: Spouse, Parent, Child, Sibling, Relative, Friend, Colleague, Other), phone (required, international format), second phone (optional).

## Actors

Holders of `workforce.contacts.view` (read); `workforce.manage` + `workforce.contacts.view` (change); the linked user (own, read-only).

## Preconditions

- The profile exists and isn't archived (to change); the company isn't read-only.

## User Flow

1. Profile → **Contacts**: each contact with name, relationship, phone numbers as tap-to-call links, and the Primary / Secondary label.
2. **Edit contacts** → list editor: add (up to 3), edit, remove, Move up / down → **Save**.
3. With no contacts, the Overview shows a warning "No emergency contact" (also a "Check" flag in PLT-20).

## Functional Requirements

The system shall:

1. Return a person's contacts in order to readers with `workforce.contacts.view` or the linked user; otherwise `403`.
2. Replace the whole list in one call (0–3 contacts), in one batch with the audit and History entries.
3. Omit the `noEmergencyContact` flag from compliance summaries for readers without `workforce.contacts.view`.

## Validation Rules

| Field        | Rule                                                     | Message                           |
| ------------ | -------------------------------------------------------- | --------------------------------- |
| Contacts     | 0–3                                                      | "Add up to 3 contacts."           |
| Name         | Required, 2–120                                          | "Enter the contact name."         |
| Relationship | One of the list                                          | "Choose the relationship."        |
| Phone        | Required, international format                           | "Enter a valid phone number."     |
| Second phone | Optional, international format, different from the first | "Enter a different phone number." |

## Permission Rules

- **`workforce.contacts.view`** (company, new). Proposed defaults (O-75): CA ✓, HD ✓, HM ✓, PM ✓, SO ✓, SE —, SV ✓, FM —, IN —, WK —, CL —, CO —, AU —. Company-editable.
- Change: `workforce.manage` **and** `workforce.contacts.view`.

## Database Impact

New table `workforce_emergency_contact`: `id`, `company_id`, `workforce_member_id`, `position` (1–3), `name`, `relationship`, `phone`, `phone_alt`, audit columns. Index: (`workforce_member_id`, `position`).

## API Requirements

- `GET /api/v1/workforce/{memberId}/emergency-contacts` → `{ items: [{ name, relationship, phone, phoneAlt, position }] }`.
- `PUT …/emergency-contacts` `{ items: [...] }` → the saved list.

## UI Requirements

- Phone numbers as `tel:` links in `<bdi dir="ltr">`; large touch targets on phone.
- The tab is hidden without `workforce.contacts.view`.

## Error Handling

| Case              | Response                      |
| ----------------- | ----------------------------- |
| More than 3       | `422 WORKFORCE_CONTACT_LIMIT` |
| No permission     | `403 FORBIDDEN`               |
| Profile archived  | `409 WORKFORCE_ARCHIVED`      |
| Read-only company | `403 SUBSCRIPTION_READ_ONLY`  |

## Notifications

None.

## Audit Requirements

`workforce.contacts.updated` with the old and new lists. A History entry "Emergency contacts updated" without the contact details.

## Acceptance Criteria

- A Supervisor sees Ahmed's two contacts and can call the primary from the phone.
- A Site Engineer doesn't see the Contacts tab and the API returns `403`.
- A fourth contact is refused.

## Test Scenarios

- **Positive:** add, reorder, remove, clear all; linked user reads own.
- **Negative:** each validation rule; read and change without permission; archived profile; read-only company; ids of another company.

## Future Improvements

Showing the primary contact on the incident report (Epic 05); SMS to the contact in emergencies (Epic 13).
