# Bundled scripts and reference files (Phase 4)

The most common `skill-creator` pattern — bundle a helper script, split a
large reference doc out of the main body — has a real, safe, tested home
in a `.skill`. This document specifies it.

## Naming convention

`resources/` is arbitrary bytes attached to a package (`SkillPackageFiles
.resources`, wired into the container by `packages/core/src/pack.ts`).
Within it, two sub-paths are established conventions (used by `skill
ingest`, see [FAQ.md](./FAQ.md#how-do-i-convert-an-existing-skillmd)):

- **`resources/scripts/<name>`** — a bundled executable a workflow step
  invokes as a capability.
- **`resources/references/<name>`** — a reference document too large or
  too situational to belong in a primary `knowledge/*.json` item.

Neither path gets special validation or a manifest field of its own —
they're both just regular content-addressed files under `manifest
.content[]`, digested and integrity-checked like everything else. The
convention is what makes cross-tool interop possible, not a schema
requirement.

## Scripts: capability + permission + tool step, never auto-authorized

A bundled script never executes on its own. Three things have to line up:

1. **A capability** declares it exists and its blast radius:
   ```json
   {
     "name": "run_lint",
     "description": "Run resources/scripts/lint.py against the draft.",
     "side_effect_class": "exec",
     "fallback": "ask_human",
     "required": true
   }
   ```
2. **A permission** with a matching `side_effect_class` — without one, the
   runtime's deny-by-default gate (`assertCapabilityAllowed` in
   `packages/runtime/src/index.ts`) refuses it outright:
   ```json
   {
     "id": "p_exec",
     "side_effect_class": "exec",
     "description": "Run the bundled lint script.",
     "consent": "explicit_human"
   }
   ```
3. **A `tool` workflow step** that actually invokes it:
   ```json
   { "id": "lint", "title": "Run lint script", "kind": "tool", "capability": "run_lint" }
   ```

Only with all three present does `run_lint` get past the capability gate.
`skill ingest` (Phase 1) creates step 1 automatically for every script it
finds under a skill-creator folder's `scripts/` — but deliberately **never**
creates steps 2 or 3, so an ingested skill's scripts stay declared-but-
inert until a human/agent explicitly authors the permission and wires a
step to call them. See `packages/core/src/ingest.ts`'s capability-stub
comment.

### `exec` is gated exactly like `read`/`write`/`destructive`/`network`

This is worth stating plainly: `assertCapabilityAllowed` checks every
`side_effect_class` against a declared permission before allowing a
capability through — `exec` included. (This phase found and fixed a real
gap where `exec` had no branch in that function at all — see the `PHASE 4`
comment in `packages/runtime/src/index.ts` and the regression test in
`packages/runtime/src/runtime.test.ts`.) A `tool` step calling an
`exec`-class capability with no matching permission is denied with a
distinct, machine-readable message, the same as an unauthorized file read
or network call — see [SECURITY.md](./SECURITY.md) and
[THREAT-MODEL.md](./THREAT-MODEL.md).

### What "runs" actually means in the reference runtime

`packages/runtime`'s `tool` step handler delegates to a **host-supplied
adapter** (`ctx.adapters.find(a => a.supports(cap))`) — this reference
runtime does not itself execute Python, shell, or any other script. In
`dry_run` mode, an authorized `tool` step returns `{dry_run: true, ...}`
without needing an adapter, which is what proves the authorization chain
(capability → permission → step) actually works end-to-end (see the
fixture in `packages/cli/src/conformance.test.ts`, "a tool step backed by
a bundled exec-class script..."). In `execute` mode with no adapter
registered, an authorized-but-unimplemented capability fails with `No
adapter for capability <name>` (or, for `fallback: "ask_human"`, `requires
human/tool adapter`) — a distinct failure from an authorization refusal.
Real script execution is a host/product concern (see
[ROADMAP.md](./ROADMAP.md)'s host-adapter entries), not something this
protocol package ships.

## References: progressive disclosure by convention, not by mechanism

`skill-creator` splits large reference material out of the main skill body
so an agent only loads it when actually needed. This protocol supports the
same pattern honestly:

- Put large, situational reference material under
  `resources/references/<name>` instead of a `knowledge/*.json` item.
- `knowledge/*.json` items (and the SKILL.md-equivalent primary body) are
  what a host/agent is expected to load eagerly when using the skill.
  `resources/references/*` is available but not eagerly surfaced — point
  to it by relative path from a knowledge item or step instruction when
  it's actually relevant (e.g. "see `resources/references/style-guide.md`
  for detailed style rules").

**This is a naming and authoring convention today, not a runtime
mechanism.** There is no `load: "on_demand"` manifest field and no code
that automatically defers loading `resources/references/*` — inventing
one without a host that actually reads it would be exactly the kind of
"looks functional, isn't" gap this project's BUG-3 sweep exists to catch.
A host that wants real lazy-loading behavior can implement it today purely
by choosing not to eagerly read `resources/references/*` bytes until a
step/instruction actually references one — the convention gives it a
stable, predictable place to look. Making this a first-class, host-
enforced primitive (e.g. a manifest-level pointer list) is a reasonable
"Next" contribution — see [ROADMAP.md](./ROADMAP.md).
