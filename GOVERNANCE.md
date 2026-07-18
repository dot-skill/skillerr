# Governance

## Status

| Level | Meaning |
|-------|---------|
| Draft | May change with notice in CHANGELOG |
| Candidate | Feature-complete; breaking changes need RFC |
| Stable | Passes the reference conformance corpus (RFC 8785 canonicalization vectors, the adversarial security corpus, and deterministic repacking, all run on every push across three OSes); breaking changes require an RFC |

Open `.skill` Protocol is **1.0.0 (Stable)**. Reference packages (`skillerr`, `@skillerr/*`, currently **1.5.2**) are versioned separately and in lockstep; treat `packages/skillerr/package.json` as the single source of truth for that number if it ever drifts from what's restated here.

A second, independent runtime is the highest-leverage contribution toward ecosystem growth and independent validation of the spec, not a prerequisite for Stable status. A single reference implementation passing its own full conformance corpus is sufficient evidence of stability on its own.

## Project

- **License:** MIT, [LICENSE](./LICENSE) · [docs/LICENSING.md](./docs/LICENSING.md)
- **Maintainer:** Bharat Dudeja
- **Contributions:** DCO sign-off, [DCO.md](./DCO.md)
- **Decision process:** day-to-day changes land via pull request and maintainer review. Protocol-level changes (schema, wire format, trust semantics) go through the open [RFC process](./docs/rfcs/); additive changes are preferred over breaking ones.

## Extensions

Vendor fields live under `extensions.<vendor_id>.*`.

## Neutrality

Anyone may implement `.skill` under the MIT License. The open protocol is
independent of any particular product, marketplace, or host.
