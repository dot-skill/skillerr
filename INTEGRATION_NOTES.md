# Integration notes for `skillerr-registry`

This is the only handshake between this repo and the private `skillerr-registry` product. When a capability described in [`spec/CONTRACT.md`](./spec/CONTRACT.md) becomes available in `@skillerr/core`, it's noted here with the version that shipped it. The registry side reads this and upgrades its `@skillerr/core` pin when ready — this repo never reaches into `skillerr-registry` to wire itself in.

Newest first.

## ACTION REQUIRED — SessionSource APIs shipped, drop local `cli/session-sources.mjs`

Inference-free per-agent session intake is now in `@skillerr/core` (on the version below). The registry's temporary `cli/session-sources.mjs` scanners should be replaced with core calls.

**Pin:** `@skillerr/core@^1.7.0` (lockstep siblings).

**Swap to:**
- `listSessionCandidates({ cwd, from? })`
- `resolveSession({ cwd, from?, sessionId? })`
- `loadSessionContext(session)` → redacted `CaptureContext` (+ optional scrubbed `sessionFile` attach for the caller)
- `captureSession({ cwd, intent, from?, sessionId?, context? })` — when `from` / `sessionId` is set, core resolves + loads + merges under `context`, then always runs the git floor
- `normalizeSessionSourceId` / `normalizeResumeAgent` / `resumeAgentFromSessionSource` — `claude` ↔ `claude-code` (ResumeTarget still emits legacy `claude`; SessionSource ids are `claude-code` \| `codex` \| `cursor`)

**Drop** local store walkers once parity is proven against `skill capture --from claude-code|codex|cursor [--session <id>]`. Do not reintroduce registry URLs or product assumptions into core.

Also see the prior capture ACTION below if mocks for `captureSession` / resume still linger.

## ACTION REQUIRED — real session capture shipped, drop the mocks

The hollow `capture → resume` (empty payload, "_preview (Resume Contract pending)_" header) is fixed at the source. `@skillerr/core` now ships the **real** capture + resume surface — replace the mocks in `src/lib/core-adapter.ts` with the real imports.

**Now real in `@skillerr/core@1.6.0`:**
- `captureSession(opts): Promise<CaptureResult>` — the missing piece. Always runs git working-set capture from `opts.cwd` (branch, base/HEAD, staged+unstaged diff, changed files with `+adds -dels`, recent commits, untracked), so a dirty repo is **never** empty. Merges optional agent context over it. Returns `{ pkg (sealable continuity SkillPackageFiles), workingSet, journey, source, redaction, hasGit }`.
- `openContinuity`, `isContinuity`, `resumePreview` — real, over the actual payload (not stubs). `resumePreview` now returns the full Resume Contract 1.0 (workingSet, plan, nextSteps, decisions, rejectedPaths, openThreads, gaps, knowledge, filePointers, toolResults, resumeTargets).
- `renderResumeContract(contract): string` — paste-ready markdown briefing. **No "preview"/"pending" framing** — remove any client-side placeholder text; when fields are populated the renderer emits them.

**What `@skillerr/add` must do to fix the hollow capture** (the payload was empty because the client sent metadata only):
1. Either let core do the environment capture (call `captureSession({ cwd })` — it reads git itself), **or** if the client captures git itself, upload the full payload — the diff, file list, branch, base/HEAD, commits, untracked — not a one-line summary.
2. Accept richer agent context and pass it through as a `CaptureContext` (object, `--context <file.json>`, `-` for stdin, or an auto-loaded `.skillerr/context.json`). Intake schema (all fields optional, every string is scrubbed by core):
   ```ts
   interface CaptureContext {
     intent?: string; title?: string;
     agent?: { host?: string; provider?: string; model?: string; deployment?: string };
     journey?: { summary?: string; open_questions?: string[]; decisions?: string[] };
     plan?: Array<{ status: "todo" | "in_progress" | "done"; text: string }>;
     nextSteps?: string[]; rejectedPaths?: string[];
     openThreads?: string[];  // -> journey.open_questions
     decisions?: string[];    // -> journey.decisions
     knowledge?: Array<{ title: string; body: string; type?: string }>;
     filePointers?: Array<{ path: string; note?: string }>;
     toolResults?: Array<{ tool: string; summary: string }>;
   }
   ```
