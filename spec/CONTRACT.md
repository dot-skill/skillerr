# Frozen contract: `@skillerr/core` <-> `skillerr-registry`

Status: **frozen**. This file is the single source of truth for the interface between this open-source repo (`dot-skill/skillerr`, Apache-2.0-track trust/interop primitives — see [Licensing note](#licensing-note) below) and the private `skillerr-registry` product. Both sides build against this document. If a shape here must change, it changes **here first, by mutual agreement**, before either side's code changes to match it.

## Dependency direction (hard invariant)

`skillerr-registry` depends on `@skillerr/core`. `@skillerr/core` **never** depends on `skillerr-registry` — no registry URLs hard-coded, no registry types imported, no knowledge that `skillerr.com` exists anywhere in this package. Enforced by CI (`scripts/check-no-registry-coupling.mjs`, run on every `npm test`): fails the build if `packages/core/src/**` references a registry-specific hostname/package, or if `packages/core/package.json` ever gains a dependency on anything registry-named.

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
| `seal` | adapter, in progress | `packSkill` + `finalizeManifest` + `sealedManifestDigest` (`pack.ts`, `hash.ts`) |
| `openSealed` | adapter, in progress | `unpackSkill` (`pack.ts`) |
| `sign` / `verifySignature` | adapter, in progress | `createEd25519Signer` (`signer.ts`), `mintKeylessAnchor` (`transparency.ts`) |
| `buildLeaf` / `verifyInclusion` / `verifyConsistency` | not started | no Merkle-log concept exists yet; `packages/registry` is a flat append-only log, not a Merkle tree |
| `Anchor` interface + `RekorAnchor` | adapter, in progress | `anchorToRekor` / `verifyRekorAnchor` (`transparency.ts`) — real `@sigstore/*` calls already, just not behind this interface yet |
| `verify(digest, evidence)` | not started | closest existing primitives: `assessClaims` (`claims.ts`), `verifyMintTrust` (`mint.ts`) — different shape, needs composing |
| `generateSBOM` | not started | nothing exists (confirmed zero CycloneDX/SBOM references anywhere in the repo) |
| `attest` | not started | `buildAnchorStatement` (`transparency.ts`) produces a real in-toto v1 statement but scoped to the anchor subject/predicate, not general SLSA provenance |
| `evaluatePolicy` | not started | only a fixed declarative `SkillPolicy` struct (`protocol/src/types.ts`), no pluggable rule engine |
| `scoreSignals` | not started | nothing exists; `@skillerr/skill-score` computes a final score from `provenance/benchmark.json`, not raw signals |
| `CapabilitySchema` | adapter, in progress | `SideEffectClass` + `SkillPermission.paths/hosts` (`protocol/src/types.ts`) — no distinct `shell`, no `commands` scoping yet |
| `runSandboxed` with declared-vs-actual diff | not started | `assertCapabilityAllowed` (`runtime/src/index.ts`) gates only, never diffs after the fact |
| `fromFormat` / `toFormat` bridge | not started | `ingestSkillMd` / `exportAgentSkillFolder` hardcoded to one format pair (SKILL.md <-> Agent Skills folder), no `vercel`/`skills.sh` formats, no `LossReport` type |
| `evaluateReleaseProfile` | adapter, in progress | `assessCompleteness` (`compile.ts`) is already pure pass/fail+reasons, but only covers completeness — full release gate logic is inline in `mintSkillPackage` |

## Licensing note

This repo's root `LICENSE` and every package's `package.json` currently say **MIT**, not Apache-2.0. Relicensing an already-published package is a decision with real legal consequences (existing MIT-licensed copies stay MIT forever regardless) that hasn't been made yet — this document does not assume it's settled. Code built under this contract is written to be license-agnostic (no MIT-specific or Apache-specific dependencies pulled in), so the relicensing question can be resolved independently of the implementation work.
