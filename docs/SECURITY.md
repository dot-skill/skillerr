# Security

For the full threat/mitigation map (what's defended, what's explicitly out of scope, and which RFC tracks each open gap), see [THREAT-MODEL.md](./THREAT-MODEL.md). For a plain-language breakdown of what any given trust state does and does not prove, see [TRUST-MODEL.md](./TRUST-MODEL.md) and [WHAT-IS-VERIFIABLE.md](./WHAT-IS-VERIFIABLE.md).

## Practice

- **Inspect before run** — `skill inspect --trust` shows TrustView (seal, issuer, host/model claims, digests) without compiling or feeding package body to a model
- Plain `skill inspect` (no `--trust`) never verifies a signature — it's a structural summary. A package that merely claims `mint_status=minted` + `attestation_digest` (self-reported manifest fields, trivially hand-edited) is labeled `CLAIMS SEALED (unverified — run \`skill inspect --trust\`)`, never a bare "SEALED" that reads as already-verified
- Validate before extract; reject traversal (`../`), absolute/drive-letter paths, bombs, digest mismatch (whole-package and per-file), and duplicate zip entries — unpacking streams through the archive so bomb/duplicate checks abort mid-decompression rather than after a malicious archive has already been fully inflated. Every rejection has a distinct machine-readable code (`UnsafePathError.code` / `UnsafeZipError.code` / `ValidationIssue.code`) — see the adversarial corpus below
- Secrets never embedded — references only
- **Deny-by-default runtime** — undeclared network / filesystem / exec / secret capabilities are refused; missing consent fails closed. This includes `read` and `exec`: a declared permission is required for every `side_effect_class`, no exemptions (bundled-script `tool` steps go through the same gate — see [RESOURCES.md](./RESOURCES.md))
- Network host allowlists match the parsed hostname exactly, or a `*.example.com` suffix — never a bare substring/prefix (`example.com` does not match `evil.com/?q=example.com` or `example.com.attacker.io`)
- Filesystem `permission.paths` / `policy.filesystem_roots` checks normalize the candidate path first, so `/data/../etc/passwd` cannot pass a `/data` root check
- **Unsigned / open packages** are labeled untrusted; `execute` refuses them unless `--allow-untrusted`
- Reference mint HMAC (`dot-skill-dev-mint-key`) is **public-dev only** — TrustView labels it `development`, never production trust
- Trust profiles: `open` | `minted` | `anchored` | `issuer:<id>`
- Trust states: `untrusted` | `development` | `self_reported` | `verified_issuer`

## SKILL_HOST / anti-spoof

- Denylisted mint hosts: `human`, `cli`, `shell`, `manual`, `bash`, `terminal`, … — mint refuses
- Exporting `SKILL_HOST=cursor` alone **cannot** produce `verified_issuer` trust
- Seals record `host_claim_binding` (`self_reported` vs `verified_issuer`) and `issuer_class`
- Agent runtime markers (`SKILL_AGENT_INVOCATION`, `SKILL_SESSION_ID`, Cursor markers, …) strengthen the mint path but are still locally spoofable

## Seal binding

Creation seals cover `sealed_manifest_digest`: title, intent, permissions, policy, capabilities, input sensitivity, content digests, and contract summary — not only workflow/knowledge bytes.

## Adversarial fixtures corpus

`packages/cli/src/adversarial.test.ts` is a consolidated corpus of hostile
`.skill` inputs, run as part of the normal `npm test` (and therefore the
CI matrix on ubuntu/windows/macos): a `../` traversal entry, a `C:/`
absolute entry, a zip bomb, duplicate `skill.json` entries, a tampered
per-file content digest, tampered manifest capabilities, a stripped
`issuer_class`, and a dev-HMAC-minted package confirming `execute` refuses
it (`trust_state=development`) without `--allow-untrusted`. Every case
asserts a *distinct* code — never a crash, never a silent accept. A second
independent implementation (see [ROADMAP.md](./ROADMAP.md)) should
reproduce every one of these before the protocol is called Stable.

## Residual risk

A seal proves which key signed which claims. It **cannot** prove that a named local LLM was honest about authorship. Treat host/provider/model fields as claims under that key’s honesty.

`unpackSkill` never performs real filesystem extraction (everything stays
in-memory as named byte blobs), so a zip entry with symlink-style external
attributes or symlink-shaped content is inert today — there is no real
path for it to escape through. If a future host adds real extraction (e.g.
executing a bundled script from `resources/`), it must independently
validate against symlink escapes at that point; this is not yet enforced
because there is nothing to enforce it against.

## Threats

Malicious packages, prompt injection via resources, tool escalation, dependency confusion
(including similarly named npm packages). Prefer verifying package identity and digests.

Report vulnerabilities privately — see [SECURITY.md](../SECURITY.md).
