# RFC 0003 — Revocation + expiry (PROTO-4)

Status: **Draft — spec only, not implemented**

## Motivation

Once a `.skill` package is shared, there is no way to kill it. If a bug,
security issue, or a since-revoked issuer key is discovered after
distribution, every copy in the wild stays fully trusted forever. This is
a real gap for anything resembling a supply chain (compare: npm's
`deprecate`/unpublish, or a revoked TLS certificate via CRL/OCSP).

## Proposal

### Optional `expires_at` on the attestation

`CreationAttestation` gains an optional `expires_at: string` (ISO 8601).
`verifyMintTrust` checks it the same way it checks trust profiles: past
expiry with a `minted`/`anchored` profile is a distinct issue code
(`attestation_expired`), refusing `ok`. This is the cheap half — no
network call, no external state, works offline. Absence means "never
expires," matching today's behavior exactly (fully backward compatible).

### Revocation records

A revocation is a separate, issuer-signed artifact — not embedded in the
package (a compromised or malicious package obviously can't be trusted to
self-report its own revocation):

```json
{
  "kind": "revocation_record",
  "package_digest": "sha256:...",
  "reason": "security" | "policy" | "superseded" | "other",
  "detail": "human-readable reason",
  "revoked_at": "2026-07-13T00:00:00Z",
  "issuer_key_id": "dot-skill-org-2026",
  "sig_alg": "ed25519-v1",
  "sig": "..."
}
```

Keyed by `package_digest` (not `skill_id`+`version`, since digest is the
one thing that can't be spoofed onto a different package — see PROTO-1).
Signed by the same issuer-key mechanism as RFC 0001, so a revocation can
only be issued by whoever could have minted in the first place (or a
separately-designated revocation key, mirroring RFC 0002's separate
reviewer-role pattern).

### Where revocations live and how they're checked

`@skillerr/registry`'s existing local transparency log
(`~/.skillerr/registry/log.jsonl`) is the natural home — it already
indexes by digest. A revocation record is just a new entry `kind`
alongside the existing `registry_entry` kind. `skill run` (and `skill
verify-trust`) look it up the same way `@skillerr/registry`'s `verify()`
already looks up publish entries.

**Offline behavior is the design question this RFC actually needs to
settle**: checking a revocation registry requires either a local log (which
may be stale — the whole point of "shared once" is that the checker's
local log was populated *before* the skill was distributed further) or a
network call (which breaks offline-first). Proposed default: **warn, don't
refuse**, when the registry can't be checked (no local entry, no network) —
configurable via `--strict-revocation` to refuse instead. This matches the
existing pattern of `skill inspect` being "unverified but not blocking" by
default (SEC-I) and only escalating to a hard refusal when explicitly asked
for stronger guarantees.

## Schema diff

- `CreationAttestation.expires_at?: string` (additive optional field,
  `creation-attestation.schema.json`).
- New `revocation-record.schema.json`.
- `@skillerr/registry`'s `RegistryEntry.kind` gains a documented
  `"revocation_record"` value alongside its current implicit
  `"registry_entry"` shape (today `kind` is always `"registry_entry"` on
  the wire — this needs an actual `kind` discriminator added, which is
  itself a small additive change to `RegistryEntry`).

## Migration

Additive. No existing package or log format changes shape; `expires_at`
absent means unchanged behavior, and old registry logs with no
revocation-kind entries just never match on lookup (identical to today,
since there's nothing to look up yet).

## Fixtures

Once implemented: an expired attestation refuses `verifyMintTrust` with
`attestation_expired`; a package whose digest has a matching signed
revocation record in the local log refuses `skill run` (strict mode) or
warns (default mode) with the revocation's `reason`/`detail` surfaced; a
revocation record signed by a key *not* authorized to revoke is ignored,
not honored (same "don't trust an unpinned signer" principle as RFC 0001).

## Open questions

- Should `--strict-revocation` be the default once the ecosystem matures
  (i.e. flip the default in a later minor version once revocation-aware
  tooling is common)? Leave as a documented future consideration, not a
  decision this RFC needs to make now.
- HTTP transparency-log server (already on `docs/ROADMAP.md`'s "Next"
  list) would make revocation checking meaningfully less stale for
  distributed skills — this RFC doesn't depend on it, but benefits from it.
