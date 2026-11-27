# Offline layer (Sprint 9: PLT-25 – PLT-31)

The one offline layer of the web app (D-11, D-20, D-56, D-57). Business modules never open
IndexedDB, call `fetch` for queued work or talk to the service worker themselves: they register
with this folder and queue changes through it.

## Pieces

| File                            | What it does                                                                                                                                                                                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `device-store.ts`               | The IndexedDB database `hse-offline` (one per company subdomain): `meta`, `session`, `reference`, `drafts`, `outbox`, `blobs`, `conflicts`. Every row has `userId`. Versioned upgrades in `upgrade()`.                                                         |
| `outbox.ts`                     | `enqueue` (fixes the `Idempotency-Key`), list, discard (with dependents and photos), `discardAll`, `pruneSynced` (24 h), device copies of conflicts, counts for the indicator.                                                                                 |
| `sync-engine.ts`                | `SyncEngine`: per-record order, `dependsOn`, up to 3 records at once, back-off, and where each answer sends an item (`classify`). Framework-free and unit-tested.                                                                                              |
| `http-transport.ts`             | Sends an item with `Idempotency-Key`, `X-Captured-At`, `X-Device-Id`; refreshes the token once on 401.                                                                                                                                                         |
| `sync-provider.tsx`             | Runs the engine for the signed-in user under a Web Lock; triggers: start, `online`, focus, every minute while pending, Background Sync (Chromium). Exposes `useSync()`.                                                                                        |
| `offline-profile.ts`            | The offline profile (no tokens, T-73), 7-day limit (O-118), projects kept on the device and their packs (PLT-26).                                                                                                                                              |
| `photo.ts`                      | `compressPhoto`: JPEG, long edge ≤ 2,560 px, quality 0.82, no EXIF (T-74).                                                                                                                                                                                     |
| `registry.ts`                   | `registerOfflineEntity`, `registerReferencePack`, the offline routes the service worker pre-caches.                                                                                                                                                            |
| `pwa-provider.tsx`              | Registers `/sw.js`, pre-caches after sign-in, the update banner and the install prompt.                                                                                                                                                                        |
| `../../../service-worker/sw.ts` | The service worker (built to `public/sw.js` by `scripts/build-sw.mjs` before `dev` and `build`).                                                                                                                                                               |
| Screens                         | `sync-centre-screen.tsx` (`/sync`), `conflict-review.tsx` (`/sync?conflict={id}`), `connection-indicator.tsx`, `update-banner.tsx`, `offline-gate.tsx` / `offline-notice.tsx`, `sign-out-dialog.tsx`, `keep-on-device-switch.tsx`, `waiting-items-notice.tsx`. |
| `dev/`                          | The sync probe (development build only, O-116). The example to copy.                                                                                                                                                                                           |

## Making a record type work offline (Sprint 10 onwards)

1. **API:** mark the module's offline write routes with `idempotent({ read, companyIdOf })` and add
   `IdempotencyService.record(claim, …)` to the change's `UnitOfWork`. Creates accept a device-made
   `id` (T-68). Give the table a `version` column, take `baseVersion` on updates, and on a mismatch
   call `SyncConflictService.detect(...)` when the request is offline (`offlineMetaOf(c)`). Register
   a `SyncEntity` (`snapshot`, `prepareUpdate`, `conflictFields`) in the module's `index.ts`.
2. **Web:** call `registerOfflineEntity({ type, labelKey, routes, conflictFields, fromServer })` from
   `offline-modules.ts`. Queue changes with `enqueue(...)`: one `create`, then `upload` items with
   `dependsOn` the create's `seq`; updates carry `baseVersionField: 'baseVersion'` and **only the
   fields the user changed** (an untouched field would show as a conflict).
3. Add the module's pages to `routes` so the service worker pre-caches them, and keep their
   contract backward compatible for 30 days after a change (O-125).

See `dev/sync-probe.ts` for a complete example.