3. Upload **all** payload fields (don't truncate to metadata). Render/upload the Resume Contract 1.0 faithfully; drop the "Resume Contract pending" label.

Redaction (core's `scrub()`) removes secrets from the diff/strings but keeps the diff, file list, and journey — over-redaction is not the cause of an empty payload; a metadata-only upload was. Full shapes: [`spec/CONTRACT.md`](./spec/CONTRACT.md) §3a + [RFC 0009](./docs/rfcs/0009-resume-contract.md).

**Client-side, for Cursor to act on (not a core issue):** the npx cache was observed serving a stale `@skillerr/add@0.2.0`. Surface/pin the client version (print it, or `npx @skillerr/add@latest`) so users aren't silently on an old build with the mock capture.

This is also exposed in the reference CLI as `skill capture` / `skill resume` if useful as a reference implementation to diff against.

## Shipped in 1.6.0

The items below shipped in `@skillerr/core@1.6.0` (and lockstep sibling packages). Pin `^1.6.0` (or exact `1.6.0`) and drop the mocks.

**Adapter layer** (`packages/core/src/trust-spine.ts`), matching spec/CONTRACT.md's Section 3a shapes:
- `seal`, `openSealed`
- `sign`/`verifySignature` — published-key path only; keyless (Fulcio) signing not yet split out of the existing `mintKeylessAnchor` (real follow-up work, not a thin wrap)
- `Anchor`/`RekorAnchor` — delegates to the real, already-network-tested Rekor anchoring; subject metadata captured at construction time
- `capabilitiesFromPermission` (`CapabilitySchema`) — `shell` scope honestly empty pending a `@skillerr/protocol` change (no `commands` field exists yet)
- `evaluateReleaseProfile`
- `verify(digest, evidence)` — composes signature + inclusion-proof checks directly; `anchored`/`revocation` are caller-supplied pre-checked results (a `Commitment`/`RevocationRecord`'s real verification needs key-store context this generic function doesn't have). Never reports `verified: true` without at least one positive check, never lets a pass outweigh a fail.
- `generateSBOM` — real, minimal CycloneDX 1.5, built from `SkillManifest.dependencies` (no invented dependency graph)

**Merkle-log spine** (`packages/core/src/merkle-log.ts`): `buildLeaf`, `verifyInclusion`, `verifyConsistency`, plus the constructive counterparts a log host needs (`treeHash`, `generateInclusionProof`, `generateConsistencyProof`, `buildSignedTreeHead`) — a from-scratch RFC 6962-style Merkle tree, pure/standalone, no registry knowledge. Nothing existed for this before; treat it as the trust primitive most worth independent review given its role.

**Continuity surface** (`packages/core/src/capture.ts` + `continuity.ts`, [RFC 0009](./docs/rfcs/0009-resume-contract.md)): `captureSession` (the write side, git working-set capture + agent-context intake), `isContinuity`, `openContinuity`, `resumePreview`, `renderResumeContract` — Resume Contract 1.0. Built directly on real `provenance.journey`/`knowledge` and a `ContinuitySource` payload inside the existing `provenance/source.json`, not any invented file convention (differs from what `registry/continuity-surface`'s mock in `src/lib/core-adapter.ts` guessed — no "steps" array, no `continuity.json` file). `resumeTargets` deliberately uses this repo's own host-agnostic `skill load <path>`, never a product-specific install command. See the ACTION REQUIRED note above.

Relicensed to **Apache-2.0** (was MIT) — sole-author decision, see spec/CONTRACT.md's licensing note.

Not yet started: `attest`, `evaluatePolicy`, `scoreSignals`, `runSandboxed`'s declared-vs-actual diff, and the generic `fromFormat`/`toFormat` bridge — see spec/CONTRACT.md's status table for what each maps onto today.
