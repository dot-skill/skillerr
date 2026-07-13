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
