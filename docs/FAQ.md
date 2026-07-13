# FAQ

## What is the `.skill` Protocol?

An open format for **portable AI skills**: typed inputs, workflow, pinned knowledge, redacted journey provenance, optional token usage, integrity digests, and mint attestation. Home: [skillerr.com](https://skillerr.com).

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

## Is this production-final?

Public **draft** (0.5.0). Reference mint HMAC is **development-only** — replace with real keys in production issuers. Digests and inspect-before-run are real; do not treat the bundled signer as production identity proof.
