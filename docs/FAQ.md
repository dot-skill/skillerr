# FAQ

## What is the `.skill` Protocol?

An open format for **portable AI skills**: typed inputs, workflow, pinned knowledge, redacted journey provenance, optional token usage, integrity digests, and mint attestation. Home: [skillerr.com](https://dot-skill.github.io/skillerr-com/).

## How do I use Skillerr?

Install the reference CLI once, then **talk to your AI** — paste a prompt that points the agent at create, inspect, load, or handoff. You review and approve releases; the agent runs the tooling.

```bash
npm i -g skillerr
```

Prompts: [examples/prompts.md](../examples/prompts.md). Agent contract: [AGENT.md](./AGENT.md).

## How is this different from `SKILL.md`?

See [WHY.md](./WHY.md). Short version: structured package + digests + mint + continuity handoff + compile gates. Markdown is a lossy adapter only.

## Continuity vs release?

- **Continuity** — AI↔AI work handoff (partial OK, not mintable).
- **Release** — complete reusable skill or `compile_refused`.

## How do I create a skill?

Ask your agent. Set `SKILL_HOST`, then the agent runs `init` → `propose` → `checkpoint` or `compile --approve --mint`. Prefer exact human-approved section bodies. See [AGENT.md](./AGENT.md).

## How do I ingest or run a skill?

Ask your agent to inspect first, then validate, then dry-run:

```text
Inspect ./file.skill TrustView without executing. Validate, then dry-run.
Summarize trust warnings. Do not execute for real unless I ask.
```

What the agent runs: `skill inspect` → `validate` → `run` (dry-run by default).

## How is agent authorship represented?

Creation requires a declared agent host (`SKILL_HOST`). Humans review, stage, and approve. The reference implementation records this as self-reported provenance; it is not proof that a particular model authored the content.

## Where do I publish?

Share the `.skill` file directly. An optional local transparency log is included (`skill registry …`). Hosted registries are out of scope for this protocol.

## Do I need a blockchain?

**No.**

## Is npm free for these packages?

Yes — public install is unscoped `skillerr` (no org required). Install: `npm i -g skillerr`.

## Claude Desktop claims `.skill` on macOS — is that Skillerr?

**No, and you don't have to choose.** On macOS, Claude Desktop may register the `.skill` extension for its own **Agent Skills** format (a zip with `SKILL.md` inside). Skillerr `.skill` files are a different sealed package — same extension, different format — but Skillerr is built to sit **above** `SKILL.md`, not compete with it: run `skill ingest ./your-skill-folder` and an existing Claude/skill-creator skill becomes a sealed, typed, integrity-checked Skillerr superset in one command. `SKILL.md` still works everywhere it always did; `.skill` adds digests, mint, trust states, and (once evaluated) a portable score receipt on top of it. See [How do I convert an existing SKILL.md?](#how-do-i-convert-an-existing-skillmd) below.

**What to do:** Use the CLI (`skill inspect ./file.skill`) or your AI agent to identify a file you didn't create yourself. In Finder, use **Open With** → your editor or terminal instead of double-clicking if the wrong app opens. Do not assume every `.skill` file is Claude-native or Skillerr-native without inspecting.

## How do I convert an existing SKILL.md?

```text
Run: npm i -g skillerr (skip if `skill --version` already works), then
export SKILL_HOST=<your-tool-name>. I have a SKILL.md at ./SKILL.md (or a
skill-creator folder) — run `skill ingest` on it into a portable .skill.
Show me the output path and what's still missing before it can be a
release. Don't invent contract fields.
```

`skill ingest <path> [-o out.skill]` reads a `SKILL.md` file or a
skill-creator-style folder (`SKILL.md` + optional `scripts/`, `references/`,
`assets/`, `evals/evals.json`) and produces a **continuity** `.skill` —
frontmatter maps to intent/triggers, `##` sections become knowledge, bundled
scripts become stub capabilities (never auto-authorized to execute), and
`evals/evals.json` assertions map into the contract's verification items.
It never fabricates completeness: the output always names exactly which
fields (usually just recorded human review) still need attention before a
release compile. See [examples/ingest-skill-md/](../examples/ingest-skill-md/)
for a worked example.

**Determinism:** `skill_id` is derived from the SKILL.md content itself
(a digest of the raw file), so re-ingesting byte-identical source always
produces the same `skill_id` — it's a stable identity for "this source",
not a fresh instance id per run. The overall `package_digest` is **not**
identical across repeated ingests of the same source, because each ingest
records its own real `created_at` timestamp in provenance — that's
accurate provenance (this ingest genuinely happened now), not
non-determinism to fix. If you need byte-identical output for testing,
pass a fixed clock via the `now` option to `ingestSkillMd()` (core API;
not exposed as a CLI flag).

## Is this production-final?

Public **draft** (0.5.0). Reference mint HMAC is **development-only** — replace with real keys in production issuers. Digests and inspect-before-run are real; do not treat the bundled signer as production identity proof.
