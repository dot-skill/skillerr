# Cryptographic foundation

This is the canonical page for two related claims made throughout this repo's docs and site: `.skill` gives a skill a verifiable identity, authorship, and provenance today, and the same primitives are, by design, a foundation a future ownership layer could build on. Both halves are scoped precisely here so neither drifts into overclaim elsewhere.

## Identity, authorship, provenance, assurance

A skill is only as trustworthy as your ability to verify it. `.skill` gives every skill a verifiable identity, provable authorship, and independently checkable provenance, the same guarantees the software supply chain now expects (think `cosign`, npm provenance, SLSA), applied to AI skills.

### Identity: content-addressed

Every skill has a content-derived `skill_id`, plus SHA-256 `package_digest` (content only) and `manifest_digest` (permissions/capabilities/policy/content, self-digest present on every package, minted or not). Both are recomputed from the actual archive at inspect/verify time and compared against the sealed values, not read from a field and trusted. Any edit after sealing, even one byte, changes the digest. See [PROTOCOL.md](./PROTOCOL.md) for the exact digest scope.

### Authorship: cryptographically signed

Two independent ways to bind a seal to a real signer, both usable together:

- **Configured Ed25519 issuer key.** `skill keygen` generates a keypair; `skill mint --signer-key <pem>` seals with it. A verifier who has pinned your public key in their trust store gets cryptographic proof that this exact key signed this exact content, `trust_state: verified_issuer`. See [KEY-CEREMONY.md](./KEY-CEREMONY.md).
- **Sigstore Fulcio keyless signing.** `skill mint --keyless` generates a fresh, single-use keypair and has Fulcio issue a short-lived certificate binding it to an OIDC identity (a GitHub Actions job, for example) for the few seconds it takes to sign and log. No long-lived key to manage or leak.

Both paths produce a `CreationAttestation` in the standard **DSSE** (Dead Simple Signing Envelope) format, the same envelope shape `cosign` and npm's provenance attestations use, not a bespoke signature scheme.

### Provenance: publicly anchored

