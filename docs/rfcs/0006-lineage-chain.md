# RFC 0006 — Lineage chain (PROTO-9)

Status: **Draft — spec only, not implemented**

## Motivation

`SkillSource.parents` (`packages/protocol/src/source.ts`) exists today as
`parents: string[]` — an untyped, unpopulated field. Every producer of a
`SkillSource` in this codebase (`packages/workspace/src/index.ts`'s
`toSkillSource`, `packages/protocol/src/extract.ts`, every test fixture)
sets it to `[]` and nothing ever reads it. Worse: even if a caller filled
it in, `compileWorkspace`'s hand-built `provenance.source` object
(`packages/core/src/compile.ts`, the object literal at the end of
`compileNativeContract`) only copies `id`, `hash`, `title`, `contract`,
`agent`, and `section_ids` off `source` into the packaged provenance —
`parents` is dropped on the floor even in continuity/release packages
compiled *today*. The field is doubly inert: unspecified shape, and not
even wired into the one place (`provenance.source`) that would carry it
into a package.

This matters because continuity is the whole reason this protocol has a
`.skill` object model instead of a single mutable file. `skill checkpoint`
(`packages/workspace/src/index.ts`) produces a new sealed-or-not `.skill`
package every time an agent hands off work, and `.skill/HEAD.json`
(`WorkspaceHead`: `package_path`, `package_digest`, `skill_id`,
`mint_status`, `compile_profile`, `updated_at` — see
[WORKSPACE.md](../WORKSPACE.md)) already records the digest of the *last*
compile after every checkpoint or release compile. A skill that goes
through several `continuity` checkpoints before a `release` compile —
draft → refined draft → refined draft → release — produces a real,
ordered sequence of `package_digest`s over time. Right now nothing
connects them: given a release package, there is no way to prove "this
descended from these specific continuity drafts" or "this skill is a
refinement of that other skill," even though the raw material
(`HEAD.json`'s digest at each step) already exists on disk. Auditability
across continuity checkpoints is the entire value proposition of having
checkpoints be discrete, digested objects instead of git-style diffs —
and today that value proposition dead-ends at "trust me."

### Why this had to wait for PROTO-1

Before PROTO-1 (content-addressed `skill_id` — `skl_<sha256-prefix>`
derived from `source.hash` and `source.contract`, see
`contentAddressedSkillId` in `packages/core/src/compile.ts`), `skill_id`
was a random UUID minted fresh on every compile. A `parents` entry
recording `{skill_id: <random-uuid>}` would have been unfalsifiable and
non-reproducible: the same logical parent skill, rebuilt from the same
source, got a *different* id every time, so "this package's parent is
skill X" could never be checked against anything — there was no stable X
to check against, and two independently-compiled copies of what a human
would call "the same skill" had no shared identifier at all. PROTO-1 made
`skill_id` a function of content, so an ancestor reference now names
something that is either reproducible from the same source or verifiably
absent — the precondition this RFC's `{skill_id, package_digest}` pair
needs to mean anything. Lineage on top of random-UUID ids would have been
lineage in name only.

## Proposal

### `SkillSource.parents` becomes a structured array

```ts
export interface SkillParentRef {
  skill_id: string;
  package_digest: string;
}
```

```ts
export interface SkillSource {
  // ...
  parents: SkillParentRef[];
  // ...
}
```

Ordering: **immediate parents first** (most recent ancestor at index 0),
oldest checkpoint last. Rationale: `skill inspect` and any human skimming
the chain almost always want "what did this come from most recently" —
the last continuity draft before this release, not the original blank
workspace three checkpoints ago. Immediate-first also matches how
`WorkspaceHead` naturally produces entries (each compile only ever knows
its own immediate predecessor's digest; building the chain backwards from
there is an append-to-front, not a re-sort), and mirrors git's own `git
log` default (newest first) rather than forcing a reversal at read time.
A consumer that wants oldest-first for a timeline view reverses the
already-short array; that's cheaper than every producer having to
maintain sorted-oldest-first insertion.

### How `parents` gets populated

Three distinct producers, all additive to existing compile paths:

1. **Workspace checkpoint chaining.** `toSkillSource` in
   `packages/workspace/src/index.ts` currently hardcodes `parents: []`.
   It should instead call `loadHead(root)` (already used elsewhere in the
   same file, e.g. `status()`) and, when `head.package_digest` and
   `head.skill_id` are both present, prepend
   `{ skill_id: head.skill_id, package_digest: head.package_digest }` to
   the new source's `parents`. This is exactly the "successive continuity
   checkpoints" case: checkpoint 1 has no parent (`HEAD.json` doesn't
   exist yet or has no digest), checkpoint 2's parent is checkpoint 1's
   digest, the release compile's parent is checkpoint 2's digest — a
   naturally-growing chain with zero new state to track, since
   `WorkspaceHead` already carries the one prior digest needed at each
   step. Only the immediate predecessor is added here; earlier ancestors
   arrive transitively because checkpoint 2's own `parents` (as packaged
   in checkpoint 2's `provenance.source`) already contains checkpoint 1's
   entry — see "What `skill inspect` can actually render" below for why
   this RFC does not propose eagerly flattening the whole transitive
   chain into every package.
2. **Continuity draft promoted to release.** No special case needed
   beyond (1): a release compile is just another `compileWorkspace` call
   with `profile: "release"`, so it picks up the same `HEAD.json`-derived
   parent as any other compile. "Refinement of that other skill" (a
   distinct, not-purely-sequential lineage claim — e.g. release v2 forked
   from a differently-titled draft) is out of scope for the automatic
   `HEAD.json` path; a caller can still hand-supply extra `parents`
   entries via `CompileOptions`/`CompileWorkspaceOptions` for that case
   (not detailed further here — additive, no shape change beyond what's
   already proposed).
3. **Resolved subskill dependencies (RFC 0004 cross-reference).** RFC
   0004 (`docs/rfcs/0004-dangling-step-kinds.md`, PROTO-6) already commits
   to this: "a resolved subskill's `package_digest` becomes a `parents`
   entry in the resolving skill's provenance." When `subskill` resolution
   ships, a resolved `SkillDependency` (`packages/protocol/src/types.ts`:
   `{ skill_id, version, package_digest? }`) that pins a `package_digest`
   contributes `{ skill_id: dependency.skill_id, package_digest:
   <resolved digest> }` to the resolving skill's `parents`. This is a
   different *kind* of ancestry (compositional — "built from," not
   temporal — "checkpointed from") but shares the same shape and the same
   auditability motivation, so this RFC does not propose a separate field
   for it. A future consumer that needs to distinguish "checkpoint parent"
   from "subskill parent" can do so structurally (cross-reference against
   `manifest.dependencies`) without a schema change here.

### Wiring into the packaged `provenance.source`

`packages/core/src/compile.ts`'s hand-built `provenance.source` object
(the literal inside `compileNativeContract`, currently `{ id, hash,
title, contract, agent, section_ids }`) needs a `parents:
source.parents` line added. Without this, `SkillSource.parents` stays
inert regardless of the schema change above — this is not optional
plumbing, it's the actual delivery mechanism that gets a lineage claim
from the compiler's input into the shipped package. The legacy-adapter
compile path (`compileSkillSource` when `!source.contract`, continuity
only) should carry the same field for consistency, even though it's
already lossy in other ways.

### What `skill inspect` can actually render

`inspectSkill()` (`packages/core/src/validate.ts`) reads
`result.manifest`, not `provenance.source` — the manifest today has no
lineage field at all. Two options:

- **(a)** Add `parents` (or a manifest-level `lineage`) to
  `SkillManifest` itself, populated at pack time from
  `source.parents` alongside the existing `provenance.source` copy — a
  first-class manifest field, inspectable without opening
  `provenance/compilation_report.json`.
- **(b)** Leave it in `provenance.source` only and have `inspectSkill`
  reach into `provenance.source.parents` when building its summary.

This RFC proposes **(a)**: a first-class `SkillManifest.lineage?:
SkillParentRef[]` field. `manifest.json` (`skill.json`) is the one file
`skill inspect`, `skill validate`, and every other lightweight tool
already reads without needing the `provenance/` directory; `provenance`
is explicitly the "may be redacted/absent for privacy" part of the
package (`provenance_mode: "proof_only"` already drops `provenance.source`
entirely — see `compile.ts`'s ternary on `opts.provenance_mode`). A
release package compiled `proof_only` would otherwise lose its lineage
claim entirely, which defeats "auditable derivation chain" for exactly
the profile (release) where auditability matters most. Manifest-level
`lineage` survives `proof_only`.

`inspectSkill()`'s returned `summary` gains:

```ts
lineage?: Array<{ skill_id: string; package_digest: string }>;
```

populated straight from `manifest.lineage` — no verification, no
resolution, matching `inspectSkill`'s existing "lightweight, no signature
checks" contract (the comment already there: "that's `inspectTrustView` /
`skill inspect --trust`"). This is deliberately **not** recursive: a
locally-available package only ever declares its own `parents` (typically
one or two entries — direct checkpoint predecessor, plus any resolved
subskill dependencies), never a flattened transitive history. Walking
further back (rendering *checkpoint 1*'s title from *checkpoint 3*'s
`skill inspect`) requires checkpoint 1's actual package bytes to be
locally available (e.g. still sitting in `.skill/objects/`, per
[WORKSPACE.md](../WORKSPACE.md)'s workspace layout) — `skill inspect`
does not fetch or assume access to ancestor packages it hasn't been
handed. A future `skill inspect --lineage-deep <dir>` that walks
`.skill/objects/` resolving each `parents[i].package_digest` to a local
file and recursing is a plausible follow-up CLI feature, but is out of
scope for this RFC: it's UX on top of an already-complete data model, not
a schema question. Rendering the single declared `parents` array from the
package in hand is what this RFC actually specifies, and it is enough to
answer "what immediately preceded this" without requiring every ancestor
to be co-located.

## Schema diff

- `packages/protocol/src/source.ts`: new exported interface
  `SkillParentRef { skill_id: string; package_digest: string }`;
  `SkillSource.parents: string[]` → `SkillSource.parents:
  SkillParentRef[]`.
- `packages/protocol/src/types.ts`: `SkillManifest` gains
  `lineage?: SkillParentRef[]` (optional — absent means "no declared
  parents," same as an empty array, kept optional rather than
  required-empty-array to match every other optional provenance-ish
  field on `SkillManifest`, e.g. `supersedes?`, `anchors?`).
- `packages/core/src/validate.ts`: `inspectSkill()`'s return type gains
  `summary.lineage?: SkillParentRef[]`.
- `packages/core/src/compile.ts`: the `provenance.source` object literal
  gains `parents: source.parents`; `finalizeManifest`/the manifest
  literal gains `lineage: source.parents` (or omitted when empty, per the
  optional-field convention above).
- **JSON Schema**: `parents` does not currently appear in any of
  `packages/protocol/*.schema.json` (`skill-manifest.schema.json`,
  `skill-contract.schema.json`, `workflow.schema.json`,
  `knowledge-item.schema.json`, `creation-attestation.schema.json` — none
  reference it today, confirmed by grep). Adding manifest-level `lineage`
  per this RFC requires a new `lineage` property definition in
  `skill-manifest.schema.json` (PROTO-7): an array of objects each
  requiring `skill_id` and `package_digest` as strings. This is the one
  schema-level (wire-checked) part of this change; `skill validate`
  would then be able to structurally check a declared `lineage` entry the
  same way it checks every other manifest field today.
- **Is the `SkillSource.parents` shape change itself wire-breaking?** No.
  `SkillPackageFiles.provenance.source` is typed `unknown`
  (`packages/protocol/src/types.ts`) precisely because it's a "scrubbed
  SkillSource or product source" blob with no schema contract today — no
  JSON Schema validates its shape, and nothing downstream parses
  `provenance.source.parents` as anything other than opaque JSON. The
  `string[]` → `SkillParentRef[]` change is a **TypeScript-level**
  breaking change (any code doing `source.parents.map(id => ...)`
  assuming bare strings breaks at compile time) but not a **wire-level**
  one for `provenance.source`, since nothing currently reads or validates
  that sub-shape at runtime. It only becomes wire-relevant at the point
  this RFC adds the new, actually-schema-checked `SkillManifest.lineage`
  field described above — and that field is new and additive, not a
  reinterpretation of an existing wire shape.

## Migration

Additive at the wire level, with one explicit legacy-shape accommodation:

- No shipped package today has a non-empty `parents` (every producer
  sets `[]`), so there is no real-world `parents: ["skl_abc", "skl_def"]`
  payload in the wild to preserve compatibility with — this is a
  theoretical migration, not an observed-data one. Still, since the type
  was public in `@skillerr/protocol`, a defensive reader is worth
  specifying: a plain string entry in a `parents` array (old shape) is
  interpreted as `{ skill_id: <value>, package_digest: undefined }` —
  meaningful-if-incomplete (identifies *which* skill, not *which build of
  it*), rather than a hard parse failure. This mirrors how this codebase
  already treats "the field named the thing but not precisely enough to
  verify" elsewhere (e.g. `SkillDependency.package_digest` itself being
  optional — an unpinned dependency is still a real declared dependency).
- `SkillManifest.lineage` is a brand-new optional field. Every package
  compiled before this RFC lands simply has no `lineage` — `skill
  inspect` renders `lineage: []` or omits the field, same as any other
  package predating an optional field's introduction (e.g. `supersedes`,
  `anchors`). No `PROTOCOL_VERSION` bump required by the same logic RFC
  0001 and RFC 0003 use: this is an additive optional field, not a
  reinterpretation of `protocol_version`'s exact-match contract
  (`docs/PROTOCOL.md`'s "Protocol/CLI compatibility" section).
- `skill-manifest.schema.json`'s new `lineage` property is optional
  (not in `required`), so existing packages without it continue to pass
  `skill validate`'s schema check unchanged.

## Fixtures

Once implemented:

- A workspace that runs `skill checkpoint` twice, then `skill compile
  --profile release`, produces a release package whose
  `manifest.lineage` has exactly one entry (the immediate checkpoint-2
  predecessor per the immediate-first/single-hop-per-package design —
  *not* two entries, since checkpoint 2's own package already carries
  checkpoint 1 as its one parent; the two-checkpoint depth is only
  visible by walking both packages, not flattened into one array). A
  fixture asserting the *full two-hop history* should instead inspect
  checkpoint 2's package for its own one-entry `lineage` pointing at
  checkpoint 1, demonstrating the chain is real without claiming
  flattening this RFC doesn't propose.
- `skill inspect` on the release package from the fixture above renders
  `summary.lineage` as `[{ skill_id: "skl_...", package_digest:
  "sha256:..." }]`, matching checkpoint 2's actual `package_digest`
  (recoverable from checkpoint 2's own `HEAD.json` entry at the time it
  was written, for the test to assert against).
- A package whose `manifest.lineage` entry names a `package_digest` that
  matches nothing in the local `.skill/objects/` (or wherever the
  inspecting tool looks) still `skill inspect`s cleanly: the entry is
  rendered as declared (`skill_id`, `package_digest`), with no attempt at
  resolution and no error/warning — "unresolvable locally" is the
  expected, common case for a package inspected outside its authoring
  workspace (e.g. after being shared as a standalone file per
  [PROTOCOL.md](../PROTOCOL.md)'s "distribute the compiled `.skill` file
  directly"), not a validation failure. Add this alongside the existing
  corpus in `packages/cli/src/conformance.test.ts`.
- A legacy-shape `parents: ["skl_abc123"]` (bare strings, pre-RFC) fed
  through the compiler still compiles, and the packaged
  `provenance.source.parents` (or `manifest.lineage`, if the legacy
  reader also normalizes at pack time) shows
  `{ skill_id: "skl_abc123", package_digest: undefined }`, per the
  Migration section above.

## Open questions

- **Tamper-evidence: should `lineage` be inside the sealed claim set?**
  `SealedManifestClaims` (`packages/protocol/src/types.ts`) currently
  binds identity + permissions/policy/capabilities + content digests into
  `sealed_manifest_digest` — deliberately not everything on
  `SkillManifest` (e.g. `authors` is informational-only, outside the
  seal). Lineage is a genuine judgment call between those two poles: an
  *unsealed* `lineage` (like `authors`) is easy to spoof — anyone
  repackaging a `.skill` could claim any ancestry with no integrity cost,
  which undercuts "auditable" in this RFC's own motivation. A *sealed*
  `lineage` makes the claim tamper-evident (any edit changes
  `sealed_manifest_digest`, catchable the same way permission tampering
  is caught today) but only for minted packages — continuity checkpoints
  are explicitly never minted (`docs/PROTOCOL.md`'s profile table: `Mint?
  No` for continuity), so the checkpoint-to-checkpoint links that make up
  most of a real lineage chain would stay unsealed regardless, and only
  the final release-to-last-checkpoint link would ever be sealable. This
  RFC leans informational-only (matching `authors`) for a first cut,
  given that most of the chain can't be sealed anyway under the current
  mint-only-at-release model, but flags this as the one decision most
  likely to get revisited once real lineage data exists to evaluate
  spoofing risk against.
- **Cross-workspace / forked lineage**: this RFC's automatic population
  (via `HEAD.json`) only covers the single-workspace, single-lineage-line
  case. A skill that is a deliberate refinement of an *unrelated*
  workspace's release package (not a checkpoint-to-checkpoint chain, not
  a subskill dependency) has no automatic producer in this proposal —
  only the manual `CompileOptions`-supplied-entry escape hatch mentioned
  in "Continuity draft promoted to release" above. Whether that deserves
  a first-class CLI affordance (e.g. `skill compile --parent
  <path-or-digest>`) is left for a future RFC or a follow-up PR against
  this one once real usage shows whether the manual path is actually
  used.
