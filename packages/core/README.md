# `@skillerr/core`

Compile, pack, validate, and mint `.skill` packages for the [Open `.skill` Protocol](https://github.com/dot-skill/skillerr).

Turns a **SkillSource** / **SkillContract** into a deterministic ZIP with digests, privacy scrubbing, completeness gates, and optional mint attestation.

## Install

```bash
npm i @skillerr/core
```

## Capabilities

| Function | Role |
|----------|------|
| Compile | SkillSource → package files; release profile refuses if incomplete |
| Pack / unpack | Deterministic ZIP container |
| Validate | Structure + SHA-256 digests |
| Mint | Creation attestation — default HMAC is development-only; a configured Ed25519 signer key mints as `verified_issuer` |
| Inspect helpers | Manifest and seal visibility without execution |

## Profiles

- **`continuity`** — handoff draft; soft gaps allowed; not mintable
- **`release`** — complete or `compile_refused`; mintable when approved

## Related

- [`@skillerr/protocol`](https://www.npmjs.com/package/@skillerr/protocol) — types & contract
- [`@skillerr/runtime`](https://www.npmjs.com/package/@skillerr/runtime) — inspect / dry-run / execute
- [`skillerr`](https://www.npmjs.com/package/skillerr) — public install (`skill` CLI)

Docs: [PROTOCOL.md](https://github.com/dot-skill/skillerr/blob/main/docs/PROTOCOL.md) · [MINT.md](https://github.com/dot-skill/skillerr/blob/main/docs/MINT.md)

## License

MIT
