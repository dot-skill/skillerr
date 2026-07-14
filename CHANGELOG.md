# Changelog

## 0.8.1 — 2026-07-14

Launch Readiness Phase D — plain-language trust/threat/verifiability docs.
No behavior changes except one additive field.

- New `docs/TRUST-MODEL.md` — plain-language explanation of the four
  `trust_state` values, explicit that `development`/`self_reported` are
  not safe to run blindly, why `SKILL_HOST` alone is `self_reported`, why
  the bundled key is dev-only, and exactly when `execute` refuses.
- New `docs/WHAT-IS-VERIFIABLE.md` — attribute-by-attribute breakdown of
  what's cryptographically proven vs. key-bound-but-not-publicly-verifiable
  vs. purely self-reported. Linked prominently from README, FAQ, and
  `skill verify-trust`'s own JSON output (new `docs` field).
- New `docs/FROM-SKILL-CREATOR.md` — the exact `skill ingest` mapping
  table and what's always left for a human to complete before release.
- `docs/RUNTIME.md` gained a step-kind support matrix: all 12
  `WorkflowStepKind`s, executed vs. dry-run-only vs. always-refuses, with
  exact refusal messages for `delegate`/`subskill`/unsupported `tool`/
  `transform` cases.
- Fixed two more stale "reference mint is unconditionally dev-only HMAC"
  claims in `docs/FAQ.md` that earlier passes missed (same class of fix
  as 0.7.1/0.8.0, just a different file).

## 0.8.0 — 2026-07-14

Every package back to lockstep versioning (all 7 at the same number, all
internal `@skillerr/*` ranges matching) — fixes real version drift where
`core`/`runtime`/`skillerr` had quietly diverged from the rest. Bundles
Launch Readiness Phases A and B:

**Phase A — launch blockers:**
- `skill ingest` printed a stale `package_digest` — computed before
  resources/assets were merged into the compiled package, so it never
  matched what was actually written to disk. Now re-finalizes the
  manifest after the merge, before packing.
- `skill score` returned `ok:false` when the optional `@skillerr/skill-score`
  peer isn't installed, even though the mapped `assessment.json` was
  written successfully — not an error. Now `ok:true, scored:false` with
  a `notice` field.

**Phase B — first-run polish:**
- Registered `ajv-formats` so `validate`/`inspect --trust`/`score` stop
  printing `unknown format "date-time" ignored` noise.
- `skill score --emit` without `-o` silently overwrote the *original*
  input file — contradicting the CLI's own usage text, which promises
  "a sealed copy." Now defaults to a `<name>.scored.skill` sibling
  instead of touching the input.
- `skill_id` was already a content digest (stable across re-ingests of
  identical source) but this wasn't verified by a test or documented;
  `package_digest` is *not* stable across real-world re-ingests, because
  each run's `created_at` is a genuine distinct timestamp — that's
  correct provenance, not a bug. Both now locked in by a regression test
  and documented in docs/FAQ.md.

## 0.7.1 — 2026-07-14

`skillerr`, `@skillerr/core`, `@skillerr/runtime` only — README fixes.

- READMEs led with "Skillerr" as a brand title; `skillerr` is the package/CLI
  name, not the project identity — protocol-first framing to match the site.
