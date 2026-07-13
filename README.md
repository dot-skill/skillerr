# Skillerr

Open protocol and portable `.skill` format for AI skills.

Conforming **hosts** (AI apps, agents, IDEs) implement the Skillerr specification.
The **`skillerr`** CLI is the **reference implementation** for validation, inspection,
compile, and run.

**Site:** [skillerr.com](https://skillerr.com) · **Artifact:** `.skill` (sealed ZIP) · **Reference CLI:** [`skillerr`](https://www.npmjs.com/package/skillerr) (`skill`)

[![npm](https://img.shields.io/npm/v/skillerr.svg)](https://www.npmjs.com/package/skillerr)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![Protocol](https://img.shields.io/badge/protocol-0.5.0_draft-orange.svg)](./docs/PROTOCOL.md)

## Status

Specification: Draft **0.5.0** ([docs/PROTOCOL.md](./docs/PROTOCOL.md))  
Reference CLI: `skillerr`  
Independent conforming implementations welcome.

Why implement: portable packages with typed I/O, workflow, redacted provenance, integrity digests, optional mint, TrustView-before-execute, and continuity handoffs. Why not markdown alone? → [docs/WHY.md](./docs/WHY.md)

---

## Reference CLI

```bash
npm i -g skillerr
```

Then: `skill --help`. Node ≥ 20. One-shot: `npx -y skillerr --help`. Host authors typically integrate the Skillerr protocol libraries (schemas, compile, runtime) instead of — or in addition to — the CLI.

```bash
export SKILL_HOST=cursor   # required when creating
```

1. Ask your AI agent to create a skill (agents must set `SKILL_HOST`).
2. Review with `skill status`.
3. Hand off with `skill checkpoint`, or seal with `skill compile -m "…" --approve --mint`.
4. Before trusting a file: `skill inspect` → `skill validate` → `skill run` (dry-run by default).

---

## Quickstart

### Create

```bash
export SKILL_HOST=cursor          # ollama | lmstudio | claude | codex | …
export SKILL_MODEL=…              # optional

skill init --title "Demo"
skill journey --summary "Human+AI built a short-answer API client; secrets as refs."
skill propose --json '[
  {"title":"Tone","body":"Keep answers short.","type":"decision"},
  {"title":"API","body":"POST {{base_url}}/v1","type":"integration"}
]'
skill status
skill checkpoint                  # continuity draft → hand off to another AI
# when complete:
skill compile -m "Demo" --approve --mint
```

### Ingest / run

```bash
skill inspect ./file.skill        # manifest, digests, seals — no execution
skill validate ./file.skill
skill verify-trust ./file.skill
skill load ./file.skill           # resume continuity context
skill run ./file.skill            # dry-run by default
```

---

## For agents

Treat portable `.skill` packages like git for interoperable skills. Full guide: [docs/AGENT.md](./docs/AGENT.md).

**Rules:** set `SKILL_HOST`; prefer exact human-approved section bodies; secrets only as `{{refs}}`; checkpoint for handoff; compile+mint only when release-complete; never invent filler to force a release.

Creation records **declared** agent provenance (`SKILL_HOST`) — self-reported context, not cryptographic proof. Humans review and approve release compilation.

---

## Continuity vs release

| | Continuity draft | Release skill |
|---|---|---|
| Purpose | AI↔AI work handoff | Reusable sealed procedure |
| Incomplete? | Allowed (lists gaps) | **compile_refused** |
| Mint? | No | Yes |
| Privacy | Redacted journey, secret refs | Same + attestation |

Details: [CONTINUITY.md](./docs/CONTINUITY.md) · [PRIVACY.md](./docs/PRIVACY.md)

---

## What’s in a `.skill`

```text
example.skill
├── skill.json           # manifest, digests, profile, completeness
├── workflow.json        # runnable steps
├── knowledge/           # pinned decisions / rules
├── provenance/          # redacted journey + generation_usage (tokens)
└── signatures/          # mint attestation (release)
```

Markdown is a **lossy adapter only** (`skill to-skill-md`).

---

## Trust before run

- **Inspect first** — digests and seals without running the skill.
- **Validate** structure and hash integrity.
- **Dry-run** before execute.
- Reference mint HMAC in this repo is **development-only** — not production identity proof.

See [docs/SECURITY.md](./docs/SECURITY.md).

---

## Packages

| Package / path | Purpose |
|----------------|---------|
| [`skillerr`](./packages/skillerr) | **Reference CLI** — bin `skill` |
| [`packages/cli`](./packages/cli) | CLI implementation |
| [`packages/protocol`](./packages/protocol) | SkillContract, SkillSource, types |
| [`packages/core`](./packages/core) | Compile, pack, validate, mint |
| [`packages/runtime`](./packages/runtime) | Inspect / dry-run / execute |
| [`packages/workspace`](./packages/workspace) | Local `.skill/` working tree |
| [`packages/registry`](./packages/registry) | Optional local transparency log |

From this repository root:

```bash
npm i && npm run build && npm link -w skillerr
```

Publishing: [docs/PUBLISHING.md](./docs/PUBLISHING.md)

---

## Documentation

- [Protocol](./docs/PROTOCOL.md) · [Agent](./docs/AGENT.md) · [Workspace](./docs/WORKSPACE.md)
- [Why structured packages](./docs/WHY.md) · [Continuity](./docs/CONTINUITY.md) · [Privacy](./docs/PRIVACY.md)
- [Local agents](./docs/LOCAL_AGENTS.md) · [Mint](./docs/MINT.md) · [Runtime](./docs/RUNTIME.md) · [FAQ](./docs/FAQ.md) · [Roadmap](./docs/ROADMAP.md)

---

## Contributing

Independent runtimes, language ports, adapters, and adversarial fixtures make this real.

- [CONTRIBUTING.md](./CONTRIBUTING.md) · [DCO.md](./DCO.md) (sign-off required)
- [GOVERNANCE.md](./GOVERNANCE.md) · [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)

```bash
npm test
```

---

## License

[MIT](./LICENSE) — Copyright (c) 2026 Bharat Dudeja
