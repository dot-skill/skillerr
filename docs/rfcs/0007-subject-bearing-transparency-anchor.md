# RFC 0007 — Subject-bearing transparency anchor

Status: **Implemented**, `packages/core/src/transparency.ts` (`buildAnchorStatement`, `anchorToRekor`, `mintKeylessAnchor`, `verifyRekorAnchor`, `verifyKeylessAnchor`), shipped in `skillerr@1.1.0` and `@skillerr/*@1.1.0`. See [dot-skill/skillerr#40](https://github.com/dot-skill/skillerr/pull/40).

This is the first RFC written and merged after the code that implements it, deliberately: it documents the real shipped shape rather than a proposal that might drift from what actually landed.

## Motivation

`skill mint --transparency`/`--keyless` anchored a bare `sealed_manifest_digest` string to Rekor. The resulting public log entry carried a hash, a signature, and a public key, and nothing else, so a stranger looking at that entry on `search.sigstore.dev` had no way to tell which skill it belonged to without already holding the package. That defeats a real use of a transparency log: independently discovering and cross-referencing entries, not just re-confirming one you already have.

The fix has to hold a hard privacy line: the public Rekor log is permanent and world-readable (see [TRANSPARENCY.md](../TRANSPARENCY.md)), so whatever gets added to the anchored payload cannot include anything descriptive, only stable, opaque identifiers.

## Proposal

Anchor a minimal [in-toto](https://in-toto.io) `Statement` instead of the bare digest, as the DSSE payload:

```json
{
  "_type": "https://in-toto.io/Statement/v1",
  "subject": [
    { "name": "<manifest.id>", "digest": { "sha256": "<package_digest, hex, no \"sha256:\" prefix>" } }
  ],
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

The `predicate` allowlist (`skill_id`, `skill_version`, `sealed_manifest_digest`, `package_digest`, `issuer_class`) is enforced twice: once at construction time (`assertAnchorStatementPrivacy` throws on any other key) and once at the JSON Schema level (`additionalProperties: false`), so a bug in one guard doesn't silently rely on the other. No `minted_at`: the log's own `integratedTime` is the trustworthy timestamp, a self-reported wall-clock value doesn't belong in a signed statement.

The statement is canonicalized with the existing RFC 8785 (JCS) `canonicalize()` (already used for `sealed_manifest_digest` itself), then signed and submitted exactly as the bare digest was before, same `DSSEBundleBuilder`, same signer, same Rekor witness.

## Schema diff

- New `packages/protocol/skill-anchor-statement.schema.json` (draft 2020-12), registered in `@skillerr/protocol`'s `loadSchema()` as `"anchor-statement"`.
- `PermanenceAnchor` (`packages/protocol/src/types.ts`) gains two new optional fields: `statement_version?: string` (currently `"1"`) and `predicate_type?: string`. Both additive.
- `AnchorVerification`/`KeylessVerification` (`packages/core/src/transparency.ts`) each gain two new optional fields: `code?: string` (currently only ever `"anchor_subject_mismatch"`) and `subject?: { skill_id: string; package_digest: string }`. Both additive.
- `anchorToRekor`/`mintKeylessAnchor` gain a new required `subject: AnchorSubject` parameter. `verifyRekorAnchor`/`verifyKeylessAnchor` gain a new optional `expectedSubject` parameter. These are TypeScript API changes, not wire/protocol changes, existing anchors on disk are unaffected either way.

## Migration

Purely additive at the wire level. `statement_version`'s absence is the only signal `checkAnchorPayload` uses to choose the verification path:

- **No `statement_version`** (every anchor minted before this shipped): the exact bare-digest string comparison that always ran, unchanged, forever. No re-signing, no re-anchoring, no action needed for anything already minted.
- **`statement_version: "1"`**: parse the payload as JSON, schema-validate it, check `predicate.sealed_manifest_digest` against the digest being verified, and (if a caller passes `expectedSubject`) check `subject`/`predicate.package_digest` against the package actually being verified.

Both paths live in the same `verifyRekorAnchor`/`verifyKeylessAnchor` functions; callers don't need to know which shape an anchor is before calling them.

## Verification impact

- New refusal code `anchor_subject_mismatch`: a validly-signed, correctly-logged anchor presented against a *different* package (different `skill_id` or `package_digest` than what the anchor's own subject claims) refuses, rather than verifying as if it were about the presented package. This mirrors how `--keyless` re-derives `owner_identity` from the Fulcio certificate rather than trusting the anchor's own stored claim, the subject is a checked claim, never an assumed one.
- `packages/cli/src/cli.ts`'s `verify-trust` case threads `{ skill_id: manifest.id, package_digest: manifest.package_digest }` (re-derived from the package actually being verified) into both anchor-verification calls.
- `assessClaims()` (`packages/core/src/claims.ts`) adds `transparency_log.anchor_subject`/`keyless_identity.anchor_subject` to the `verified` array once a subject check passes, surfaced via `skill verify-trust --claims`/`skill inspect --trust --claims`.
- No change to `trust_state`, `sealed_manifest_digest`, the container seal, or `rekorSearchUrl`. Anchoring remains orthogonal to trust classification (see [TRANSPARENCY.md](../TRANSPARENCY.md) "What Rekor inclusion proves").

## Fixtures

- `fixtures/canonicalization/vectors.json` gained one new entry (`skill_anchor_statement_example`), a full example statement with its expected canonical form and SHA-256 digest, for cross-implementation reproducibility.
- `fixtures/transparency/rekor-anchor-statement.json`: a real, captured subject-bearing anchor from a genuine, approved, throwaway-key submission to the public Rekor log (the same approach used for the pre-existing `rekor-anchor.json` legacy fixture), verified end to end at capture time. Public entry: https://search.sigstore.dev/?logIndex=2173022811
- `packages/core/src/transparency.test.ts` and `packages/cli/src/adversarial.test.ts` cover: statement determinism, mint-side structure (both `--transparency` and `--keyless` shapes), the full-crypto positive path against the captured fixture above, the pre-existing legacy fixture's continued bare-digest verification, tampered subject name, subject digest mismatch, predicate `sealed_manifest_digest` mismatch, schema-invalid payload, and the privacy allowlist guard.

## Errata (found in `skillerr@1.5.0`): the payload wasn't actually retrievable

The Motivation section above claims a stranger can read which skill a public entry names without holding the package. That was only half true at first ship: `anchorToRekor`/`mintKeylessAnchor` submitted through `@sigstore/sign`'s default Rekor entry kind, `"dsse"`, which stores only `envelopeHash`/`payloadHash` on the public log, never the payload itself. Confirmed directly against the real public instance: a `dsse`-kind entry has no `attestation` field at all, under any endpoint. The subject-bearing statement above was real and correctly built, but functionally unreadable by anyone who didn't already have it.

Fix: both functions now construct `RekorWitness` with `entryType: "intoto"`, the Rekor entry kind that does persist the payload. Verified against a fresh, real, throwaway-key submission: `GET /api/v1/log/entries/{uuid}` (not the batch `?logIndex=` search, which omits it either way) returns an `attestation.data` field that decodes straight to the statement, `skill_id` included. See [TRANSPARENCY.md](../TRANSPARENCY.md#what-gets-logged).

No wire/schema change, no re-anchoring needed for anything already minted; those entries simply stay in the state described in this errata, real, correctly-signed, cryptographically verifiable by anyone holding the package, but not independently discoverable from the log alone.
