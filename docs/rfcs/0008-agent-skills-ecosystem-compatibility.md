# RFC 0008 — Agent Skills ecosystem compatibility

Status: **Implemented**, `packages/core/src/ingest.ts`, `packages/core/src/export.ts`, `packages/core/src/verify-skill.ts`. See [dot-skill/skillerr#43](https://github.com/dot-skill/skillerr/pull/43).

Like RFC 0007, this documents the shipped shape rather than a proposal that might drift from what actually landed.

## Motivation

skillerr positions itself as the trust layer for the [Agent Skills](https://agentskills.io/specification)
ecosystem: authoring stays `SKILL.md`, distribution stays tools like
[`vercel-labs/skills`](https://github.com/vercel-labs/skills) and
[skills.sh](https://skills.sh), and skillerr adds the missing piece,
inspecting and verifying a skill's integrity and provenance before you run
it. That positioning only holds if the code actually honors the standard
it claims to sit above. Before this RFC, `skill ingest` silently dropped
several spec fields after parsing them (`license`, `compatibility`,
`allowed-tools`) and couldn't parse `metadata` at all (the frontmatter
reader only handled flat `key: value` lines, not a nested map). There was
also no way back: a sealed `.skill` could only export to a single lossy
markdown file (`skill to-skill-md`), never to a real, installable Agent
Skills folder, and multi-skill repositories (a plugin manifest, or a
`skills/<name>/` catalog) weren't recognized at all.

## Proposal

Four additive pieces, all in `@skillerr/core`, none touching the wire
container, the seal, or the `kind: "dot-skill"` identifier:

**Full frontmatter fidelity on ingest.** `parseFrontmatter` now handles
one level of nested `key:\n  child: value` maps and the equivalent flat
dotted form (`key.child: value`), both landing in the same slot. `license`
maps to `SkillSource.license` (+ `license_url` from a bundled `LICENSE`
file, if present); `compatibility` becomes a `ContractPrecondition`
(`check: "human"`) plus `extensions.agentskills.compatibility`; `metadata`
becomes `extensions.agentskills.metadata.*` verbatim, never interpreted;
`allowed-tools` becomes `extensions.agentskills.allowed_tools` plus one
`ContractPermission` per tool with `consent: "explicit_human"`, the exact
same deny-by-default posture ingest already used for bundled `scripts/*`.
Every mapping (or explicit skip) is named in `IngestReport.notes`, never
silent. `SkillSource` gained an `extensions?: Record<string,
Record<string, unknown>>` field (mirroring the one `SkillManifest` already
had) so `compile.ts` can thread it straight through to the manifest.

**Multi-skill discovery.** `discoverSkillMdCandidates(path)` recognizes
the same two conventions [`vercel-labs/skills`](https://github.com/vercel-labs/skills)
itself uses: a `.claude-plugin/marketplace.json`/`plugin.json` manifest
(`plugins[].skills[]` entries are skill directory paths), and a flat
`skills/<name>/SKILL.md` catalog. `skill ingest <path>` lists candidates
instead of failing when `<path>` has no direct `SKILL.md` but matches
either shape. Nested catalog variants (`.curated/`, `.experimental/`,
`.system/`) are out of scope.

**Reverse folder export.** `exportAgentSkillFolder` (core) and `skill
export-skill <file.skill> -o <dir> [--agent <host>]` (CLI) materialize a
spec-valid Agent Skills folder from a sealed `.skill`: `name` is a
slugified, spec-valid form of `contract.title` (never a compile message,
see "Incidental fix" below), `description` comes from `contract.intent`,
license/compatibility/metadata/allowed-tools are restored from
`extensions.agentskills.*`, and `scripts/`/`references/`/`assets/` are
materialized from the package's resources. `--agent claude`/`--agent
cursor` compute the standard install directory (`.claude/skills/<name>/`,
`.cursor/skills/<name>/`) automatically; any other value falls back to
`.agents/skills/<name>/`. The result is validated with `skills-ref
validate <dir>` if that binary is on `PATH`, otherwise the same
name/description constraints are enforced internally, either way a folder
that doesn't satisfy the spec is never written silently.

**`skill verify-skill <dir>`.** Deliberately narrow: reports a content
digest and flags `scripts/*` as executable surface for any plain folder,
sealed or not. If a `.skill` sidecar exists (a sibling `<dir>.skill`, or
`--attestation <file.skill>`), it additionally reports that package's own
attestation integrity via the existing `verifyMintTrust`. This is
explicitly not a claim that the folder's current files are byte-identical
to what was sealed, a plain folder and a `.skill` archive have
structurally different content layouts, so that comparison isn't
well-defined, and the command's own output says so.

## Incidental fix

`compileWorkspace` (`packages/workspace/src/index.ts`) resolved a
package's title as `opts.title ?? opts.message ?? configuredTitle ??
firstStagedTitle`, so a `-m` compile message silently overrode a title the
workspace already had configured. This surfaced concretely as a bug in
`export-skill`'s name derivation (and in the older `to-skill-md`
adapter's `# heading`): the fallback chain reordered to `opts.title ??
configuredTitle ?? opts.message ?? firstStagedTitle`, so an explicit
compile message can no longer clobber a real configured title.

## Migration

Purely additive. Existing `ingest` behavior for `name`/`description` is
unchanged; existing `.skill` fixtures remain valid (`extensions` is
optional on both `SkillSource` and `SkillManifest`); no change to the
wire container, `kind: "dot-skill"`, package naming, or the seal.

## Fixtures

- `examples/ingest-skill-md/` (the existing worked example) gained
  `compatibility`, a nested `metadata:` block, `allowed-tools`, a bundled
  `LICENSE`, and an `assets/` file, exercising every new mapping in one
  real fixture rather than only synthetic unit tests.
- `packages/core/src/ingest.test.ts`, `export.test.ts`,
  `verify-skill.test.ts`, and `packages/cli/src/conformance.test.ts` cover:
  nested and dotted metadata parsing, allowed-tools recorded as
  `explicit_human`-consent permissions (never auto-granted),
  compatibility-as-precondition, license/license_url mapping,
  unrecognized-key passthrough, plugin-manifest and catalog discovery, a
  golden ingest to mint-ready compile to export-skill to re-ingest round
  trip asserting the same fields are found on both ends, folder-basename
  mismatch warnings, and the honest no-attestation/with-attestation paths
  for `verify-skill`.
