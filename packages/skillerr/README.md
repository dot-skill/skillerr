# skillerr

<p align="center">
  <img src="https://raw.githubusercontent.com/dot-skill/skillerr/main/assets/skillerr-banner.png" alt=".skill — identity, instructions, capabilities, seal, and assets inside a portable skill package" width="100%" />
</p>

<p align="center">
  <img src="./assets/skillerr-mark.png" alt="Skillerr .skill mark" width="128" height="128" />
</p>

<p align="center"><strong>Skillerr</strong></p>
<p align="center"><em>Sealed <code>.skill</code> packages for AI agents</em></p>

Reference CLI for **Skillerr** — portable `.skill` packages for AI agents.

You install once. Then you **point your AI** at Skillerr. The agent creates, inspects, hands off, and dry-runs skills; you review and approve releases.

**Bin:** `skill` · **Site:** [skillerr.com](https://skillerr.com) · **Format:** `.skill` · **Repo:** [dot-skill/skillerr](https://github.com/dot-skill/skillerr) · **License:** MIT

[![npm](https://img.shields.io/npm/v/skillerr.svg)](https://www.npmjs.com/package/skillerr)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../../LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

A `.skill` is a sealed ZIP: typed inputs, workflow, pinned knowledge, redacted provenance, integrity digests, and optional mint. Inspect TrustView before anything runs.

Plain markdown skills lose structure, integrity, and portability across hosts. Skillerr fixes that with one inspectable artifact. See [WHY.md](../../docs/WHY.md).

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
Install skillerr if needed. Set SKILL_HOST to your host id. From this conversation,
create a portable .skill with a redacted journey and exact sections I approved
(secrets as {{refs}}). Checkpoint for handoff, or compile --approve --mint when
release-complete. Do not invent filler. Show status and the output path.
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

Digests and seals are visible without execution. Prefer inspect → validate → dry-run. Reference mint HMAC is **development-only**.

---

## Documentation

- [Protocol](../../docs/PROTOCOL.md) · [Agent](../../docs/AGENT.md) · [Prompts](../../examples/prompts.md)
- [Security](../../docs/SECURITY.md) · [skillerr.com](https://skillerr.com)

End users install **`skillerr`**. Host authors integrate `@skillerr/*` libraries or an independent conforming implementation.

---

## License

[MIT](./LICENSE) — Copyright (c) 2026 Bharat Dudeja
