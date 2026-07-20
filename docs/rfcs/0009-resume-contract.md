# RFC 0009 — Resume Contract 1.0 (continuity surface)

Status: **Implemented** — `packages/core/src/continuity.ts` (`isContinuity`, `openContinuity`, `resumePreview`), tests in `continuity.test.ts`. See [spec/CONTRACT.md](../../spec/CONTRACT.md)'s status table.

## Motivation

Continuity `.skill` packages (`compile_profile: "continuity"`) already carry everything a receiving agent needs to pick up a session where it left off: a redacted journey (`provenance.journey`), staged knowledge, and agent context — but nothing in `@skillerr/core` exposed that in one stable, host-agnostic shape. Every product that wanted a "resume this session" feature (the private `skillerr-registry` product's Sessions/Handoffs surface being the concrete driver) had to reach into a package's internals itself, re-deciding what counts as a continuity package versus a release, and re-inventing its own notion of "what a receiving agent needs to reconstruct" independently. That's exactly the kind of reusable, protocol-native primitive `@skillerr/core` exists to own once, not something every downstream product should reimplement — see the [core/registry frozen contract](../../spec/CONTRACT.md)'s framing.

## Proposal

Three functions, `packages/core/src/continuity.ts`:

- **`isContinuity(pkg: { manifest: SkillManifest } | SkillManifest): boolean`** — `manifest.compile_profile === "continuity"`. Sufficient on its own: `mintSkillPackage` (`mint.ts`) requires `compile_profile === "release"` to mint at all, so `"continuity"` and "minted" are already mutually exclusive by construction — no separate mint-status check needed, and no continuity package can ever pass as a minted release.

- **`openContinuity(zip): Promise<ContinuityOpenResult>`** — unpacks the archive (`unpackSkill`), refuses (throws) anything that isn't `isContinuity`, and reshapes the real, already-typed continuity data into a stable contract shape:

  ```ts
  interface ContinuityOpenResult {
    manifest: SkillManifest;
    digest: string;           // sha256:..., manifest.package_digest
    profile: "continuity";
    agentContext: Partial<Pick<AgentContext, "host" | "provider" | "model" | "deployment">>;
    intent?: string;
    journey: { summary: string; open_questions: string[]; decisions: string[] };
    gaps: Gap[];               // journey.open_questions + journey.decisions, tagged and severity-scored
    knowledge: KnowledgeItem[];
    sections: ContinuitySection[]; // knowledge reshaped to {id, title, body}
  }
  ```

  Built directly from `provenance.journey` (a real, already-typed `JourneyProvenance` — `{summary, open_questions?, decisions?, redacted, sensitivity}`, not `unknown`) and `provenance.source` (typed `unknown` at the protocol level, since it's "scrubbed SkillSource or product source"; `openContinuity` reads `.agent` off it defensively). No new file convention, no new manifest fields — this is a read-only reshape of data continuity packages already carry.

  `agentContext` fields are optional (`Partial`), not defaulted to a placeholder string: a `provenance_mode: "proof_only"` continuity package genuinely has no recoverable agent context, and representing that honestly (absent) is preferred over fabricating a fallback value, consistent with this repo's "never fabricate provenance" discipline elsewhere (e.g. `skill load`'s own "never fabricates human review").

- **`resumePreview(pkg: ContinuityOpenResult): ResumeContract`** — pure, synchronous (everything it needs is already in `pkg`, no further I/O):

  ```ts
  interface ResumeContract {
    version: "1.0";
    digest: string;
    intent?: string;
    agentContext: AgentContextSummary;
    gaps: Gap[];
    knowledge: KnowledgeItem[];
    resumeTargets: Array<{ agent: "cursor" | "claude" | "codex"; label: string; command: string }>;
  }
  ```

  `resumeTargets` deliberately uses this repo's own, already-real, already-host-agnostic `skill load <path> --into .` (see [docs/CLI-FLOW.md](../CLI-FLOW.md)) as the command for every agent, with `<path>` left as a placeholder for the caller to substitute — never a product-specific install command (e.g. a registry's own `npx <package> <id>` convention). This is a direct consequence of the core/registry independence invariant: `@skillerr/core` has no way to know a registry's URL scheme, and baking one in would be exactly the kind of coupling [spec/CONTRACT.md](../../spec/CONTRACT.md) forbids. A product wanting a branded one-liner composes it on its own side from this contract's `resumeTargets` + its own download URL.

### Gap severity

`journey.open_questions` become `kind: "open_question"`, `severity: "warn"` (unresolved, needs a decision). `journey.decisions` become `kind: "decision"`, `severity: "info"` (already resolved, informational context for the resuming agent). No `"block"` severity is emitted by this version — nothing in a continuity package's current shape distinguishes a merely-open question from one that should actually block resuming; that's a real gap, tracked in Open Questions below.

## Schema diff

Purely additive: three new exported functions and their result types in `@skillerr/core`. No change to the `.skill` container format, `SkillManifest`, or `JourneyProvenance` — continuity packages already carried everything this reads.

## Migration

Nothing to migrate. Existing continuity packages (already compiled, already packed) work with `openContinuity` unchanged; nothing about how continuity packages are produced changes.

## Fixtures

Covered by `packages/core/src/continuity.test.ts`: a hand-built real continuity `SkillPackageFiles` (real `packSkill`/`unpackSkill` round trip, not a mock) exercising `isContinuity`'s true/false cases, `openContinuity`'s reshape of journey into gaps with correct severities, its refusal of a release-profile package, its honest handling of missing/absent provenance (`proof_only`-style), and `resumePreview`'s derivation — including an explicit assertion that no resume target ever contains a registry hostname or product-specific install command.

## Open questions

- **Gap severity beyond warn/info**: should some open questions be promotable to `"block"` (e.g. an explicitly-flagged blocking decision)? Nothing in `JourneyProvenance` currently distinguishes this; would need either a new optional field there or a heuristic, neither designed yet.
- **Cross-tool session adapters** (per-tool capture for Claude Code, Codex, Gemini CLI, OpenCode, Copilot, per [docs/ROADMAP.md](../ROADMAP.md)'s Phase 4 continuity item) are a separate, larger effort this RFC deliberately doesn't take on — `resumePreview`'s `resumeTargets` describes the same generic `skill load` command for every agent today because that's genuinely all that exists; richer per-agent resume commands are a natural follow-up once/if per-tool adapters exist.
- **Full-fidelity continuity capture** (real journey/section content beyond summaries, per ROADMAP's Phase 3) would enrich `ContinuityOpenResult.sections`/`.knowledge` but isn't required for this contract's shape to be useful today.
