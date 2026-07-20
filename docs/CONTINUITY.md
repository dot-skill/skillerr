# Continuity — work context without private dumps

Developers switch models and hosts constantly. Chat exports leak secrets, PII, and noise. Continuity `.skill` files are the portable **source of truth for work context**.

## Checkpoint

```bash
export SKILL_HOST=cursor
skill journey --summary "Building OAuth; provider undecided; secrets as refs."
skill propose --json '[…sections…]'
skill checkpoint -m "auth WIP"
# → *.skill draft (compile_profile: continuity)
```

## Resume in another agent

```bash
skill load ./skl_….skill
```

The agent receives: intent, redacted journey, open questions, knowledge titles/bodies (scrubbed), completeness gaps, typed inputs — **not** raw transcripts or credentials.

## Rules

- Continuity may be **partial**; release may not.
- Continuity packages are **not mintable**.
- Default sensitivity: `shareable_redacted`.
- Never embed API keys, tokens, `.env`, or private customer data.

See [PRIVACY.md](./PRIVACY.md).

## Programmatic API: the continuity surface

A product embedding continuity resume (not just shelling out to `skill load`) uses `@skillerr/core`'s continuity surface directly ([RFC 0009](./rfcs/0009-resume-contract.md)):

```ts
import { isContinuity, openContinuity, resumePreview } from "@skillerr/core";

const opened = await openContinuity(zipBytes);   // throws on anything that isn't compile_profile: "continuity"
const resume = resumePreview(opened);            // Resume Contract 1.0
```

`openContinuity` reshapes a package's real `provenance.journey`/`provenance.source`/`knowledge` into a stable `ContinuityOpenResult` (intent, agent context, journey, `gaps` derived from open questions/decisions, knowledge, sections). `resumePreview` derives a **Resume Contract 1.0**: digest, intent, agent context, gaps, knowledge, and one resume target per agent (`cursor`/`claude`/`codex`), all using this repo's own host-agnostic `skill load <path> --into .` command — never a product-specific install URL, per the core/registry independence invariant in [spec/CONTRACT.md](../spec/CONTRACT.md). `isContinuity` alone is enough to gate a package before even opening it (`compile_profile === "continuity"`, mutually exclusive with being minted).
