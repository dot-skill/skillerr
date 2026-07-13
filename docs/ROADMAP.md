# Roadmap

Status: protocol **Draft 0.5.0**; reference packages **0.6.0**.

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
      see [docs/KEY-CEREMONY.md](./KEY-CEREMONY.md)
- [x] Public RFC folder (`docs/rfcs/`) — six RFCs; PROTO-2 (asymmetric
      signing) has since shipped as real code, the rest remain spec-only
- [x] Forward `SKILL.md` -> `.skill` ingest (`skill ingest`), distinct from
      the existing lossy `to-skill-md` export — see
      [examples/ingest-skill-md/](../examples/ingest-skill-md/)

## Next (great contribution targets)

- [ ] Resolve `{{input_name}}` permission-path/host placeholders against
      the input's runtime value before matching in
      `assertCapabilityAllowed` — grammar-valid today (PROTO-5) but not yet
      functional; see the `scoped-npm-monorepo-publishing` gold example
- [ ] Validate the published authoring schema with an independent implementation
- [ ] HTTP transparency-log server (same log format as local registry)
- [ ] Stronger `verify` assertion language + fixtures
- [ ] Host adapters: local OpenAI-compatible, Cursor, Claude Code, Codex
- [ ] Second language runtime (Go or Rust) for Stable eligibility — reproduce
      the adversarial corpus and canonicalization vectors byte-for-byte
      (now also covers Ed25519/PEM signing — see CONTRIBUTING.md)
- [ ] Native eval/benchmark loop (`skill eval`) and wiring `skill-score` in
      as a sealed `provenance/score.json` receipt

## Later

- [ ] Multi-issuer trust roots / key transparency
- [ ] Optional ledger anchors as one permanence kind (never required)
- [ ] Mark **Candidate** then **Stable** after two independent runtimes pass the same corpus
