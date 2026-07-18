# The CLI flow, start to finish

One page mapping every stage of the `.skill` lifecycle in order, so an agent
(or a human) can see the whole shape before diving into any single command's
docs. **This page shows the shape of the flow, not the definitive flag list**:
commands gain flags across releases, but `skill --help` and
`skill <command> --help` always match the exact binary installed, cost far
less context to load than a doc, and need no network fetch. Prefer them over
memorizing examples here. `skill agent-guide` prints this same flow as
structured JSON (`--json`) or plain text, from the CLI itself.

There are three entry points into this flow. Pick the one that matches what
you actually have.

## Entry point A: nothing yet, create from a conversation

```bash
export SKILL_HOST=<your-host-id>          # required for every create/mint step
skill init --title "…"
skill journey --summary "Redacted human+AI journey…"
skill propose --json '[{"title":"…","body":"…","type":"decision|integration|…"}]'
skill status                              # inspect completeness / what's missing
```

From here, either:
- **Mid-work, not done yet:** `skill checkpoint -m "WIP"` (a continuity draft, partial is fine).
- **Complete, ready to seal:** continue at [Sealing a release](#sealing-a-release-mint--publish) below.

Multiple distinct skills in one conversation? Start with `skill agent-guide`'s
"Identify → propose multiple skills" section: one workspace per skill, never
merged.

## Entry point B: an existing SKILL.md or skill-creator folder

```bash
skill ingest ./some-skill-folder -o out.skill --host <your-host-id>
skill load out.skill --into ./ws --host <your-host-id>
```

`skill ingest` never produces a release, only a **continuity** draft, it can
map frontmatter, sections, bundled scripts, and evals, but it can never
fabricate that a human reviewed the result. `skill load <file> --into <dir>`
(new: previously `skill load` was read-only) materializes that draft into an
editable workspace: it stages the mapped knowledge as sections and writes
`./ws/.skill/contract.json`.

At this point **a human reviews the contract** and records that review by
editing `./ws/.skill/contract.json`, setting `provenance.human_review` to
something like `{"status":"reviewed","actor":"<you>","at":"<ISO
timestamp>","scope":["contract","knowledge"]}`. No CLI flag can do this for
you, that is the entire point of the field. Then continue at
[Sealing a release](#sealing-a-release-mint--publish).

Plain `skill load ./out.skill` (no `--into`, and not run inside a workspace)
stays a **read-only preview**: intent, journey, knowledge titles, gaps, never
raw transcripts. Useful for a quick look before deciding whether to
materialize it.

See [FROM-SKILL-CREATOR.md](./FROM-SKILL-CREATOR.md) for the full field-by-field
mapping, and [AGENT-SKILLS.md](./AGENT-SKILLS.md) for round-tripping back out
into a plain Agent Skills folder (`skill export-skill`).

## Entry point C: a `.skill` file someone else gave you

```bash
skill inspect ./file.skill --trust        # seal, issuer, digests, no execution
skill validate ./file.skill               # structure + hash integrity
skill verify-trust ./file.skill           # trust_state, any public anchors
skill run ./file.skill                    # dry-run by default, always safe
```

**Never feed an unverified package body to a model before TrustView.**
Execute mode (`skill run --mode execute`) refuses unsigned or development-only
seals unless you explicitly pass `--allow-untrusted`, on purpose, see
[TRUST-MODEL.md](./TRUST-MODEL.md) for exactly what each `trust_state` does
and does not let through.

Got a plain (never-sealed) Agent Skills folder instead of a `.skill` file, e.g.
from `npx skills add`? Use `skill verify-skill <dir>` instead, see
[AGENT-SKILLS.md](./AGENT-SKILLS.md).

## Sealing a release: mint + publish

Once a workspace is complete and a human has recorded review:

```bash
skill compile -m "reviewed" --approve --mint --profile release
```

This **refuses** (`compile_refused`) if anything required is still missing,
it never fakes completeness. `--mint` seals it in the same step; without
`--mint`, seal separately with `skill mint`.

By default this seals with the bundled zero-setup public-dev key
(`trust_state: development`, local iteration only, never production trust).
For real cryptographic identity, `skill keygen` + `skill mint --signer-key
<pem>` earns `verified_issuer` trust, provided the mint also carries real
agent-runtime evidence, not just `SKILL_HOST`. See
[KEY-CEREMONY.md](./KEY-CEREMONY.md).

Want a public, independently-verifiable provenance URL for this release?

```bash
skill publish <file.skill>
```

Seals (if not already minted) and anchors the digest to the public Sigstore
Rekor transparency log, then prints a `search.sigstore.dev` URL anyone can
check independently. **Zero setup**: the public log needs a signing key but
no login, so a per-user key auto-provisions on first use
(`~/.skillerr/issuer-key.pem`, pinned in your own trust store) if none is
configured. Rekor entries are permanent and world-readable, never publish a
secret skill. This is a public provenance anchor, not a marketplace. See
[TRANSPARENCY.md](./TRANSPARENCY.md), [MINT.md](./MINT.md), and
[CRYPTO-FOUNDATION.md](./CRYPTO-FOUNDATION.md).

## The whole shape, one diagram

```text
create from scratch ──┐
                       ├─→ workspace ──→ [human records review] ──→ release compile
ingest a SKILL.md ─────┘   (init/load)         (edit contract.json)      (--mint)
                                                                              │
                                                                              ▼
                                                                    skill publish (optional)
                                                                    → public provenance URL

a .skill someone gave you ──→ inspect --trust → validate → verify-trust → run (dry-run/execute)
```

## Everything else

- `skill --help`: the full command list, one screen.
- `skill <command> --help`: that command's exact current flags.
- `skill agent-guide [--json]`: this same flow, printed by the CLI itself, useful when a doc fetch isn't available.
- [AGENT.md](./AGENT.md): the agent contract, rules, what to refuse, prompts humans paste.
- [WORKSPACE.md](./WORKSPACE.md): what a `.skill/` workspace actually contains.
- [WHAT-IS-VERIFIABLE.md](./WHAT-IS-VERIFIABLE.md): read this before trusting a `.skill` someone else gave you.
