# Runtime

Lifecycle: LoadAndVerify → TrustView → NegotiateCapabilities → ResolveInputs → Consent → Execute → Verify → EmitSkillRun.

Modes: `inspect`, `explain`, `dry_run`, `execute`, `resume`.

## Trust gate

- `execute` / `resume` refuse unsigned, open, development (public-dev HMAC), and self_reported seals unless `allow_untrusted` / `--allow-untrusted`
- Public-dev HMAC never counts as production trust

## Capability deny-by-default

- Network tools require `policy.allow_network` and a declared network permission; `permission.hosts` matches the parsed hostname exactly or a `*.suffix` wildcard, never a substring — and a permission with `hosts` declared refuses any call whose target host can't be determined from its arguments
- Filesystem tools must stay within `filesystem_roots` / permission `paths` when declared; candidate paths are normalized (posix-resolve semantics) before the comparison, so `..` segments can't escape a root
- `read` requires a declared `read` permission exactly like `write`/`destructive` — it is not exempt from deny-by-default
- Secret slots must be declared; undeclared secret access is refused
- Missing consent callbacks fail closed for side effects in `consent_for` / `requires_consent`

Fail clearly when required capabilities or minted trust profiles are unmet. Never silently degrade.

## Step-kind support matrix

Every `WorkflowStepKind` reaches `executeStep` in `packages/runtime/src/index.ts` — none are silently skipped — but "reaches the switch statement" and "actually does something at execute time" are different claims. This table is the honest version of that difference.

| Step kind | `dry_run` | `execute` |
|---|---|---|
| `instruct` | Returns the substituted instruction text | Same — no side effects either mode |
| `prompt` | Returns the rendered template | Same — no side effects either mode |
| `tool` | Capability-gated stub (`dry_run: true`, arguments shown, never invoked) | Invokes the matching adapter for real. **Refuses if no adapter is registered for the capability** (unless `fallback: "skip_if_optional"` or the step is `optional`) |
| `transform` | Executed (`identity` or `jsonpath:` expressions) | Same. **Refuses `Unsupported transform: <expr>`** for any other expression |
| `branch` | Executed (control flow only, no side effects) | Same |
| `iterate` | Executed — pairs each collection item with the step body | Same. Does not itself recursively execute the body's steps within this function |
| `delegate` | Dry-run stub (`dry_run: true`, task shown) | **Always refuses** — `delegate requires an A2A adapter (not configured)`. No adapter mechanism exists yet for this step kind |
| `checkpoint` | Executed (echoes the checkpoint message) | Same — no side effects either mode |
| `human_decision` | Dry-run stub (`awaiting_human: true`, prompt/choices shown) | Requires a host-supplied `decide` callback returning real evidence (`actor`, `at`, `decision`). **Refuses if no callback is configured** — input values alone can never spoof approval |
| `verify` | Executed — runs declared assertions | Same. Recognized assertion prefixes (`exists:`, `constraint_present:`/`honor:`, `precondition:`/`contract_assertion:`, `all_required_inputs_resolved`) are checked for real; an unrecognized assertion is either advisory or a hard fail depending on `policy.fail_on_unsupported_step` |
| `emit` | Executed (passthrough) | Same — no side effects either mode |
| `subskill` | **Always refuses** — `subskill <id> not resolved in this runtime invocation` | Same — unconditional, in every mode. See [Threat Model](https://github.com/dot-skill/skillerr/wiki/Threat-Model) T4 and [RFC 0004](./rfcs/0004-dangling-step-kinds.md) for why this step kind exists in the schema but has no resolution semantics yet |

If a workflow you're inspecting uses `delegate` or `subskill`, treat those steps as **not runnable today** regardless of what the rest of the package's trust state claims — this is a runtime-implementation gap, not a trust problem, and no signature can paper over it.
