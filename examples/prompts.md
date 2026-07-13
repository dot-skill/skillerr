# Copy-paste prompts for your AI

Install once (`npm i -g skillerr`), then paste these into Cursor, ChatGPT, Claude, Codex, or any agent that can run shell tools. Adjust paths and host names as needed.

These are the primary getting-started path — not a human CLI checklist.

---

## Create a skill from this chat

```text
Install skillerr if needed (`npm i -g skillerr`). Set SKILL_HOST to your host id
(e.g. cursor, claude, codex, ollama). From this conversation, create a portable
.skill package: redacted journey summary, exact section bodies I approved
(secrets only as {{refs}}), then either checkpoint for handoff or
compile --approve --mint when release-complete. Do not invent filler to force a
release. Show me status and the output path.
```

---

## Convert an existing SKILL.md

```text
I have a SKILL.md at ./SKILL.md (or a skill-creator folder with scripts/,
references/, assets/, evals/). Install skillerr if needed (npm i -g skillerr),
set SKILL_HOST, then use `skill ingest` to convert it into a portable .skill.
Show me the output path and exactly what's still missing before it can be a
release — don't invent contract fields to make it look more complete than it is.
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
