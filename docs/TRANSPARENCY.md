# Transparency (Rekor / optional Fulcio)

Status: implemented in `@skillerr/core` (`transparency.ts`), opt-in, additive only. This doc explains what it adds and — just as importantly — what it does not claim.

## Why sigstore, not a hand-rolled log

An append-only transparency log with inclusion proofs is exactly what [Rekor](https://docs.sigstore.dev) already is: a public Merkle-tree log, maintained by the Sigstore project (part of the Linux Foundation / OpenSSF), with a well-audited reference implementation and official TypeScript client libraries (`@sigstore/sign`, `@sigstore/verify`, `@sigstore/bundle`). Re-implementing Merkle inclusion proof verification from scratch is exactly the kind of security-critical cryptographic code that's easy to get subtly wrong — using the same library the rest of the software supply-chain ecosystem (npm provenance, sigstore-python, cosign) already relies on is the safer choice. This repo's own npm publishes already depend on the same stack (`npm publish --provenance` uses sigstore under the hood).

## What gets logged

When you mint with `--transparency`, the anchored payload is a small, signed [in-toto](https://in-toto.io) `Statement` (RFC 0007), not a bare digest. Its `subject` names the skill (`skill_id` and `package_digest`), so the resulting public log entry is self-describing and cross-linkable: a stranger can see which skill an entry belongs to without already holding the package. The predicate carries only stable, opaque identifiers, never title, intent, contract, journey, section bodies, endpoints, or any other free text, since the public Rekor log is permanent and world-readable:

```json
{
  "_type": "https://in-toto.io/Statement/v1",
  "subject": [{ "name": "<skill_id>", "digest": { "sha256": "<package_digest, hex>" } }],
  "predicateType": "https://skillerr.com/attestations/skill/v1",
  "predicate": {
    "skill_id": "<manifest.id>",
    "skill_version": "<manifest.version>",
    "sealed_manifest_digest": "<the same string mintSkillPackage already signs>",
    "package_digest": "<sha256:...>",
    "issuer_class": "<configured_ed25519 | public_dev_hmac | ...>"
  }
}
```

Submitted to Rekor as a `DSSEBundleBuilder` artifact (not `MessageSignatureBundleBuilder`, which hardcodes a SHA-256 hashedrekord entry incompatible with Rekor's Ed25519ph requirement for Ed25519 signatures, confirmed against the real public instance):

1. The statement is RFC 8785 (JCS) canonicalized (see [CANONICALIZATION.md](./CANONICALIZATION.md)), then our existing issuer signer (`configured_ed25519`, or the public-dev HMAC path, see below) signs it exactly as it always signed the bare digest.
2. `RekorWitness` submits the resulting signature and public key to Rekor, which returns a `TransparencyLogEntry`: `logIndex`, `integratedTime`, `logID`, an `inclusionProof` (Merkle path to the signed tree head), and a `signedEntryTimestamp` (SET).
3. That entry is stored as a `PermanenceAnchor { kind: "transparency_log", statement_version: "1" }` inside `signatures/anchors/`, using the container's existing anchor mechanism (`addPermanenceAnchor`), not a new container feature.

Nothing about `mintSkillPackage`'s core signing path changes. Transparency is a witness *added on top of* an already-valid signature, never a replacement for one, so a mint with no network access still succeeds exactly as before, just without an anchor.

**Backward compatible.** Anchors minted before RFC 0007 have no `statement_version` and signed the bare digest directly; they keep verifying exactly as they always have, forever. `skill verify-trust` detects the absence of `statement_version` and takes that legacy path automatically. On a subject-bearing anchor, verification re-derives `skill_id` and `package_digest` from the package being checked and compares them against the anchored `subject`, the same way `--keyless` re-derives `owner_identity` from the certificate: a mismatch refuses with `anchor_subject_mismatch`, never a silent accept.

## What Rekor inclusion proves (and what it doesn't)

- **Proves**: this exact `sealed_manifest_digest` + signature was submitted to a specific public log, at a specific log index, integrated at a specific time, and that entry is provably included in the log's current Merkle tree (checkable independently of trusting Rekor's operator — that's the point of a transparency log; a dishonest operator can't quietly remove or alter an entry without the tree's root hash changing, which would be detected).
- **Does not prove**: that the signer's key belongs to any particular real-world identity (that's a separate claim — see [WHAT-IS-VERIFIABLE.md](./WHAT-IS-VERIFIABLE.md)), that the package's content is good or safe, or that "inclusion" means "endorsement" of any kind. A malicious actor can log a malicious package just as easily as a benign one — Rekor's guarantee is *auditability*, not *goodness*.
- **"inclusion ≠ endorsement."** This phrase is repeated throughout this repo's trust docs deliberately. Do not build UI or messaging that implies a green checkmark for "logged."

## Public vs. configurable Rekor

Default is the public instance (`rekor.sigstore.dev`) — free, world-readable, maintained by Sigstore. `--rekor-url <url>` points at a self-hosted instance instead (same log format, same API, same client library). **Public Rekor entries are permanent and world-readable.** Never anchor a skill containing anything you don't want publicly, permanently associated with a timestamp and a digest — this is stated in the CLI's own `--transparency` help text, not just here.

## Verification: offline by default, `--online` as an extra check

`skill verify-trust` checks a transparency anchor the same way `cosign verify-blob --bundle` does: the inclusion proof and SET are self-contained cryptographic evidence inside the anchor's `receipt` — verifying them requires Rekor's public key (a well-known constant, part of Sigstore's public trust root) but **not a live network call**. `--online` additionally re-queries Rekor directly, which catches the one thing offline verification can't (a log that's since been proven inconsistent/forked — extremely rare, but the option exists).

## Independent verification: a link to Rekor's own UI, not just our word

Neither the CLI nor `www.skillerr.com`'s verify page ask you to trust their own "verified" output on faith. When a `transparency_log` anchor is present and verifies against the pinned issuer key — and it's logged to the public `rekor.sigstore.dev` instance (a self-hosted log has no public search UI, so no link is fabricated for it) — both surfaces hand back a `https://search.sigstore.dev/?logIndex=<n>` link:

- `skill mint --transparency` prints it the moment the entry is created.
- `skill verify-trust` prints it every time it re-verifies an anchor (this is the more common moment — verification happens far more often than minting).
- The website's upload-and-verify flow (`/verify`) shows it next to its own trust verdict, and says plainly when a package has no anchor at all, so absence of a link reads as "not anchored," not as a broken feature.

Follow the link and you're looking at the raw log entry on sigstore's own infrastructure, not anything this project runs or could quietly alter.

## Optional keyless (Fulcio) signing

`skill mint --keyless` adds a **second, independent** anchor alongside (never instead of) whatever the container's own seal already is (public-dev HMAC or `configured_ed25519`) — a `PermanenceAnchor { kind: "keyless_identity" }`, not a change to `mintSkillPackage`'s own signing path. Instead of a stable, pre-pinned key, a fresh single-use keypair is generated and Fulcio issues a short-lived certificate binding it to your OIDC identity (GitHub Actions, Google, etc.) for the few seconds it takes to sign and log; that certificate + the Rekor entry are the anchor's `receipt`, same shape as a `--transparency` anchor's.

This is *why* it's a distinct anchor `kind` and not folded into `transparency_log`: a one-time ephemeral key has no stable `key_id` to pre-pin in a trust store, so it's a fundamentally different trust mechanism from `verified_issuer` — `--keyless` verification checks the certificate chains to Fulcio's CA (part of the sigstore trusted root), not that some `key_id` appears in a trust store a human curated in advance. `skill verify-trust` re-derives `owner_identity` (and the OIDC `issuer` that vouched for it) from the certificate itself during verification — never from the anchor's own stored `extensions.owner_identity`, which is mint-time convenience only, not a checked claim. See [WHAT-IS-VERIFIABLE.md](./WHAT-IS-VERIFIABLE.md)'s "key-bound, but requires you to already trust the key" section for why an OIDC-bound identity is a meaningfully stronger claim than a bare pinned key.

**What's shipped:** the CI-ambient path. Inside a GitHub Actions job with `permissions: id-token: write`, `--keyless` picks up the ambient OIDC token that job's own runner injects — the same mechanism `npm publish --provenance` uses (this repo's own publish workflow being one example of many possible callers, not something `--keyless` is wired to specifically). No interactive setup needed. Run outside such an environment, it fails closed with a clear error rather than silently doing nothing or falling back to something weaker.

**Not shipped yet:** an interactive/browser-login OIDC provider for local (non-CI) use — the same flow `cosign sign` uses. Tracked in [ROADMAP.md](./ROADMAP.md).

### Whose identity gets logged?

Always the identity of whatever environment is actually running `skill mint --keyless` at that moment — **never `dot-skill/skillerr`'s own identity**, regardless of who published the `skillerr` package those bits came from. GitHub's runner injects a fresh OIDC token, scoped to the specific repo/workflow-file/ref that's executing, into every job that enables `id-token: write` — that's true for *any* repo that adds the permission, including yours, with zero coordination with this project needed. The published npm package has no embedded credential of ours and no special relationship to this repo's own CI; it just reads whatever token the calling environment happens to provide. Concretely: if you `npm i -g skillerr` and run `skill mint --keyless` inside your own repo's Actions workflow (with `id-token: write` added to that workflow's `permissions:` block — the only setup required), the resulting certificate and `owner_identity` are bound to *your* repo, *your* workflow file, and *your* ref. Run it locally with no CI environment at all, and it fails closed instead of silently substituting some other identity.

Same permanence caveat as `--transparency`: the certificate and Rekor entry are logged to the public instance by default and are **permanent and world-readable** once logged.

## Extensible anchors

`transparency_log` and `keyless_identity` are two `PermanenceAnchor` kinds among several the wire format already defines (`PermanenceAnchorKind` in `packages/protocol/src/types.ts`): the local `registry` log is a third, shipped kind, and `ledger`/`content_addressed_store`/`other` are reserved kinds with no implementation yet. The `PermanenceAnchor` slot is an open extension point, not a fixed list: a future ledger/chain anchor is a documented, unimplemented [roadmap item](./ROADMAP.md#later) ("optional ledger anchors as one permanence kind, never required"), addable the same additive way `keyless_identity` was added after `transparency_log`, without touching any package sealed today. Whatever anchor kinds ship later, the caveats on this page (offline-by-default verification, "inclusion is not endorsement," permanent and world-readable once logged) apply identically, an anchor kind is evidence to check, never a trust upgrade granted for free.

## What this is not

- Not a marketplace, not a payment rail, not a reputation score. See [ROADMAP.md](./ROADMAP.md) / Launch Readiness Phase F for where publisher identity (built on the same Fulcio OIDC identity) eventually connects to commerce concerns — deliberately kept separate from this transparency layer.
- Not required. Every trust state and every CLI command that worked before this phase still works identically without `--transparency`/`--keyless`. This is purely additive.
- Not a replacement for `verified_issuer`/trust-store semantics — see [TRUST-MODEL.md](./TRUST-MODEL.md). An anchored package can still be `development` or `self_reported` trust; anchoring and trust classification are orthogonal.

## Related

- [WHAT-IS-VERIFIABLE.md](./WHAT-IS-VERIFIABLE.md) — `log_inclusion`/`log_timestamp` (cryptographic, either anchor kind) and `owner_identity` (identity-bound, `--keyless` only)
- [TRUST-MODEL.md](./TRUST-MODEL.md) — the four `trust_state` values, unaffected by anchoring
- [Key Ceremony](./KEY-CEREMONY.md) — the non-keyless issuer key path `--transparency` builds on
