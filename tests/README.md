# Cross-application tests

Unit tests live next to each package (`apps/*/test`, `packages/*/test`) and run with `npm test`.

This folder is for tests that span apps:

- `e2e/` — end-to-end browser tests (tool to be chosen with the first screen; Playwright is the expected candidate).

Testing bar (Doc 32): unit + integration for each feature, UAT before release.
