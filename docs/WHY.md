# Structured `.skill` packages

**Your `SKILL.md` still works.** Skillerr is not a competing skill format to
replace it — it's the integrity and evaluation layer *above* it. Run
`skill ingest ./your-skill` and a Claude/skill-creator skill becomes a
sealed, typed `.skill` superset in one command (see
[FAQ.md](./FAQ.md#how-do-i-convert-an-existing-skillmd)). Everything below
describes what that superset adds — none of it requires abandoning
`SKILL.md` as your authoring format.

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
