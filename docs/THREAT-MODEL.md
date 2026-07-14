# Threat model (PROTO-10)

Status: **living document** — describes threats against the reference
implementation as of protocol Draft 0.5.0 / reference packages 0.9.9. Update
this file in the same commit as any change to trust semantics, container
parsing, or the runtime capability gate (same rule as
[PROTOCOL.md](./PROTOCOL.md)).

This document maps concrete threats to concrete mitigations and the test or
spec section that proves each mitigation holds. It is the map; the
[SECURITY.md](./SECURITY.md) practice list and the adversarial corpus
(`packages/cli/src/adversarial.test.ts`) are the territory.

## Actors

- **Skill author** — an agent (or human, via an agent host) that produces a
  `SkillSource`/`SkillContract` and compiles it.
- **Issuer** — whoever mints a package (`mintSkillPackage`). May be the same
  party as the author, or a separate CI/org pipeline.
- **Distributor** — whoever moves the `.skill` bytes from issuer to consumer:
  a registry, a file share, a chat attachment, npm, a git repo. Not a
  protocol-trusted role — the protocol assumes distribution channels are
  hostile by default (see "Threat: in-transit tampering" below).
- **Consumer host** — the agent runtime that validates, inspects, and
  potentially executes a package (`@skillerr/runtime`, or any second
  implementation per [ROADMAP.md](./ROADMAP.md)).
- **Reviewer** (RFC 0002, not yet implemented) — a human or process that
  countersigns a package independently of the issuer.

## Assets

1. **Consumer host integrity** — the filesystem, network, and secrets the
   runtime touches while executing a skill. The highest-value asset; most
   threats below ultimately aim here.
2. **Trust labels** — `trust_state`/`trust_profile`/`issuer_class` on a
   package. If these can be forged upward (e.g. `development` presented as
   `verified_issuer`), every downstream consumer that gates on trust is
   compromised without knowing it.
3. **Package integrity** — the claim that the bytes a consumer inspects are
   the bytes the issuer sealed (`sealed_manifest_digest`, `package_digest`,
   per-file content digests).
4. **Author/issuer identity claims** — `agent.host`, `human_approvals`,
   `issuer_class`. Overclaiming here (BUG-2, BUG-3) misleads a human reviewer
   about who is accountable for a package's contents.
5. **Availability of the consumer host** — resource exhaustion (zip bombs,
   unbounded entry counts) is a threat even against a package that never
   reaches `execute`.

## Trust boundaries

```
 author -> [compile] -> source/contract -> [mint] -> sealed package
                                                         |
                                              (untrusted distribution)
                                                         v
                                          consumer: validate -> inspect -> (gate) -> execute
```

