# RFC 0001 — Real asymmetric signatures + trust store (PROTO-2)

Status: **Implemented** (Phase 10) — `packages/core/src/signer.ts`,
`packages/core/src/trust-store.ts`, `skill keygen`/`skill mint --signer-key`/
`skill verify-trust --trust-store`. See [KEY-CEREMONY.md](../KEY-CEREMONY.md)
for the operational walkthrough. This document is retained as the original
design rationale; two deltas from what shipped, both improvements over the
original sketch below:

- **Key encoding**: shipped as standard PKCS8/SPKI **PEM**, not the
  base64-raw-key sketch in "Trust store file format" below — PEM has native
  `node:crypto` support (`createPrivateKey`/`createPublicKey`) and matches
  `openssl genpkey`/`pkey` output directly, so no hand-rolled ASN.1/DER
  wrapping was needed. The trust-store JSON shape is otherwise unchanged
  (`public_key_pem` replaces `public_key`).
- **Missing-pin behavior**: this RFC's prose said an unpinned/expired/
  wrong-host key "falls back to `self_reported` at best." The shipped
  behavior is stricter — a `configured_ed25519` attestation the verifier
  cannot check against a trust-store entry is a hard refusal
  (`trust_store_key_not_found` / `_expired` / `_host_not_allowed`,
  `trust_state=untrusted`), not a soft downgrade. Rationale: without the
  public key the verifier cannot even check the signature, so it cannot
  honestly report anything better than untrusted — matching this
  codebase's established fail-closed rule (see
  [THREAT-MODEL.md](https://github.com/dot-skill/skillerr/wiki/Threat-Model)) that an unverifiable claim is
  never silently accepted at a lesser-but-still-passing level.

## Motivation

The reference seal (SEC-G) is real HMAC-SHA256, but HMAC means the verifier
and the minter share the same secret. That's fine for one org signing its
own skills and verifying them internally, but it cannot scale beyond one
org: anyone who can verify can also forge, because verification and
forgery use the identical key. `verified_issuer` trust (`host_claim_binding
= verified_issuer`) currently requires a "configured issuer secret" —
which is still an HMAC secret under the hood, so "verified" only means
"signed with a secret I also happen to have," not "signed by a key I trust
without also being able to impersonate it."

Public-key (asymmetric) signing is the only way to make `verified_issuer`
mean what it says: a verifier holds a public key and can check a signature
without ever holding the ability to produce one.

## Proposal

### New issuer class: `configured_ed25519`

Add `issuer_class: "configured_ed25519"` alongside the existing
`public_dev_hmac` | `configured_hmac`. HMAC stays the zero-config local
default (`issuer_class=public_dev_hmac` → `trust_state=development`,
unchanged) and remains available as `configured_hmac` for closed loops
that genuinely want a shared-secret model (e.g. a single CI pipeline
minting and a single internal verifier checking, both trusted equally).
Ed25519 becomes the standard path for anything crossing an organizational
boundary.

### Seal envelope

`sig_alg` (already versioned per SEC-G) gains a new value:
`"ed25519-v1"`. The DSSE envelope shape is unchanged
(`payloadType`, `payload_digest`, `sig_alg`, `signatures: [{keyid, sig}]`,
`attestation`) — `sig` becomes a base64/hex-encoded Ed25519 signature over
`payload_digest` instead of an HMAC digest, and `keyid` identifies which
trust-store entry verifies it.

### Trust store file format

A new local file, `~/.skillerr/trust-store.json` (mirroring the existing
`~/.skillerr/registry/` convention), holding the verifier's pinned keys:

```json
{
  "version": 1,
  "keys": [
    {
      "key_id": "dot-skill-org-2026",
      "public_key": "<base64 Ed25519 public key>",
      "algorithm": "ed25519",
      "allowed_hosts": ["cursor", "claude-code"],
      "not_before": "2026-01-01T00:00:00Z",
      "not_after": "2027-01-01T00:00:00Z",
      "comment": "dot-skill org production signing key"
    }
  ]
}
```

`verifyMintTrust` looks up `attestation.agent.key_id` in the trust store;
a signature that verifies against a *pinned* key with a live
`not_before`/`not_after` window is `host_claim_binding=verified_issuer`.
No entry, an expired entry, or a host not in `allowed_hosts` → falls back
to `self_reported` at best, never silently upgraded.

### `issuer_class=keyless` (reserved, future) — superseded by what shipped

This sketch assumed keyless signing would become a new `issuer_class`
value on the container's own seal (`mintSkillPackage`'s signer). What
actually shipped (`skill mint --keyless`, see
[TRANSPARENCY.md](../TRANSPARENCY.md)) took a different, more
conservative shape: a separate, additive `PermanenceAnchor { kind:
"keyless_identity" }`, layered *alongside* whatever the container's own
seal already is, not a new value of `issuer_class` itself. Reasoning:
`issuer_class`/`verified_issuer` trust is fundamentally about a
*pre-pinned, stable* key a human curated in a trust store in advance — a
one-time Fulcio-issued ephemeral key has no stable `key_id` to ever pin,
so conflating the two would have quietly weakened what `verified_issuer`
means. Keeping them as two orthogonal claims (see
[WHAT-IS-VERIFIABLE.md](../WHAT-IS-VERIFIABLE.md)) avoided that.

## Schema diff

- `CreationAttestation.issuer_class`: add `"configured_ed25519"` to the
  enum (`creation-attestation.schema.json`, PROTO-7).
- New trust-store JSON Schema, `trust-store.schema.json`, for the file
  above.
- No changes to `SkillManifest`, `Workflow`, or `SkillContract`.

## Migration

Purely additive. Existing HMAC-sealed packages are unaffected —
`issuer_class` stays whatever it already is, and `verifyMintTrust` only
consults the trust store when it sees `configured_ed25519`. No version
bump to `PROTOCOL_VERSION` required; `sig_alg` already carries its own
version tag independent of the protocol version (SEC-G).

## Fixtures

Once implemented: a package minted with a configured Ed25519 key verifies
as `verified_issuer`; the same package verified against a trust store
*without* that key falls back to `self_reported`; an expired trust-store
entry refuses with a distinct code (`trust_store_key_expired`); a
`sig_alg=ed25519-v1` envelope with a corrupted signature byte refuses with
`attestation_sig_invalid` (same code HMAC already uses — the failure mode
is the same regardless of algorithm). Add these to
`packages/cli/src/adversarial.test.ts` alongside the existing corpus.

## Open questions

- Signature encoding: base64 vs hex — lean base64 (shorter, and what most
  Ed25519 tooling emits by default).
- Key rotation UX: does the CLI get a `skill trust-store add-key` command,
  or is the file hand-edited? Hand-editing is fine for v1; a command is a
  nice-to-have, not a blocker.
