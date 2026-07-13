# skillerr

<p align="center">
  <img src="https://raw.githubusercontent.com/dot-skill/skillerr/main/assets/skillerr-banner.png" alt=".skill — identity, instructions, capabilities, seal, and assets inside a portable skill package" width="100%" />
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/dot-skill/skillerr/main/assets/skillerr-mark.png" alt="Skillerr .skill mark" width="128" height="128" />
</p>

<p align="center"><em>Sealed <code>.skill</code> packages for AI agents — reference CLI for the Open <code>.skill</code> Protocol</em></p>

**The integrity + evaluation layer for AI skills.** Your `SKILL.md` still works — `.skill` seals it, scores it, and makes it portable and inspectable before anyone runs it.

You install once. Then you **point your AI** at `skillerr`. The agent creates, inspects, hands off, and dry-runs skills; you review and approve releases.

**Bin:** `skill` · **Site:** [skillerr.com](https://dot-skill.github.io/skillerr-com/) · **Format:** `.skill` · **Repo:** [dot-skill/skillerr](https://github.com/dot-skill/skillerr) · **License:** MIT

[![npm](https://img.shields.io/npm/v/skillerr.svg)](https://www.npmjs.com/package/skillerr)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../../LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

A `.skill` is a sealed ZIP: typed inputs, workflow, pinned knowledge, redacted provenance, integrity digests, and optional mint + eval/score. Inspect TrustView before anything runs.

Plain markdown skills lose structure, integrity, and portability across hosts. The `.skill` format fixes that with one inspectable artifact, without asking you to abandon `SKILL.md` — see [WHY.md](../../docs/WHY.md).

Already have a `SKILL.md`? `skill ingest ./your-skill` upgrades it in one command — see [FAQ.md](../../docs/FAQ.md#how-do-i-convert-an-existing-skillmd).

---

## Install once

```bash
npm i -g skillerr
```

Node ≥ 20. One-shot: `npx -y skillerr --help`.

---

## Talk to your AI

Paste into Cursor / ChatGPT / Claude / Codex (or any agent with shell tools):

**Create from this chat**

```text
Run these exact commands in your terminal, in order:

1. npm i -g skillerr          (skip if `skill --version` already works)
2. export SKILL_HOST=cursor   (replace "cursor" with your actual tool name)

Then, from this conversation, create a portable .skill with a redacted journey
and exact sections I approved (secrets as {{refs}}). Checkpoint for handoff, or
compile --approve --mint when release-complete. Do not invent filler. Show
status and the output path.
```

**Inspect before run**

```text
Inspect ./file.skill TrustView without executing. Validate, then dry-run.
Summarize trust warnings. Do not execute for real unless I ask.
```

**Load a handoff**

```text
Load ./handoff.skill as continuity context. Summarize intent, gaps, and knowledge.
Resume the work; do not mint an incomplete release.
```

More prompts: [examples/prompts.md](../../examples/prompts.md). Agent rules: [AGENT.md](../../docs/AGENT.md).

---

## What your agent will do

| Goal | Agent runs |
|------|------------|
| Create | `skill init` → `journey` → `propose` → `status` |
| Handoff | `skill checkpoint` |
| Release | `skill compile -m "…" --approve --mint` |
| Trust | `skill inspect --trust` → `validate` → `run` (dry-run) |
| Resume | `skill load ./file.skill` |

`SKILL_HOST` is required when creating (`cursor`, `ollama`, `claude`, `codex`, …). Prefer `SKILL_AGENT_INVOCATION=1`. Never use denylisted hosts (`human`, `cli`, `shell`, `manual`, …).

---

## Trust before run

Digests and seals are visible without execution. Prefer inspect → validate → dry-run. Default mint is **development-only** HMAC; a configured Ed25519 issuer key mints as `verified_issuer` instead — see [KEY-CEREMONY.md](../../docs/KEY-CEREMONY.md).

---

## Documentation

- [Protocol](../../docs/PROTOCOL.md) · [Agent](../../docs/AGENT.md) · [Prompts](../../examples/prompts.md)
- [Eval / benchmark](../../docs/EVAL.md) · [Bundled scripts](../../docs/RESOURCES.md) · [FAQ](../../docs/FAQ.md)
- [Security](../../docs/SECURITY.md) · [Threat model](../../docs/THREAT-MODEL.md) · [skillerr.com](https://dot-skill.github.io/skillerr-com/)

End users install **`skillerr`**. Host authors integrate `@skillerr/*` libraries or an independent conforming implementation.

---

## License

[MIT](./LICENSE) — Copyright (c) 2026 Bharat Dudeja
