# Frozen contract: `@skillerr/core` <-> `skillerr-registry`

Status: **frozen**. This file is the single source of truth for the interface between this open-source repo (`dot-skill/skillerr`, Apache-2.0-track trust/interop primitives — see [Licensing note](#licensing-note) below) and the private `skillerr-registry` product. Both sides build against this document. If a shape here must change, it changes **here first, by mutual agreement**, before either side's code changes to match it.

## Dependency direction (hard invariant)

`skillerr-registry` depends on `@skillerr/core`. `@skillerr/core` **never** depends on `skillerr-registry` — no registry URLs hard-coded, no registry types imported, no knowledge that `skillerr.com` exists anywhere in this package. Enforced by CI (`scripts/check-core-registry-independence.mjs`, run on every `npm test`): fails the build if `packages/core/src/**` references a registry-specific hostname/package, or if `packages/core/package.json` ever gains a dependency on anything registry-named.

The only handshake in the other direction is [`INTEGRATION_NOTES.md`](../INTEGRATION_NOTES.md) at the repo root: when a capability here is ready, `@skillerr/core` bumps a minor version and a note goes there with the version + what's newly available. The registry side reads that note and upgrades its pin when ready. This repo never edits registry files to "wire itself in."

## 3a. `@skillerr/core` public API (what the registry imports)

```ts
// package format + integrity
seal(input: SealInput): Promise<{ zip: Buffer; digest: string /* "sha256:…" */; manifest: Manifest }>
openSealed(zip: Buffer): Promise<{ manifest: Manifest; digest: string; files: FileMap }>

// signing (Sigstore, opt-in/keyless if available, else published-key)
sign(digest: string, opts?: SignOpts): Promise<Signature>
verifySignature(digest: string, sig: Signature): Promise<boolean>

// transparency log primitives (pure — no hosting)
buildLeaf(event: LogEvent): Leaf                       // event: publish|install|revoke
verifyInclusion(leaf: Leaf, proof: InclusionProof, treeHead: SignedTreeHead): boolean
verifyConsistency(a: SignedTreeHead, b: SignedTreeHead, proof: ConsistencyProof): boolean

// anchor interface (default = RekorAnchor; on-chain = optional plugin)
interface Anchor { anchor(digest: string): Promise<Commitment>; verify(digest: string, c: Commitment): Promise<boolean> }
RekorAnchor: Anchor

// verification entry point clients/CLI use
verify(digest: string, evidence: Evidence): Promise<VerifyResult>
// Evidence = { signature?, inclusionProof?, treeHead?, revocation?, anchor? }
// VerifyResult = { verified: boolean; digest; anchored: boolean; revoked: boolean; reasons: string[] }

// supply chain
generateSBOM(pkg): Promise<SBOM /* CycloneDX */>
attest(pkg): Promise<Attestation /* in-toto/SLSA */>
evaluatePolicy(pkg, policy: Policy): PolicyResult      // policy-as-code, pluggable
scoreSignals(pkg): ScoreSignals                        // raw signals; registry computes Score v2 from these

// capabilities
CapabilitySchema  // fs|net|shell with scoping (paths/hosts/commands)
runSandboxed(pkg, grants): Promise<RunResult>          // enforces declared caps; RunResult includes declaredVsActual diff

// interop / bridge
fromFormat(path, fmt: "claude"|"cursor"|"vercel"|"skills.sh"|"agents.md"): Promise<SkillPackage>
toFormat(pkg, fmt): Promise<{ output: Buffer; lossReport: LossReport }>

// profiles
evaluateReleaseProfile(pkg, profile: ReleaseProfile): GateResult   // pure gate fn; registry enforces at mint

// continuity (Resume Contract 1.0 — RFC 0009, see docs/rfcs/0009-resume-contract.md
// and docs/CONTINUITY.md; hosted-product lane, never minted/anchored/catalog-listed)
isContinuity(pkg): boolean
openContinuity(zip): Promise<ContinuityOpenResult>
resumePreview(pkg: ContinuityOpenResult): ResumeContract
```

## 3b. Registry HTTP wire protocol (what the CLI/verifier calls)

```
GET  /api/skills/:ns/:name        -> { ns,name,digest, permissions, scoreSignals, anchored, revoked, download }
GET  /api/log/tree-head           -> SignedTreeHead
GET  /api/log/proof?digest=sha256:… -> { leaf, inclusionProof, treeHead }
POST /api/verify  { ref | digest } -> VerifyResult (same shape as core.verify)
GET  <download>                   -> body: application/vnd.dot-skill+zip
```

This repo never calls a live registry to satisfy this contract. Anywhere code would call the registry (e.g. a CLI `verify` command hitting `/api/verify`), it's written against this wire spec and tested against a local fixture server in this repo (`test/fixtures/registry-mock`), never against `skillerr.com` being up.

## Implementation status against this contract

Tracks what actually exists in `packages/core` today versus this frozen shape. Updated as work lands; see git history for the authoritative record of when each row changed.

| Contract item | Status | Existing primitive it's built on / adapts |
|---|---|---|
| `seal` | shipped (`trust-spine.ts`) | `packSkill` + `unpackSkill` (`pack.ts`), round-tripped so the manifest can't drift from the zip |
| `openSealed` | shipped (`trust-spine.ts`) | `unpackSkill` (`pack.ts`) |
| `sign` / `verifySignature` | shipped, published-key path only | `createEd25519Signer` / `verifyEd25519Signature` (`signer.ts`). Keyless (Fulcio) signing not yet split out of `mintKeylessAnchor` (`transparency.ts`), which signs and anchors atomically — real follow-up work, not a thin wrap |
| `buildLeaf` / `verifyInclusion` / `verifyConsistency` | shipped (`merkle-log.ts`) | from-scratch RFC 6962-style Merkle tree (nothing existed before this; `packages/registry` is a separate, unrelated flat append-only log, not a Merkle tree). Also exports the constructive counterparts (`treeHash`, `generateInclusionProof`, `generateConsistencyProof`, `buildSignedTreeHead`) a log host needs to build real proofs — beyond the frozen 3, but needed to use them at all. Validated against 3 hand-derived golden vectors plus an exhaustive round-trip sweep across every (old_size, new_size) pair for trees up to size 24 (300 combinations) — see `merkle-log.test.ts`'s header comment for why this got unusually thorough treatment: RFC 6962 consistency proofs are a well-known place to introduce subtle correctness bugs |
| `Anchor` interface + `RekorAnchor` | shipped (`trust-spine.ts`) | delegates to the real, already-network-tested `anchorToRekor` / `verifyRekorAnchor` (`transparency.ts`). Subject metadata (skill_id/version/issuer_class) captured at `RekorAnchor(config)` construction time, since the frozen `anchor(digest)` signature has no room for it per-call |
| `verify(digest, evidence)` | not started | closest existing primitives: `assessClaims` (`claims.ts`), `verifyMintTrust` (`mint.ts`) — different shape, needs composing |
| `generateSBOM` | not started | nothing exists (confirmed zero CycloneDX/SBOM references anywhere in the repo) |
| `attest` | not started | `buildAnchorStatement` (`transparency.ts`) produces a real in-toto v1 statement but scoped to the anchor subject/predicate, not general SLSA provenance |
| `evaluatePolicy` | not started | only a fixed declarative `SkillPolicy` struct (`protocol/src/types.ts`), no pluggable rule engine |
| `scoreSignals` | not started | nothing exists; `@skillerr/skill-score` computes a final score from `provenance/benchmark.json`, not raw signals |
| `CapabilitySchema` | shipped (`trust-spine.ts`), `shell` scope honestly empty | `capabilitiesFromPermission()` normalizes `SideEffectClass` + `SkillPermission.paths/hosts`. No `commands` field exists to scope `shell` by yet — that needs a `@skillerr/protocol` schema change |
| `runSandboxed` with declared-vs-actual diff | not started | `assertCapabilityAllowed` (`runtime/src/index.ts`) gates only, never diffs after the fact |
| `fromFormat` / `toFormat` bridge | not started | `ingestSkillMd` / `exportAgentSkillFolder` hardcoded to one format pair (SKILL.md <-> Agent Skills folder), no `vercel`/`skills.sh` formats, no `LossReport` type |
| `evaluateReleaseProfile` | shipped (`trust-spine.ts`) | pure pass/fail+reasons mirror of `mintSkillPackage`'s inline throw-based gate (`mint.ts`). Deliberately duplicated, not delegated — refactoring `mintSkillPackage` to call this instead of throwing inline is separate follow-up work |
| `isContinuity` / `openContinuity` / `resumePreview` | shipped (`continuity.ts`) | built directly on real `provenance.journey` (already-typed `JourneyProvenance`) and `knowledge` — no new file convention or manifest fields. Resume Contract 1.0 ([RFC 0009](../docs/rfcs/0009-resume-contract.md)); `resumeTargets` deliberately uses this repo's own host-agnostic `skill load <path>`, never a product-specific install command, per the independence invariant above |

Follow-up work called out above, not yet scheduled: splitting a pure keyless `sign()` out of `mintKeylessAnchor`; adding `commands` scoping to `SkillPermission` for real `shell` capabilities; refactoring `mintSkillPackage` to call `evaluateReleaseProfile` instead of duplicating its checks inline.

## Licensing note (resolved)

Relicensed to **Apache-2.0**: root `LICENSE`, every package's `LICENSE` and `package.json`, and all docs referencing the license (`docs/LICENSING.md`, `GOVERNANCE.md`, `CONTRIBUTING.md`, `DCO.md`, `README.md`, per-package `README.md`s). Sole-author decision (no third-party contributor consent needed to relicense past contributions). Prior MIT-licensed npm releases already published stay MIT under those version numbers forever, as is always true of a relicense — this only governs the code going forward from this change.

## Keyless signing (deferred, not a bug)

`sign()`'s keyless (Fulcio) path is intentionally not implemented — see the `sign` row in the status table above. Splitting a pure sign step out of `mintKeylessAnchor` (which currently signs and anchors atomically) is real, deliberate follow-up work, not something to force through as a shallow adapter.
