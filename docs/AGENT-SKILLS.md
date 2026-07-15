# Agent Skills compatibility

skillerr is the trust layer for the [Agent Skills](https://agentskills.io/specification)
ecosystem, not a competing authoring format. This page is the reference for
exactly how a plain `SKILL.md` folder and a sealed `.skill` package map onto
each other in both directions, and how to install a `.skill`'s contents
straight into an agent's own skills directory.

See also: [WHY.md](./WHY.md) "Where this fits in the Agent Skills
ecosystem", [FROM-SKILL-CREATOR.md](./FROM-SKILL-CREATOR.md) for the
forward mapping in full narrative detail.

## The compatibility matrix

| Agent Skills frontmatter | `skill ingest` (forward) | `skill export-skill` (reverse) |
|---|---|---|
| `name` | `contract.title` (falls back to the body's first `#` heading, then the folder name) | `contract.title`, slugified to a spec-valid name |
| `description` | `contract.intent` | `contract.intent`, truncated to 1024 chars if needed |
| `license` | `SkillSource.license` (+ `license_url` from a bundled `LICENSE`/`LICENSE.md`/`LICENSE.txt`, if present) | restored verbatim |
| `compatibility` | one `ContractPrecondition` (`check: "human"`) + `extensions.agentskills.compatibility` | restored verbatim from `extensions.agentskills.compatibility` |
| `metadata` (nested or dotted) | `extensions.agentskills.metadata.*`, verbatim, never interpreted | restored verbatim |
| `allowed-tools` | `extensions.agentskills.allowed_tools` + one `ContractPermission` per tool (`consent: "explicit_human"`) | restored verbatim as a space-separated list |
| `context`, `hooks`, other unrecognized keys | `extensions.agentskills.<key>`, verbatim passthrough | not currently restored (round-tripped only through `extensions`, not re-emitted as frontmatter) |
| `##` body sections | one knowledge item per heading | one `## <title>` heading per knowledge item |
| `scripts/*` | `resources/scripts/*` + one stub `exec` capability per script (`fallback: "ask_human"`, never auto-authorized) | `scripts/*`, restored verbatim |
| `references/*` | `resources/references/*` | `references/*`, restored verbatim |
| `assets/*` | `assets/*` | `assets/*`, restored verbatim |
| `evals/evals.json` | `contract.verification.items` | not currently restored |

**Nothing here is ever auto-authorized.** `allowed-tools` and bundled
`scripts/*` both become *proposed* capabilities/permissions requiring
explicit human consent, ingest and export never grant execution rights,
only record what the source declared.

## `skill export-skill` and the `--agent` install-dir shortcut

```bash
skill export-skill ./file.skill -o ./my-skill-folder
skill export-skill ./file.skill --agent claude   # writes ./.claude/skills/<name>/
skill export-skill ./file.skill --agent cursor   # writes ./.cursor/skills/<name>/
skill export-skill ./file.skill --agent codex    # writes ./.agents/skills/<name>/ (generic fallback)
```

| `--agent` value | Install directory |
|---|---|
| `claude` | `.claude/skills/<name>/` |
| `cursor` | `.cursor/skills/<name>/` |
| anything else | `.agents/skills/<name>/` (generic fallback, not every host has a dedicated convention yet) |

`<name>` is always derived from the package's title, slugified to the
spec's constraints (lowercase `a-z0-9-`, no leading/trailing/consecutive
hyphen, ≤64 characters); the same slug becomes both the frontmatter
`name` and the output directory's basename, satisfying the spec's "name
must match the parent directory" rule automatically. Plain `-o <dir>`
uses the exact path you give it and only warns (never silently renames)
if its basename doesn't match the derived name.

If [`skills-ref`](https://agentskills.io/specification) is on your `PATH`,
`export-skill` shells out to `skills-ref validate <dir>` and surfaces its
result. Otherwise it enforces the name/description constraints itself and
fails loudly, a folder is never written as "exported" if it doesn't
actually satisfy the spec.

## `skill verify-skill`: checking a folder you didn't seal yourself

```bash
skill verify-skill ./some-skill-folder
skill verify-skill ./some-skill-folder --attestation ./some-skill-folder.skill
```

Useful right after `npx skills add owner/repo` or any other install path
that doesn't go through skillerr at all:

- Always reports a content digest of the folder and flags every file
  under `scripts/*` as executable surface, regardless of whether a seal
  exists.
- If a sealed `.skill` sidecar exists (a sibling `<dir>.skill`, or an
  explicit `--attestation <file.skill>`), it also reports that
  attestation's own signing integrity (issuer, trust state). This is a
  real check, but it does **not** prove the folder's current files are
  byte-identical to what was sealed: a plain folder and a `.skill`
  archive have different internal layouts, so that specific comparison
  isn't well-defined. The command's own output says this explicitly.
- With no attestation at all, it says so honestly: nothing cryptographic
  to check, `scripts/*` are unverified executable surface.

## Worked round trip

```bash
npm i -g skillerr
export SKILL_HOST=cursor

# Forward: a plain Agent Skills folder becomes a sealed, typed .skill.
skill ingest ./my-skill-folder -o draft.skill
# ... record human review, then compile release + mint (see docs/MINT.md) ...

# Reverse: back to a plain, installable folder.
skill export-skill ./release.skill --agent claude

# Optional: confirm it's spec-valid independently, if you have the reference validator.
skills-ref validate ./.claude/skills/<name>
```

## Multi-skill discovery

`skill ingest <path>` also recognizes two ways a folder can hold more than
one skill, matching the conventions [`vercel-labs/skills`](https://github.com/vercel-labs/skills)
itself uses:

- A plugin manifest: `.claude-plugin/marketplace.json` or `plugin.json`,
  whose `plugins[].skills[]` entries are skill directory paths.
- A flat catalog folder: `skills/<name>/SKILL.md`.

If `<path>` has no direct `SKILL.md` of its own but matches either
convention, `ingest` lists the candidates it found (as JSON) instead of
failing, so you can re-run `ingest` on the one you want. Nested catalog
variants (`.curated/`, `.experimental/`, `.system/`) are out of scope for
now.

## What's not yet a full round trip

- `evals/evals.json` assertions map forward into `contract.verification.items`
  on ingest, but are not currently restored to a new `evals/evals.json` on
  export.
- Unrecognized frontmatter keys (`context`, `hooks`, ...) are captured
  under `extensions.agentskills.*` for inspection, but `export-skill`
  doesn't currently re-emit them as frontmatter.
- `skill to-skill-md` remains a separate, intentionally lossy single-file
  export (workflow-step prose, not a folder); use `export-skill` when you
  need the real round trip.

These are tracked, not silent, see [ROADMAP.md](./ROADMAP.md) and
[GOOD-FIRST-ISSUES.md](./GOOD-FIRST-ISSUES.md).
