# Roadmap

Status: protocol **1.0.0 (Stable)**; reference packages **1.1.0**.

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
      see [Key Ceremony](https://github.com/dot-skill/skillerr/wiki/Key-Ceremony)
- [x] Public [RFCs](https://github.com/dot-skill/skillerr/wiki/RFCs) — six RFCs; PROTO-2 (asymmetric
      signing) has since shipped as real code, the rest remain spec-only
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

## Next (great contribution targets)

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
- [ ] Second language runtime (Go or Rust) — reproduce the adversarial
      corpus and canonicalization vectors byte-for-byte (now also covers
      Ed25519/PEM signing — see CONTRIBUTING.md). Ecosystem growth, not a
      stability prerequisite: the protocol is versioned 1.0 (Stable)
      against this reference implementation's own corpus already

## Later

- [ ] Multi-issuer trust roots / key transparency
- [ ] Optional ledger anchors as one permanence kind (never required)
