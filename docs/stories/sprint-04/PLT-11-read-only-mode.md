# PLT-11 — Read-Only Mode

| Field    | Value                                                      |
| -------- | ---------------------------------------------------------- |
| Epic     | Platform / tenancy                                         |
| Priority | Must                                                       |
| Status   | Approved                                                   |
| Sources  | D-18, D-30; PLT-02, PLT-08, PLT-10; T-22, T-23, T-24; O-36 |

## Business Goal

An unpaid company can still see and export all its data, but can't add or change anything until it pays (D-18). Every user knows why, and the administrator knows how to fix it.

## Description

One middleware on all company routes refuses writes while the company is read-only, except for a short allow-list. The tenant profile tells the web app the subscription state, and a banner on every company page explains it.

## Actors

Every company user; Company Administrator (sees how to pay).

## Preconditions

PLT-10 (effective state).

## Functional Requirements

The system shall:

1. Add a middleware after tenant resolution on every company-context route: when the effective state (PLT-10 FR-1, FR-2) is `read_only`, refuse `POST`, `PUT`, `PATCH` and `DELETE` with `403 SUBSCRIPTION_READ_ONLY`.
2. Let through only the routes marked `allowInReadOnly` (O-36):
   - sign-in, token refresh, sign-out, forgot / reset password, invitation acceptance (an invited user can still join and look);
   - own profile, own password, own sessions (`/auth/*`);
   - the subscription and payment routes (PLT-13);
   - export routes, when they exist (D-18).
     The marker is set where the route is defined, and a unit test lists every company write route with its marker, so a new one is a reviewed choice.
3. Not affect `GET`, `HEAD` and `OPTIONS`.
4. Not affect platform (base-domain) routes.
5. Extend the public tenant profile `GET /tenant` with `subscription: { state, endsAt, readOnlySince, paymentUnderReview }` (`endsAt` = trial end, period end or grace end depending on the state). No amounts or plan details, because the endpoint is public.
6. In the web app, show a **banner** under the header on every company page:
   - `trial`, 7 days or fewer left: "Your trial ends on {date}." Administrators: "Upload payment proof" link.
   - `grace`: "Your subscription has ended. Pay by {date} to avoid read-only mode."
   - `read_only`: "This workspace is read-only because the subscription isn't paid. You can still view everything." Administrators get the link; others: "Contact your Company Administrator."
   - pending proof: "Payment under review."
7. In read-only mode, hide or disable create, edit and delete controls on the existing screens (users, company profile, settings, logo) with the reason as a tooltip/help text, and show the API's message if a write is attempted anyway.

## Validation Rules

None.

## Permission Rules

Read-only mode only removes rights; it never grants any. It applies before permission checks, so the message is the subscription one even for administrators.

## Database Impact

None.

## API Requirements

- Every non-allowed company write → `403 SUBSCRIPTION_READ_ONLY`, message "This workspace is read-only until the subscription is paid." (Arabic and English), `details: { readOnlySince }`.
- `GET /api/v1/tenant` extended (FR-5).

## UI Requirements

Banner as above: full width, warning colour for trial/grace and a stronger one for read-only, icon plus text (not colour alone), logical CSS so it works right-to-left. Dates in the company's date format (US-013). Phone width first.

## Error Handling

`SUBSCRIPTION_READ_ONLY` shown as a toast or inline error with a link to the subscription page for administrators.

## Notifications

None (emails are PLT-15).

## Audit Requirements

Refused writes aren't audited (they change nothing); they are logged at `info` with the route and company.

## Acceptance Criteria

- In read-only mode, inviting a user, editing the company, settings or logo is refused with the subscription message.
- Signing in, changing one's own password and uploading payment proof still work.
- Every company write route is either blocked or on the reviewed allow-list (test).
- The banner shows the right message and date in Arabic and English for each state.

## Test Scenarios

- **Positive:** read-only GET works; allowed writes work; banner per state; company becomes writable right after confirmation (cache cleared).
- **Negative:** each Sprint 3 write route refused in read-only mode; a forged state in the request has no effect (state comes from the server).

## Future Improvements

Read-only rules per module once exports and offline sync exist (offline captures made before read-only started are accepted, decided in Sprint 9).
