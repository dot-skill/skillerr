# Integration notes for `skillerr-registry`

This is the only handshake between this repo and the private `skillerr-registry` product. When a capability described in [`spec/CONTRACT.md`](./spec/CONTRACT.md) becomes available in `@skillerr/core`, it's noted here with the version that shipped it. The registry side reads this and upgrades its `@skillerr/core` pin when ready — this repo never reaches into `skillerr-registry` to wire itself in.

Newest first.

<!-- Example entry, once the first adapter ships:
## @skillerr/core@1.6.0

- `seal()` / `openSealed()` now available — thin async/Buffer-returning wrappers around `packSkill`/`unpackSkill`/`finalizeManifest`. See spec/CONTRACT.md's status table.
-->