- Fixed READMEs (`skillerr`, `core`, `runtime`) that still claimed reference
  mint is unconditionally dev-only HMAC; a configured Ed25519 signer key
  mints as `verified_issuer` (shipped in 0.7.0, docs hadn't caught up).

## 0.7.0 — 2026-07-14

First real publish of `@skillerr/protocol`, `@skillerr/core`, `@skillerr/runtime`,
`@skillerr/registry`, `@skillerr/workspace`, and `@skillerr/cli` since their
initial `0.6.0` release — that version was published on day one and never
updated, so every fix and feature below existed only on `main` until now.
`npm i -g skillerr` previously resolved `@skillerr/cli@^0.6.0`, which was
the pre-hardening skeleton; it now resolves `0.7.0`.

- Security hardening (Tier 0-4): closed network/filesystem allowlist
  bypasses, real HMAC-SHA256 seal envelope, manifest self-digest, streamed
  zip unpacking (duplicate-entry / zip-bomb resistant), adversarial
  package corpus run on every `npm test`, RFC 8785 canonicalization with
  cross-implementation vectors, content-addressed `skill_id`
- Pluggable Ed25519 issuer signer + local trust store
  (`issuer_class: configured_ed25519` → `trust_state: verified_issuer`),
  replacing dev-HMAC-only trust — see `docs/KEY-CEREMONY.md`
- `skill ingest`: forward `SKILL.md` → `.skill` conversion, distinct from
  the existing lossy `to-skill-md` export
- Native eval/benchmark loop (`skill eval`) with a sealed
  `provenance/benchmark.json`
- `@skillerr/skill-score` wired in as an optional dependency of the CLI
  (`skill score`) — gracefully degrades to a mapped `assessment.json`
  when not installed, never fabricates a number
- Structured permission grammar for `permission.hosts`/`.paths`, validated
  at both authoring and manifest-validation time
- JSON Schemas (draft 2020-12) for every container file, checked by
  `skill validate`
- Bundled-script / progressive-disclosure semantics
  (`resources/scripts/*`, `resources/references/*`); found and fixed a
  real gap where `exec`-class capabilities had no deny-by-default gate
- Public RFC folder (`docs/rfcs/`) — six RFCs
- Fixed `skill mint <file>` requiring a workspace even with an explicit
  file argument, unlike every other file-taking CLI command

## 0.6.4 — 2026-07-13

- New transparent `.skill` mark — coffee-wave scroll motif replaces stacked diamonds; teal accent on waves.
- Public homepage and doc links point at live GitHub Pages (`https://dot-skill.github.io/skillerr-com/`) until `skillerr.com` DNS is set.

## 0.6.3 — 2026-07-13

- Replace Arcane Shimmer banner with a plain diagrammatic `.skill` insides README banner (identity, instructions, capabilities, seal, assets).
- Update square mark to a clean `.skill` glyph; remove Shimmer from README hero copy.

## 0.6.2 — 2026-07-13

- Ship Arcane Shimmer brand identity (cinematic banner + pixel skill-core mark) for Skillerr / `.skill`.
- Supersedes provisional mark assets in README and the `skillerr` npm package.

## 0.6.1 — 2026-07-13

- Ship brand mark assets in the public `skillerr` npm package.
- Keep repository links on `dot-skill/skillerr` (renamed from `dot-skill`).

## 0.6.0 — 2026-07-13

- Renamed npm scope from `@dot-skill/*` to `@skillerr/*` (protocol, core, runtime, registry, workspace, cli).
- Public install remains `npm i -g skillerr` (bins: `skill`, `skillerr`).
- Homepage and docs point to [skillerr.com](https://dot-skill.github.io/skillerr-com/); repository URLs track `dot-skill/skillerr`.
- Local registry default path is `~/.skillerr/registry/log.jsonl` (reads legacy `~/.dot-skill/…` if present).
- Preserved `.skill` artifact extension and wire identifiers (`kind: "dot-skill"`, `application/vnd.dot-skill+zip`).

## 0.5.0 — 2026-07-13

- Added the product-neutral `SkillContract` as the release compilation source of truth.
- Added explicit declarations for triggers, typed inputs/outputs, preconditions,
  ordered steps, branches, human decisions, capabilities, permissions/consent,
  forbidden actions, recovery, verification, corrections, and provenance.
- Added contract scaffold, assessment, explanation APIs, CLI commands, and JSON Schema.
- Preserved structured contract fields in manifests and workflows.
- Made 0.4 text-only sources explicitly lossy and continuity-only.
- Added runtime refusal for unsupported assertions/branches and authenticated
  human-decision callbacks that cannot be spoofed with input values.
- Added approved npm-publishing gold-model conformance coverage.
- Added per-package READMEs and included them in npm tarballs.
- Public install package is `skillerr` (depends on `@skillerr/cli`, exposes the `skill` bin).
- Hardened public docs and CLI help for create vs ingest paths.
- Added agent multi-skill identify path: `skill agent-guide`, `skill extract` / `skill segment`,
  protocol `extractSkillCandidates` / `agentCreateGuide`, and incomplete SkillContract scaffolds
  with completeness reports (one workspace per candidate; release still refuses if incomplete).

## 0.4.3 — 2026-07-13

- Derived CLI, runtime, and attestation package versions from shipped package metadata.
- Added conformance coverage for package version reporting.

## 0.4.1 — 2026-07-12

- Added local and offline agent provenance fields.
- Enforced release completeness and approval checks before minting.
- Added runtime trust-profile checks and mandatory minted signatures.
- Added privacy scrubbing for journey, prompt, and endpoint provenance.
- Added MIT licensing, DCO sign-off, and npm release documentation.

## 0.4.0 — 2026-07-12

- Added continuity and release compile profiles.
- Added completeness gates and `CompileRefusalError`.
- Added agent host provenance and optional generation usage.
- Added workspace checkpoint, load, compile, and journey commands.
- Added public npm package configuration.

## 0.3.0

- Added the protocol, core, runtime, registry, workspace, and CLI packages.
