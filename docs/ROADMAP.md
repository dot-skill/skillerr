# Roadmap

Status: protocol **1.0.0 (Stable)**; reference packages **1.5.1**. The package number should always match [`packages/skillerr/package.json`](../packages/skillerr/package.json); if this line ever drifts from that file, the file wins. Maturity levels (Stable / Candidate / Preview) are defined in [GOVERNANCE.md](../GOVERNANCE.md). Everything below is Stable except `@skillerr/skill-score` (`skill score`), which is **Preview**, it's real and shipped, but its scoring interface may still change without a major bump.

## Now (done in this repo)

- [x] `.skill` container + digests
- [x] Mint + attestation (reference implementation)
- [x] Free local transparency-log registry
- [x] Reference runtime + CLI
- [x] Conformance tests
- [x] Docs, governance, CI
- [x] Local/offline agent provenance (Ollama, LM Studio, llama.cpp, custom)
- [x] Complete transferable `SkillContract`, assessment APIs, and JSON Schema
- [x] Structured contract-to-manifest/workflow compilation
- [x] Content-addressed `skill_id`; byte-identical repacking of the same source
- [x] RFC 8785 canonicalization pinned, with cross-implementation test vectors
      (`fixtures/canonicalization/`)
- [x] Adversarial package corpus (zip bombs, path tricks, hash mismatch,
      duplicate entries, tampered digests, stripped issuer_class) —
      `packages/cli/src/adversarial.test.ts`, run on every `npm test`
