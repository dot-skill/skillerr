# Workspace (git-like)

```text
.skill/
  config.json      # title, journey_summary, default_stage_all
  contract.json    # optional authored SkillContract (1.0 native semantics)
  sections/*.json  # agent-proposed units
  index.json       # staged ids
  HEAD.json        # last compile
  objects/*.skill
```

| git | skill |
|-----|-------|
| init | `skill init` |
| edit | `skill propose` (AI only) |
| author contract | `skill contract-init` + edit `.skill/contract.json` |
| add | `skill add` (default all) |
| status | `skill status` (+ completeness) |
| stash/WIP | `skill checkpoint` (continuity) |
| commit | `skill compile` (release) |
| tag/sign | `skill mint` |

No marketplace publish in the happy path — share the `.skill` file.

## Agent path

```bash
export SKILL_HOST=cursor
skill init --title "…"
skill journey --summary "…"
skill contract-init                       # scaffold .skill/contract.json, then fill it in
skill contract-check .skill/contract.json # completeness + field-specific fixes
skill propose --json '[…]'
skill checkpoint                 # handoff draft
skill compile -m "…" --approve --mint
```

## Contract authoring (`.skill/contract.json`)

A workspace compile only reaches the native contract path — the one that can
ever produce a **release** package — when `.skill/contract.json` exists,
parses as JSON, and has `kind: "skill_contract"` / `contract_version: "1.0"`.
Without
it, `compileWorkspace()` falls back to the legacy text-section adapter, which
is **continuity-only and lossy**: `skill compile --profile release` always
refuses with `missing: ["semantic_contract"]`.

This is deliberate, not an oversight: a workspace with no authored contract
has no structured semantics to release, and the protocol refuses to mint
something with unknown behavior rather than guess. `skill checkpoint`
(continuity) still works from text sections alone, but its
`compilation_report.issues` always carries an explicit entry — never a
silent gap:

- `contract_missing` — no `.skill/contract.json` was ever authored.
- `contract_unparsable` — the file exists but isn't valid JSON, or doesn't
  look like a `SkillContract` (wrong `kind`/`contract_version`). The report
  and the release refusal hint both include the concrete parse/shape error,
  so a broken authored contract is never silently treated the same as "no
  contract was ever intended."

Install: `npm i -g skillerr`
