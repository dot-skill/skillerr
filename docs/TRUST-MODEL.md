# Trust model (plain language)

This explains what `trust_state` actually means when you see it in `skill inspect --trust` output, without assuming you've read [Threat Model](https://github.com/dot-skill/skillerr/wiki/Threat-Model) or the protocol spec first. If you only read one doc before running a `.skill` file someone else gave you, read this one.

## The four states

There are exactly four values for `trust_state`, and they are **not a spectrum from "a little trusted" to "very trusted."** They answer different questions:

| `trust_state` | What it means | What it does NOT mean |
|---|---|---|
| `untrusted` | No valid signature at all — unsigned, or the signature check failed. | — |
| `development` | Signed, but with the bundled public development key (`dot-skill-dev-mint-key`) that ships with this repo and every install of it. Anyone can produce a `development`-trust package; it costs nothing and proves nothing about identity. | Does **not** mean "safe" or "tested" — it means "structurally sealed with a key everyone has." |
| `self_reported` | Signed with a real, non-development key, but the signer's identity was never bound to independently-checkable evidence — just a claimed `SKILL_HOST` value or similar. | Does **not** mean the claimed host/model/author is verified. It means "someone signed this and told us who they are," not "we confirmed who they are." |
| `verified_issuer` | Signed with a configured Ed25519 (or HMAC) key that is pinned in a trust store **and** bound to actual agent-runtime evidence (a session id or agent-invocation markers), not just an environment variable. | Does **not** mean the skill is safe to execute, well-written, or free of bugs — it means the signer's identity is the one that trust store says it is. |

## The one sentence that matters

**`development` and `self_reported` are not "safe to run blindly."** Only `verified_issuer` packages skip the runtime's execute gate by default — everything else (`untrusted`, `development`, `self_reported`) requires you to explicitly pass `--allow-untrusted` to execute, precisely because none of those three states prove anything about who actually produced the package or whether it's safe.

If you take away nothing else: **`trust_state` tells you about the signature, not about the skill's behavior.** A `verified_issuer` package can still contain a badly-designed or buggy workflow. Verified identity and good content are different questions — see [WHAT-IS-VERIFIABLE.md](./WHAT-IS-VERIFIABLE.md) for the full breakdown of which claims are cryptographic versus self-reported.

## Why `SKILL_HOST` alone is `self_reported`

Setting `export SKILL_HOST=cursor` before running `skill compile`/`skill mint` tells the tooling "an agent named cursor made this." That's it — it's an environment variable, exactly as spoofable as any other environment variable. It cannot, by itself, produce `verified_issuer` trust, no matter what value you set it to. Stronger provenance requires actual agent-runtime evidence (a real session id, agent-invocation markers) *and* a signer key that's pinned in a trust store — see [Key Ceremony](./KEY-CEREMONY.md) for what that setup actually involves.

## Why the bundled key is dev-only

Every install of this CLI ships the same public development HMAC key (`dot-skill-dev-mint-key`) so that `skill mint` works out of the box without requiring key setup first — useful for trying the tooling, worthless as an identity claim. Because the key is public and shared by every installation, a `development`-trust package proves only that *someone* ran `skill mint` — it cannot distinguish one issuer from another, and it cannot be revoked from just one bad actor without breaking it for everyone. Treat it exactly like an unsigned package.

## When execute is refused

`skill run --mode execute` (and `resume`) checks exactly one thing to decide whether to refuse by default: is `trust_state === "verified_issuer"`? If not, execute refuses with `Refusing execute: <label>` unless you pass `--allow-untrusted`. This applies uniformly to `untrusted`, `development`, and `self_reported` — there is no partial-trust carve-out where, say, `self_reported` gets a lighter gate than `untrusted`. `dry_run`, `explain`, and `inspect` modes never touch this gate — they're always safe to run regardless of trust state, which is why "inspect before you trust or run" is the standing advice throughout this repo's docs.

## The trust ladder (mint-time provenance, a different axis from `trust_state`)

`trust_state` above answers "does the runtime's execute gate trust this signature." A separate, complementary question is "how much publicly-checkable provenance does this package carry." That's the trust ladder: it describes how a package was sealed and anchored, not whether the runtime will execute it.

| Rung | How it's sealed | What a verifier gets |
|---|---|---|
| **Development** | Public dev HMAC key (default, zero setup) | Local iteration only. Forgeable by design, labeled `development` everywhere it appears, never production trust. |
| **Verified issuer** | Configured Ed25519 key (`skill keygen` + `--signer-key`) | Cryptographic proof of authorship and integrity, once a verifier pins your key in their trust store. |
| **Publicly anchored** | Rekor transparency log (`--transparency`) and/or Fulcio keyless OIDC (`--keyless`) | A public, independently-checkable record, anyone can confirm the entry on Sigstore's own infrastructure. |

Anchoring is orthogonal to `trust_state` and always additive: an anchored package can still be `development` or `self_reported` trust, the anchor never upgrades or replaces the seal. **Inclusion is not endorsement,** logging a package to Rekor proves auditability, not goodness. See [CRYPTO-FOUNDATION.md](./CRYPTO-FOUNDATION.md) and [TRANSPARENCY.md](./TRANSPARENCY.md).

## Related

- [WHAT-IS-VERIFIABLE.md](./WHAT-IS-VERIFIABLE.md) — which specific claims (content, timestamp, identity, host, human approval) are cryptographic vs. self-reported, attribute by attribute
- [CRYPTO-FOUNDATION.md](./CRYPTO-FOUNDATION.md): identity, authorship, provenance, and the trust ladder in one place
- [Threat Model](https://github.com/dot-skill/skillerr/wiki/Threat-Model) — the full threat/mitigation map this trust model sits inside
- [SECURITY.md](./SECURITY.md) — practice-level rules ("inspect before run", deny-by-default runtime)
- [Key Ceremony](./KEY-CEREMONY.md) — what it actually takes to mint as `verified_issuer` in production
