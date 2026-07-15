# Tier 0–4 summary (bug fixes, hardening, protocol evolution)

Final deliverable for the "Fix bugs, harden, and evolve dot-skill/skillerr"
task: every silent-fallback instance found during the BUG-3 sweep with its
disposition, and a checklist mapping every SEC-*/PROTO-* item to the test or
spec section that proves it.

## BUG-3 silent-fallback disposition table

BUG-3 asked for a systematic sweep for places where the reference
implementation quietly did something less than what it claimed — treating
missing data as empty, reconstructing an unverifiable claim as if verified,
or swallowing an error instead of surfacing it. Each instance below was
triaged as either a genuine bug (**fixed**) or a deliberate, now-documented
default (**intentional**).

| # | Silent-fallback instance | Disposition | Evidence |
|---|---|---|---|
| 1 | `validate()` treated a package with `manifest.inputs`/`manifest.policy.consent_for` stripped as structurally fine (empty, not missing) | **Fixed** — `inputs_missing`/`policy_missing`/`policy_consent_for_missing` issue codes added | `conformance.test.ts:632` |
| 2 | Secret redaction regex was broad enough to also redact legitimate hex digests (git SHAs, content hashes), silently corrupting non-secret content while looking like it was "protecting" the package | **Fixed** — narrowed pattern, and every redaction is now reported as a `secret_redacted` issue rather than applied invisibly | `conformance.test.ts:1499` |
| 3 | A contract step missing a kind-required field (e.g. an `instruct` step with no `instruction`) compiled anyway with the field silently treated as empty text | **Fixed** — `STEP_KIND_REQUIRED_FIELDS` validation flags it at authoring/compile time | `conformance.test.ts:1566` |
| 4 | `verifyMintTrust` reconstructed a missing `issuer_class` from `key_id` instead of refusing — meaning a stripped `issuer_class` still silently produced *some* trust label rather than a loud refusal | **Fixed** — throws `missing_issuer_class` | `conformance.test.ts:1587`, `adversarial.test.ts` "stripped issuer_class" |
| 5 | `workspace.status()` caught and swallowed *every* error uniformly, including ones that meant real corruption, not just "no agent host declared yet" | **Fixed for the general case, intentional for one case** — only the expected missing-agent-host condition is caught silently; every other error now propagates | `conformance.test.ts:1623` |
| 6 | `human_approvals.actors` present as an empty array was implicitly readable as "a human approved this" by anything checking for the field's mere presence | **Fixed** — explicit `attested: (actors?.length ?? 0) > 0` boolean added; absence of actors is never implied as approval | `docs/MINT.md`, RFC 0002 motivation |
| 7 | Workspace section files authored outside the declared agent boundary were silently folded in as if agent-authored | **Fixed** — `listSectionFiles()` rejects non-`"agent"`-sourced files | `packages/workspace/src/index.ts:380` comment + `workspace.test.ts` |
| 8 | `compilation_report.created_at` was silently overwritten with wall-clock mint time, discarding when the source actually existed | **Fixed** — defaults to `source.created_at` unless explicitly overridden | `packages/core/src/compile.ts` |
| 9 | A source with `contract_missing`/`contract_unparsable` silently fell back to the lossy legacy adapter path instead of surfacing why the richer contract path wasn't available | **Fixed** — `contract_load_error` surfaced in release-profile refusal hints | `packages/protocol/src/source.ts`, `packages/core/src/compile.ts` |
| 10 | `inspectSkill()`'s `claimsSealed` logic had inverted/garbled boolean handling, so a package that merely *claimed* `mint_status=minted` could render as a bare "SEALED" label indistinguishable from a cryptographically verified one | **Fixed** — relabeled `CLAIMS SEALED (unverified — run \`skill inspect --trust\`)` | `packages/core/src/validate.ts`, `docs/SECURITY.md` |
| 11 | `validateManifestShape`'s `manifest_digest` recomputation could itself throw on a manifest with a stripped required array field, meaning a malformed package could crash validation instead of getting a report | **Intentional, documented** — wrapped in try/catch; a thrown recomputation is treated as a `manifest_digest_mismatch`, since `validate()` must always return a report, never crash. This is a deliberate "never throw out of validate()" invariant, not an unnoticed gap. | `packages/core/src/validate.ts` |
| 12 | Legacy (non-contract) workspace sections compile successfully under `continuity` but the same source silently would have looked "fine" if release-compiled too, given no explicit signal that legacy adapter loses fidelity | **Intentional, documented** — legacy sections are explicitly allowed to checkpoint (continuity) but `release` profile refuses them outright (BUG-1's contract-authoring path is the only way to reach release); this is the profile system working as designed, now covered by a regression test so the boundary can't silently drift | `conformance.test.ts` "workspace legacy sections checkpoint for continuity but refuse release" |
| 13 | Runtime capability gate exempted `read`-class capabilities from deny-by-default, unlike `write`/`destructive` | **Fixed** (SEC-H) — `read` now requires an explicit declared permission exactly like every other capability class | `packages/runtime/src/runtime.test.ts` |
| 14 | `subskill`/`delegate` workflow steps pass every validation/mint/compile check and only fail with a generic thrown error deep into `execute` | **Not yet fixed — spec-only for now**, tracked as a real gap rather than silently left unaddressed | RFC 0004 (PROTO-6) |

**Totals: 11 fixed, 2 intentional-and-now-documented, 1 tracked as an open RFC.**

## SEC-*/PROTO-* checklist

Every item's disposition, and the test file or spec section that proves it
holds. "Code" = shipped, tested implementation. "RFC" = spec-only per the
tier-4 scope decision (full implementation for PROTO-1/5/7 only, since later
SEC-tier fixes depend on those staying fixed; RFC for the rest).

| Item | Disposition | Test / spec |
|---|---|---|
| SEC-A: host allowlist substring/prefix bypass | Code | `runtime.test.ts` |
| SEC-B: path allowlist traversal bypass (unnormalized `..`) | Code | `runtime.test.ts` |
| SEC-C: Windows drive-letter path bypass | Code | `adversarial.test.ts` "C:/ absolute entry", `core.test.ts` |
| SEC-D: zip bomb (entry count / size / ratio) | Code | `adversarial.test.ts` "zip bomb" |
| SEC-E: streaming decompression (abort mid-inflate, not post-hoc) | Code | `adversarial.test.ts`, `packages/core/src/pack.ts` `unzipWithLimits` |
| SEC-F: manifest self-digest (`manifest_digest`) | Code | `adversarial.test.ts` "tampered manifest capabilities", `core.test.ts` |
| SEC-G: real HMAC seal + `sig_alg` versioning | Code | `core.test.ts` mint/verify coverage |
| SEC-H: `read` capability included in deny-by-default | Code | `runtime.test.ts` |
| SEC-I: unverified "sealed" claims labeled honestly | Code | `docs/SECURITY.md`, `core.test.ts` |
| SEC-J: deterministic zip packing (sorted entries, fixed mtime) | Code | `core.test.ts` determinism test |
| SEC-K: RFC 8785 canonicalization pinned + cross-impl vectors | Code | `fixtures/canonicalization/vectors.json`, `docs/CANONICALIZATION.md` |
| SEC-L: consolidated adversarial fixture corpus | Code | `packages/cli/src/adversarial.test.ts` (9 cases, run in CI on all 3 OSes) |
| PROTO-1: content-addressed `skill_id` | Code | `core.test.ts`, `packages/core/src/compile.ts` `contentAddressedSkillId` |
| PROTO-2: asymmetric Ed25519 signatures + trust store | Code (Phase 10) | `packages/core/src/signer.ts`, `trust-store.ts`, `core.test.ts` PROTO-2 tests, [Key Ceremony](./KEY-CEREMONY.md), [RFC 0001](./rfcs/0001-asymmetric-signatures-trust-store.md) |
| PROTO-3: independent human-review countersignature | RFC | [RFC 0002](./rfcs/0002-human-review-countersignature.md) |
| PROTO-4: revocation + expiry | RFC | [RFC 0003](./rfcs/0003-revocation-expiry.md) |
| PROTO-5: permission grammar (hosts/paths) | Code | `protocol.test.ts` grammar tests, `packages/protocol/src/grammar.ts` |
| PROTO-6: dangling `subskill`/`delegate` step kinds | RFC | [RFC 0004](./rfcs/0004-dangling-step-kinds.md) |
| PROTO-7: JSON Schemas (draft 2020-12) for every container file | Code | `core.test.ts` schema tests, `packages/protocol/src/schemas.ts` |
| PROTO-8: media type + magic identification | RFC | [RFC 0005](./rfcs/0005-media-type-magic-identification.md) |
| PROTO-9: lineage chain | RFC | [RFC 0006](./rfcs/0006-lineage-chain.md) |
| PROTO-10: threat model | Code (doc) | [Threat Model](https://github.com/dot-skill/skillerr/wiki/Threat-Model) |

## Tier 0 / Tier 3 hygiene (not individually coded, for completeness)

- Cross-platform build/test/CI matrix (ubuntu/windows/macos) — Tier 0
- Every package has real unit test coverage — Tier 3, `packages/*/src/*.test.ts`
- `npm pack --dry-run` excludes test files from published tarballs — Tier 3
- `docs/PROTOCOL.md`/`README.md`/`docs/SECURITY.md`/`docs/RUNTIME.md`/`docs/MINT.md`/`docs/WORKSPACE.md`/`docs/ROADMAP.md` kept in sync with every semantic change in the same commit — Tier 3, ongoing rule
- `install.sh` pinned to an exact version instead of `@latest` — Tier 3

## PR history

All of the above landed as commits directly on `main` (no separate
feature-branch PRs were opened — the user authorized working locally and
pushing directly per the "push all current to github then continue"
instruction), each commit scoped to one tier/bug/item with a conventional
commit message and DCO sign-off (`git commit -s`). See `git log` on
`dot-skill/skillerr`'s `main` branch for the full, itemized history.
