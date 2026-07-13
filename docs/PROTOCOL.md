# Open `.skill` Protocol

**Status:** Draft 0.5.0  
**Extension:** `.skill`  
**Media type:** `application/vnd.dot-skill+zip`

Markdown is never the protocol. A `.skill` is a deterministic ZIP with a
protocol-native authoring contract, typed inputs, executable workflow,
knowledge, redacted journey provenance, optional generation token usage, and
mint attestation.

## Profiles

| Profile | Compile if incomplete? | Mint? |
|---|---|---|
| `continuity` | Soft gaps OK; hard gaps refuse | No |
| `release` | **Refuse** (`compile_refused`) | Yes, when complete + approved |

## Required components (release)

1. **Agent context** — declared agent host, provider, model, and deployment when known
2. **SkillContract** — complete 0.5 semantic source of truth
3. **Intent and triggers** — purpose and when to apply it
4. **Typed inputs and outputs** — schemas, optionality, defaults, sensitivity, ask and approval policy
5. **Workflow** — ordered steps, branches, decisions, failure/recovery edges
6. **Safety boundary** — capabilities, permissions/consent, forbidden actions
7. **Verification** — domain assertions and evidence expectations
8. **Learning and provenance** — corrections, evidence, limitations, redacted journey
9. **Human semantic review** — recorded actor, time, and scope; never inferred from a flag

Every list declaration is `specified`, explicit `none`, or explicit
`not_applicable`. Ambiguous omission refuses release. See
[AUTHORING-CONTRACT.md](./AUTHORING-CONTRACT.md).

Optional: `generation_usage` (tokens).

## Vocabulary

| Term | Meaning |
|------|---------|
| **section** | Atomic authored unit (decision, integration, lesson, …) |
| **SkillSource** | Structured authoring input before compile |
| **SkillContract** | Transferable semantic contract (0.5+) |
| **extract / segment** | Agent-identified candidates → incomplete contract scaffolds + missing reports |
| **compile** | Source → `.skill` package (continuity or release) |
| **mint** | Seal a complete release with creation attestation |
| **load** | Resume continuity context in another agent |

Multi-skill create path for agents: `skill agent-guide` → identify candidates →
`skill extract` → one workspace per skill → `contract-check` / `status` →
checkpoint or release compile. See [AGENT.md](./AGENT.md).

## Agent provenance

Reference creation paths require an agent host declaration (CLI with
`SKILL_HOST`, an IDE extension, or an app wrapping `@skillerr/core`). Local
and offline model hosts are supported. Hosts in the denylist (`human`, `cli`,
`shell`, `manual`, …) cannot mint. `SKILL_HOST` alone is **self_reported**
provenance and never `verified_issuer` trust. Public-dev HMAC seals are
labeled `development`. These fields do not prove that a named model performed
the work — especially local LLMs.

`manifest.authors` and `attestation.human_approvals` never fabricate a human
identity: authorship defaults to `agent:<host>`, and approval evidence
(`human_approvals.actors`) is empty with `attested: false` unless a caller
actually supplied it. A human semantic reviewer is only ever recorded in
`contract.provenance.human_review`. See [MINT.md](./MINT.md).

## Local workspace

`.skill/` working tree: `sections/`, stage index, optional authored
`contract.json`, compile → package. A workspace without an authored contract
compiles continuity-only (lossy, loud `contract_missing`/`contract_unparsable`
report entries); release always refuses without one. See
[WORKSPACE.md](./WORKSPACE.md).

## Eval / benchmark (Phase 2)

An optional `contract.evals[]` array of test-prompt-plus-assertion cases.
`skill eval` grades what's honestly machine-checkable, leaves the rest
`pending_human`, and never fabricates a pass. `skill eval --attach` seals
the result into `provenance/benchmark.json` on the next compile. See
[EVAL.md](./EVAL.md).

## Quality score (Phase 3)

`provenance/score.json` is an **optional** sealed receipt — a
`@skillerr/skill-score` `ScoreResult` (score, confidence, coverage,
per-dimension breakdown, evidence receipt ids). Scoring is a separate,
independently-versioned package with its own formula and gate caps; this
protocol only reserves the container slot and the mapping from
`provenance/benchmark.json` into that package's evidence-receipt input —
see `skill score` in the reference CLI. A package's `package_digest`
excludes `signatures/**` but includes every other file, so `score.json`
(like `benchmark.json`) is covered by the package's own integrity digest —
tampering with either after packing is detectable the same way tampering
with any other content file is.

## Bundled scripts + progressive disclosure (Phase 4)

`resources/scripts/*` and `resources/references/*` are established naming
conventions (not distinct container primitives) for the two most common
`skill-creator` patterns — a bundled helper script, and reference material
too large for the primary knowledge body. A script never auto-executes:
its capability, a matching permission, and a `tool` step invoking it must
all be present, and the runtime's deny-by-default gate checks every
`side_effect_class` — including `exec` — the same way it checks
`read`/`write`/`destructive`/`network`. See [RESOURCES.md](./RESOURCES.md).

