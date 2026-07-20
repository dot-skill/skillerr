# Privacy

`.skill` packages must be useful for handoff **without** becoming a leak vector.

## Never in the package

- API keys, passwords, session cookies, private keys
- Raw chat transcripts / chain-of-thought
- Unredacted customer PII when sensitivity is not `private` local-only

## Always OK (preferred)

- Secret **references**: `env:OPENAI_API_KEY`, `{{api_credential_ref}}`
- Generalized journey summaries
- Decisions, constraints, workflows
- Token **counts** (generation_usage), not prompt contents

## Compiler behavior

- Before pack, every text field is run through a deterministic secret
  scrubber (no AI, no network, no randomness — pattern rules, an opt-in
  exact-match layer against real secret values you point it at, and
  entropy-based flagging). Known-format secrets are auto-redacted into
  stable `{{redacted:<rule_id>#<n>}}` placeholders; the result is sealed
  as `provenance/redaction.json`, covered by the package's own integrity
  hash like any other container file. `redactSecrets()` still exists with
  its old signature for any existing caller, now backed by this same
  engine. See [docs/SCRUBBING.md](./SCRUBBING.md) for the full rule set,
  the reproducibility guarantee, and the honest boundary: this catches
  secrets, not proprietary or personally-identifying content — that
  still needs a human read before wide sharing.
- High-entropy strings that don't match a known secret format are flagged
  `needs_review` in that report — they are **never** auto-removed, only
  surfaced, since entropy alone can't distinguish a leaked key from an
  ordinary opaque identifier.
- Continuity defaults to `provenance_mode: redacted`
- `package_sensitivity`: `private` | `shareable_redacted` | `public`

## Local and shareable

| Sensitivity | Use |
|---|---|
| `private` | Stay on your machine / trusted repo |
| `shareable_redacted` | Handoff to another AI / teammate |
| `public` | Community skills (still no secrets) |
