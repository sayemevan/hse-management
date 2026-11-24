# US-006 — User Invitation

| Field    | Value                                                                                                                                  |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Epic     | Epic 01 — Authentication & Security                                                                                                    |
| Priority | Must                                                                                                                                   |
| Status   | Approved                                                                                                                               |
| Sources  | Product Book Doc 14, Doc 16 (User Invitation; User Flow), Doc 07 §13; D-02, D-03, D-08; T-15, T-16, T-17, T-20; O-21, O-23, O-24, O-26 |

## Business Goal

Let a Company Administrator bring colleagues onto the platform without sharing passwords, so each person has their own account and audit trail.

## Description

The administrator enters a name, an email address and a role. The person gets an email with a link to their company's subdomain, sets a password and is signed in. The administrator sees pending invitations and can resend or cancel them.

## Actors

Company Administrator (invites); invited person (accepts).

## Preconditions

- The administrator is signed in on their company's subdomain and holds `users.invite` (PLT-08).
- The company is `active` (not `read_only`, D-30).

## User Flow

**Invite**

1. Open **Settings → Users** and select **Invite user**.
2. Enter full name, email address and role; choose the invitation language (defaults to the company language).
3. Select **Send invitation**. The person appears in the list as **Invitation pending**.

**Accept**

1. Open the link (`<slug>.<base>/invite/accept?token=…`). The page shows the company's name and logo and the person's name and email (read-only).
2. Set and confirm a password (live policy checklist, D-03).
3. Select **Activate account**. The person is signed in and lands on the home page.

**Manage pending invitations**: **Resend** (new link, the old one stops working) or **Cancel invitation** (with confirmation).

## Functional Requirements

The system shall:

1. Create a `user` with status `pending_invitation`, the company's id, no usable password and the chosen role at company scope, plus a `user_invitation` row and a token (purpose `invitation`, 7 days, O-21), and enqueue `user.invitation` — all in one atomic batch (T-15, T-16).
2. Refuse an email already used by any user on the platform (D-08), with a message that doesn't reveal which company has it.
3. Check the plan's user limit: active plus pending users must stay within the limit (O-26).
4. Allow any company-level role from D-02 except System Owner (O-23).
5. On resend: invalidate the previous token, issue a new one, enqueue the email again. Limited to 5 resends per invitation per day.
6. On cancel: mark the invitation revoked, invalidate the token and soft-delete the pending user, so the email can be invited again.
7. On accept: check the token (purpose, unused, unexpired, and that the user belongs to the tenant of the subdomain), set the password hash, set status `active`, consume the token, mark the invitation accepted, and start a session as at login (US-001) — in one batch.
8. Show the GET of the accept page without changing data (as in US-011.2).
9. List the company's users with name, email, role, status and, for pending ones, when the invitation was sent and when it expires. Search by name or email; 25 per page.

## Validation Rules

- Full name: 2–100 characters.
- Email: valid address, max 254 characters, stored in lowercase.
- Role: from the allowed list.
- Password at acceptance: D-03 policy, 8–128 characters, confirmation matches.

## Permission Rules

- Invite, resend, cancel, list: `users.invite` / `users.view` (Company Administrator, PLT-08).
- Accept: anyone with the link (the token is the credential), on the company's subdomain only.

## Database Impact

- New table `user_invitation`: `id`, `company_id`, `user_id`, `invited_by`, `role_code`, `language`, `sent_at`, `resend_count`, `last_sent_at`, `accepted_at`, `revoked_at`, `revoked_by`, audit columns.
- Inserts/updates `user`, `user_role`, `one_time_token`, `email_outbox`, `user_session`, `audit_log`.

## API Requirements

- `GET /api/v1/users?search=&page=` → paged list.
- `POST /api/v1/users/invitations` with `{ fullName, email, roleCode, language }` → `201` with the user.
- `POST /api/v1/users/{id}/invitation/resend` → `202`.
- `DELETE /api/v1/users/{id}/invitation` → `204`.
- `GET /api/v1/invitations?token=` → `{ companyName, fullName, email }` or `TOKEN_INVALID_OR_EXPIRED`.
- `POST /api/v1/invitations/accept` with `{ token, password }` → same response as login.

## UI Requirements

- Users list: cards on phones, a table from tablet width; status chip (Active / Invitation pending / Invitation expired).
- Invite form in a drawer (phones: full screen); role select with a one-line description of each role.
- Accept page: company logo, password fields with show/hide and `autocomplete="new-password"`, the D-03 checklist.
- Arabic and English, phone width.

## Error Handling

| Situation                     | Message                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| Email already in use          | "This email address is already registered on the platform."                                 |
| Plan user limit reached       | "Your plan allows {limit} users. Remove a pending invitation or upgrade your plan."         |
| Link invalid, used or expired | "This invitation has expired or was already used. Ask your administrator for a new one."    |
| Company is read-only          | "Your company account is read-only. New users can't be invited until payment is confirmed." |

## Notifications

- `user.invitation` (to the invited person, in the chosen language): company name, who invited them, the link, the expiry date.
- `user.invitation_accepted` (to the administrator who invited).

## Audit Requirements

`user.invited`, `user.invitation_resent`, `user.invitation_revoked`, `user.invitation_accepted` (actor, user id, role; never the token).

## Acceptance Criteria

- An administrator can invite a person, who receives the email and can activate the account and sign in.
- A used, expired, resent-over or cancelled link doesn't work.
- A link for company A doesn't work on company B's subdomain.
- An email already in use, a System Owner role or a full plan is refused.
- Pending users can't sign in until they accept.
- Every step is audited.

## Test Scenarios

- **Positive:** invite → accept → sign in; resend then accept with the new link; cancel then invite the same email again; invite a second Company Administrator (O-24).
- **Negative:** duplicate email (same and other company); role `system_owner`; plan limit reached; old link after resend; expired link (7 days + 1 minute); link opened on another subdomain; weak password; non-administrator calling the endpoints; read-only company.
- **Boundary:** limit exactly reached by the last invitation is allowed; one more is refused.

## Future Improvements

Bulk invitations from a spreadsheet; invitation by phone number once SMS exists (D-32); project assignment in the same step (Sprint 5).
