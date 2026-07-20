# Integration notes for `skillerr-registry`

This is the only handshake between this repo and the private `skillerr-registry` product. When a capability described in [`spec/CONTRACT.md`](./spec/CONTRACT.md) becomes available in `@skillerr/core`, it's noted here with the version that shipped it. The registry side reads this and upgrades its `@skillerr/core` pin when ready — this repo never reaches into `skillerr-registry` to wire itself in.

Newest first.

## Pending release — on `develop`, not yet published

Everything below is merged into this repo's `develop` branch but **has not gone through a release yet** (no `release/*` branch cut, no version bump, no npm publish) — `@skillerr/core@1.5.2` on npm today still predates all of it. Pin against a specific commit on `develop` if you need to integrate before a real version ships; this note will be updated with the actual version number once one does.

**Adapter layer** (`packages/core/src/trust-spine.ts`), matching spec/CONTRACT.md's Section 3a shapes:
- `seal`, `openSealed`
- `sign`/`verifySignature` — published-key path only; keyless (Fulcio) signing not yet split out of the existing `mintKeylessAnchor` (real follow-up work, not a thin wrap)
- `Anchor`/`RekorAnchor` — delegates to the real, already-network-tested Rekor anchoring; subject metadata captured at construction time
- `capabilitiesFromPermission` (`CapabilitySchema`) — `shell` scope honestly empty pending a `@skillerr/protocol` change (no `commands` field exists yet)
- `evaluateReleaseProfile`
- `verify(digest, evidence)` — composes signature + inclusion-proof checks directly; `anchored`/`revocation` are caller-supplied pre-checked results (a `Commitment`/`RevocationRecord`'s real verification needs key-store context this generic function doesn't have). Never reports `verified: true` without at least one positive check, never lets a pass outweigh a fail.
- `generateSBOM` — real, minimal CycloneDX 1.5, built from `SkillManifest.dependencies` (no invented dependency graph)

**Merkle-log spine** (`packages/core/src/merkle-log.ts`): `buildLeaf`, `verifyInclusion`, `verifyConsistency`, plus the constructive counterparts a log host needs (`treeHash`, `generateInclusionProof`, `generateConsistencyProof`, `buildSignedTreeHead`) — a from-scratch RFC 6962-style Merkle tree, pure/standalone, no registry knowledge. Nothing existed for this before; treat it as the trust primitive most worth independent review given its role.

**Continuity surface** (`packages/core/src/continuity.ts`, [RFC 0009](./docs/rfcs/0009-resume-contract.md)): `isContinuity`, `openContinuity`, `resumePreview` — Resume Contract 1.0. Built directly on real `provenance.journey`/`knowledge`, not any invented file convention (differs in shape from what `registry/continuity-surface`'s mock in `src/lib/core-adapter.ts` guessed — no "steps" array, no `continuity.json` file). `resumeTargets` deliberately uses this repo's own host-agnostic `skill load <path>`, never a product-specific install command.

Relicensed to **Apache-2.0** (was MIT) — sole-author decision, see spec/CONTRACT.md's licensing note.

Not yet started: `attest`, `evaluatePolicy`, `scoreSignals`, `runSandboxed`'s declared-vs-actual diff, and the generic `fromFormat`/`toFormat` bridge — see spec/CONTRACT.md's status table for what each maps onto today.