`skill publish <file.skill>` (or `skill mint --transparency`) anchors the sealed digest to the public **Sigstore Rekor** transparency log, a public, append-only Merkle-tree log maintained by the Sigstore project. The anchored payload is a minimal signed [in-toto](https://in-toto.io) Statement naming the skill (`skill_id` + `package_digest`), not a bare hash, so a public log entry is self-describing (RFC 0007). Verification checks the entry's inclusion proof against the log's signed tree head **offline by default**; `--online` additionally re-queries Rekor live as an extra check. Every verified anchor on the public instance prints a `search.sigstore.dev` link, so a third party can confirm the entry on Sigstore's own infrastructure, not just take this tool's word for it.

This path is frictionless by design: the public Rekor log needs a signing key but **no login** (that is only the Fulcio `--keyless` path), so if no key is configured, `skill publish` auto-generates a per-user Ed25519 issuer key on first run and reuses it after. Zero setup, and the URL is still independently verifiable.

`--keyless` produces a second, independent anchor kind (`keyless_identity`) alongside whatever the container's own seal is; `skill verify-trust` re-derives the OIDC `owner_identity` from the Fulcio certificate itself during verification, never from the anchor's own stored claim. See [TRANSPARENCY.md](./TRANSPARENCY.md) for the full mechanics.

### Assurance: verified vs self-reported, never blurred

`skill inspect --trust --claims` and `skill verify-trust --claims` return a `claims` object with two structurally separate arrays: `verified` (checked by math) and `self_reported` (asserted, e.g. `SKILL_HOST`, declared model, timestamps). Every claim lands in exactly one array, never both, so no UI or agent consuming this output can end up showing a self-reported field next to a "verified" badge. See [WHAT-IS-VERIFIABLE.md](./WHAT-IS-VERIFIABLE.md) for the attribute-by-attribute breakdown.

**A seal proves who issued a package and that it hasn't changed. It never proves a skill is correct, safe, or good.** That is the single most important sentence in this repo's trust docs; every page that discusses signing repeats it for a reason.

## The trust ladder

Trust is explicit and layered. You choose how much you need; a verifier can always tell which rung a package sits on, the levels are never blurred together.

| Rung | How it's sealed | What a verifier gets |
|---|---|---|
| **Development** | Public dev HMAC key (default, zero setup) | Local iteration only. Forgeable by design, labeled `development` everywhere it appears, never production trust. |
| **Verified issuer** | Configured Ed25519 key (`skill keygen` + `--signer-key`) | Cryptographic proof of authorship and integrity, once a verifier pins your key in their trust store. |
| **Publicly anchored** | Rekor transparency log (`--transparency`) and/or Fulcio keyless OIDC (`--keyless`) | A public, independently-checkable record, anyone can confirm the entry on Sigstore's own infrastructure. |

Anchoring is orthogonal to trust state and always additive: an anchored package can still be `development` or `self_reported` trust, the anchor never replaces or upgrades the seal itself. **Inclusion is not endorsement.** Rekor's guarantee is auditability, a malicious actor can log a malicious package just as easily as a benign one. See [TRUST-MODEL.md](./TRUST-MODEL.md) and [TRANSPARENCY.md](./TRANSPARENCY.md).

## Built to be verified today, and owned tomorrow

The primitives above are, by design, a foundation a future ownership layer could build on: on-chain provenance, programmable royalties for skill authors, decentralized skill marketplaces. This section describes deliberate architecture, not a promise of shipped features.

- **Content-addressed identity** is already the reference primitive on-chain assets use to point at off-chain content: a stable, tamper-evident id and digest a future system could reference without this protocol changing.
- **Cryptographic authorship** is already key-based (Ed25519, optionally Fulcio-bound OIDC identity), the same shape as wallet-based identity: a key signs, a verifier checks the signature. Nothing about how ownership might attach to that identity is decided or implemented here.
- **Pluggable anchors.** `PermanenceAnchor` (`packages/protocol/src/types.ts`) is an open extension point. Its `kind` field already accepts `"ledger"` as a defined value alongside the shipped `"transparency_log"`, `"keyless_identity"`, and `"registry"` kinds, so the wire format has a reserved slot. No code implements minting or verifying a `ledger`-kind anchor today; it is a tracked, unimplemented [roadmap item](./ROADMAP.md#later): "optional ledger anchors as one permanence kind (never required)". Adding it later would not require breaking any package sealed today, the same way `keyless_identity` was added after `transparency_log` without touching existing anchors.
- **A neutral core.** The protocol specification has no marketplace, no token, and no commerce code anywhere in it. Economics, if they ever exist, live above the protocol, in a product or an ecosystem tool, never inside the spec itself. That separation is what lets any ownership or settlement layer build on the verifiable foundation without the standard picking winners.

### What this is not, today

- skillerr does not mint tokens, issue NFTs, or move value of any kind.
- "Minting" a `.skill` (`skill mint`) creates a cryptographic attestation (a signed claim about identity and integrity), not a financial instrument, not a collectible, not a claim on anything.
- On-chain ownership is a roadmap extension point, not a shipped feature. It is not scheduled, not funded, and not guaranteed to ship in any particular form.
- If it ships, it will always be optional and additive, exactly like `--transparency`/`--keyless` are today, never required to author, verify, or run a skill.
- Nothing in this document, this repository, or this project is investment advice, a solicitation, or a claim of future financial value.

## Related

- [WHAT-IS-VERIFIABLE.md](./WHAT-IS-VERIFIABLE.md): attribute-by-attribute, what's cryptographic vs self-reported
- [TRUST-MODEL.md](./TRUST-MODEL.md): what `trust_state` means and when execute is refused
- [TRANSPARENCY.md](./TRANSPARENCY.md): the full Rekor/Fulcio mechanics and what inclusion does and doesn't prove
- [KEY-CEREMONY.md](./KEY-CEREMONY.md): generating and pinning a production Ed25519 issuer key
- [ROADMAP.md](./ROADMAP.md): the single source of truth for what's shipped vs planned, including the ledger-anchor item this page links to