- [x] Structured permission grammar for `permission.hosts`/`.paths`
      (`@skillerr/protocol`'s `isValidHostPattern`/`isValidPathPattern`),
      validated at both contract-authoring and manifest-validation time
- [x] JSON Schemas (draft 2020-12) for every container file — contract,
      manifest, workflow, knowledge items, DSSE attestation — checked by
      `skill validate` via `@skillerr/protocol`'s `loadSchema()`
- [x] Production-grade signing: pluggable Ed25519 issuer signer + local
      trust store (`configured_ed25519`), replacing dev-HMAC-only trust —
      see [Key Ceremony](./KEY-CEREMONY.md)
- [x] Public [RFCs](./rfcs/): eight RFCs; PROTO-2 (asymmetric signing),
      RFC 0007 (subject-bearing anchors), and RFC 0008 (Agent Skills
      ecosystem compatibility) have since shipped as real code, the rest
      remain spec-only
- [x] Forward `SKILL.md` -> `.skill` ingest (`skill ingest`), distinct from
      the existing lossy `to-skill-md` export — see
      [examples/ingest-skill-md/](../examples/ingest-skill-md/)
- [x] Native eval/benchmark loop (`skill eval`, sealed
      `provenance/benchmark.json`) — see [docs/EVAL.md](./EVAL.md)
- [x] `@skillerr/skill-score` wired in as an optional dependency of the CLI
      (`skill score`), mapping `provenance/benchmark.json` +
      manifest/provenance evidence into its assessment input, with a
      sealed `provenance/score.json` receipt slot. SKILL.md-ingested
      sources are honestly tiered self-reported, not observed — see
      `packages/cli/src/score-adapter.ts`
- [x] Bundled-script / progressive-disclosure semantics documented
      (`resources/scripts/*`, `resources/references/*`) — see
      [docs/RESOURCES.md](./RESOURCES.md). Found and fixed a real gap in
      the process: `exec`-class capabilities had no deny-by-default gate
      at all (unlike read/write/destructive/network)
- [x] Optional public transparency-log anchoring (`skill mint
      --transparency`, `skill verify-trust --online`), built on the
      official `@sigstore/*` client libraries against the public Rekor
      log (or a self-hosted one via `--rekor-url`) — see
      [docs/TRANSPARENCY.md](./TRANSPARENCY.md)
- [x] Independent Rekor verification link (`rekorSearchUrl`) — both
      `skill mint --transparency`/`--keyless` and `skill verify-trust`
      print a `search.sigstore.dev` link to a verified anchor's log
      entry, so a trust verdict is independently checkable, not just
      this tool's word
- [x] Fulcio keyless mint (`skill mint --keyless`) — OIDC-bound identity
      instead of a pinned key, added as a second anchor alongside (not
      replacing) the container's own seal. CI-ambient path shipped
      (zero setup — reuses GitHub Actions' `id-token: write`, the same
      mechanism this repo's own `npm publish --provenance` uses; fails
      closed outside such an environment). Interactive browser login for
      local use is not yet implemented. See
      [docs/TRANSPARENCY.md](./TRANSPARENCY.md)
- [x] Public verify utility on `www.skillerr.com` — upload a `.skill`
      file, get back the same TrustView `skill inspect --trust` would
      report, plus the transparency-log link above when applicable. Not
      the digest-lookup `GET /skill/{package_digest}` API originally
      sketched here — that would need a hosted registry to look digests
      up against, which doesn't exist; this shipped as upload-based
      instead
- [x] Per-claim assurance model (`assessClaims`) — `skill inspect --trust
      --claims` / `skill verify-trust --claims` return a `claims` object
      with two structurally separate arrays, `verified` and
      `self_reported`, so no UI or agent consuming the JSON can end up
      showing a self-reported field next to a "verified" badge — they're
      never in the same array. Built from already-verified TrustView/
      anchor-verification output, not new cryptography
- [x] License/terms manifest slot (Phase F, scoped down) — `manifest.license`
      (SPDX identifier) and `manifest.license_url`, set via
      `SkillSource.license`/`.license_url`. Self-reported like npm's
      `package.json` `license` field — see [WHAT-IS-VERIFIABLE.md](./WHAT-IS-VERIFIABLE.md).
      The other two original Phase F pieces were already shipped elsewhere
      by the time this was scoped: Fulcio-based publisher identity is
      `--keyless`'s `owner_identity` (see [TRANSPARENCY.md](./TRANSPARENCY.md)),
      and `skill score` already exists as a quality signal. No commerce
      code lands in this repo — see Launch Readiness Phase F and
      [TRANSPARENCY.md](./TRANSPARENCY.md)'s "What this is not"
- [x] Subject-bearing transparency anchors ([RFC 0007](./rfcs/0007-subject-bearing-transparency-anchor.md)):
      `skill mint --transparency`/`--keyless` now sign a minimal in-toto
      statement naming the skill (`skill_id` + `package_digest`) instead of
      a bare digest, so a public Rekor entry is self-describing without
      already holding the package. `skill verify-trust` re-derives and
      checks the subject against the package being verified
      (`anchor_subject_mismatch` on a mismatch); anchors minted before this
      shipped have no `statement_version` and keep verifying via the exact
      legacy bare-digest path, forever. See [TRANSPARENCY.md](./TRANSPARENCY.md).
- [x] Agent Skills ecosystem compatibility ([RFC 0008](./rfcs/0008-agent-skills-ecosystem-compatibility.md)):
      `skill ingest` now maps the full [Agent Skills](https://agentskills.io/specification)
      frontmatter (`license`, `compatibility`, nested/dotted `metadata`,
      `allowed-tools`, never auto-authorized), not just name/description;
      recognizes multi-skill folders via the same plugin-manifest and
      catalog conventions [`vercel-labs/skills`](https://github.com/vercel-labs/skills)
      uses; and a new `skill export-skill` reverses a sealed `.skill` back
      into a spec-valid, installable folder (`--agent claude`/`cursor`
      computes the standard install dir). `skill verify-skill` checks a
      plain, never-ingested folder honestly, with or without a sealed
      sidecar. See [docs/AGENT-SKILLS.md](./AGENT-SKILLS.md).
- [x] Ingest -> signed-release bridge: `skill load <file.skill> --into <dir>`
      (or plain `skill load` inside a workspace) now materializes a package
      into an editable workspace, staging its knowledge as sections and
      writing `.skill/contract.json`, so an ingested continuity package can
      be taken forward to a release. It never fabricates
      `provenance.human_review` (a human still records that in the contract).
      With no workspace and no `--into`, `skill load` stays a read-only
      preview. See [docs/FROM-SKILL-CREATOR.md](./FROM-SKILL-CREATOR.md).
- [x] Zero-setup public provenance URL: `skill publish <file.skill>` seals a
      release and anchors it to the public Rekor log, printing an
      independently-verifiable `search.sigstore.dev` link. The public log needs
      a signing key but no login, so a per-user Ed25519 issuer key is
      auto-provisioned on first use (and `skill mint --transparency` gets the
      same auto-key, removing the old "requires --signer-key" dead end). The
      anchor is decoupled from the verified_issuer evidence gate, so it works
      without ever fabricating evidence or inflating trust_state. See
      [docs/MINT.md](./MINT.md) and [docs/TRANSPARENCY.md](./TRANSPARENCY.md).
- [x] Consistency sweep: `skill agent-guide`'s ambiguous "v1.0.0" header
      (bare protocol spec version, easy to misread as the CLI's own version)
      now labeled clearly and paired with the actual CLI version; its
      content updated to cover the ingest-to-release-to-publish flow it
      previously never mentioned. New [docs/CLI-FLOW.md](./CLI-FLOW.md): the
      complete current lifecycle in one page. New
      `scripts/check-doc-versions.mjs` in CI, catching hardcoded
      package-version mentions that drift from `packages/skillerr/package.json`.
      Wiki cleanup: removed pages superseded by `docs/rfcs/`/`docs/KEY-CEREMONY.md`
      that were still being linked from stale references.
- [x] External-agent bug sweep: `skill publish`/`mint --transparency` help and
      runtime messages now lead with exactly what goes public (five opaque
      fields, never skill content), after a real agent refused to publish out
      of an inaccurate fear of exposure. Fixed a real gap from [RFC
      0007](./rfcs/0007-subject-bearing-transparency-anchor.md#errata-found-in-skillerr150-the-payload-wasnt-actually-retrievable):
      anchors were submitted as Rekor's hash-only `dsse` entry kind, so the
      subject-bearing statement was never actually retrievable from the
      public log; now uses `entryType: "intoto"`, verified against a real
      submission. `inspectTrustView` now surfaces `manifest.anchors` instead
      of staying silent about a public anchor on an otherwise dev-sealed
      package. Fixed a real crash + silent-validation-skip bug:
      `assessSkillContract`'s item validator silently accepted a plain
      string wherever a structured object was required (permissions,
      inputs, branches, human_decisions, etc.), so `contract-check` reported
      "complete" on contracts that then crashed the compiler; it now flags
      the type mismatch directly. `skill compile --mint` also now runs the
      same schema/workflow-integrity check `verify-trust` runs before
      signing, closing the gap that let an invalid package get minted,
      signed, and permanently published before anyone caught it.
      `contract-check` itself never ran real JSON Schema validation either
      (only the hand-rolled completeness check above), so a bad enum or
      wrong type also passed silently until mint time; new
      `validateContractSchema` closes that too, reported as a separate
      `schema_issues` array in `contract-check`'s output.

## Next (great contribution targets)

A curated, verified-against-real-behavior list of smaller contribution targets lives in [GOOD-FIRST-ISSUES.md](./GOOD-FIRST-ISSUES.md).

- [ ] Resolve `{{input_name}}` permission-path/host placeholders against
      the input's runtime value before matching in
      `assertCapabilityAllowed` — grammar-valid today (PROTO-5) but not yet
      functional; see the `scoped-npm-monorepo-publishing` gold example
- [ ] Validate the published authoring schema with an independent implementation
- [ ] Interactive/browser-login OIDC provider for `skill mint --keyless`
      run locally (outside CI) — the CI-ambient path already shipped, see
      the "Now" section above
- [ ] Stronger `verify` assertion language + fixtures — would also enrich
      `skill score`'s validationEvidence beyond contains:/not_contains:/regex:
- [ ] Host adapters: local OpenAI-compatible, Cursor, Claude Code, Codex —
      also the natural place to implement real `tool`-step script execution
- [ ] First-class progressive-disclosure primitive (a manifest-level
      pointer list for `resources/references/*`, not just the naming
      convention documented in [RESOURCES.md](./RESOURCES.md))
- [ ] Pixel-level (not byte-level) drift check for the `brand` CI job —
      sharp/libvips PNG encoding isn't byte-stable across OS/architecture,
      so today's job only proves `scripts/build-brand.mjs` runs, not that
      checked-in assets exactly match its output
- [ ] Second language runtime (Go or Rust) ⭐: reproduce the adversarial
      corpus and canonicalization vectors byte-for-byte (now also covers
      Ed25519/PEM signing, see CONTRIBUTING.md). Ecosystem growth, not a
      stability prerequisite: the protocol is versioned 1.0 (Stable)
      against this reference implementation's own corpus already. See
      [CONTRIBUTING.md](../CONTRIBUTING.md)'s "second independent runtime"
      section for exactly what it needs to reproduce.
- [ ] Round-trip `evals/evals.json` and unrecognized frontmatter keys on
      `skill export-skill`, not just `skill ingest`, both currently map
      forward into the contract/`extensions.agentskills.*` but aren't
      re-emitted on export. See [docs/AGENT-SKILLS.md](./AGENT-SKILLS.md)
      "What's not yet a full round trip" and
      [GOOD-FIRST-ISSUES.md](./GOOD-FIRST-ISSUES.md).

## Later

- [ ] Multi-issuer trust roots / key transparency
- [ ] Optional ledger anchors as one permanence kind (never required)
