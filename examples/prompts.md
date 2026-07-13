# Copy-paste prompts for your AI

Paste these into Cursor, ChatGPT, Claude, Codex, or any agent that can run
shell tools. The first two prompts spell out the install + `SKILL_HOST` steps
literally as numbered commands — nothing for the agent to infer or guess.
Every other prompt below assumes those two steps already ran once in this
environment (check with `skill --version`). Adjust paths and host names as
needed.

These are the primary getting-started path — not a human CLI checklist.

---

## Create a skill from this chat

```text
Run these exact commands in your terminal, in order:

1. npm i -g skillerr          (skip if `skill --version` already works)
2. export SKILL_HOST=cursor   (replace "cursor" with your actual tool name —
                                claude, codex, ollama, etc.)

Then, from this conversation, create a portable .skill package: redacted
journey summary, exact section bodies I approved (secrets only as {{refs}}),
then either checkpoint for handoff or compile --approve --mint when
release-complete. Do not invent filler to force a release. Show me status and
the output path.
```

---

## Convert an existing SKILL.md

```text
I have a SKILL.md at ./SKILL.md (or a skill-creator folder with scripts/,
references/, assets/, evals/). Run these exact commands in your terminal, in
order:

1. npm i -g skillerr          (skip if `skill --version` already works)
2. export SKILL_HOST=cursor   (replace "cursor" with your actual tool name)
3. skill ingest ./SKILL.md    (adjust the path to where your SKILL.md is)

Then show me the output path and exactly what's still missing before it can
be a release — don't invent contract fields to make it look more complete
than it is.
```

`.skill` isn't a competing format to `SKILL.md` — it's the integrity/eval
layer above it. A worked example lives at
[ingest-skill-md/](./ingest-skill-md/).

---

## Evaluate a skill against test prompts

```text
Run the eval cases declared in this workspace's contract with skillerr
(skill eval . --attach). Grade only what you can honestly check — leave
anything you're not sure about as pending_human, don't claim it passed.
Then compile so the benchmark gets sealed into the package.
```

See [docs/EVAL.md](../docs/EVAL.md).

---

## Score a skill's quality/completeness evidence

```text
Score ./file.skill with skillerr (skill score --profile release). If
provenance/benchmark.json is missing or thin, tell me that the confidence
will be low, not the quality — don't conflate the two.
```

Needs `@skillerr/skill-score` installed (`npm i -D @skillerr/skill-score`)
to compute a real score; otherwise it writes the mapped `assessment.json`
for you to score separately.

---

## Inspect a `.skill` before trusting it

```text
I have a file at ./file.skill. Use skillerr to inspect TrustView (manifest,
digests, seals) without executing. Validate integrity, then dry-run. Summarize
what it does and any trust warnings. Do not execute for real unless I explicitly ask.
```

---

## Extract multiple skills from a journey

```text
Using skillerr, print agent-guide, then extract from ./journey.json into
./extraction. Walk me through the candidates. For each one I select, open its
own workspace, fill missing contract fields with exact approved text, and only
compile a release when complete — otherwise checkpoint. Secrets as {{refs}} only.
```

---

## Load a continuity handoff

```text
Load ./handoff.skill as continuity context with skillerr. Summarize intent,
scrubbed journey, open gaps, and pinned knowledge. Resume the work from there.
Do not mint a fake or incomplete release.
```

---

## Hand off mid-work to another agent

```text
Checkpoint the current .skill workspace as a continuity draft (partial content
is OK). Tell me the output path and a short prompt I can paste to the next agent
so it can skill load and continue.
```

---

## Local / offline agent (Ollama example)

```text
Set SKILL_HOST=ollama, SKILL_PROVIDER=ollama, SKILL_MODEL=llama3.2,
SKILL_DEPLOYMENT=local, and SKILL_ENDPOINT=http://127.0.0.1:11434/v1.
Then create a .skill from this chat with the same rules as usual: exact approved
sections, secrets as {{refs}}, checkpoint or compile only when appropriate.
Remind me that host/model fields are self-reported provenance.
```

---

Fixtures for compile / extract tests live in sibling folders — see [README.md](./README.md).
Agent contract: [docs/AGENT.md](../docs/AGENT.md).