## Container

```text
example.skill
├── skill.json
├── workflow.json
├── knowledge/
├── prompts/
├── resources/
├── artifacts/
├── assets/icon.*         # optional per-skill icon — see "Format icon slot" below
├── provenance/          # journey + usage + compilation_report + optional benchmark/score
└── signatures/          # attestation + optional anchors
```

### Format icon slot

`assets/icon.svg` or `assets/icon.png` is an **optional** reserved path a
skill author MAY include to give that individual skill its own visual mark
— e.g. a registry listing, a file browser, or an agent UI that renders a
grid of installed skills can show `assets/icon.*` instead of (or alongside)
the generic Skillerr `.skill` format mark
([`skillerr/assets/skillerr-mark.svg`](../assets/skillerr-mark.svg)) when
one is present.

This is purely presentational and Java-duke/PDF-icon-style: the format
itself (`.skill`) has one identity (the format mark, generated by
[`scripts/build-brand.mjs`](../scripts/build-brand.mjs)); an individual
skill file MAY additionally carry its own icon the way a `.jar` can bundle
an app icon distinct from the Java duke logo, or a PDF viewer shows a
document thumbnail instead of the generic PDF icon. A host that doesn't
support custom icons simply falls back to rendering the generic format
mark — `assets/icon.*` is never required, and its absence is not a
validation issue.

`assets/icon.*` is not a distinct container primitive: it's just another
file under the package, digested and listed in `manifest.content[]` like
every other resource (`assets/`, `resources/`, `artifacts/`, …). It is not
sealed or trust-scored any differently — no special-cased validation rule
exists for it in `skill validate`, and none is planned; it only needs a
stable, agreed-upon path so tooling across hosts/registries can look in
the same place. A skill with no `assets/icon.*` is exactly as valid as one
that has it.

For how the generic `.skill` format mark itself is generated and how a
real OS would register `.skill` as a recognized file type (distinct from
Claude Desktop's own `.skill` claim), see
[FILE-TYPE.md](./FILE-TYPE.md).

### JSON Schemas (PROTO-7)

Every structured container file has a published draft 2020-12 JSON Schema
under `packages/protocol/`, and `skill validate` checks each entry against
its schema (not just the hand-written required-field checks that predate
this): `skill-contract.schema.json`, `skill-manifest.schema.json`
(`skill.json`), `workflow.schema.json` (`workflow.json`, with a step-kind
union covering all 12 kinds), `knowledge-item.schema.json` (each
`knowledge/*.json`), and `creation-attestation.schema.json`
(`signatures/creation.dsse.json`). A schema failure is a `schema_*` issue
code (`schema_manifest`, `schema_workflow`, `schema_knowledge_item`,
`schema_creation_attestation`) alongside the existing semantic checks. Load
them at runtime via `@skillerr/protocol`'s `loadSchema(name)` rather than a
raw file path, so the lookup works the same whether the package is a
workspace symlink or an installed npm dependency.

## Permission grammar (PROTO-5)

`permission.hosts` and `permission.paths` are not bare ad hoc strings —
they're validated against a specific grammar (`@skillerr/protocol`'s
`isValidHostPattern` / `isValidPathPattern`), at both contract-authoring
time (`assessSkillContract`) and manifest-validation time
(`skill validate`), so a malformed declaration is refused before it ever
reaches a runtime. This is the root-cause fix behind SEC-A (host
substring/prefix bypass) and SEC-B (path traversal past a filesystem root)
staying fixed: runtimes match against pre-validated patterns instead of
each having to re-derive "is this well-formed" independently.

- **Hosts**: an exact hostname (`example.com`), or a `*.` suffix wildcard
  (`*.example.com`) matching any subdomain — `*` only ever as a whole
  leading label, never embedded (`ex*.com` is invalid), never a bare `*`.
  Never a full URL, port, or IP/CIDR.