Every arrow crossing from "produced by someone else" into the consumer host
is a trust boundary: `validatePackageBytes`, `inspectTrustView`, and
`assertCapabilityAllowed` are the three checkpoints. The protocol's central
design commitment (stated in [PROTOCOL.md](./PROTOCOL.md) and enforced
throughout this tier's fixes) is that **crossing a boundary must produce
either a distinct machine-readable refusal code or an honestly-labeled trust
state — never a silent accept and never a silently-upgraded claim.**

## Threats and mitigations

### T1 — Malicious archive structure (zip-level attacks)

**Threat**: a `.skill` is a zip; zip parsers have a long history of path
traversal, zip-bomb, and duplicate-entry exploits (CVE classes affecting
nearly every archive library at some point).

| Attack | Mitigation | Verified by |
|---|---|---|
| `../` path traversal in an entry name | `normalizePath` rejects traversal segments (`UnsafePathError`, code `path_traversal`) | `adversarial.test.ts`: "../ traversal entry" |
| Absolute path / `C:/` drive-letter entry | `normalizePath` rejects (`windows_absolute_path`, `absolute_path`) | `adversarial.test.ts`: "C:/ absolute entry" |
| Null byte in entry name | rejected (`null_byte`) | `paths.ts` unit coverage in `core.test.ts` |
| Zip bomb (extreme compression ratio) | streaming `unzipWithLimits` aborts mid-decompression on entry-count / uncompressed-size / ratio limits (`UnsafeZipError`, `suspicious_compression_ratio`) — SEC-D/SEC-E | `adversarial.test.ts`: "zip bomb" |
| Duplicate entries (e.g. two `skill.json`, ambiguous which wins) | streaming reader refuses on first duplicate (`duplicate_entry`) rather than silently taking last-write-wins | `adversarial.test.ts`: "duplicate skill.json entries" |
| Symlink-shaped entry content | inert — `unpackSkill` never performs real filesystem extraction, entry bytes are opaque data (see [SECURITY.md](./SECURITY.md) "Residual risk") | `adversarial.test.ts`: "symlink-style entry content is inert" |
| Content-type / format confusion (renamed to `.zip`, served with wrong `Content-Type`, or a plain zip crafted to look like a `.skill`) | not yet mitigated at the container-magic level — **gap**, see RFC 0005 | RFC 0005 (spec only) |

### T2 — Integrity tampering (bytes changed after sealing)

**Threat**: a distributor (or a compromised registry, or a MITM on an
insecure transport) modifies package bytes after the issuer sealed them —
swapping a knowledge file, escalating a capability, or altering a permission
without re-signing.

| Attack | Mitigation | Verified by |
|---|---|---|
| Per-file content tampering (e.g. rewritten knowledge body) | `manifest.content[]` per-file digests checked in `validatePackageBytes`; mismatch → `digest_mismatch` | `adversarial.test.ts`: "tampered knowledge content digest" |
| Manifest-field tampering (e.g. capabilities escalated to `exec.shell` post-seal) | `manifest_digest` (SEC-F, `sealedManifestDigest`) recomputed and checked; mismatch → `manifest_digest_mismatch` | `adversarial.test.ts`: "tampered manifest capabilities" |
| Whole-package tampering | `package_digest` (content-only, excludes `skill.json`/`signatures/`) checked | `core.test.ts` pack/unpack round-trip |
| Non-deterministic repacking hiding a diff in re-ordered bytes | `packSkill` sorts entries + fixes `mtime` (SEC-J) so the same source always produces byte-identical output, making any diff meaningful | `core.test.ts` determinism test |
| Canonicalization divergence between implementations masking a semantic change as a digest match (or vice versa) | RFC 8785 (JCS) pinned with cross-implementation test vectors, including the UTF-16-vs-code-point surrogate-pair gotcha (SEC-K) | `fixtures/canonicalization/vectors.json`, [CANONICALIZATION.md](./CANONICALIZATION.md) |

### T3 — Trust-label forgery / claim escalation

**Threat**: a package presents itself as more trustworthy than it is —
either by fabricating a signature, by exploiting a verifier bug that
upgrades an unverifiable claim to a verified one, or by hand-editing
self-reported fields.

| Attack | Mitigation | Verified by |
|---|---|---|
| `issuer_class` stripped post-seal so verifier falls back to a permissive default | `verifyMintTrust` throws `missing_issuer_class` instead of reconstructing from `key_id` (BUG-3) | `adversarial.test.ts`: "stripped issuer_class" |
| `SKILL_HOST=cursor` env var alone claimed as strong provenance | denylisted mint hosts (`human`, `cli`, `shell`, ...) refuse mint; env markers alone never produce `verified_issuer` | `docs/MINT.md`, `docs/SECURITY.md` "SKILL_HOST / anti-spoof" |
| Public-dev HMAC (`dot-skill-dev-mint-key`, world-known) presented as production trust | `execute` refuses `trust_state=development` packages unless `--allow-untrusted` is explicit | `adversarial.test.ts`: "dev-HMAC-minted package still refuses execute" |
| `sig_alg`/seal-version confusion (a downgrade or cross-algorithm replay) | `verifyMintTrust` checks `sig_alg` before comparing the signature; unknown/mismatched version → `unsupported_seal_version` (SEC-G) | `core.test.ts` mint/verify coverage |
| Symmetric (HMAC) trust cannot scale beyond one org — anyone who can verify can also forge, so "verified_issuer" over HMAC only ever means "shares my secret," not "signed by a key I trust without being able to impersonate it" | **Mitigated (Phase 10)** — `issuer_class=configured_ed25519`, verified against a local pinned trust store; a missing/expired/host-mismatched pin refuses (`trust_store_key_not_found`/`_expired`/`_host_not_allowed`), never a silent downgrade | `core.test.ts` PROTO-2 tests, [KEY-CEREMONY.md](./KEY-CEREMONY.md), RFC 0001 |
| A single attestation conflates "an agent authored this" and "a human reviewed this" under one signer — a compromised issuer key forges both claims at once | **not yet mitigated** | RFC 0002 (independent review countersignature) |
| A compromised or since-revoked key's packages remain fully trusted forever after distribution | **not yet mitigated** — no revocation channel exists | RFC 0003 (revocation records, `expires_at`) |
| `inspectSkill`'s summary conflated an unverified self-reported "sealed" claim with an actually-verified one, making a hand-edited `mint_status: "minted"` field read as trustworthy at a glance | `claimsSealed` logic fixed, relabeled `CLAIMS SEALED (unverified — run \`skill inspect --trust\`)` | `docs/SECURITY.md` "Inspect before run"; `core.test.ts` |
| A public transparency-log anchor (Phase E, `--transparency`) is misread as elevated trust — "this is logged publicly" mistaken for "this is safe/verified" | `verify-trust`'s `transparency` field is structurally separate from `trust_state`; anchor presence never upgrades trust classification. Explicit "inclusion ≠ endorsement" framing throughout [docs/TRANSPARENCY.md](./TRANSPARENCY.md) | `transparency.test.ts`; CLI output shape (`trust_state` and `transparency` are sibling fields, never merged) |

### T4 — Runtime capability escalation (execute-time)

**Threat**: a package's declared permissions are honest, but the runtime's
enforcement of them is exploitable — a network host allowlist that matches
substrings, a path allowlist that doesn't normalize `..`, or a capability
that's exempted from the deny-by-default gate.

| Attack | Mitigation | Verified by |
|---|---|---|
| Host allowlist bypass via substring/prefix match (`example.com` matching `evil.com/?q=example.com` or `example.com.attacker.io`) | `hostMatchesAllowlist` uses WHATWG `URL` parsing + exact-or-`*.`-suffix match only (SEC-A) | `runtime.test.ts` |
| Path allowlist bypass via unnormalized traversal (`/data/../etc/passwd` against a `/data` root) | `isPathWithinRoot` posix-normalizes both sides before the prefix check (SEC-B) | `runtime.test.ts` |
| `read` capability silently exempted from deny-by-default (an early design gap) | removed — `read` is gated exactly like `write`/`destructive` (SEC-H) | `runtime.test.ts` |
| `exec` capability had **no deny-by-default branch at all** in `assertCapabilityAllowed` — a bundled-script `tool` step invoking an `exec`-class capability was silently allowed regardless of declared permissions or consent, found while writing Phase 4's bundled-script docs (the most dangerous side_effect_class to have had this gap) | `exec` now requires a declared permission exactly like `read`/`write`/`destructive` (Phase 4) | `runtime.test.ts`, `conformance.test.ts` "a tool step backed by a bundled exec-class script..." |
| Missing consent treated as implicit allow | consent failure is closed (refuse), never open | `runtime.test.ts` |
| Permission grammar itself is under-specified, letting an author write an ambiguous or unintentionally broad host/path pattern that a naive verifier accepts | `isValidHostPattern`/`isValidPathPattern` (PROTO-5) constrain grammar to exact hostnames, `*.`-suffix wildcards, absolute normalized paths, or whole `{{name}}` placeholders — checked at both authoring and validation time | `protocol.test.ts` grammar tests |
| A `{{name}}` placeholder permission is grammar-valid but the runtime doesn't actually resolve it against the input's runtime value before matching — a gap between "looks scoped" and "is scoped" | tracked as a known gap, not silently ignored | [ROADMAP.md](./ROADMAP.md) "Next" |
| `subskill`/`delegate` workflow steps pass every validation/mint check but throw unconditionally at execute time — worse than refusing earlier, since a hostile package could deliberately place undeclared behavior behind a step kind that's "valid but unrunnable" as a distraction from what other steps actually do | **not yet mitigated** — no resolution semantics exist yet | RFC 0004 (subskill resolution, cycle detection, `delegate` marked experimental) |

### T5 — Author/issuer identity overclaiming

**Threat**: the package fabricates or exaggerates who is accountable for it
— a human approval that never happened, a workspace boundary that doesn't
actually confine authored files to the declared agent.

| Attack | Mitigation | Verified by |
|---|---|---|
| `human_approvals.actors` present-but-empty read as "attested" by a careless consumer | explicit `attested: (actors?.length ?? 0) > 0` boolean added, never implied (BUG-2) | `core.test.ts` mint coverage |
| A workspace section file authored outside the declared agent boundary silently included as if agent-authored | `listSectionFiles()` rejects non-`"agent"`-sourced files | `workspace.test.ts` |
| `compile.ts`'s `created_at` silently replaced with wall-clock mint time, erasing when the source actually existed | `compilation_report.created_at` now defaults to `source.created_at`, not `new Date()` | `core.test.ts` |
| A `contract_missing`/`contract_unparsable` source silently falls back to a lossy legacy path instead of surfacing the failure | `contract_load_error` surfaced in refusal hints (release profile) rather than swallowed | `cli/conformance.test.ts` |

### T6 — Resource exhaustion / availability

**Threat**: a package (even one that never reaches `execute`) exhausts
consumer host resources merely by being validated or inspected.

| Attack | Mitigation | Verified by |
|---|---|---|
| Zip bomb during validation/inspection (not just execution) | streaming decompression with incremental limits applies to every unpack call, not just an execute-time path | `adversarial.test.ts` |
| Unbounded entry count | entry-count limit enforced during streaming unzip | `adversarial.test.ts` (covered by the same bomb fixture's ratio+size+count checks) |

### T7 — Supply-chain / package-manager-level threats

**Threat**: threats that live outside the `.skill` container format
entirely — in how the reference implementation itself is distributed.

| Attack | Mitigation | Verified by |
|---|---|---|
| `install.sh` pulling `@latest` lets a compromised npm publish reach every new installer immediately | pinned to an exact version, prints installed version | `install.sh` |
| Test files leaking into the published npm tarball (dead weight, and a larger attack surface for anyone auditing what actually ships) | `files` field negation (`!dist/**/*.test.js`) per package | `npm pack --dry-run` (Tier 3) |
| Dependency confusion / similarly-named npm packages impersonating `@skillerr/*` | prefer verifying package identity and digests; no automated mitigation in-repo today | [SECURITY.md](./SECURITY.md) "Threats" |
| No IANA-registered media type — a generic zip/file-type sniffer has no authoritative signal to distinguish a `.skill` from an arbitrary zip | **not yet mitigated** | RFC 0005 |

## Explicitly out of scope / residual risk

Carried forward from [SECURITY.md](./SECURITY.md) "Residual risk" and stated
here because a threat model should say what it does *not* cover, not just
what it does:

- **Model/agent honesty.** A seal proves which key signed which claims. It
  cannot prove a named local LLM or agent host was honest about authorship,
  intent accuracy, or the correctness of the skill's content. Treat every
  host/provider/model field as a claim under that key's honesty, never as an
  independently verified fact.
- **Prompt injection via resources.** A skill's `knowledge/`/`resources/`
  content is, from the runtime's perspective, attacker-controlled text fed
  to a model. The capability/permission gate constrains what *actions* an
  agent can take as a result, but does not and cannot sanitize the semantic
  content of what an agent reads.
- **Real filesystem extraction.** `unpackSkill` never writes to disk or
  follows symlink-shaped content — this is why T1's symlink row is inert
  today. Any future host that adds real extraction (e.g. Phase 4's
  bundled-script execution) inherits a new, currently-unaddressed obligation
  to independently validate against symlink/hardlink escapes at extraction
  time, not container-parse time.
- **Second-runtime divergence.** Every mitigation in this document is
  enforced by the reference TypeScript implementation only. Until a second
  independent runtime reproduces the adversarial corpus and canonicalization
  vectors byte-for-byte (see [ROADMAP.md](./ROADMAP.md)), a spec-level gap
  between "what PROTOCOL.md says" and "what the only implementation happens
  to do" cannot be ruled out.

## Open mitigations tracked as RFCs

Every "not yet mitigated" row above has a corresponding spec-only RFC rather
than a silently-dropped gap:

| Threat | RFC |
|---|---|
| Symmetric-trust ceiling (T3) | **Implemented** — [RFC 0001](./rfcs/0001-asymmetric-signatures-trust-store.md) (see status note in that doc) |
| Single-signer conflation of authorship + review (T3) | [RFC 0002](./rfcs/0002-human-review-countersignature.md) |
| No revocation channel (T3) | [RFC 0003](./rfcs/0003-revocation-expiry.md) |
| Dangling `subskill`/`delegate` step kinds (T4) | [RFC 0004](./rfcs/0004-dangling-step-kinds.md) |
| No container-level magic identification (T1, T7) | [RFC 0005](./rfcs/0005-media-type-magic-identification.md) |
| Unauditable derivation chain across continuity checkpoints (T5, adjacent) | [RFC 0006](./rfcs/0006-lineage-chain.md) |

Production key-ceremony practice (how an org actually generates, stores, and
rotates a `configured_ed25519`/`configured_hmac` issuer key, once RFC 0001
ships code) is intentionally not specified in this document — see the
forthcoming `docs/KEY-CEREMONY.md` (Phase 10).
