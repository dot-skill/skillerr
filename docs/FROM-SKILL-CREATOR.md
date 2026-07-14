# From a skill-creator / `SKILL.md` folder to `.skill`

This is the exact mapping `skill ingest` performs, and exactly what's left for a human to do before the result can be a release. If you've built a Claude/skill-creator-style skill (`SKILL.md` plus optional `scripts/`, `references/`, `assets/`, `evals/evals.json`), this page tells you what happens to every part of it.

```text
Run these exact commands in your terminal, in order:

1. npm i -g skillerr          (skip if `skill --version` already works)
2. export SKILL_HOST=<your-tool-name>
3. skill ingest ./your-skill-folder -o out.skill

Then show me the output path and exactly what's still missing before it can
be a release. Don't invent contract fields to make it look more complete
than it is.
```

## The mapping

| Source | Maps to | Notes |
|---|---|---|
| Frontmatter `name` | `title` | Falls back to the body's first `#` heading, then the folder name, if absent — and says so in a note either way |
| Frontmatter `description` | `intent` | If absent, `intent` is empty and the note says triggers/intent need manual authoring |
| Description text | `triggers` | Heuristically split on a `"use when ..."`-style clause. Marked as a derived heuristic — review before release, don't assume it's exhaustive |
| `##` sections in the body | `knowledge` sections | One knowledge item per `##` heading, `sensitivity: shareable_redacted`, `authored_by: "agent"` |
| `scripts/*` | `resources/scripts/*` **and** one stub `exec`-class capability per script | The capability is created with `fallback: "ask_human"` and is **never auto-authorized to execute** — ingest cannot know what permission scope the script actually needs. See [RESOURCES.md](./RESOURCES.md) |
| `references/*` | `resources/references/*` | Progressive-disclosure load semantics (on-demand pointers) — see [RESOURCES.md](./RESOURCES.md) |
| `assets/*` | `assets/*` | Copied verbatim |
| `evals/evals.json` | `contract.verification.items` | Each assertion becomes a verification item; `check` defaults to `"human"` when the source doesn't specify one. A native eval/benchmark *run* (`skill eval`) is separate — see [EVAL.md](./EVAL.md) — ingest only maps the assertions, it doesn't run them |

Every one of these mappings is reported back to you in `report.found` / `report.notes` — `skill ingest`'s JSON output always says exactly what it found and what it guessed, never silently.

## What ingest never fabricates

`skill ingest` always produces a **continuity** draft, never a release. In every case observed, the one thing standing between an ingested draft and a release compile is `provenance.human_review`:

```json
{
  "field": "provenance.human_review",
  "message": "release requires recorded human semantic review",
  "fix": "Have a human review the contract and record actor, timestamp, scope, and preferably the reviewed digest. A CLI flag cannot create this evidence."
}
```

This is intentional, not a gap to work around. No amount of re-running `ingest` or passing a flag can manufacture this — a human (or, per the agent-first model throughout this repo, an agent acting with a human's explicit review) has to actually look at the mapped contract and record that review before `skill compile --profile release` will succeed. `skill compile` on an ingested draft without this **refuses** (`compile_refused`), it does not silently downgrade or fake completeness.

## After ingest

1. Review the output path's completeness report (`missing_for_release` in the JSON output, or `skill inspect ./out.skill` any time after).
2. Fix each named field — usually just recording human review, occasionally a `semantic_contract` gap if the source was too sparse to infer structure from.
3. Re-assess: `skill contract-check ./out.skill` (or re-run `skill compile --profile release --approve --mint` once ready).
4. If the bundled `scripts/*` need to actually execute, author real permissions for the stub capabilities ingest created — they start deny-by-default and stay that way until you explicitly scope them.

## Related

- [examples/ingest-skill-md/](../examples/ingest-skill-md/) — a worked example fixture (frontmatter, sections, one script, evals)
- [RESOURCES.md](./RESOURCES.md) — bundled-script and progressive-disclosure semantics in detail
- [EVAL.md](./EVAL.md) — running the mapped verification items as a real eval/benchmark
- [FAQ.md](./FAQ.md#how-do-i-convert-an-existing-skillmd) — the short version of this page
