# Authoring contract

Protocol 1.0 makes `SkillContract` the source of truth for transferable skill semantics. Sections remain useful knowledge and evidence, but section prose cannot satisfy release completeness.

## Required declarations

Every contract must declare:

- intent and discovery triggers
- typed inputs: JSON Schema, required/optional, default, sensitivity, source, ask policy, and approval policy
- preconditions and their failure behavior
- ordered steps and conditional branches
- human decisions and the step each decision gates
- capabilities and fallback behavior
- permissions and consent requirements
- forbidden actions and enforcement boundary
- typed outputs
- recovery/failure edges
- domain verification assertions and expected evidence
- corrections/lessons
- provenance evidence, limitations, and human-review state

List-like fields use one of:

```json
{ "status": "specified", "items": [{ "...": "..." }] }
```

```json
{ "status": "none", "reason": "No external capability is needed." }
```

```json
{ "status": "not_applicable", "reason": "This knowledge skill has no rollback edge." }
```

Absent is not equivalent to `none`. A release compile refuses absent declarations and returns a field-specific fix. Empty `specified.items` also refuses.

## Universal and profile-dependent rules

All fields must be explicitly declared for every skill kind. Release additionally requires:

- at least one trigger, ordered step, and domain verification assertion
- recorded human semantic review with actor, time, and scope
- valid agent and redacted journey provenance

Capabilities and permissions may be explicitly `none`. Knowledge-only skills must not invent tools, filesystem access, network access, or consent requirements.

Continuity compilation may retain an incomplete native contract. Its completeness report remains false and includes machine-readable missing fields and fixes. A 0.4 text source may compile only as a lossy continuity package.

## Human decisions are gates, not claims

`approval: "explicit_human"` declares that execution must pause for a human. It is not evidence that approval happened. Runtime input values and CLI flags cannot satisfy a `human_decision`; a runtime must provide an authenticated decision callback with actor and timestamp.

Input `approval: "human_before_use"` is also compiled into a runtime decision gate. Permission consent remains a separate execution-time check.

## Runtime support

Tool steps require a matching capability adapter. Arbitrary transforms, branch expressions outside the documented `input:name[==value]` form, subskills, delegates, preconditions, and domain assertions refuse explicitly when the runtime lacks support. Dry-run records planned tool and decision behavior but does not perform side effects or manufacture verification evidence.

## Agent APIs and CLI

Protocol APIs:

- `scaffoldSkillContract()` — machine-readable template
- `assessSkillContract(value, profile)` — structured issues
- `explainContractAssessment(report)` — field-specific fixes

CLI:

```sh
skill contract-template
skill contract-check contract.json --profile release
```

The published JSON Schema is exported as `@skillerr/protocol/skill-contract.schema.json`.

## Candidate extraction

An adapter or AI **identifies** transferable skills from a redacted journey, then calls protocol extract APIs / CLI:

```sh
skill agent-guide
skill extract journey.json -o ./extraction
skill segment journey.json -o ./extraction   # alias
```

Input shape: `{ summary, candidates|topics: [...] }` (`kind: "redacted_journey"` optional). Output: `SkillCandidate[]` scaffolds with incomplete `SkillContract` / `SkillSource` stubs and field-specific `missing` reports. Candidate segmentation is not compiler behavior. Only a selected, complete `SkillContract` in its own workspace becomes the compile source of truth.

Protocol APIs: `extractSkillCandidates` / `segmentJourney`, `agentCreateGuide`, `formatAgentGuide`.

Example fixture: `examples/multi-skill-extract/journey.json`.

## 0.4 migration

`SkillSource` and the deprecated product `Recipe` shape remain readable. If they do not carry a native contract (`contract_version: "1.0"`):

- continuity compiles with `semantic_contract: "legacy_lossy"`, explicit losses, and `needs_human_review`
- release compilation refuses with `missing: ["semantic_contract"]`
- minting refuses because a native approved release compilation report is absent

Migration requires an agent to scaffold a contract, map the source meaning into every declaration, assess it, and obtain real human semantic review. Placeholder inference is never upgraded into release semantic completeness.
