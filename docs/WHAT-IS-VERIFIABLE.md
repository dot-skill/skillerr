# What is verifiable (read this before you trust a `.skill`)

This is the single most important page in this repo's docs if you're deciding whether to run someone else's `.skill` file. It lists, attribute by attribute, what `skill verify-trust` / `skill inspect --trust` actually proves versus what a package merely *claims*.

## The one-sentence guarantee

**As of protocol Draft 0.5.0 / reference packages 0.9.8:** we guarantee that a specific key controlled the signature over this exact, unaltered content. We do not guarantee who or what agent authored it, that any human reviewed it, when it was actually created, or that its declared behavior is honest — those are separate claims, listed below, that are either self-reported or enforced at runtime rather than proven by the signature.

If a package was minted with `--transparency` (see [TRANSPARENCY.md](./TRANSPARENCY.md)), that guarantee extends further: a public, independently-checkable Rekor transparency log entry means a third party — not just you — can confirm *when* it was first registered, without trusting your local trust store alone. Anchoring is opt-in, not automatic — a package without an anchor is exactly as verifiable as described above (verifiable by you, using your own pinned trust store), which is still the common case today.

**This page is the human-readable version of a machine-readable split.** `skill inspect --trust --claims` / `skill verify-trust --claims` return a `claims` object with two separate arrays, `verified` and `self_reported`, built from `assessClaims()` in `@skillerr/core` — every table row below maps to an entry in exactly one of those two arrays, never both, and never a single flat list with a flag that's easy to ignore. Any UI or agent consuming this output structurally cannot end up displaying a `self_reported` claim next to a "verified" badge, because they're never in the same array to begin with. `www.skillerr.com`'s verify page (`/verify`) uses this same split.

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

## What's cryptographic *and* publicly checkable — only if the package was anchored

| Claim | How it's checked |
|---|---|
| **Log inclusion** — this exact signed digest was submitted to a specific public Rekor log entry | `skill verify-trust` checks the entry's inclusion proof against the log's signed tree head — no live network call needed by default (`--online` re-fetches the entry as an extra check). See [TRANSPARENCY.md](./TRANSPARENCY.md). |
| **Log timestamp** — when that entry was integrated into the log | The log's own `integratedTime`, not a self-claimed value — this is the one timestamp in this whole system that isn't just "whatever the signer's machine said." |
| **`owner_identity`** — a real OIDC identity (e.g. a specific CI workflow ref), *only* when the package was minted with `skill mint --keyless` | `skill verify-trust` re-derives this from the Fulcio-issued certificate's chain-of-trust to Fulcio's CA during verification — never from the package's own stored claim. A `--transparency`-only anchor (no `--keyless`) has no `owner_identity` at all: it proves *when and that* something was logged, signed by *some* key, but not *whose* identity backs that key (see "key-bound" section above). |

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

## Roadmap: what's still pending

Optional keyless signing (Fulcio) shipped for the CI-ambient case (`skill mint --keyless` inside GitHub Actions or similar, with no interactive setup needed) — see the `owner_identity` row above and [TRANSPARENCY.md](./TRANSPARENCY.md). What's still pending is an interactive/browser-login OIDC provider for running `--keyless` locally, outside CI — tracked in [ROADMAP.md](./ROADMAP.md).

## Related

- [TRUST-MODEL.md](./TRUST-MODEL.md) — plain-language explanation of the four `trust_state` values
- [THREAT-MODEL.md](./THREAT-MODEL.md) — the full threat/mitigation map
- [KEY-CEREMONY.md](./KEY-CEREMONY.md) — how to actually curate a trust store and mint as `verified_issuer`
- [EVAL.md](./EVAL.md) — quality/correctness evidence, a separate concern from trust
