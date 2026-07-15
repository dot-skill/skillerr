# RFC 0002 — Separate human-review countersignature (PROTO-3)

Status: **Draft — spec only, not implemented**

## Motivation

Today, "a human reviewed this" is a boolean-shaped claim living *inside*
the agent-issued `CreationAttestation`
(`contract.provenance.human_review`) and, separately,
`human_approvals.actors` in the attestation itself (fixed by BUG-2 to
never fabricate — see `docs/MINT.md`). Both are real improvements, but
they share one structural weakness: they're claims made by whoever
produced the attestation. There is no way to independently verify "an
agent authored this" and "a human reviewed this" as two separate,
separately-signed facts — if the attestation's signer is compromised or
dishonest, both claims fall together.

## Proposal

### `signatures/review.dsse.json` — a second, independent envelope

A new optional container file, structurally identical in shape to
`creation.dsse.json` but countersigning the *already-sealed*
`sealed_manifest_digest` rather than re-attesting the whole manifest:

```json
{
  "payloadType": "application/vnd.dot-skill.human-review+json",
  "payload_digest": "sha256:...",
  "sig_alg": "ed25519-v1",
  "signatures": [{ "keyid": "reviewer-key-id", "sig": "..." }],
  "review": {
    "kind": "human_review_countersignature",
    "sealed_manifest_digest": "sha256:...",
    "reviewer": { "id": "actor-id", "display_name": "optional" },
    "reviewed_at": "2026-07-13T00:00:00Z",
    "scope": ["permissions", "capabilities", "workflow"],
    "decision": "approved"
  }
}
```

`reviewer` uses the same `key_id` → trust-store lookup as RFC 0001, but as
a *separate* trust-store role (a reviewer key is not necessarily an
issuer key — an org may want different people/keys authorized to review
vs. mint).

### Verification semantics

`inspectTrustView` / `verifyMintTrust` gain an independent field:
`human_review_state: "none" | "claimed_unsigned" | "countersigned"`.
`countersigned` requires the review envelope's signature to verify against
a trust-store reviewer key *and* its `sealed_manifest_digest` to match the
package's actual `sealed_manifest_digest` — a review countersignature
bound to a different package (or a since-tampered one) doesn't count.

This makes "agent authored" and "human reviewed" independently falsifiable
claims: a hostile actor holding the minting key cannot forge a review
countersignature without also holding the reviewer key, and vice versa.

## Schema diff

- New `review-countersignature.schema.json` (draft 2020-12, same house
  style as the other PROTO-7 schemas).
- `SkillPackageFiles.signatures` gains an optional, well-known key
  `"review.dsse.json"` (already a `Record<string, unknown>`, so no type
  change — just a new documented convention, same way
  `"creation.dsse.json"` already is one).
- `TrustView` gains `human_review_state`.

## Migration

Fully additive and optional. A package with no `review.dsse.json` behaves
exactly as today (`contract.provenance.human_review` remains the only
review signal, unsigned). Nothing currently reads or writes this file, so
there's zero behavior change until a producer starts writing it and a
verifier starts checking for it.

## Fixtures

Once implemented: a package with a valid review countersignature reports
`human_review_state=countersigned`; the same review envelope replayed
against a *different* package (mismatched `sealed_manifest_digest`) is
rejected with a distinct code, not silently ignored; a review signed by a
key not in the reviewer trust-store role reports `claimed_unsigned`, not a
false `countersigned`.

## Open questions

- Should `scope` be a closed enum or free text? Free text with documented
  conventional values (matching `ContractProvenance.human_review.scope`'s
  existing shape) is more consistent with the rest of the protocol's
  "structured but extensible" style.
- Is one reviewer countersignature enough, or should multiple reviewers be
  representable (`signatures: [...]` already supports multiple entries in
  the DSSE convention — likely just works without further design).
