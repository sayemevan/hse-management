# US-002 — Forgot Password

| Field    | Value                                                                      |
| -------- | -------------------------------------------------------------------------- |
| Epic     | Epic 01 — Authentication & Security                                        |
| Priority | Must                                                                       |
| Status   | Approved                                                                   |
| Sources  | Product Book Doc 14, Doc 16 (Forgot Password); O-7; T-16, T-17, T-21; O-22 |

## Business Goal

Let users get back into their account on their own, without waiting for an administrator.

## Description

The user enters their email address and receives a reset link if an active account exists. The page always answers the same way. This replaces the Sprint 1 "contact your administrator" page (O-7).

## Actors

Any user who can't sign in, including the System Owner on the base domain.

## Preconditions

None. On a company subdomain, only that company's users get a link; on the base domain, only platform users (System Owner).

## User Flow

1. On the sign-in page, select **Forgot your password?**
2. Enter the email address and select **Send reset link**.
3. See "If an account exists for this address, we've sent a link. It works for 1 hour."
4. Open the email and follow the link (US-003).

## Functional Requirements

The system shall:

1. Accept an email address and always reply `202` with the same body and similar timing.
2. Only when an `active` user with that email exists **in the tenant of the request** (or a platform user on the base domain): invalidate earlier unused reset tokens, create a new token (purpose `password_reset`, 1 hour, O-22) and enqueue `auth.password_reset`.
3. Send nothing for pending, suspended or archived users. A user locked by failed attempts (D-05) can still reset; the reset clears the lock.
4. Rate-limit: 3 requests per email per hour and the existing per-IP limit.
5. Send the email in the user's preferred language, else the company default.

## Validation Rules

Email: required, valid address.

## Permission Rules

Public.

## Database Impact

Inserts `one_time_token`, `email_outbox`; marks earlier reset tokens used.

## API Requirements

`POST /api/v1/auth/forgot-password` with `{ email }` → `202`.

## UI Requirements

- One email field (`autocomplete="email"`), a send button, and a back-to-sign-in link.
- After sending: the confirmation message and a **Send again** link (shown after 60 seconds).
- Arabic and English, phone width.

## Error Handling

| Situation       | Message                                                                          |
| --------------- | -------------------------------------------------------------------------------- |
| Any request     | "If an account exists for this address, we've sent a link. It works for 1 hour." |
| Rate limit (IP) | "Too many requests. Try again in a few minutes."                                 |

## Notifications

`auth.password_reset`: the link, its expiry, and "If you didn't ask for this, ignore this email — your password hasn't changed."

## Audit Requirements

`auth.password_reset.requested` only when a link was sent (user id; never the token).

## Acceptance Criteria

- An active user receives a reset link; any other address gets the same answer and no email.
- A company user asking on another company's subdomain gets no email.
- The System Owner can request a link on the base domain.
- The sign-in page links to this form instead of the placeholder.

## Test Scenarios

- **Positive:** active user; locked user; System Owner on base domain; second request invalidates the first link.
- **Negative:** unknown email; pending, suspended user; user of another company's subdomain; 4th request in an hour sends nothing.

## Future Improvements

A one-time code instead of a link; alert to the administrator after many reset requests.
