# PLT-25 — Installable App and Offline Shell (Service Worker)

| Field    | Value                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| Epic     | Platform — Offline foundation (Doc 01 §15, Doc 02 §4)                                                        |
| Priority | Must                                                                                                         |
| Status   | Approved                                                                                                     |
| Sources  | Product Book Doc 01 §15, Doc 02 §4 "PWA"; Master Rules Rule 15; D-11; T-66, T-72; O-115, O-117, O-125, O-128 |

## Business Goal

Field staff open the app from their home screen on site and it starts, even with no signal, so they can capture an inspection or a hazard instead of waiting for coverage (Doc 02 §4 "Installable, Offline capable, Fast loading").

## User Story

As a **site user**, I want to install the app and have it open without a connection, so that a dead zone never stops me from recording what I see.

## Description

Today the web app has a manifest (`apps/web/src/app/manifest.ts`) without icons and no service worker. This enabler adds:

- a **service worker** (T-66) registered on every company subdomain, with the caching rules below;
- **app icons** (placeholders until brand assets arrive, O-128) so the app is installable on Android and iOS;
- an **offline page** for screens that need a connection;
- an **update flow** that never reloads under the user's hands (O-125).

### Caching rules (T-66)

| Request                                              | Strategy                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| `/_next/static/*`, fonts, icons                      | Cache-first (hashed, immutable); old versions removed on activate        |
| App pages and RSC payloads (`?_rsc=`, `RSC` header)  | Network-first, 3 s timeout, then last cached copy, then the offline page |
| Offline-capable routes (registered by modules, T-72) | Pre-cached after sign-in and after each update                           |
| `/api/*`                                             | **Never cached**; passed straight to the network                         |
| Anything cross-origin                                | Not handled                                                              |

Caches are named per build (`hse-static-<buildId>`, `hse-pages-<buildId>`); the activate step deletes other builds' caches.

## Actors

Every user of a company subdomain. The platform console (base domain) does not register the worker.

## Preconditions

- HTTPS (or `localhost` in development).
- A company subdomain (the worker's scope is `/` of that origin).

## User Flow

1. The user opens the app online; the worker installs silently and pre-caches the shell and the offline-capable routes.
2. The browser offers installation (Android) or the user chooses **Install app** in the user menu; on iPhone the menu shows "Share → Add to Home Screen" instructions (O-128).
3. Later, with no connection, the user opens the app: the shell and offline-capable screens open from cache; the header shows **Offline** (PLT-31).
4. They open an online-only page (for example Actions): the **offline page** says "You're offline. This page needs a connection." and links to the sync centre and the offline-capable screens.
5. A new version is deployed: the header shows **Update available — Reload**. Reload is disabled while a form has unsaved input ("Save or discard your changes first").

## Functional Requirements

The system shall:

1. Register the service worker on company subdomains only, after the first page load, never blocking rendering.
2. Apply the caching rules above; never cache `/api/*` responses or any response with `Cache-Control: no-store`.
3. Pre-cache the routes registered as offline-capable (T-72) and the offline page in both languages.
4. Serve the offline page for navigations that fail and have no cached copy.
5. Detect a waiting new worker, show the update banner, and activate it only when the user chooses Reload (`skipWaiting` on message).
6. Delete caches of previous builds on activation.
7. Provide manifest icons (192, 512, maskable 512) and an Apple touch icon; set `lang` and `dir` from the user's language (D-21).
8. Offer **Install app** in the user menu when the browser fires `beforeinstallprompt`; hide it when already installed (`display-mode: standalone`).
9. Unregister nothing on sign-out (the shell holds no personal data); the device store is handled by PLT-31.

## Validation Rules

None.

## Permission Rules

None; the worker never sees API data.

## Database Impact

None.

## API Requirements

None. The worker passes `/api/*` through unchanged.

## UI Requirements

- Offline page: icon, title, short text, buttons **Sync centre** and the offline-capable screens that exist (none in a Sprint 9 production build; Sprint 10 adds inspections).
- Update banner at the top of the page, dismissible until the next navigation; text and icon, never colour alone.
- Arabic right-to-left; the offline page reads the language from the device store (PLT-26), defaulting to the company default.

## Error Handling

| Case                              | Behaviour                                     |
| --------------------------------- | --------------------------------------------- |
| Worker registration fails         | App works online as today; error logged once  |
| Cache quota exceeded on pre-cache | Pre-cache skipped; sync centre warns (PLT-31) |
| Navigation fails, nothing cached  | Offline page                                  |

## Notifications

None.

## Audit Requirements

None.

## Acceptance Criteria

- The production build passes the browser's installability checks; the app installs on Android Chrome and iOS Safari.
- With the network off, reopening the installed app shows the shell and the sync centre; an online-only page shows the offline page in the user's language.
- `/api/*` responses never appear in any cache (checked in the browser's cache storage).
- After a deployment, the banner appears; with unsaved input Reload is refused; after Reload the old caches are gone.

## Test Scenarios

- **Positive:** install, offline start, offline navigation to a cached page, update and reload.
- **Negative:** platform console registers no worker; `no-store` responses not cached; a failed RSC fetch with no cache falls back to the offline page rather than a broken screen.

## Future Improvements

Brand icons and splash screens; Web Push notifications; periodic background sync for reference data.
