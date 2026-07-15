# Open `.skill` Protocol

<p align="center">
  <img src="./assets/skillerr-mark.png" alt="Skillerr .skill mark" width="128" height="128" />
</p>

<p align="center"><em>Sealed <code>.skill</code> packages for AI agents</em></p>

**Create, inspect, and run portable `.skill` packages for AI agents — typed, sealed, and verifiable before anyone runs them.** Your `SKILL.md` still works — `.skill` seals it, scores it, and makes it portable and inspectable before anyone runs it.

**Site:** [skillerr.com](https://www.skillerr.com/docs/) · **Format:** `.skill` (sealed ZIP) · **Reference CLI:** [`skillerr`](https://www.npmjs.com/package/skillerr) (`skill`) · **Repo:** [dot-skill/skillerr](https://github.com/dot-skill/skillerr)

[![npm](https://img.shields.io/npm/v/skillerr.svg)](https://www.npmjs.com/package/skillerr)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![Protocol](https://img.shields.io/badge/protocol-1.0.0-blue.svg)](./docs/PROTOCOL.md)
[![Tests](https://img.shields.io/badge/tests-180%20passing-brightgreen.svg)](./docs/SECURITY.md)

## Convert your `SKILL.md` in one line

Already have a `SKILL.md` or a skill-creator folder? `.skill` isn't a
competing format — it's the integrity layer on top. One command upgrades it,
and it never claims completeness it can't back up. Paste this to your agent —
it names every command literally, nothing to guess:

```text
Run these exact commands in your terminal, in order:

1. npm i -g skillerr          (skip if `skill --version` already works)
2. export SKILL_HOST=cursor   (replace "cursor" with your actual tool name —
                                claude-code, codex, ollama, etc.)
3. skill ingest ./SKILL.md    (adjust the path if your SKILL.md lives elsewhere)

Then show me the output path and exactly what's still missing before it can be
a release. Don't invent contract fields to make it look more complete than it is.
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
that can run shell tools. The two prompts above (convert / create) spell out
the install + `SKILL_HOST` steps explicitly since they're usually the first
thing you paste. The prompts below assume you already ran those two steps
once in this environment — if `skill --version` fails, run `npm i -g
skillerr` and `export SKILL_HOST=<your-tool-name>` first.

New to the vocabulary the prompts use? "Journey" is the redacted record of
what you and the agent did; "checkpoint" is a partial, in-progress save
(continuity draft); "release-complete" means every required contract field
is filled in and human-reviewed, not just "looks done." The output either
way is a sealed `.skill` file, not a chat export.

### Create a skill from this chat

```text
Run these exact commands in your terminal, in order:

1. npm i -g skillerr          (skip if `skill --version` already works)
2. export SKILL_HOST=cursor   (replace "cursor" with your actual tool name —
                                claude-code, codex, ollama, etc.)

Then, from this conversation, create a portable .skill: redacted journey, exact
sections I approved (secrets only as {{refs}}), then either checkpoint for
handoff or compile --approve --mint when release-complete. Do not invent filler.
Show me status and the output path.
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
| Mid-work handoff | `skill checkpoint` |
| Release when complete | `skill compile -m "…" --approve --mint` |
| Trust before run | `skill inspect --trust` → `validate` → `run` (dry-run) |
| Resume handoff | `skill load ./file.skill` |

Creation requires a declared agent host (`SKILL_HOST=cursor|ollama|claude|…`). Humans review and approve releases. Declared host/model fields are self-reported provenance, not cryptographic proof of authorship.

---

## What good looks like

- **Inspect first** — digests and seals without executing (`skill inspect --trust`)
- **Validate** structure and hash integrity
- **Dry-run** before execute
- Continuity drafts may be incomplete; **release** compile refuses incomplete contracts (`compile_refused`)
- **Real cryptographic identity in production:** `skill keygen` + `--signer-key` mints with a configured Ed25519 issuer key as `verified_issuer` — the bundled zero-setup key (used when no `--signer-key` is given) is for trying the CLI, not for shipping. See [Key Ceremony](https://github.com/dot-skill/skillerr/wiki/Key-Ceremony)

See [docs/SECURITY.md](./docs/SECURITY.md).

| | Continuity draft | Release skill |
|---|---|---|
| Purpose | AI↔AI work handoff | Reusable sealed procedure |
| Incomplete? | Allowed (lists gaps) | **compile_refused** |
| Mint? | No | Yes |

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

Specification: **1.0.0 (Stable)** ([docs/PROTOCOL.md](./docs/PROTOCOL.md)) — future changes go through the open [RFC process](https://github.com/dot-skill/skillerr/wiki/RFCs), not silent revisions.  
Reference CLI: `skillerr` @ **1.1.0**, a stable public API backed by 180 tests passing on every push (mac/Linux/Windows × Node 22/24), including an [adversarial security corpus](https://github.com/dot-skill/skillerr/wiki/Threat-Model) and a live-tested [transparency-log integration](./docs/TRANSPARENCY.md).  
Independent conforming implementations welcome.

**Why the format doesn't lock you in:**

- The format is protocol-defined, not tied to this CLI — any conforming implementation can read/write it (see [RFCs](https://github.com/dot-skill/skillerr/wiki/RFCs) for how the spec evolves in the open)
- The optional permanence-anchor slot (`skill registry`) is an extension point, not a required dependency — new anchor kinds can be added later without breaking existing packages
- Trust states are explicit and versioned in the manifest, so a package minted today stays verifiable under future trust-store/issuer changes instead of silently degrading

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

- [Protocol](./docs/PROTOCOL.md) · [Agent](./docs/AGENT.md) · [Prompts](./examples/prompts.md)
- [Why structured packages](./docs/WHY.md) · [Continuity](./docs/CONTINUITY.md) · [Privacy](./docs/PRIVACY.md)
- [FAQ](./docs/FAQ.md) · [Roadmap](./docs/ROADMAP.md) · [Naming](https://github.com/dot-skill/skillerr/wiki/Naming)
- [Ingest a SKILL.md](./docs/FAQ.md#how-do-i-convert-an-existing-skillmd) · [From skill-creator](./docs/FROM-SKILL-CREATOR.md) · [Eval / benchmark](./docs/EVAL.md) · [Bundled scripts / resources](./docs/RESOURCES.md)
- [What is verifiable](./docs/WHAT-IS-VERIFIABLE.md) · [Trust model](./docs/TRUST-MODEL.md) · [Transparency](./docs/TRANSPARENCY.md) · [Security](./docs/SECURITY.md) · [Threat model](https://github.com/dot-skill/skillerr/wiki/Threat-Model) · [Key ceremony](https://github.com/dot-skill/skillerr/wiki/Key-Ceremony) · [Canonicalization (RFC 8785)](./docs/CANONICALIZATION.md)
- [Mint](./docs/MINT.md) · [Runtime](./docs/RUNTIME.md) · [Workspace](./docs/WORKSPACE.md) · [File type / OS registration](./docs/FILE-TYPE.md)
- [RFCs](https://github.com/dot-skill/skillerr/wiki/RFCs) — protocol design proposals, spec-only and implemented
- Site guides: [skillerr.com](https://www.skillerr.com/docs/)

---

## Contributing

Independent runtimes, language ports, adapters, and adversarial fixtures make this real — see the [second-runtime call in CONTRIBUTING.md](./CONTRIBUTING.md#wanted-a-second-independent-runtime).

- [CONTRIBUTING.md](./CONTRIBUTING.md) (dev setup, PR checklist) · [DCO.md](./DCO.md) (sign-off required)
- [GOVERNANCE.md](./GOVERNANCE.md) · [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)

---

## License

[MIT](./LICENSE) — Copyright (c) 2026 Bharat Dudeja
