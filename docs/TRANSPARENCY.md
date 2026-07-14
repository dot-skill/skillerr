# Transparency (Rekor / optional Fulcio)

Status: implemented in `@skillerr/core` (`transparency.ts`), opt-in, additive only. This doc explains what it adds and — just as importantly — what it does not claim.

## Why sigstore, not a hand-rolled log

An append-only transparency log with inclusion proofs is exactly what [Rekor](https://docs.sigstore.dev) already is: a public Merkle-tree log, maintained by the Sigstore project (part of the Linux Foundation / OpenSSF), with a well-audited reference implementation and official TypeScript client libraries (`@sigstore/sign`, `@sigstore/verify`, `@sigstore/bundle`). Re-implementing Merkle inclusion proof verification from scratch is exactly the kind of security-critical cryptographic code that's easy to get subtly wrong — using the same library the rest of the software supply-chain ecosystem (npm provenance, sigstore-python, cosign) already relies on is the safer choice. This repo's own npm publishes already depend on the same stack (`npm publish --provenance` uses sigstore under the hood).

## What gets logged

When you mint with `--transparency`, the **`sealed_manifest_digest`** (the same string `mintSkillPackage` already signs today — see [MINT.md](./MINT.md)) is submitted to Rekor as a `MessageSignatureBundleBuilder` artifact:

1. Our existing issuer signer (`configured_ed25519`, or the public-dev HMAC path — see below) signs the digest exactly as it always has.
2. `RekorWitness` submits the resulting signature + public key to Rekor, which returns a `TransparencyLogEntry`: `logIndex`, `integratedTime`, `logID`, an `inclusionProof` (Merkle path to the signed tree head), and a `signedEntryTimestamp` (SET).
3. That entry is stored as a `PermanenceAnchor { kind: "transparency_log" }` inside `signatures/anchors/` — using the container's existing anchor mechanism (`addPermanenceAnchor`), not a new container feature.

Nothing about `mintSkillPackage`'s core signing path changes. Transparency is a witness *added on top of* an already-valid signature, never a replacement for one — a mint with no network access still succeeds exactly as before, just without an anchor.

## What Rekor inclusion proves (and what it doesn't)

- **Proves**: this exact `sealed_manifest_digest` + signature was submitted to a specific public log, at a specific log index, integrated at a specific time, and that entry is provably included in the log's current Merkle tree (checkable independently of trusting Rekor's operator — that's the point of a transparency log; a dishonest operator can't quietly remove or alter an entry without the tree's root hash changing, which would be detected).
- **Does not prove**: that the signer's key belongs to any particular real-world identity (that's a separate claim — see [WHAT-IS-VERIFIABLE.md](./WHAT-IS-VERIFIABLE.md)), that the package's content is good or safe, or that "inclusion" means "endorsement" of any kind. A malicious actor can log a malicious package just as easily as a benign one — Rekor's guarantee is *auditability*, not *goodness*.
- **"inclusion ≠ endorsement."** This phrase is repeated throughout this repo's trust docs deliberately. Do not build UI or messaging that implies a green checkmark for "logged."

## Public vs. configurable Rekor

Default is the public instance (`rekor.sigstore.dev`) — free, world-readable, maintained by Sigstore. `--rekor-url <url>` points at a self-hosted instance instead (same log format, same API, same client library). **Public Rekor entries are permanent and world-readable.** Never anchor a skill containing anything you don't want publicly, permanently associated with a timestamp and a digest — this is stated in the CLI's own `--transparency` help text, not just here.

## Verification: offline by default, `--online` as an extra check

`skill verify-trust` checks a transparency anchor the same way `cosign verify-blob --bundle` does: the inclusion proof and SET are self-contained cryptographic evidence inside the anchor's `receipt` — verifying them requires Rekor's public key (a well-known constant, part of Sigstore's public trust root) but **not a live network call**. `--online` additionally re-queries Rekor directly, which catches the one thing offline verification can't (a log that's since been proven inconsistent/forked — extremely rare, but the option exists).

## Optional keyless (Fulcio) signing

`--keyless` swaps the signer: instead of your own `configured_ed25519` key, an ephemeral keypair is generated locally and Fulcio issues a short-lived certificate binding it to your OIDC identity (GitHub, Google, etc.) for the few seconds it takes to sign and log. The resulting `owner_identity` is then a real, independently-checkable OIDC identity rather than an opaque key someone told you to trust — see [WHAT-IS-VERIFIABLE.md](./WHAT-IS-VERIFIABLE.md)'s "key-bound, but requires you to already trust the key" section for why this is a meaningfully stronger claim than a bare pinned key.

In CI (GitHub Actions with `id-token: write` permission), this requires **no setup at all** — the same ambient OIDC credential that already powers this repo's `npm publish --provenance` is reused automatically. Run locally, it opens a browser for an interactive OIDC login, the same flow `cosign sign` uses.

## What this is not

- Not a marketplace, not a payment rail, not a reputation score. See [ROADMAP.md](./ROADMAP.md) / Launch Readiness Phase F for where publisher identity (built on the same Fulcio OIDC identity) eventually connects to commerce concerns — deliberately kept separate from this transparency layer.
- Not required. Every trust state and every CLI command that worked before this phase still works identically without `--transparency`/`--keyless`. This is purely additive.
- Not a replacement for `verified_issuer`/trust-store semantics — see [TRUST-MODEL.md](./TRUST-MODEL.md). A transparency-anchored package can still be `development` or `self_reported` trust; anchoring and trust classification are orthogonal.

## Related

- [WHAT-IS-VERIFIABLE.md](./WHAT-IS-VERIFIABLE.md) — updated with `log_inclusion`/`log_timestamp` (cryptographic) and `owner_identity` (identity-bound when Fulcio-signed) once this phase lands
- [TRUST-MODEL.md](./TRUST-MODEL.md) — the four `trust_state` values, unaffected by anchoring
- [KEY-CEREMONY.md](./KEY-CEREMONY.md) — the non-keyless issuer key path this builds on
