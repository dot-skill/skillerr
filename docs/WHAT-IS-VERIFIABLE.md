# What is verifiable (read this before you trust a `.skill`)

This is the single most important page in this repo's docs if you're deciding whether to run someone else's `.skill` file. It lists, attribute by attribute, what `skill verify-trust` / `skill inspect --trust` actually proves versus what a package merely *claims*.

## The one-sentence guarantee

**Today, as of protocol Draft 0.5.0 / reference packages 0.8.0:** we guarantee that a specific key controlled the signature over this exact, unaltered content. We do not guarantee who or what agent authored it, that any human reviewed it, when it was actually created, or that its declared behavior is honest — those are separate claims, listed below, that are either self-reported or enforced at runtime rather than proven by the signature.

A public, independently-checkable transparency log (so a third party — not just you — can confirm *when* a package was first registered, without trusting your local trust store alone) is planned but **not yet implemented** — see the roadmap note at the bottom of this page. Until then, "verifiable" means "verifiable by you, using your own pinned trust store," not "verifiable by anyone, against a public record."

## What's actually cryptographic

These are checked by math, not by asking the package what it claims about itself.

| Claim | How it's checked |
|---|---|
| **Content integrity** — the bytes you're inspecting are exactly the bytes that were sealed, unaltered | `package_digest` (content-only) and `manifest_digest` (permissions/capabilities/policy) are recomputed from the actual archive and compared against the sealed values. Any post-seal edit — even one byte — changes the digest. |
| **Signature validity** — a specific private key produced a signature over the sealed manifest digest | `verifyMintTrust` recomputes and checks the signature (HMAC or Ed25519 depending on `sig_alg`) against the claimed `key_id`/algorithm. An invalid or missing signature is `trust_state: untrusted`. |
| **Which key signed it** — the `key_id` that produced a valid signature | Part of the same signature check above — this is a fact about the bytes, not a claim the package makes about itself. |

## What's key-bound, but requires you to already trust the key

| Claim | What's actually verified | What is NOT verified |
|---|---|---|
| **`verified_issuer` trust state** | The signature is valid *and* the `key_id` is pinned in **your** local trust store (`~/.skillerr/trust-store.json` by default), with a matching, non-expired, host-authorized entry. | Nothing about *who* that key belongs to in the real world. The trust store's `comment` field is a human-written label you (or whoever curates your trust store) chose to trust — see [KEY-CEREMONY.md](./KEY-CEREMONY.md). There is no public identity system (no OIDC binding, no certificate authority) behind this today. Two different people could both call their trust-store entry `"our CI pipeline"` and you'd have no way to independently tell them apart without your own out-of-band verification of the key. |

This is real cryptography — you're not being lied to about signature validity — but it is **not** the same as a publicly-verifiable identity. If someone hands you a `.skill` file and says "trust key X," and you add key X to your trust store, `verified_issuer` from that point on just means "signed by the key I was told to trust." Garbage in, garbage out.

## What's self-reported — NOT guaranteed by anything above

| Field | Why it's not guaranteed |
|---|---|
| **`agent.host` / declared model** (`SKILL_HOST=cursor`, etc.) | An environment variable at compile/mint time. Trivially spoofable. Signing the package doesn't make this claim any more true — it just proves *someone with the signing key* asserted it. |
| **`created_at` / any self-claimed timestamp** | Wall-clock time read from the machine that ran `skill compile`/`ingest`/`mint`. Not independently timestamped anywhere. Two packages can claim any `created_at` a signer wants, including a false one. |
| **`human_approvals` / `provenance.human_review`** | Only counted as `attested: true` when actor evidence is actually present (a named actor, not just an empty claim) — but "an actor named X approved this" is still exactly as trustworthy as the signer's honesty. Nothing cryptographically ties a human to a specific approval event. |
| **Declared behavior matching actual behavior** | Signing a package proves the *permissions/capabilities declarations* weren't altered after sealing (that's `manifest_digest`) — it does **not** prove the workflow steps actually do only what the capabilities describe. That's enforced separately, at execution time, by the consumer's own runtime capability gate (deny-by-default; see [SECURITY.md](./SECURITY.md)) — not something a signature can prove in advance. |
| **Quality / correctness / safety of the content** | Entirely out of scope for trust_state. A `verified_issuer` package can still be poorly designed, buggy, or a bad fit for your use case. See `skill score` / [EVAL.md](./EVAL.md) for quality evidence — a completely separate axis from trust. |

## Quick reference: what to actually do with this

1. **Inspect first, always** — `skill inspect --trust ./file.skill` shows every field above without executing anything.
2. **Never treat `development` or `self_reported` as safe to run blindly** — see [TRUST-MODEL.md](./TRUST-MODEL.md) for exactly what the runtime's execute gate does and doesn't allow through.
3. **`verified_issuer` means "I already trust this key,"** not "this key is publicly known to be trustworthy." Curate your trust store deliberately.
4. **Self-reported fields (host, model, timestamp, human review) are claims, not proofs**, no matter what trust state the package has.

## Roadmap: what this page will say once transparency logging ships

A planned future phase adds an optional public transparency log (Rekor-based) so a package's first-registration timestamp and signature can be checked by anyone, not just against your local trust store, plus optional keyless signing (Fulcio) so `owner_identity` can be a real, independently-checkable OIDC identity instead of an opaque key you were told to trust. When that ships, this page — and the machine-readable `skill verify-trust --json` output — will add `log_inclusion`/`log_timestamp` (cryptographic) and `owner_identity` (identity-bound when Fulcio-signed) as new rows, without changing anything above: today's guarantees stay exactly what they are, this just adds more.

## Related

- [TRUST-MODEL.md](./TRUST-MODEL.md) — plain-language explanation of the four `trust_state` values
- [THREAT-MODEL.md](./THREAT-MODEL.md) — the full threat/mitigation map
- [KEY-CEREMONY.md](./KEY-CEREMONY.md) — how to actually curate a trust store and mint as `verified_issuer`
- [EVAL.md](./EVAL.md) — quality/correctness evidence, a separate concern from trust
