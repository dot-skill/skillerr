# Open `.skill` Protocol

<p align="center">
  <img src="./assets/skillerr-mark.png" alt="Skillerr .skill mark" width="128" height="128" />
</p>

<p align="center"><em>The cryptographic trust standard for AI skills.</em></p>

**Package a skill once as a sealed `.skill`: content-addressed, cryptographically signed, and independently verifiable before anyone runs it.** A Sigstore-grade trust ladder carries a skill from local development to a publicly anchored proof of authorship, on a neutral foundation built to outlast any single tool, host, or marketplace.

Create, inspect, sign, and run portable `.skill` packages for AI agents, the integrity and provenance layer on top of your `SKILL.md`.

```bash
npm i -g skillerr
```

**Site:** [skillerr.com](https://www.skillerr.com/docs/) · **Format:** `.skill` (sealed ZIP) · **Reference CLI:** [`skillerr`](https://www.npmjs.com/package/skillerr) (`skill`) · **Repo:** [dot-skill/skillerr](https://github.com/dot-skill/skillerr)

[![npm](https://img.shields.io/npm/v/skillerr.svg)](https://www.npmjs.com/package/skillerr)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![Protocol](https://img.shields.io/badge/protocol-1.0.0-blue.svg)](./docs/PROTOCOL.md)
[![Tests](https://img.shields.io/badge/tests-200%20passing-brightgreen.svg)](./docs/SECURITY.md)

**Contributing:** see [CONTRIBUTING.md](./CONTRIBUTING.md) for the DCO/PR checklist, or jump straight to a scoped task in [docs/GOOD-FIRST-ISSUES.md](./docs/GOOD-FIRST-ISSUES.md).

## Cryptographic foundation

A skill is only as trustworthy as your ability to verify it. `.skill` gives every skill a verifiable identity, provable authorship, and independently checkable provenance, the same guarantees the software supply chain now expects, applied to AI skills.

- **Identity, content-addressed.** Every skill has a content-derived `skill_id` and SHA-256 `package_digest`/`manifest_digest`. Change one byte after sealing and the identity changes; tampering is detectable by math, not trust.
- **Authorship, cryptographically signed.** Seal with a configured Ed25519 issuer key (`verified_issuer`), or bind the seal to an OIDC identity with Sigstore Fulcio keyless signing (`skill mint --keyless`). Attestations use the standard DSSE envelope, the same primitives `cosign` and npm provenance rely on.
- **Provenance, publicly anchored.** Anchor the sealed digest to the public Sigstore Rekor transparency log (`skill mint --transparency`). Inclusion is verified against the log's signed tree head offline by default (`--online` re-checks live), and every verified anchor prints a `search.sigstore.dev` link so a third party can confirm it without trusting this tool's word.
- **Assurance you can't fake.** `skill inspect --trust --claims` / `skill verify-trust --claims` split every field into `verified` (crypto-checked) and `self_reported` (asserted), two separate arrays, so a self-reported claim can never be shown as verified. A seal proves who issued a package and that it hasn't changed, never that a skill is correct, safe, or good. See [What is verifiable](./docs/WHAT-IS-VERIFIABLE.md).

### The trust ladder

| Rung | How it's sealed | What a verifier gets |
|---|---|---|
| **Development** | Public dev HMAC key (default, zero setup) | Local iteration only. Forgeable by design, labeled `development` everywhere it appears, never production trust. |
| **Verified issuer** | Configured Ed25519 key (`skill keygen` + `--signer-key`) | Cryptographic proof of authorship and integrity, once a verifier pins your key in their trust store. |
| **Publicly anchored** | Rekor transparency log (`--transparency`) and/or Fulcio keyless OIDC (`--keyless`) | A public, independently-checkable record, anyone can confirm the entry on Sigstore's own infrastructure. |

Anchoring is orthogonal to trust state and always additive, an anchored package can still be `development` or `self_reported`; the anchor never replaces the seal. **Inclusion is not endorsement:** logging a package proves auditability, not goodness. See [docs/TRUST-MODEL.md](./docs/TRUST-MODEL.md).

## Built to be verified today, and owned tomorrow

The primitives that make a `.skill` verifiable are, by design, a foundation a future ownership layer could build on: on-chain provenance, programmable royalties for skill authors, decentralized skill marketplaces. This is deliberate architecture, not a promise of features:

- **Content-addressed identity.** A skill already has a unique, tamper-evident id and digest, the same reference primitive on-chain assets use to point at off-chain content.
- **Cryptographic authorship.** Skills are already signed by Ed25519 issuer keys and, optionally, bound to an OIDC identity via Sigstore Fulcio, key-based identity that maps cleanly onto wallet-based identity.
- **Pluggable anchors.** `PermanenceAnchor` is an open extension point. The wire format already reserves `kind: "ledger"` as a valid anchor kind alongside the shipped `transparency_log`/`keyless_identity`/`registry` kinds; no ledger-anchoring implementation exists yet, it's a tracked [roadmap item](./docs/ROADMAP.md), addable without breaking a single existing package.
- **A neutral core.** Economics live above the protocol, never inside it. The spec has no marketplace, no token, and no commerce code, so any ownership or settlement layer could build on the verifiable foundation without the standard picking winners.

**What this is not, today:** skillerr does not mint tokens, issue NFTs, or move value. "Minting" a `.skill` creates a cryptographic attestation, not a financial instrument. On-chain ownership is a roadmap extension point, not a shipped feature, and it will always be optional, never required to author, verify, or run a skill. Nothing here is investment advice or a claim of future value. See [docs/CRYPTO-FOUNDATION.md](./docs/CRYPTO-FOUNDATION.md) for the full breakdown.

## Where skillerr fits

The Agent Skills ecosystem has three layers. skillerr owns the third, and is complementary to the other two, not a competitor to either:

| Layer | What it does | Who does it |
|---|---|---|
| **Authoring** | Defines the `SKILL.md` format itself: frontmatter, body, `scripts/`/`references`/`assets/` | The [Agent Skills spec](https://agentskills.io/specification) |
| **Distribution** | Installers and directories that get a skill onto your machine | [`vercel-labs/skills`](https://github.com/vercel-labs/skills) (`npx skills add owner/repo`), [skills.sh](https://skills.sh) |
| **Trust / integrity** | Seals, signs, records provenance, and lets you inspect a skill before you run it | **skillerr** |

The concrete gap this closes: `npx skills add owner/repo` installs unverified instructions and executable scripts from any repo, with no integrity or provenance check built in. skillerr adds the missing step: inspect and verify a skill before you run it, not after.

**Agent Skills / `SKILL.md`** is the open authoring format. **`.skill`** is a sealed, signed package *of* one. `.skill` doesn't replace your `SKILL.md`, `skill ingest` reads a standard Agent Skills folder and wraps it in a typed contract, an integrity seal, and provenance, so the same skill keeps working everywhere Agent Skills are supported, and gains inspect-before-run trust on top.

Distribution tools install a skill; skillerr lets you verify one, its integrity, issuer, and provenance, before you run it.

**No telemetry, no tracking.** skillerr makes no network calls unless you explicitly ask it to (`--transparency`, `--keyless`, `--online`, all opt-in). Nothing about what skills you create, ingest, or run is ever reported anywhere.

## Convert your `SKILL.md` in one line

Already have a `SKILL.md` or a skill-creator folder? `.skill` isn't a
competing format — it's the integrity layer on top. One command upgrades it,
and it never claims completeness it can't back up. Paste this to your agent —
it names every command literally, nothing to guess:

```text
Using skillerr (npmjs.com/package/skillerr), convert ./SKILL.md into a sealed
.skill package. Set yourself up and ask me for anything you need. Show me the
output path and exactly what's still missing before it can be a release. Don't
invent contract fields to make it look more complete than it is.
```

See [docs/FAQ.md](./docs/FAQ.md#how-do-i-convert-an-existing-skillmd).

## What a sealed `.skill` gives you that a bare `SKILL.md` can't

| | Bare `SKILL.md` | Sealed `.skill` |
|---|---|---|
| **Structure** | Freeform prose | Typed contract: intent, triggers, inputs/outputs, ordered steps, capabilities, permissions, verification |
| **Integrity** | None | Content-addressed `skill_id` + SHA-256 `package_digest`/`manifest_digest` — any edit after packing is detectable |
| **Trust before run** | None | Inspect seal/issuer/digests without executing (`skill inspect --trust`); `untrusted`/`development`/`self_reported`/`verified_issuer` states, never blurred together |
| **Quality evidence** | None | Native eval/benchmark loop + an optional sealed score receipt (`skill eval`, `skill score`) — see [docs/EVAL.md](./docs/EVAL.md) |
| **Handoff** | Copy the chat | Continuity draft — a real AI↔AI handoff object, partial-OK, privacy-scrubbed |
| **Authenticity path** | None | Optional public transparency-log anchoring (`skill mint --transparency`, built on the official sigstore/Rekor stack) plus a local transparency log (`skill registry`) — never a required dependency, see [docs/TRANSPARENCY.md](./docs/TRANSPARENCY.md) |

Markdown remains a **lossy adapter only** — not the protocol. Full comparison: [docs/WHY.md](./docs/WHY.md).

---

## Install once

```bash
npm i -g skillerr
```

Node ≥ 20. One-shot: `npx -y skillerr --help`. After that, you do not drive a CLI checklist — you **point your AI at `skillerr`**.

---

## Talk to your AI

Paste prompts like these into Cursor, ChatGPT, Claude, Codex, or any agent
that can run shell tools. None of them spell out install steps or
`SKILL_HOST`: a competent agent checks `skill --version`, installs skillerr,
and picks the right host value on its own; it'll ask you if it needs
anything else.

New to the vocabulary the prompts use? "Journey" is the redacted record of
what you and the agent did; "checkpoint" is a partial, in-progress save
(continuity draft); "release-complete" means every required contract field
is filled in and human-reviewed, not just "looks done." The output either
way is a sealed `.skill` file, not a chat export.

### Create a skill from this chat

```text
Using skillerr (npmjs.com/package/skillerr), create a sealed .skill from this
conversation: redacted journey, exact sections I approved, nothing invented.
Set yourself up and ask me for anything you need. Show me status and the
output path.
```

Starting from a blank page instead of a chat you want to seal? Point your
agent at [examples/skillerr-authoring/SKILL.md](./examples/skillerr-authoring/SKILL.md)
— it's the interview → contract → review → mint front door, written so an
agent can follow it without hand-writing the contract JSON.

### Inspect before you trust or run

```text
I have a file at ./file.skill. Inspect TrustView (digests, seals) without executing.
Validate integrity, then dry-run. Summarize what it does and any trust warnings.
Do not execute for real unless I explicitly ask.
```

### Extract multiple skills from a journey

```text
Using skillerr, run agent-guide then extract from ./journey.json into ./extraction.
For each candidate I select, open its own workspace, fill missing contract fields,
and only compile a release when complete — otherwise checkpoint. Prefer exact text.
```

### Load a continuity handoff

```text
Load ./handoff.skill as continuity context. Summarize intent, scrubbed journey,
open gaps, and pinned knowledge. Resume the work; do not mint a fake release.
```

### Hand off mid-work to another agent

```text
Checkpoint the current .skill workspace as a continuity draft (partial OK).
Tell me the output path and what the next agent should load.
```

More copy-paste prompts: [examples/prompts.md](./examples/prompts.md). Agent contract: [docs/AGENT.md](./docs/AGENT.md).

---

## What your agent will do

Commands below are what the **agent** runs — not a human homework list.

| Goal | What the agent runs |
|------|---------------------|
| Create workspace | `skill init` → `journey` → `propose` → `status` |
| Convert an existing SKILL.md | `skill ingest <path>` |
| Take an ingested skill to a workspace | `skill load <file.skill> --into <dir>` (stages sections + writes the contract) |
| Mid-work handoff | `skill checkpoint` |
| Release when complete | `skill compile -m "…" --approve --mint` |
| Public provenance URL, zero setup | `skill publish <file.skill>` (auto-keys, anchors to Rekor, prints the `search.sigstore.dev` link) |
| Production issuer identity | `skill keygen` → `skill mint --signer-key …` for `verified_issuer` trust |
| Trust before run | `skill inspect --trust --claims` → `validate` → `verify-trust --claims` → `run` (dry-run) |
| Read-only handoff preview | `skill load ./file.skill` |

Creation requires a declared agent host (`SKILL_HOST=cursor|ollama|claude|…`). Humans review and approve releases. Declared host/model fields are self-reported provenance, not cryptographic proof of authorship.

---

## What good looks like

- **Inspect first** — digests and seals without executing (`skill inspect --trust`)
- **Validate** structure and hash integrity
- **Dry-run** before execute
- Continuity drafts may be incomplete; **release** compile refuses incomplete contracts (`compile_refused`)
- **Real cryptographic identity in production:** `skill keygen` + `--signer-key` mints with a configured Ed25519 issuer key as `verified_issuer` — the bundled zero-setup key (used when no `--signer-key` is given) is for trying the CLI, not for shipping. See [Key Ceremony](./docs/KEY-CEREMONY.md)
- **Public provenance, zero setup:** `skill publish <file.skill>` seals a release and anchors its digest to the public Sigstore Rekor log, printing an independently-verifiable `search.sigstore.dev` link. The public log needs a signing key but **no login**, so a per-user key is auto-generated on first run. Rekor entries are permanent and world-readable. See [Transparency](./docs/TRANSPARENCY.md)

See [docs/SECURITY.md](./docs/SECURITY.md).

| | Continuity draft | Release skill |
|---|---|---|
| Purpose | AI↔AI work handoff | Reusable sealed procedure |
| Incomplete? | Allowed (lists gaps) | **compile_refused** |
| Mint? | No | Yes |

---

## Agent hosts and provenance

Set `SKILL_HOST` to the agent recording the skill, any string, self-reported unless a configured issuer key plus real agent-runtime evidence bind it as `verified_issuer` (see [What is verifiable](./docs/WHAT-IS-VERIFIABLE.md)). Commonly seen values, not an exhaustive or gated list:

| `SKILL_HOST` | Notes |
|---|---|
| `cursor`, `claude-code`, `codex` | IDE / coding-agent hosts |
| `ollama`, `lmstudio`, `llama.cpp` | Local/offline model runtimes |
| `custom` (or any other name) | Anything else, `human`/`cli`/`shell`/`manual` are the only denylisted values |

Exporting a sealed `.skill` back into an agent's own skill directory (`.claude/skills/`, `.cursor/skills/`, `.agents/skills/`, …) is on the [roadmap](./docs/ROADMAP.md), not shipped yet, `skill to-skill-md` today produces a single lossy markdown file, not an installable folder.

---

## What’s in a `.skill`

```text
example.skill
├── skill.json         # manifest, digests, profile, completeness
├── workflow.json      # runnable steps
├── knowledge/         # pinned decisions / rules
├── prompts/           # versioned prompt templates
├── resources/         # bundled scripts, reference material
├── artifacts/         # generated outputs
├── assets/icon.*      # optional per-skill icon (format mark otherwise)
├── provenance/        # journey, usage, compile report, optional eval + score
└── signatures/        # mint attestation, optional anchors
```

Full package layout spec: [docs/PROTOCOL.md](./docs/PROTOCOL.md#container).

---

## Status

Specification: **1.0.0 (Stable)** ([docs/PROTOCOL.md](./docs/PROTOCOL.md)) — future changes go through the open [RFC process](./docs/rfcs/), not silent revisions. Separate axis from the package version directly below, which changes every release.  
Reference CLI: `skillerr` @ **1.5.2**, a stable public API backed by 200 tests passing on every push (mac/Linux/Windows × Node 22/24), including an [adversarial security corpus](https://github.com/dot-skill/skillerr/wiki/Threat-Model) and a live-tested [transparency-log integration](./docs/TRANSPARENCY.md).  
Independent conforming implementations welcome.

**Why the foundation is future-proof:**

- The format is protocol-defined, not tied to this CLI — any conforming implementation can read/write it (see [RFCs](./docs/rfcs/) for how the spec evolves in the open)
- The `PermanenceAnchor` slot (`skill registry`, `--transparency`, `--keyless`) is an open extension point, not a required dependency: the wire format already reserves a `ledger` anchor kind alongside the shipped ones, so new anchor kinds can be added later without breaking existing packages
- Trust states are explicit and versioned in the manifest, so a package minted today stays verifiable under future trust-store/issuer/anchor changes instead of silently degrading

---

## Packages

| Package | Purpose |
|---------|---------|
| [`skillerr`](./packages/skillerr) | **Reference CLI** — bins `skill` / `skillerr` |
| [`@skillerr/cli`](./packages/cli) | CLI implementation |
| [`@skillerr/protocol`](./packages/protocol) | SkillContract, SkillSource, types |
| [`@skillerr/core`](./packages/core) | Compile, pack, validate, mint |
| [`@skillerr/runtime`](./packages/runtime) | Inspect / dry-run / execute |
| [`@skillerr/workspace`](./packages/workspace) | Local `.skill/` working tree |
| [`@skillerr/registry`](./packages/registry) | Optional local transparency log |

Host authors typically integrate the protocol libraries; end users install **`skillerr`** and talk to their agent.

---

## Documentation

**Before you run someone else's `.skill` file, read [What is verifiable](./docs/WHAT-IS-VERIFIABLE.md).** It states plainly what a signature does and doesn't prove — most trust confusion comes from skipping this.

- [CLI flow, start to finish](./docs/CLI-FLOW.md) · [Protocol](./docs/PROTOCOL.md) · [Agent](./docs/AGENT.md) · [Prompts](./examples/prompts.md)
- [Why structured packages](./docs/WHY.md) · [Continuity](./docs/CONTINUITY.md) · [Privacy](./docs/PRIVACY.md)
- [FAQ](./docs/FAQ.md) · [Roadmap](./docs/ROADMAP.md) · [Naming](https://github.com/dot-skill/skillerr/wiki/Naming)
- [Ingest a SKILL.md](./docs/FAQ.md#how-do-i-convert-an-existing-skillmd) · [From skill-creator](./docs/FROM-SKILL-CREATOR.md) · [Eval / benchmark](./docs/EVAL.md) · [Bundled scripts / resources](./docs/RESOURCES.md)
- [What is verifiable](./docs/WHAT-IS-VERIFIABLE.md) · [Trust model](./docs/TRUST-MODEL.md) · [Cryptographic foundation](./docs/CRYPTO-FOUNDATION.md) · [Transparency](./docs/TRANSPARENCY.md) · [Security](./docs/SECURITY.md) · [Threat model](https://github.com/dot-skill/skillerr/wiki/Threat-Model) · [Key ceremony](./docs/KEY-CEREMONY.md) · [Canonicalization (RFC 8785)](./docs/CANONICALIZATION.md)
- [Mint](./docs/MINT.md) · [Runtime](./docs/RUNTIME.md) · [Workspace](./docs/WORKSPACE.md) · [File type / OS registration](./docs/FILE-TYPE.md)
- [RFCs](./docs/rfcs/) — protocol design proposals, spec-only and implemented
- Site guides: [skillerr.com](https://www.skillerr.com/docs/)

**Agent Skills ecosystem:** [Agent Skills specification](https://agentskills.io/specification) (the authoring format) · [vercel-labs/skills](https://github.com/vercel-labs/skills) (`npx skills add`, distribution) · [skills.sh](https://skills.sh) (directory) · [Claude Code skills docs](https://code.claude.com/docs/en/skills)

---

## Contributing

Independent runtimes, language ports, adapters, and adversarial fixtures make this real — see the [second-runtime call in CONTRIBUTING.md](./CONTRIBUTING.md#wanted-a-second-independent-runtime).

- [CONTRIBUTING.md](./CONTRIBUTING.md) (dev setup, PR checklist) · [DCO.md](./DCO.md) (sign-off required)
- [GOVERNANCE.md](./GOVERNANCE.md) · [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)

---

## License

[MIT](./LICENSE) — Copyright (c) 2026 Bharat Dudeja
