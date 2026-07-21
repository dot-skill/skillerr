# Doc map

Every documentation surface in this repo, what it covers, and which package (if any) owns the code it describes. Use this when a PR changes behavior: update the matching page(s), then tick the [Docs impact](../CONTRIBUTING.md#docs-impact) checklist item.

Public site rendering lives in **[dot-skill/skillerr-com](https://github.com/dot-skill/skillerr-com)** — this map is the OSS repo only.

## Start here

| Doc | Covers | Module |
|-----|--------|--------|
| [README.md](../README.md) | Product pitch, install, quick start, talk-to-your-AI prompts | meta (`skillerr` CLI) |
| [docs/WHY.md](./WHY.md) | Why a trust layer for Agent Skills exists | — |
| [docs/WHAT-IS-VERIFIABLE.md](./WHAT-IS-VERIFIABLE.md) | What a seal actually proves (and does not) | `@skillerr/core` trust |
| [docs/FAQ.md](./FAQ.md) | Short answers; points at deeper pages | — |
| [docs/CLI-FLOW.md](./CLI-FLOW.md) | Full lifecycle mapped to `skill` commands | `@skillerr/cli` |
| [docs/AGENT.md](./AGENT.md) | Agent-facing operating guide (`skill agent-guide`) | `@skillerr/cli` |
| [docs/GOOD-FIRST-ISSUES.md](./GOOD-FIRST-ISSUES.md) | Concrete first-contribution targets | various |

## Protocol & trust

| Doc | Covers | Module |
|-----|--------|--------|
| [docs/PROTOCOL.md](./PROTOCOL.md) | Spec surface: manifest, workflow, digests, seals | `@skillerr/protocol` + `@skillerr/core` |
| [docs/SEMANTICS.md](./SEMANTICS.md) | Object summary (manifest, slots, workflow, …) | `@skillerr/protocol` |
| [docs/CANONICALIZATION.md](./CANONICALIZATION.md) | RFC 8785 / JCS digests | `@skillerr/core` |
| [docs/CRYPTO-FOUNDATION.md](./CRYPTO-FOUNDATION.md) | Content-addressed identity + signature claims | `@skillerr/core` |
| [docs/TRUST-MODEL.md](./TRUST-MODEL.md) | Plain-language `trust_state` | `@skillerr/core` / `@skillerr/runtime` |
| [docs/SECURITY.md](./SECURITY.md) | Threat/mitigation map pointers | — |
| [docs/KEY-CEREMONY.md](./KEY-CEREMONY.md) | Ed25519 issuer key lifecycle (RFC 0001) | `@skillerr/core` signer |
| [docs/TRANSPARENCY.md](./TRANSPARENCY.md) | Rekor / optional Fulcio anchors | `@skillerr/core` transparency |
| [docs/PRIVACY.md](./PRIVACY.md) | Handoff without becoming a leak vector | `@skillerr/core` scrub |
| [docs/SCRUBBING.md](./SCRUBBING.md) | Deterministic secret detection | `@skillerr/core` scrub |
| [docs/ARCHITECTURE.md](./ARCHITECTURE.md) | Package → runtime / registry overview | all packages |

## Authoring & adapters

| Doc | Covers | Module |
|-----|--------|--------|
| [docs/AUTHORING-CONTRACT.md](./AUTHORING-CONTRACT.md) | `SkillContract` as source of truth | `@skillerr/protocol` |
| [docs/WORKSPACE.md](./WORKSPACE.md) | Git-like `.skill/` working tree | `@skillerr/workspace` |
| [docs/MINT.md](./MINT.md) | Compile → mint → seal | `@skillerr/core` |
| [docs/FROM-SKILL-CREATOR.md](./FROM-SKILL-CREATOR.md) | `SKILL.md` → `.skill` mapping | `@skillerr/core` ingest |
| [docs/AGENT-SKILLS.md](./AGENT-SKILLS.md) | agentskills.io compatibility | `@skillerr/core` ingest/export |
| [docs/ADAPTERS.md](./ADAPTERS.md) | External source → `SkillSource` | `@skillerr/core` |
| [docs/RESOURCES.md](./RESOURCES.md) | Bundled scripts / progressive disclosure | `@skillerr/core` / runtime |
| [docs/EVAL.md](./EVAL.md) | Eval / benchmark loop | `@skillerr/core` + CLI score |
| [docs/CONTINUITY.md](./CONTINUITY.md) | Continuity packages, Resume Contract, SessionSource | `@skillerr/core` capture/continuity/session-source |
| [docs/LOCAL_AGENTS.md](./LOCAL_AGENTS.md) | Offline / local-agent constraints | CLI + runtime |
| [docs/FILE-TYPE.md](./FILE-TYPE.md) | OS-recognized `.skill` file type (deployment note) | — |

## Runtime, registry, release

| Doc | Covers | Module |
|-----|--------|--------|
| [docs/RUNTIME.md](./RUNTIME.md) | Load → trust → execute → SkillRun | `@skillerr/runtime` |
| [docs/REGISTRY.md](./REGISTRY.md) | Optional local transparency log | `@skillerr/registry` |
| [docs/PUBLISHING.md](./PUBLISHING.md) | npm Trusted Publisher + tag releases | CI / meta |
| [docs/ROADMAP.md](./ROADMAP.md) | Status + planned work | — |
| [docs/TIER-SUMMARY.md](./TIER-SUMMARY.md) | Historical tier 0–4 deliverable summary | — |
| [docs/LICENSING.md](./LICENSING.md) | Apache-2.0 overview (LICENSE is authoritative) | — |

## RFCs

| Doc | Covers | Module |
|-----|--------|--------|
| [docs/rfcs/README.md](./rfcs/README.md) | RFC process index | — |
| [docs/rfcs/0000-template.md](./rfcs/0000-template.md) | RFC template | — |
| [docs/rfcs/0001](./rfcs/0001-asymmetric-signatures-trust-store.md)–[0009](./rfcs/0009-resume-contract.md) | Spec proposals (status in each file) | usually `@skillerr/core` / protocol |

## Project / process (repo root)

| Doc | Covers | Module |
|-----|--------|--------|
| [CONTRIBUTING.md](../CONTRIBUTING.md) | DCO, branch flow, PR checklist, docs impact | — |
| [GOVERNANCE.md](../GOVERNANCE.md) | Maturity levels, license, decision rights | — |
| [DCO.md](../DCO.md) | Developer Certificate of Origin | — |
| [SECURITY.md](../SECURITY.md) | Supported versions + disclosure | — |
| [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) | Conduct | — |
| [CHANGELOG.md](../CHANGELOG.md) | Release history | — |
| [INTEGRATION_NOTES.md](../INTEGRATION_NOTES.md) | Handshake with private `skillerr-registry` | `@skillerr/core` ↔ registry |
| [spec/CONTRACT.md](../spec/CONTRACT.md) | Frozen interop shapes (registry contract) | `@skillerr/core` |

## Per-package READMEs (npm)

| Doc | Covers | Module |
|-----|--------|--------|
| [packages/skillerr/README.md](../packages/skillerr/README.md) | Generated from root README (`sync-npm-readme.mjs`) | `skillerr` |
| [packages/protocol/README.md](../packages/protocol/README.md) | Package blurb | `@skillerr/protocol` |
| [packages/core/README.md](../packages/core/README.md) | Package blurb | `@skillerr/core` |
| [packages/runtime/README.md](../packages/runtime/README.md) | Package blurb | `@skillerr/runtime` |
| [packages/registry/README.md](../packages/registry/README.md) | Package blurb | `@skillerr/registry` |
| [packages/workspace/README.md](../packages/workspace/README.md) | Package blurb | `@skillerr/workspace` |
| [packages/cli/README.md](../packages/cli/README.md) | Package blurb | `@skillerr/cli` |

## CI-enforced doc hygiene

| Check | Script | Guards |
|-------|--------|--------|
| Package-version mentions | [`scripts/check-doc-versions.mjs`](../scripts/check-doc-versions.mjs) | Hardcoded `1.x.y` in key docs matches `packages/skillerr/package.json`; README test badge ↔ prose |
| License consistency | [`scripts/check-license-consistency.mjs`](../scripts/check-license-consistency.mjs) | Docs / `package.json` / `LICENSE` files agree on Apache-2.0 |
| Dead internal links | [`scripts/check-doc-links.mjs`](../scripts/check-doc-links.mjs) | Relative markdown links resolve inside the repo |
| npm README sync | [`scripts/sync-npm-readme.mjs`](../scripts/sync-npm-readme.mjs) | `packages/skillerr/README.md` matches root README transform |
| Core ↛ registry | [`scripts/check-core-registry-independence.mjs`](../scripts/check-core-registry-independence.mjs) | `@skillerr/core` never depends on the private registry |

When you add a new top-level doc under `docs/` (or a new RFC), add a row here in the same PR.
