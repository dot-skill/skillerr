# RFC 0004 — Specify or reserve dangling step kinds: `subskill`, `delegate` (PROTO-6)

Status: **Draft — spec only, not implemented**

## Motivation

`WorkflowStepKind` includes `"subskill"` and `"delegate"`, and both compile
and pack successfully today — but both throw unconditionally at
**execution** time:

```ts
// packages/runtime/src/index.ts
case "delegate": {
  if (ctx.dry) return { output: { dry_run: true, task: step.task }, resultAs: step.result_as };
  throw new Error("delegate requires an A2A adapter (not configured)");
}
case "subskill": {
  throw new Error(`subskill ${step.skill_id} not resolved in this runtime invocation`);
}
```

`subskill` doesn't even get the dry-run exemption `delegate` does — a
package containing one can't even be dry-run inspected without a runtime
error. This is a worse failure mode than refusing earlier: a skill using
either kind passes `skill validate`, passes `skill pack`, can even be
minted (nothing in `assessSkillContract` or `validatePackageBytes` flags
it) — and only fails deep into a real `skill run --mode execute`, on
whatever step happens to reach it. The gap between "protocol says this is
valid" and "runtime says this never works" is exactly the class of thing
BUG-3's sweep spent this tier closing everywhere else.

## Proposal

### Primary: specify real resolution semantics for `subskill`

A `subskill` step should be resolvable the same way a package manager
resolves a dependency — which the manifest already has a shape for
(`SkillManifest.dependencies: SkillDependency[]`, currently unused by
anything):

```ts
interface SkillDependency {
  skill_id: string;      // content-addressed (PROTO-1) — skl_<hash prefix>
  version: string;       // semver range
  package_digest?: string; // optional pin — exact digest required if present
}
```

Resolution order, matching how this protocol already treats trust
(local-first, explicit-over-implicit):

1. **Local-first**: check a local skill cache/workspace directory (mirrors
   how `@skillerr/registry`'s local transparency log is the offline-first
   default) for a package matching `skill_id` + satisfying `version`, and
   — if `package_digest` is pinned — matching digest exactly (refuse on
   mismatch, don't silently accept a same-id-different-content package).
2. **Registry lookup** (optional, if configured): same trust rules as any
   other package — an unsigned/untrusted subskill is still gated by the
   same execute-time trust checks as the top-level package (SEC-* tier
   unchanged — resolving a subskill doesn't bypass deny-by-default or the
   trust gate).
3. **Refuse, don't guess**: no local match and no registry configured (or
   no match there either) → `subskill_unresolved`, a distinct refusal
   code, not a generic thrown error.

### Cycle refusal

Since a subskill can itself contain `subskill` steps, resolution must
track the in-progress resolution chain and refuse on a cycle
(`subskill_cycle_detected`) rather than recursing until a stack overflow.
The chain itself is exactly what PROTO-9's lineage (`SkillSource.parents`)
already wants to record — a resolved subskill's package_digest becomes a
`parents` entry in the resolving skill's provenance, so `skill inspect`
can render the whole dependency chain (see RFC 0006).

### `delegate` (A2A): stays experimental, not fully specified here

`delegate` depends on an external Agent-to-Agent protocol adapter — a
different integration surface (a live network call to another agent, not
a local package resolution). This RFC doesn't attempt to fully specify
A2A integration; it recommends marking `delegate` explicitly
**reserved/experimental** in `docs/PROTOCOL.md` (packages using it should
know they're opting into an unstable, adapter-dependent step kind), and
leaves full A2A semantics to a future RFC once a concrete adapter exists
to design against.

### Interim mitigation (cheap, separable from this RFC)

Independent of full resolution semantics landing, `assessSkillContract`
and/or `validateWorkflowShape` could flag `subskill`/`delegate` steps as
requiring an explicit contract-level acknowledgment (e.g. a
`forbidden_actions`-style "uses experimental step kind" declaration) so
at minimum `skill validate` — not a live execute run — is where a package
author first learns their skill won't run standalone. This is a smaller,
independently-shippable change that doesn't require this RFC's full
resolution design; noted here so a future contributor doesn't have to
rediscover it.

## Schema diff

- `workflow.schema.json`'s `subskill` step already requires `skill_id`
  (PROTO-7, already shipped) — no change needed there.
- New refusal codes: `subskill_unresolved`, `subskill_cycle_detected`
  (runtime-level, not schema-level).
- No `SkillManifest`/`Workflow` field changes — `dependencies` already
  exists and is unused; this RFC is what makes it meaningful.

## Migration

Additive — `dependencies` is optional today and stays optional. A
`subskill` step with no matching `dependencies` entry keeps failing (now
with a clear code instead of a generic thrown error, which is itself a
strict improvement, not a behavior change worth gating behind a version
bump).

## Fixtures

Once implemented: a `subskill` step resolves against a matching local
dependency and dry-runs successfully; a `package_digest`-pinned dependency
refuses on a mismatched local package; two skills each declaring the other
as a subskill dependency refuse with `subskill_cycle_detected` instead of
recursing; an untrusted (unsigned/development-sealed) resolved subskill is
still gated by the top-level execute trust check.

## Open questions

- Should subskill resolution be recursive by default, or require an
  explicit `--resolve-subskills` opt-in the first time this ships (safer
  default: refuse unless explicitly enabled, consistent with
  `--allow-untrusted` needing to be opt-in elsewhere in this protocol)?