- **Paths**: an absolute, forward-slash path with normalized segments
  (`/data`, `/home/user/project`) — no backslashes, no `.`/`..` segments,
  no empty segments, not relative. Declaring a path grants everything
  rooted under it (matches the runtime's prefix-based matching); there is
  no separate glob syntax because the runtime doesn't implement one.
- **Placeholders**: a whole-string `{{input_name}}` referencing a declared
  input (the same convention used for input references in section/prompt
  bodies) is grammar-valid for both hosts and paths — see the
  `scoped-npm-monorepo-publishing` gold example's
  `paths: ["{{workspace_root}}"]`. **Known gap:** the reference runtime
  does not yet resolve these against the input's runtime value before
  matching, so a placeholder permission cannot currently match anything.
  Grammar-valid, not yet functional — tracked in [ROADMAP.md](./ROADMAP.md).

## Integrity & trust

- Canonical JSON for the package index: **RFC 8785 (JCS)** — see
  [CANONICALIZATION.md](./CANONICALIZATION.md) for the exact byte-level rules and
  cross-implementation test vectors under `fixtures/canonicalization/` · Digests: `sha256:<hex>`
- **`skill_id`** (PROTO-1) is content-addressed — `skl_<sha256-prefix>` derived from
  `source.hash` (and `source.contract`, when present), not a random UUID. The same
  logical skill compiled twice gets the same identity; a human-friendly label still
  lives in `manifest.title`, separate from `id`
- Compiling the same `SkillSource` twice is **byte-identical** (SEC-J): the zip
  container uses a sorted entry order and a fixed per-entry mtime (fflate defaults
  to wall-clock, which alone broke this), and `compilation_report.created_at`
  derives from `source.created_at` / an explicit `opts.created_at`, never
  `new Date()`. Enforced by a determinism test in CI on ubuntu/windows/macos
- `package_digest` excludes `skill.json` and `signatures/**`
- **`sealed_manifest_digest`** binds identity + permissions/policy/capabilities + content claims inside the creation seal — present only once minted
- **`manifest_digest`**: the same identity/permissions/policy/capabilities/content claim set, self-digested at pack time and checked by `skill validate` on *every* package, minted or not (`manifest_digest_missing` / `manifest_digest_mismatch`). Without it, `package_digest` excluding `skill.json` plus `sealed_manifest_digest` only existing post-mint meant a draft/continuity package's own permissions/capabilities/policy carried no integrity binding at all — hand-edited tampering passed `skill validate` silently. For a minted package `manifest_digest` equals `sealed_manifest_digest` (same computation over the post-seal policy state)
- **Valid** = package structure + digests
- **Minted** = signed creation attestation; TrustView states: `untrusted` | `development` | `self_reported` | `verified_issuer`
- The bundled development HMAC signer is **never** production trust (`issuer_class=public_dev_hmac`)
- Production signing uses `issuer_class=configured_ed25519` (PROTO-2 / RFC 0001), a real
  asymmetric keypair verified against a local pinned trust store, not a shared secret —
  see [MINT.md](./MINT.md) and [KEY-CEREMONY.md](./KEY-CEREMONY.md)
- `SKILL_HOST` alone is self-reported provenance — not proof of authorship (especially for local LLMs)
- Digests and seals are **inspectable without executing** (`skill inspect --trust`)
- Runtime **deny-by-default** for undeclared network / filesystem / secrets; execute refuses untrusted seals without explicit opt-in
- `manifest.inputs` and `manifest.policy.consent_for` are required and structurally
  checked by `skill validate` (`inputs_missing` / `policy_missing` /
  `policy_consent_for_missing`) — a package with either stripped fails validation
  instead of the runtime's consent gate silently treating the field as empty
- `verify-trust` requires `attestation.issuer_class` to be present; a stripped
  value is `missing_issuer_class`, never reconstructed from `key_id`
- `redactSecrets()` skips pure hex runs (git SHAs, sha256/sha1 content digests) so
  they survive packaging unchanged; every other redaction is a `secret_redacted`
  entry in `compilation_report.issues`, never a silent content change
- `unpackSkill` reads the archive through a streaming unzip so unsafe input is
  refused *during* decompression, not after: a duplicate entry name (e.g. two
  `skill.json`) is `duplicate_entry` the moment it's seen — its payload is
  never even decompressed — and entry-count / uncompressed-size / compression-
  ratio limits abort mid-stream instead of only being checked once a zip bomb
  has already been fully inflated into memory. Every rejection is a distinct
  `UnsafeZipError.code` (`duplicate_entry`, `too_many_entries`,
  `uncompressed_size_exceeded`, `suspicious_compression_ratio`, …)

## Source adapters

External source models map into **section / SkillSource / SkillContract / compile**
through adapters. Legacy text-only sources remain continuity-only and lossy.
See [ADAPTERS.md](./ADAPTERS.md).

Distribute the compiled `.skill` file directly or through a compatible registry.

## Protocol/CLI compatibility

Every package's `skill.json` carries `protocol_version`. `skill validate`
(and `skill inspect`) compares it against the running CLI's
`PROTOCOL_VERSION` **exactly** — not a semver range, not best-effort. A
mismatch is a hard, explicit `protocol_version` validation error; a package
is never read leniently against a protocol version the running CLI wasn't
built for.

| `skillerr` npm version | Reads/writes `protocol_version` |
|---|---|
| 0.6.x | `0.5.0` |

Update this table on every protocol version bump. If you're implementing a
second runtime (see [ROADMAP.md](./ROADMAP.md)), match this policy exactly:
refuse on any `protocol_version` you don't implement rather than guessing
forward/backward compatibility.
