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

## Container

```text
example.skill
├── skill.json
├── workflow.json
├── knowledge/
├── prompts/
├── resources/
├── artifacts/
├── provenance/          # journey + usage + compilation_report
└── signatures/          # attestation + optional anchors
```

## Integrity & trust

- Canonical JSON for the package index: JCS-inspired serialization · Digests: `sha256:<hex>`
- `package_digest` excludes `skill.json` and `signatures/**`
- **`sealed_manifest_digest`** binds identity + permissions/policy/capabilities + content claims inside the creation seal
- **Valid** = package structure + digests
- **Minted** = signed creation attestation; TrustView states: `untrusted` | `development` | `self_reported` | `verified_issuer`
- The bundled development HMAC signer is **never** production trust (`issuer_class=public_dev_hmac`)
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

## Source adapters

External source models map into **section / SkillSource / SkillContract / compile**
through adapters. Legacy text-only sources remain continuity-only and lossy.
See [ADAPTERS.md](./ADAPTERS.md).

Distribute the compiled `.skill` file directly or through a compatible registry.
