# The trust layer for Agent Skills

**Your `SKILL.md` still works.** skillerr is not a competing authoring
format, it's the trust layer that sits above the one you already use. Run
`skill ingest ./your-skill` and a standard Agent Skills folder becomes a
sealed, typed `.skill` superset in one command (see
[FAQ.md](./FAQ.md#how-do-i-convert-an-existing-skillmd)). Everything below
describes what that superset adds, none of it requires abandoning
`SKILL.md` as your authoring format.

## Where this fits in the Agent Skills ecosystem

Three layers, three separate concerns:

| Layer | Job | Example |
|---|---|---|
| Authoring | Define what a skill *is*: frontmatter, body, `scripts/`/`references`/`assets/` | [Agent Skills spec](https://agentskills.io/specification), `SKILL.md` |
| Distribution | Get a skill onto your machine | [`vercel-labs/skills`](https://github.com/vercel-labs/skills), [skills.sh](https://skills.sh) |
| Trust / integrity | Seal it, sign it, record provenance, let you inspect it before you run it | **skillerr** |

`npx skills add owner/repo` installs unverified instructions and executable scripts from any repo, with no integrity or provenance check. skillerr is the missing verification step: inspect and verify a skill before you run it, not after. **Agent Skills / `SKILL.md`** is the open authoring format; **`.skill`** is a sealed, signed package of one, not a replacement for it.

Markdown `SKILL.md` files do not provide package structure, integrity metadata, or portable execution semantics.

| Limitation of `.md` skills | How `.skill` helps |
|---|---|
| Unstructured prose — every model re-interprets | Typed **workflow** + **knowledge** + **inputs** |
| No integrity | SHA-256 `package_digest` |
| Quiet edits go unnoticed | **Mint** + CreationAttestation (declared agent host) |
| Secrets end up in the file | Secret **refs** only; redaction on compile |
| Switching hosts loses context | **Continuity draft** `.skill` is the handoff object |
| Thin fake skills ship easily | **Release compile refuses** if required parts missing |
| No cost trail | Optional **generation_usage** (tokens) sealed at mint |
| No upgrade path from an existing `SKILL.md` skill | `skill ingest` — one command, never fabricates completeness |

## Two profiles

1. **`continuity`** — handoff between agents. Partial OK. Privacy-scrubbed journey. Not mintable.
2. **`release`** — reusable sealed skill. Complete or **compile_refused**. Then mint.

## Agent provenance

Creating a `.skill` requires declared agent provenance
(`SKILL_HOST=cursor|ollama|lmstudio|claude|…`). Humans **review / stage /
approve**. Host and model fields are self-reported unless a deployment adds a
trusted external signer.

## Inspect before run

Digests and seals are visible with `skill inspect` / `skill verify-trust`
without executing the skill. Prefer dry-run before execute.
