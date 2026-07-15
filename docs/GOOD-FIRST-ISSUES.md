# Good first issues

Concrete, scoped contribution targets found by testing the shipped CLI end to end, not fixed here on purpose so they stay open for a first contribution. Each entry has been reproduced against the real code before being listed. Open the matching issue (or a new one referencing this doc) before starting, so effort isn't duplicated. See [CONTRIBUTING.md](../CONTRIBUTING.md) for the DCO/PR checklist.

## `good first issue`

**`skill status` ignores a native `.skill/contract.json` even when one exists.**
`status()` in `packages/workspace/src/index.ts` always runs the legacy, section-based `assessCompleteness` heuristic, the same one used before `SkillContract` existed. It never checks for or reads `.skill/contract.json`, even right after `skill contract-init`. `skill compile` does check the native contract when present, so `status` and `compile` can disagree about how close a workspace is to release. Fix: have `status` prefer the native contract's own assessment when `.skill/contract.json` exists, falling back to the legacy path only when it doesn't.

**`skill run` has no `--trust-store` flag.**
`skill inspect` and `skill verify-trust` both accept `--trust-store <path>` to point at a non-default pinned-key file; `skill run` doesn't, so a `verified_issuer` package signed with a key pinned somewhere other than `~/.skillerr/trust-store.json` can't reach `execute` mode without first copying that key into the default location. Fix: thread `--trust-store` through to `runSkillArchive`'s trust check the same way the other two commands do.

**`skill to-skill-md`'s title falls back to the compile message before the workspace's own title.**
`compileWorkspace` resolves a package's title as `opts.title ?? opts.message ?? (await loadConfig(root)).title ?? st.staged[0]!.title` (`packages/workspace/src/index.ts:561`). If a workspace was created with `skill init --title "Real Title"` and later compiled with `skill compile -m "final polish"` (no `--title`), the compile message wins over the workspace's actual configured title, so the exported `SKILL.md`'s `# ` heading (and the manifest's own `title` field) becomes the commit-style message instead. Fix: drop `opts.message` from this fallback chain, or move it to the very end, after the workspace's own title.

**`skill add`/`skill unstage`/`skill discard` silently no-op on an id that doesn't exist.**
`add`/`unstage` just call `stage`/`unstage` with whatever ids were passed and print the resulting staged list; there's no check that a given id actually matched a real section, so a typo'd id is indistinguishable from "already staged." Fix: report `found`/`not_found` (or a changed-count) alongside the resulting list.

**`skill run`'s trust-gate errors don't explain the two flags needed together.**
Running a public-dev-HMAC (`development`) seal in `execute` mode refuses unless *both* `--allow-untrusted` and `--allow-development-issuer` are passed; passing only one still refuses, with an error that doesn't say the other flag is also required. Fix: when refusing for this reason, name both flags in the error message.

## `documentation`

**README doesn't mention the harmless `npm i -g skillerr` `EBADENGINE` warnings.**
A fresh `npm i -g skillerr` on a stable (non-bleeding-edge) Node release prints several `npm warn EBADENGINE` lines from transitive dependencies pinned to very new Node ranges. The install still succeeds and the CLI works correctly, but the warnings look alarming on a first install. Fix: one sentence in the README's install section noting these are expected and harmless.

## `adapter` (medium)

**`skill ingest` has no path back into an editable workspace.**
`skill ingest` converts a `SKILL.md`/skill-creator folder straight into a continuity `.skill` package, but there's no way to open that back up as an editable `.skill/` workspace (to run `skill add`/`skill propose`/`skill compile` against it) or to get the intermediate `SkillSource`/`source.json` it was built from. Fix: either have `ingest` also emit the intermediate `source.json` alongside the package, or add a `skill workspace-import <file.skill>` command.

**`skill load` returns a read-only handoff summary, not a resumable workspace.**
`loadSkillHandoff` (`packages/workspace/src/index.ts`) unpacks a continuity/release package and returns a curated summary (journey, knowledge titles, completeness), but doesn't materialize a `.skill/` working tree a receiving agent could actually `skill add`/`skill propose` into. Today "resume" means "read the handoff and re-author from scratch." Fix: either add real workspace materialization, or rename the command/its docs to be explicit that it's a read-only handoff view, not a resume.

## `second-runtime` ⭐ (hard, highest-leverage)

A second, independent runtime (Go, Rust, or otherwise) that reproduces the adversarial corpus, the canonicalization vectors, and Ed25519/DSSE signing byte-for-byte is the single highest-leverage contribution available. See [CONTRIBUTING.md](../CONTRIBUTING.md) "Wanted: a second independent runtime" for exactly what it needs to reproduce.
