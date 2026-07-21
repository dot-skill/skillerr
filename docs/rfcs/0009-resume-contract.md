# RFC 0009 — Resume Contract 1.0 (continuity capture + resume)

Status: **Implemented** — capture in `packages/core/src/capture.ts` (`captureSession`); read/resume in `packages/core/src/continuity.ts` (`isContinuity`, `openContinuity`, `resumePreview`, `renderResumeContract`). Tests in `capture.test.ts` + `continuity.test.ts`. See [spec/CONTRACT.md](../../spec/CONTRACT.md)'s status table.

## Motivation

Continuity `.skill` packages (`compile_profile: "continuity"`) are meant to let a receiving agent pick up a session where another left off. Two gaps made this hollow in practice:

1. **Nothing captured the actual work state.** A capture recorded a one-line journey and little else — no diff, no changed files, no branch, no plan — so a downstream "resume" surface (the private `skillerr-registry` product's Sessions/Handoffs lane being the concrete driver) materialized an empty briefing. Observed on prod: `capture → resume` produced six files whose payload was a single line ("Checkpoint captured: CLI capture (redacted metadata)"), no gaps, no knowledge, no working set, and a header reading *preview (Resume Contract pending)*. The root cause was that the real capture and render functions were never shipped in `@skillerr/core`; the client ran on mocks.

2. **No stable shape for "what a receiving agent must reconstruct."** Every product reinvented it. That's exactly the reusable, protocol-native primitive `@skillerr/core` should own once — see the [core/registry frozen contract](../../spec/CONTRACT.md).

This RFC ships both: a real **capture** (write) side that reads git + the working tree and never comes back empty in a dirty repo, and a stable **Resume Contract 1.0** (read side) plus a renderer that emits a substantive briefing.

## Proposal

### Capture (write side) — `captureSession`

`captureSession(opts): Promise<CaptureResult>` (`capture.ts`) has two intake paths, and **environment capture always runs**:

1. **Environment capture (automatic, zero cooperation).** Reads git in `opts.cwd` (default `process.cwd()`) and builds a `WorkingSet`: current branch, base (merge-base with upstream / `origin/HEAD` / `main` / `master`) and HEAD short SHAs, the staged+unstaged unified diff vs HEAD (`git diff HEAD`, size-capped and flagged when truncated), the changed-file list with per-file status and `+adds -dels` counts (`git status --porcelain` joined with `git diff --numstat HEAD`), recent commits (`git log`, subjects redacted), and untracked files. In a dirty repo this path alone yields a substantive payload. Outside a git repo, `hasGit` is `false` and the payload says so honestly rather than fabricating one.

2. **Agent-supplied context (richer, optional).** An agent passes structured context as a `CaptureContext` object, a path to a JSON file, `-` for stdin, or (when `opts.context` is omitted) an auto-discovered `.skillerr/context.json` under `cwd`. It's merged **over** the environment capture.

```ts
interface CaptureContext {
  intent?: string;
  title?: string;
  agent?: { host?: string; provider?: string; model?: string; deployment?: string };
  journey?: { summary?: string; open_questions?: string[]; decisions?: string[] };
  plan?: Array<{ status: "todo" | "in_progress" | "done"; text: string }>;
  nextSteps?: string[];
  rejectedPaths?: string[];   // approaches tried and abandoned
  openThreads?: string[];     // merged into journey.open_questions
  decisions?: string[];       // merged into journey.decisions
  knowledge?: Array<{ title: string; body: string; type?: KnowledgeItemType }>;
  filePointers?: Array<{ path: string; note?: string }>;
  toolResults?: Array<{ tool: string; summary: string }>;
}
```

**Merge rule**: scalars (`intent`, `title`, `agent`) — agent value wins; `journey.summary` — agent value else the git-derived summary. Array fields the git environment can't derive (`plan`, `nextSteps`, `rejectedPaths`, `knowledge`, `filePointers`, `toolResults`) are agent-only; `openThreads`/`decisions` union into the journey's `open_questions`/`decisions`.

The result is a sealable continuity `SkillPackageFiles` (`compile_profile: "continuity"`, `provenance_mode: "redacted"`, never mint-eligible) plus the structured pieces:

```ts
interface CaptureResult {
  pkg: SkillPackageFiles;   // ready for seal()/packSkill
  workingSet?: WorkingSet;
  journey: ContinuityJourney;
  source: ContinuitySource;
  redaction: RedactionReport;
  hasGit: boolean;
}
```

### The continuity payload — `ContinuitySource`

Written into the existing `provenance.source` slot (typed `unknown` at the protocol level — "scrubbed SkillSource or product source"). **Fully additive**: no new `.skill` container entry, no new `SkillManifest` field, just a documented structure inside `provenance/source.json`:

```ts
interface ContinuitySource {
  kind: "continuity_source";
  agent?: AgentContextSummary;
  workingSet?: WorkingSet;      // branch, baseSha, headSha, dirty, files[], diff, diffTruncated, commits[], untracked[]
  plan?: PlanItem[];
  nextSteps?: string[];
  rejectedPaths?: string[];
  filePointers?: FilePointer[];
  toolResults?: ToolResult[];
}
```

### Redaction must not eat the substance

The diff, every commit subject, and every agent-supplied string are run through `@skillerr/core`'s deterministic scrubber (`scrub()`, [docs/SCRUBBING.md](../SCRUBBING.md)) in one batched pass (so "same secret → same placeholder" holds across them). Redaction replaces **secrets only** (keys/tokens/credentials → `{{redacted:…}}`) and never removes the diff, the file list, or the journey. This is enforced by a test: a capture whose diff contains both a real secret and real code changes must, after redaction, still carry the code changes and the file list while the secret is scrubbed, and the secret must not appear anywhere in the sealed package.

### Resume Contract 1.0 (read side) — `resumePreview` + `renderResumeContract`

`openContinuity(zip)` unpacks, refuses anything that isn't `compile_profile: "continuity"`, and reshapes the sealed payload (journey → gaps, knowledge → sections, plus the `ContinuitySource` fields) into a `ContinuityOpenResult`. `resumePreview(opened)` derives the stable contract:

```ts
interface ResumeContract {
  version: "1.0";
  digest: string;
  intent?: string;
  agentContext: AgentContextSummary;
  workingSet?: WorkingSet;
  plan?: PlanItem[];
  nextSteps: string[];
  decisions: string[];       // resolved, carried forward
  rejectedPaths: string[];   // tried and abandoned
  openThreads: string[];     // unresolved, for the next agent
  gaps: Gap[];               // open_questions (warn) + decisions (info), tagged
  knowledge: KnowledgeItem[];
  filePointers: FilePointer[];
  toolResults: ToolResult[];
  resumeTargets: Array<{ agent: "cursor" | "claude" | "codex"; label: string; command: string }>;
}
```

`renderResumeContract(contract)` turns it into a paste-ready markdown briefing: intent, agent context, working-set summary with changed files / untracked / recent commits / a fenced redacted diff, plan, next steps, decisions, tried-and-abandoned, open threads, key files, notable tool results, and knowledge. It emits **no** "preview"/"pending" framing — when a field is populated it renders it, when a section is genuinely empty it is omitted (never shown as a placeholder), so a real capture never renders as a hollow header.

`resumeTargets` deliberately uses this repo's own host-agnostic `skill load <path> --into .` (see [docs/CLI-FLOW.md](../CLI-FLOW.md)) for every agent, `<path>` left as a placeholder — never a product-specific install command. This is the core/registry independence invariant: `@skillerr/core` has no way to know a registry's URL scheme, and a product wanting a branded one-liner composes it from `resumeTargets` + its own download URL.

### Gap severity

`journey.open_questions` → `kind: "open_question"`, `severity: "warn"` (unresolved). `journey.decisions` → `kind: "decision"`, `severity: "info"` (resolved context). No `"block"` severity is emitted yet — see Open questions.

## Schema diff

Purely additive. New exported functions (`captureSession`, `renderResumeContract`) and types (`CaptureContext`, `CaptureResult`, `CaptureOptions`, `WorkingSet`, `ContinuitySource`, `PlanItem`, `FilePointer`, `ToolResult`, and the expanded `ContinuityOpenResult`/`ResumeContract`) in `@skillerr/core`. No change to the `.skill` container format, `SkillManifest`, or `JourneyProvenance`; the payload lives inside the existing `provenance/source.json`.

## Migration

Nothing to migrate. Existing continuity packages open unchanged (the new `ContinuityOpenResult` fields are just absent when a package predates capture). Packages produced by the old one-line capture still open; they simply carry less.

## Fixtures

`capture.test.ts` builds a **real throwaway git repo** (staged + unstaged changes, two commits, an untracked file) and runs the real `captureSession` — no mocked working set — asserting the diff, files, branch, and commits are populated and non-trivial; that a clean repo is honestly clean; that outside git it says so; that agent context merges over the environment capture carrying both; that `.skillerr/context.json` is auto-loaded; the redaction-preserves-substance case (Section above); and the full `capture → seal → openContinuity → renderResumeContract` round trip, asserting the briefing contains the working-set summary, file refs, and next steps, and contains **no** preview/pending framing. `continuity.test.ts` covers the read side against a hand-built real package.

## Open questions

- **Gap severity beyond warn/info**: promoting some open questions to `"block"` would need a new optional field on the payload or a heuristic; not designed yet.
- **Richer per-agent resume commands**: `resumeTargets` is the same generic `skill load` for every agent because that's genuinely all that exists today. **SessionSource** (`session-source.ts`) now covers inference-free *capture* intake from `claude-code` \| `codex` \| `cursor` local stores; per-tool *resume materialization* adapters remain a separate ROADMAP effort.
- **Journey timeline fidelity**: an agent-run capture can supply a richer action/decision/tool-result timeline than the git-derived work-state timeline; this RFC specifies the intake for it (`CaptureContext.journey`, `toolResults`) but doesn't mandate a particular timeline granularity. SessionSource heuristics fill a subset from jsonl without a model call.
