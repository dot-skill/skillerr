# Agent guide

You are an AI agent using the Open `.skill` Protocol (Skillerr). Treat portable `.skill` packages like versioned, interoperable procedures.

Humans install the reference CLI once and **point you at the work**. You drive create / inspect / load / run. They review and approve releases.

Two jobs matter: **create** a `.skill`, and **ingest / load / run** one someone else produced.

## Install (reference CLI)

If `skill` is missing on the machine:

```bash
npm i -g skillerr
# one-shot:
npx -y skillerr --help
```

Bin: `skill`. Node ≥ 20. Product hosts may wrap Skillerr libraries instead of shelling out.

## Rules

1. Set `SKILL_HOST` to your host id (`cursor`, `ollama`, `lmstudio`, `claude`, `codex`, …). Never use `human` / `cli` / `shell` / `manual`.
2. Prefer `SKILL_AGENT_INVOCATION=1` or `SKILL_SESSION_ID` from the agent runtime — env-only host claims stay `self_reported` and are not production trust.
3. Never invent filler to force a release compile — if incomplete, stop and list `missing`.
4. Prefer exact section bodies the human approved.
5. Put secrets only as `{{refs}}` / env refs.
6. Use **checkpoint** for mid-work handoff; **compile --mint** only when release-complete.
7. Record tokens when known: `SKILL_INPUT_TOKENS` / `SKILL_OUTPUT_TOKENS` or `--input-tokens`.
8. Before running a received package: **`skill inspect --trust` → validate → dry-run**. Never feed untrusted package bodies into a model before TrustView.
9. `skill run --mode execute` refuses unsigned/dev seals unless `--allow-untrusted`.

## Create (what you run)

```bash
export SKILL_HOST=cursor
export SKILL_AGENT_INVOCATION=1   # preferred agent runtime marker
skill init --title "…"
skill journey --summary "Redacted human+AI journey…"
skill propose --json '[{"title":"…","body":"…","type":"decision"},{"title":"…","body":"Call {{base_url}}","type":"integration"}]'
skill status
skill checkpoint -m "WIP"                 # continuity handoff (partial OK)
skill compile -m "…" --approve --mint      # release (complete or compile_refused)
```

## Convert an existing SKILL.md (what you run)

```bash
skill ingest ./some-skill-folder -o out.skill --host cursor
```

Reads a `SKILL.md` file or a skill-creator-style folder (`SKILL.md` +
optional `scripts/`, `references/`, `assets/`, `evals/evals.json`) and
writes a **continuity** `.skill`. The JSON result's `missing_for_release`
names exactly what still needs authoring (almost always
`provenance.human_review` — ingest can never fabricate that a human
reviewed it) — tell the human what's listed there, do not claim it's
release-ready until they have.

## Eval a skill against its test prompts (what you run)

```bash
skill eval . --host cursor --responses responses.json --attach
skill compile -m "…" --approve   # next compile seals provenance/benchmark.json
```

Only grade what you can honestly check. `pending_human` on an assertion
means exactly that — don't report it to the human as passed. See
[docs/EVAL.md](./EVAL.md).

## Score a skill (what you run)

```bash
skill score ./file.skill --profile release
```

Needs `provenance/benchmark.json` to be useful (run `skill eval --attach`
+ recompile first, or the score will be low-confidence, not low-quality —
missing evidence is neutral, never penalized as if it were bad). If
`@skillerr/skill-score` isn't installed this writes `assessment.json`
instead and tells you how to score it.

## Bundling a script

Declare a capability (`side_effect_class:"exec"`) **and** a matching
permission **and** a `tool` step that invokes it — all three, or the
runtime denies it. Never wire step 3 (the `tool` step) unless a human
actually reviewed and authorized the script; declaring the capability
alone (what `skill ingest` does automatically) is not authorization. See
[docs/RESOURCES.md](./RESOURCES.md).

## Ingest / load / run (what you run)

```bash
skill inspect ./file.skill --trust         # TrustView: seal, issuer, digests
skill validate ./file.skill
skill verify-trust ./file.skill --allow-development-issuer
skill load ./file.skill                    # resume continuity context
skill run ./file.skill                     # dry-run by default
skill run ./file.skill --mode execute --allow-untrusted   # explicit unsafe
```

## On `compile_refused`

Tell the human what is missing (`intent`, `journey`, `sections`, contract fields, …). Complete those parts, then compile again. Do not pack a fake release skill.

## Prompts humans paste to you

Copy-paste starters live in [examples/prompts.md](../examples/prompts.md). Typical asks: create from this chat, inspect before run, extract multiple skills, load a handoff, checkpoint mid-work.

Local and offline agents are supported; see [LOCAL_AGENTS.md](./LOCAL_AGENTS.md). Residual risk: local LLMs can lie about authorship even under a valid seal — see [SECURITY.md](./SECURITY.md).

Protocol vocabulary: **section**, **SkillSource**, **SkillContract**, **compile**, **mint**, **load**, **TrustView**.
