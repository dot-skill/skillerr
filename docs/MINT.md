# Mint

```text
AI propose sections → human approve → compile (release, complete) → mint (agent attestation)
```

Continuity drafts **cannot** be minted. Recompile with `--profile release` when complete.

## CreationAttestation

Required for minted skills. Includes:

- `package_digest` and **`sealed_manifest_digest`** (identity + permissions/policy/capabilities + content claims)
- agent host / provider / model (self-reported unless issuer-verified)
- `host_claim_binding`: `self_reported` | `verified_issuer`
- `issuer_class`: `public_dev_hmac` | `configured_hmac` | `configured_ed25519`. Required on
  verify — a stripped/absent `issuer_class` is `missing_issuer_class` and refuses; it is
  never reconstructed from `key_id` (an attacker-controlled field just like `issuer_class`
  itself, so reconstruction could launder a `public_dev_hmac` seal into a
  higher-trust-looking label).
- journey refs, optional `generation_usage` (tokens)
- `human_approvals.actors` / **`human_approvals.attested`**: `actors` is only ever the
  identity evidence a caller actually passed (`MintOptions.actors`); mint never fabricates
  a default approver. When no evidence is provided, `actors` is `[]` and `attested` is
  `false` — an explicit, inspectable "unattested" marker rather than a silent claim that a
  human named "human" approved. Likewise `manifest.authors` (from `SkillSource.actor`)
  reflects the agent that authored the skill (`agent:<host>` by default); a human semantic
  reviewer only ever appears in `contract.provenance.human_review`, never as an author.

## Trust (not the same as “signed”)

| Seal | TrustView state | Production execute |
|------|-----------------|--------------------|
| Unsigned / open | `untrusted` | Refuse unless `--allow-untrusted` |
| Public-dev HMAC | `development` | Refuse (forgeable) |
| Configured HMAC/Ed25519 + self-reported host | `self_reported` | Refuse unless opted in |
| Configured Ed25519 key + verified host binding | `verified_issuer` | Allowed |

Reference HMAC in this repo is **dev-only** — not production PKI. Humans exporting `SKILL_HOST` alone never get `verified_issuer`.

The default (no `--signer-key`) seal is real HMAC-SHA256
(`crypto.createHmac`), not a naive `sha256(secret + ":" + payloadDigest)`
concatenation. The DSSE envelope carries an explicit `sig_alg`
(`"hmac-sha256-v1"` for HMAC); a seal missing it or carrying an
unrecognized value is `unsupported_seal_version` on verify — a clear
"old/foreign algorithm" refusal, not a generic signature mismatch that
reads like ordinary tampering.

### Asymmetric signing (PROTO-2 / RFC 0001, implemented)

`skill mint --signer-key <pem>` uses a real Ed25519 keypair
(`issuer_class=configured_ed25519`, `sig_alg="ed25519-v1"`) instead of
HMAC. Unlike HMAC, verification never requires the private key — a
verifier holds only a **trust store** of pinned public keys
(`~/.skillerr/trust-store.json`, `skill verify-trust --trust-store`).
`verified_issuer` for a `configured_ed25519` attestation additionally
requires the signing key to actually be present, live (`not_before`/
`not_after`), and authorized for that `host` in the verifier's trust
store — a missing pin refuses (`trust_store_key_not_found` and friends),
it never silently downgrades to a lesser-but-still-passing label. See
[Key Ceremony](./KEY-CEREMONY.md) for the full generate → mint → pin
walkthrough, and [Threat Model](https://github.com/dot-skill/skillerr/wiki/Threat-Model) T3 for why HMAC
alone could never make `verified_issuer` mean what it says.

## Anti-spoof

Mint refuses denylisted hosts (`human`, `cli`, `shell`, `manual`, …). Exporting `SKILL_HOST=cursor` (or any host id) alone never yields `verified_issuer` — that requires a configured issuer secret and verified host binding. Agent runtime markers strengthen the mint path but remain **locally spoofable**; env claims stay `self_reported` / `development` under the public-dev key. Workspace compile may still record a declared host; TrustView distinguishes self-reported vs verified issuer.

## Anchors (optional)

Three independent, additive ways to anchor a mint — none required, none replacing the seal above:

- `skill registry …` — an optional **local** transparency log of package digests, useful offline or before deciding to anchor publicly.
- `skill mint --transparency` — logs the sealed digest to the **public** Rekor transparency log using the mint's own configured Ed25519 key, so a third party can independently confirm *when* it was first registered. See [TRANSPARENCY.md](./TRANSPARENCY.md).
- `skill mint --keyless` — adds a second, independent anchor bound to an OIDC identity via Fulcio (e.g. a specific CI workflow) instead of a pinned key. Combines with any signer choice above, or none. CI-ambient only today (no interactive login yet) — see [TRANSPARENCY.md](./TRANSPARENCY.md).

`skill verify-trust --claims` (or `skill inspect --trust --claims`) reports every claim — mint's own seal and any anchors — split into two structurally separate lists, `verified` and `self_reported`, so nothing here can be mistaken for the other. See [WHAT-IS-VERIFIABLE.md](./WHAT-IS-VERIFIABLE.md).

`--transparency` and `--keyless` sign a small, subject-bearing in-toto statement (`statement_version: "1"`), not a bare digest, so the public Rekor entry itself names which skill it belongs to. See [TRANSPARENCY.md](./TRANSPARENCY.md) "What gets logged".
