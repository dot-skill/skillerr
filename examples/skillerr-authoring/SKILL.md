---
name: skillerr-authoring
description: >
  Use this skill when a user asks you to create, author, or package a
  .skill file, wants to turn a piece of knowledge or a procedure into a
  reusable skill, or asks how skillerr's authoring flow works. This is the
  front door — it walks you through the whole path from a conversation to
  a minted, sealed .skill without hand-writing the contract JSON yourself.
license: MIT
---

# Authoring a `.skill`

Hand-authoring a full `SkillContract` from scratch is real work — fourteen
declarations, each one either filled in or explicitly marked absent. That
weight is exactly why this skill exists: you don't fill it in by staring
at the schema, you fill it in by having a normal conversation and letting
the CLI turn your answers into structure. Treat everything below as a
loose interview script, not a checklist to recite at the user.

## Before you start

```bash
npm i -g skillerr        # once, ever
export SKILL_HOST=cursor # or claude-code, codex, ollama, … whatever you are
skill init --title "…"   # once per skill, creates .skill/
```

`SKILL_HOST` matters more than it looks — it's the agent-provenance
declaration this whole protocol hangs off of. Never set it to `human`,
`cli`, `shell`, or `manual`; those are denylisted precisely so a human
can't accidentally mint something as if an agent authored it.

Already have a `SKILL.md` or a skill-creator folder instead of starting
from a conversation? Don't retype it — `skill ingest <path>` does this
whole front door for you and lands you straight at the "fill what's
missing" step. See [docs/FAQ.md](../../docs/FAQ.md#how-do-i-convert-an-existing-skillmd).

## The interview

Ask the user about their skill the way you'd ask a colleague to explain
something they know well, not the way you'd fill out a form. You're
listening for:

- **What is this, in one sentence, and when should it fire?** This becomes
  `intent` and `triggers`. If they say "use this when X, Y, or Z," each
  clause is a candidate trigger — don't collapse them into one.
- **What does it need to know before it can run?** Typed `inputs` — name,
  a real JSON Schema, whether it's required, and whether it's sensitive
  enough to need `sensitivity: "secret"` (never let a secret's raw value
  end up in a section body — a `{{secret_name}}` reference only).
- **What does it actually do, step by step?** This becomes `steps`. Prefer
  concrete `instruct` steps over vague ones — "call the deploy API with
  the reviewed changelog" beats "deploy the thing."
- **Does it touch anything outside itself?** Network calls, file writes,
  bundled scripts (see [docs/RESOURCES.md](../../docs/RESOURCES.md)) —
  each one needs a `capability` **and** a matching `permission` before the
  runtime will ever let it run. If nothing external happens, `capabilities`
  and `permissions` are both honestly `"none"`.
- **What would "this worked" look like?** `verification` assertions.
  `check:"human"` is a completely legitimate answer when there's no
  automatic way to check — better than an assertion nobody can actually
  verify.
- **What should never happen?** `forbidden_actions`, if any come up.

You don't need every answer before moving on — a partial contract compiles
fine as a **continuity** draft. Only a **release** compile (the one that
can be minted) refuses when something is left ambiguous.

## Scaffold, then fill

```bash
skill contract-init                              # writes .skill/contract.json
skill contract-check .skill/contract.json         # what's still missing, in plain terms
```

Edit `.skill/contract.json` directly with what you learned in the
interview, then re-run `contract-check` until it reports complete. Every
field is either `{"status":"specified","items":[...]}` or an explicit
`{"status":"none"|"not_applicable","reason":"..."}` — there's no "just
leave it blank," and that's deliberate: an omitted field and a field
someone thought about and declared empty are different claims, and this
protocol never lets the first one impersonate the second.

## Propose the knowledge itself

Anything with real prose — background, a worked example, a style
guide — becomes a section:

```bash
skill propose --title "…" --body "…"
skill add
```

Use the user's actual words where they gave you actual words. This
protocol's whole stance on fidelity is: an agent may organize and
structure, but shouldn't silently rewrite what a human said and call it
the same thing.

## Evaluate it (optional, but worth doing before you mint)

If the user gave you concrete example prompts and what a good response
looks like, add them as `contract.evals` (see
[docs/EVAL.md](../../docs/EVAL.md)) and run:

```bash
skill eval . --attach
```

This never fabricates a pass — anything it can't mechanically check comes
back `pending_human`, which is exactly what it should say when nobody's
actually looked yet.

## Human review — the one step that can't be automated

```bash
skill checkpoint -m "ready for review"   # handoff, if a human isn't right here
```

or, if a human is reviewing right now, once they've actually read the
contract:

```bash
skill compile -m "…" --approve --profile release
```

`compile --approve` only marks *inputs and permissions* as approved — it
does **not** and cannot manufacture `provenance.human_review`. That field
needs a real actor, a real timestamp, and a real scope, because it's a
claim about something that actually happened, not something a flag can
assert into existence. If `contract-check` still lists
`provenance.human_review`, that means what it says: nobody has reviewed
this yet.

## Mint

Once release compile succeeds:

```bash
skill mint --host cursor
```

This is the point of no casual return — minting seals the package with a
creation attestation. The default seal is public-dev HMAC, which is
honest, zero-config, and explicitly `trust_state=development` — never
production trust. For a real production issuer key, see
[Key Ceremony](../../docs/KEY-CEREMONY.md).

## Look at what you made

```bash
skill inspect --trust
```

This is the same lens anyone receiving this `.skill` file will use before
they trust it — seal, issuer, digests, trust state, all without executing
anything or feeding the package body to a model. If something about the
trust label surprises you, it should surprise the recipient too; that's
the point.

## What "done" looks like

An agent that followed this skill start to finish produced a `.skill`
file without ever hand-writing the contract JSON from a blank page — the
CLI scaffolded it, `contract-check` told you exactly what was left at
every step, and the only things a human had to do by hand were the things
that genuinely require a human: reviewing the contract and, if the
capabilities need it, granting consent at execute time.
