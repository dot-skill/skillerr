# Continuity — work context without private dumps

Developers switch models and hosts constantly. Chat exports leak secrets, PII, and noise. Continuity `.skill` files are the portable **source of truth for work context**.

## Capture a session (git-aware, one command)

```bash
skill capture -o handoff.skill -m "Debugging the write-path race"
```

`skill capture` reads git + the working tree of the current directory and seals a continuity `.skill` with a real **working set**: branch, base/HEAD, the staged+unstaged diff (secrets scrubbed, code kept), the changed-file list with `+adds -dels`, recent commits, and untracked files. In a dirty repo this is never empty — no agent cooperation required. Secrets in the diff are replaced with `{{redacted:…}}` placeholders; the diff, file list, and journey are preserved.

An agent can enrich the capture with structured context — intent, plan/todo, decisions, rejected paths, open threads, knowledge, tool results — via a JSON file, `-` for stdin, or an auto-loaded `.skillerr/context.json`:

```bash
skill capture -o handoff.skill --context .skillerr/context.json
```

See [AGENT.md](./AGENT.md) for the exact `CaptureContext` intake schema an agent supplies.

## SessionSource — inference-free agent store intake

On top of the git floor, `@skillerr/core` can read **local agent session stores** without calling a model:

| Source id | Typical roots (best-effort) |
|-----------|-----------------------------|
| `claude-code` (alias: `claude`) | `{cwd}/.claude`, `~/.claude/projects/<slug>/`, `~/.config/claude` |
| `codex` | `{cwd}/.codex`, `~/.codex/sessions` |
| `cursor` | `{cwd}/.cursor`, `~/.cursor/projects/<slug>/agent-transcripts` |

```bash
skill capture -o handoff.skill --from claude-code
skill capture -o handoff.skill --from cursor --session <id>
```

Programmatic surface: `listSessionCandidates` → `resolveSession` → `loadSessionContext` → merge into `captureSession({ from, sessionId, context })`. Ambiguous dual-source picks (different hosts, close mtimes) fail closed until you pass `from` or `sessionId`. No session found still captures the git floor. Secrets in session lines are scrubbed via protocol `scrub()` (including optional attach bytes).

**ResumeTarget agent ids** in `resumePreview` remain the legacy short forms (`cursor` \| `claude` \| `codex`). SessionSource uses canonical `claude-code`. Use `normalizeSessionSourceId` / `resumeAgentFromSessionSource` at boundaries — do not drop `claude` without a deprecation path.

## Resume a session

```bash
skill resume ./handoff.skill          # paste-ready briefing (Resume Contract 1.0)
skill resume ./handoff.skill --json   # the structured contract instead
```

The briefing carries the working-set summary, changed files, plan, next steps, decisions, tried-and-abandoned paths, open threads, and knowledge — everything a receiving agent needs to continue, with **no** "preview/pending" placeholder framing. To take a continuity package forward into an editable workspace and on to a signed release instead of just reading it, use `skill load` (see [CLI-FLOW.md](./CLI-FLOW.md)):

```bash
skill load ./handoff.skill --into ./workspace
```

Either way the agent receives intent, redacted journey, open questions, knowledge (scrubbed), and gaps — **not** raw transcripts or credentials.

## Rules

- Continuity may be **partial**; release may not.
- Continuity packages are **not mintable**.
- Default sensitivity: `shareable_redacted`.
- Never embed API keys, tokens, `.env`, or private customer data.

See [PRIVACY.md](./PRIVACY.md).

## Programmatic API: the continuity surface

A product embedding capture/resume (not just shelling out) uses `@skillerr/core`'s continuity surface directly ([RFC 0009](./rfcs/0009-resume-contract.md)):

```ts
import { captureSession, seal, openContinuity, resumePreview, renderResumeContract } from "@skillerr/core";

// Write side: git working set + optional agent context -> sealable package.
const { pkg, workingSet, redaction, hasGit } = await captureSession({
  cwd: process.cwd(),
  intent: "Debugging the write-path race",
  context: { plan: [...], decisions: [...], nextSteps: [...] }, // optional CaptureContext
});
const sealed = await seal(pkg);

// Read side.
const opened = await openContinuity(sealed.zip);   // throws on anything that isn't compile_profile: "continuity"
const contract = resumePreview(opened);            // Resume Contract 1.0
const briefing = renderResumeContract(contract);   // paste-ready markdown, no preview/pending framing
```

`captureSession` always runs environment (git) capture and merges any agent context over it (see [AGENT.md](./AGENT.md) for the `CaptureContext` schema); pass `from` / `sessionId` to also pull inference-free SessionSource enrichment from local agent stores. The working set + journey it produces are the substance a resume needs. `openContinuity` reshapes a package's real `provenance.journey`/`provenance.source`/`knowledge` into a stable `ContinuityOpenResult` (intent, agent context, journey, working set, plan, gaps, knowledge, sections). `resumePreview` derives **Resume Contract 1.0**: digest, intent, agent context, working set, plan, next steps, decisions, rejected paths, open threads, gaps, knowledge, file pointers, tool results, and one resume target per agent (`cursor`/`claude`/`codex`) — all using this repo's own host-agnostic `skill load <path> --into .` command, never a product-specific install URL, per the core/registry independence invariant in [spec/CONTRACT.md](../spec/CONTRACT.md). `isContinuity` alone is enough to gate a package before opening it (`compile_profile === "continuity"`, mutually exclusive with being minted).
