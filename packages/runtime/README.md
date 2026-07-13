# `@skillerr/runtime`

Reference runtime for the [Open `.skill` Protocol](https://github.com/dot-skill/skillerr).

Load a `.skill` archive, verify integrity and trust profile, resolve inputs, and run in **inspect**, **dry_run**, or **execute** modes. Prefer inspect and dry-run before execute.

## Install

```bash
npm i @skillerr/runtime
```

## Lifecycle

`LoadAndVerify` → `NegotiateCapabilities` → `ResolveInputs` → `Consent` → `Execute` → `Verify` → `EmitSkillRun`

Modes: `inspect` · `explain` · `dry_run` · `execute` · `resume`

Fails clearly when required capabilities or minted trust profiles are unmet. Does not silently degrade.

## Trust

- Digests and seals are visible without executing workflow steps.
- Trust profiles: `open` | `minted` | `anchored` | `issuer:<id>`
- Reference mint verification matches `@skillerr/core` — dev HMAC (`trust_state: development`) by default, or `verified_issuer` when a configured Ed25519 signer key was used

## Related

- [`@skillerr/core`](https://www.npmjs.com/package/@skillerr/core) — pack / validate / mint
- [`skillerr`](https://www.npmjs.com/package/skillerr) — `skill inspect` / `skill run`

Docs: [RUNTIME.md](https://github.com/dot-skill/skillerr/blob/main/docs/RUNTIME.md) · [SECURITY.md](https://github.com/dot-skill/skillerr/blob/main/docs/SECURITY.md)

## License

MIT
