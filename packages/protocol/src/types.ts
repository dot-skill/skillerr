/** Open .skill Protocol v0.5 — semantic types for portable `.skill` packages. */

import type {
  ContractBranch,
  ContractHumanDecision,
  InputApproval,
  ContractPrecondition,
  ContractTrigger,
  ExplicitDeclaration,
  RecoveryEdge,
  SkillContract,
  VerificationAssertion,
} from "./contract.js";

export const PROTOCOL_VERSION = "1.0.0";
export const CONTAINER_VERSION = "1.0";
export const WORKFLOW_DIALECT_VERSION = "1.1";

/** Media type for a packaged `.skill` archive (zip). */
export const MEDIA_TYPE = "application/vnd.dot-skill+zip";
/** Media type for the manifest JSON document inside a `.skill` archive. */
export const MANIFEST_MEDIA_TYPE = "application/vnd.dot-skill-manifest+json";

/**
 * Compile profiles:
 * - continuity: partial OK — portable AI work context / handoff (draft)
 * - release: full requirements or refuse — reusable sealed skill
 */
export type SkillCompileProfile = "continuity" | "release";

/** Package sharing intent — secrets never embedded either way. */
export type PackageSensitivity = "private" | "shareable_redacted" | "public";

export type ProvenanceMode = "full" | "redacted" | "proof_only";
export type MintStatus = "draft" | "minted";
export type PermanenceAnchorKind =
  | "registry"
  | "transparency_log"
  | "keyless_identity"
  | "ledger"
  | "content_addressed_store"
  | "other";
export type TrustProfile = "open" | "minted" | "anchored" | `issuer:${string}`;

/**
 * Human-readable trust decision for TrustView / inspect --trust.
 * - untrusted: unsigned, open, or failed verification
 * - development: public-dev HMAC verified structurally — never production trust
 * - self_reported: signed, but host/model claims are env/self-asserted (not issuer-verified)
 * - verified_issuer: configured non-public issuer key bound the sealed claims
 */
export type TrustState = "untrusted" | "development" | "self_reported" | "verified_issuer";

/** How the host/model claim was bound into the seal. */
export type HostClaimBinding = "self_reported" | "verified_issuer";

/**
 * Class of mint issuer key material.
 * public_dev_hmac MUST NOT be treated as production trust.
 * (Previously this union incorrectly included "verified_issuer" — a
 * HostClaimBinding/TrustState value, not an issuer-key class. Nothing ever
 * assigned issuer_class="verified_issuer"; the real values were always
 * public_dev_hmac/configured_hmac. Fixed alongside adding
 * configured_ed25519 — PROTO-2/RFC 0001.)
 */
export type IssuerClass = "public_dev_hmac" | "configured_hmac" | "configured_ed25519";
export type InputSource = "human" | "environment" | "secret" | "artifact" | "derived";
export type SensitivityLevel = "public" | "private" | "secret";
export type AskWhen = "always" | "if_missing" | "never";
export type SideEffectClass =
  | "none"
  | "read"
  | "write"
  | "network"
  | "exec"
  | "destructive";
export type CapabilityFallback = "fail" | "ask_human" | "skip_if_optional";
export type KnowledgeItemType =
  | "rule"
  | "principle"
  | "decision"
  | "tradeoff"
  | "correction"
  | "lesson"
  | "constraint"
  | "reference";
export type SteeringEffect =
  | "invariant"
  | "forbidden"
  | "decision_rule"
  | "approval_gate";
export type WorkflowStepKind =
  | "instruct"
  | "prompt"
  | "tool"
  | "transform"
  | "branch"
  | "iterate"
  | "delegate"
  | "checkpoint"
  | "human_decision"
  | "verify"
  | "emit"
  | "subskill";
export type SkillRunStatus =
  | "pending"
  | "running"
  | "paused"
  | "succeeded"
  | "failed"
  | "cancelled";
export type RuntimeMode = "inspect" | "explain" | "dry_run" | "execute" | "resume";

/** Parts the compiler checks before producing a package. */
export type CompletenessPart =
  | "agent_context"
  | "intent"
  | "sections"
  | "workflow"
  | "knowledge_or_prompts"
  | "inputs_declared"
  | "journey"
  | "generation_usage"
  | "human_approvals"
  | "semantic_contract"
  | "triggers"
  | "inputs"
  | "preconditions"
  | "steps"
  | "branches"
  | "human_decisions"
  | "capabilities"
  | "permissions"
  | "forbidden_actions"
  | "outputs"
  | "recovery"
  | "verification"
  | "corrections"
  | "provenance";

export interface GenerationUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  reported_by: "agent" | "host" | "estimated";
  captured_at: string;
  host?: string;
  model?: string;
}

/** Generalized human+AI journey — never raw chat / CoT / secrets. */
export interface JourneyProvenance {
  summary: string;
  open_questions?: string[];
  decisions?: string[];
  redacted: boolean;
  sensitivity: PackageSensitivity;
}

export interface CompletenessReport {
  kind: "completeness_report";
  profile: SkillCompileProfile;
  complete: boolean;
  present: CompletenessPart[];
  missing: CompletenessPart[];
  hints: string[];
}

/** JSON Schema subset stored as a plain object. */
export type JsonSchema = Record<string, unknown>;

export interface ContentDigest {
  path: string;
  digest: string;
  media_type?: string;
  bytes?: number;
}

export interface ProvenanceRef {
  kind: "section" | "source" | "steering" | "author" | "legacy_skill" | "ingredient" | "recipe";
  id: string;
  revision?: number;
  hash?: string;
  note?: string;
}

export interface InputSlot {
  name: string;
  schema: JsonSchema;
  description: string;
  source: InputSource;
  required: boolean;
  default?: unknown;
  sensitivity: SensitivityLevel;
  ask_when: AskWhen;
  approval?: InputApproval;
  examples?: unknown[];
  provenance?: ProvenanceRef[];
  generalization_reason?: string;
  approved?: boolean;
}

export interface OutputContract {
  name: string;
  description?: string;
  schema: JsonSchema;
  required: boolean;
  media_type?: string;
  assert?: string[];
}

export interface CapabilityAdapterHint {
  kind: "mcp" | "a2a" | "host" | "http";
  name?: string;
  uri?: string;
  tool?: string;
  meta?: Record<string, unknown>;
}

export interface CapabilityRequirement {
  name: string;
  description: string;
  input_schema?: JsonSchema;
  output_schema?: JsonSchema;
  side_effect_class: SideEffectClass;
  adapters?: CapabilityAdapterHint[];
  fallback: CapabilityFallback;
  required: boolean;
}

export interface SkillPermission {
  side_effect_class: SideEffectClass;
  description: string;
  paths?: string[];
  hosts?: string[];
  requires_consent: boolean;
}

export interface SkillPolicy {
  require_signatures: boolean;
  require_minted?: boolean;
  require_anchor?: boolean;
  max_runtime_ms: number;
  max_tool_calls: number;
  allow_network: boolean;
  filesystem_roots?: string[];
  consent_for: SideEffectClass[];
  fail_on_unsupported_step: boolean;
  trust_profile?: TrustProfile;
}

export interface SkillDependency {
  skill_id: string;
  version: string;
  package_digest?: string;
}

export interface MintRecord {
  mint_status: MintStatus;
  minted_at?: string;
  mint_issuer?: string;
  content_id?: string;
}

/**
 * Claims bound by the creation seal (identity + safety + content digests).
 * Digest of this object is `sealed_manifest_digest`.
 */
export interface SealedManifestClaims {
  id: string;
  version: string;
  title: string;
  intent?: string;
  description: string;
  package_digest: string;
  permissions: Array<{
    side_effect_class: SideEffectClass;
    description: string;
    paths?: string[];
    hosts?: string[];
    requires_consent: boolean;
  }>;
  policy: {
    require_signatures: boolean;
    require_minted?: boolean;
    require_anchor?: boolean;
    allow_network: boolean;
    filesystem_roots?: string[];
    consent_for: SideEffectClass[];
    trust_profile?: TrustProfile;
    max_tool_calls: number;
    max_runtime_ms: number;
    fail_on_unsupported_step: boolean;
  };
  capabilities: Array<{
    name: string;
    side_effect_class: SideEffectClass;
    required: boolean;
  }>;
  inputs: Array<{
    name: string;
    sensitivity: SensitivityLevel;
    required: boolean;
    source: InputSource;
  }>;
  content: ContentDigest[];
  contract?: {
    title: string;
    intent: string;
    skill_kind: string;
    sensitivity: string;
  };
}

export interface CreationAttestation {
  kind: "creation_attestation";
  package_digest: string;
  /** Digest over identity + permissions/policy/capabilities + content index. */
  sealed_manifest_digest: string;
  skill_id: string;
  skill_version: string;
  minted_at: string;
  agent: {
    runtime: string;
    version: string;
    key_id?: string;
  };
  host: string;
  provider?: string;
  model?: string;
  deployment?: "local" | "hosted" | "hybrid" | "unknown";
  endpoint?: string;
  /** Whether host/model claims are self-asserted or issuer-verified. */
  host_claim_binding: HostClaimBinding;
  /** Issuer key class — public_dev_hmac is never production trust. */
  issuer_class: IssuerClass;
  /** Agent-runtime markers observed at mint (inspectable; still spoofable locally). */
  agent_runtime_markers?: string[];
  journey: {
    /** @deprecated Prefer source_id — Skillerr recipe id when adapted. */
    recipe_id?: string;
    recipe_hash?: string;
    source_id?: string;
    source_hash?: string;
    proof_digest?: string;
    summary?: string;
  };
  generation_usage?: GenerationUsage;
  human_approvals: {
    inputs: string[];
    permissions: string[];
    /** Empty when no actor evidence was provided — never fabricated. See `attested`. */
    actors: string[];
    /** False when `actors` is empty: mint proceeded with no recorded human approver identity. */
    attested: boolean;
  };
  policy_profile?: TrustProfile;
}

/** Seal / trust summary readable without compile or model body ingest. */
export interface TrustView {
  trust_state: TrustState;
  mint_status: MintStatus;
  signed: boolean;
  issuer?: string;
  issuer_class?: IssuerClass;
  host_claim_binding?: HostClaimBinding;
  agent?: {
    host?: string;
    provider?: string;
    model?: string;
    runtime?: string;
    version?: string;
    key_id?: string;
    deployment?: string;
    markers?: string[];
  };
  package_digest: string;
  sealed_manifest_digest?: string;
  attestation_digest?: string;
  license?: string;
  license_url?: string;
  label: string;
  warnings: string[];
  issues: Array<{ severity: "error" | "warning"; code: string; message: string }>;
}

/**
 * `issuer` means different things depending on `kind`:
 * - `transparency_log`: our own trust-store `key_id` — the anchor was made
 *   with a stable, pre-pinnable key, so this string is meant to be looked
 *   up in a trust store.
 * - `keyless_identity`: the OIDC issuer URL (e.g.
 *   `https://token.actions.githubusercontent.com`) that vouched for the
 *   ephemeral, one-time Fulcio-issued signing key — there is no stable
 *   key_id to pin, since a fresh key is minted per anchor and thrown away.
 *   The bound identity itself (e.g. a specific CI workflow ref) lives in
 *   `extensions.owner_identity` and is re-derived from the certificate at
 *   verify time, never trusted from the stored string alone.
 */
export interface PermanenceAnchor {
  kind: PermanenceAnchorKind;
  package_digest: string;
  located_at: string;
  anchored_at: string;
  issuer: string;
  receipt?: unknown;
  extensions?: Record<string, unknown>;
  /**
   * Version of the signed anchor payload shape. Absent on anchors minted
   * before subject-bearing statements existed: those signed a bare
   * `sealed_manifest_digest` string as the DSSE payload and verify via that
   * legacy path forever. Present (currently `"1"`) means the payload is a
   * canonicalized in-toto Statement naming the skill, see
   * `buildAnchorStatement` in `@skillerr/core`'s `transparency.ts`.
   */
  statement_version?: string;
  /** The signed statement's `predicateType`, recorded alongside `statement_version` for the same detection purpose. */
  predicate_type?: string;
}

/**
 * Manifest of a `.skill` package.
 * Wire `kind` is `"dot-skill"`; the artifact extension is `.skill`.
 */
export interface SkillManifest {
  kind: "dot-skill";
  id: string;
  version: string;
  title: string;
  description: string;
  intent?: string;
  /** Authoritative 0.5 semantic contract. Absent only on legacy/draft adapters. */
  contract?: SkillContract;
  triggers?: ContractTrigger[];
  preconditions?: ExplicitDeclaration<ContractPrecondition>;
  branches?: ExplicitDeclaration<ContractBranch>;
  human_decisions?: ExplicitDeclaration<ContractHumanDecision>;
  forbidden_actions?: SkillContract["forbidden_actions"];
  recovery?: ExplicitDeclaration<RecoveryEdge>;
  verification?: ExplicitDeclaration<VerificationAssertion>;
  corrections?: SkillContract["corrections"];
  authors?: Array<{ id: string; display_name?: string }>;
  /** SPDX license identifier (e.g. "MIT", "Apache-2.0", "CC-BY-4.0") or "UNLICENSED" for all-rights-reserved. Self-reported by the author, like npm's package.json `license` field — not independently verified by anything in this protocol. */
  license?: string;
  /** Full terms/license text, when a bare SPDX identifier doesn't capture custom terms. */
  license_url?: string;
  container_version: string;
  protocol_version: string;
  entrypoint: string;
  inputs: InputSlot[];
  outputs: OutputContract[];
  capabilities: CapabilityRequirement[];
  permissions: SkillPermission[];
  policy: SkillPolicy;
  content: ContentDigest[];
  package_digest: string;
  /**
   * Self-digest over identity/permissions/policy/capabilities/content claims
   * (same claim set as sealed_manifest_digest), computed at pack time and
   * checked by `skill validate` on every package — minted or not.
   * package_digest excludes skill.json itself, and sealed_manifest_digest
   * only exists once minted, so without this a draft/continuity package's
   * permissions/capabilities/policy carry no integrity binding at all.
   */
  manifest_digest?: string;
  dependencies?: SkillDependency[];
  supersedes?: string;
  provenance_mode: ProvenanceMode;
  /** continuity = handoff draft; release path may carry a signed attestation */
  compile_profile?: SkillCompileProfile;
  completeness?: CompletenessReport;
  package_sensitivity?: PackageSensitivity;
  mint?: MintRecord;
  attestation_digest?: string;
  /** Present on minted packages — binds identity/policy/content claims in the seal. */
  sealed_manifest_digest?: string;
  anchors?: PermanenceAnchor[];
  legacy?: boolean;
  needs_human_review?: boolean;
  extensions?: Record<string, Record<string, unknown>>;
}

export interface KnowledgeItem {
  kind: "knowledge";
  id: string;
  type: KnowledgeItemType;
  title: string;
  body: string;
  fidelity: "exact" | "synthesize";
  applicability?: string;
  pinned?: boolean;
  sensitivity?: SensitivityLevel;
  provenance?: ProvenanceRef[];
}

export interface SteeringConstraint {
  kind: "steering_constraint";
  id: string;
  verb: "affirm" | "correct" | "reject";
  effect: SteeringEffect;
  statement: string;
  source_steering_id?: string;
  targets?: string[];
  provenance?: ProvenanceRef[];
}

export interface WorkflowStepBase {
  id: string;
  kind: WorkflowStepKind;
  title?: string;
  optional?: boolean;
  next?: string | string[];
  on_fail?: string;
  provenance?: ProvenanceRef[];
}

export interface InstructStep extends WorkflowStepBase {
  kind: "instruct";
  text: string;
  knowledge_refs?: string[];
}

export interface PromptStep extends WorkflowStepBase {
  kind: "prompt";
  template: string;
  input_bindings?: Record<string, string>;
  knowledge_refs?: string[];
}

export interface ToolStep extends WorkflowStepBase {
  kind: "tool";
  capability: string;
  arguments?: Record<string, unknown>;
  argument_bindings?: Record<string, string>;
  result_as?: string;
}

export interface TransformStep extends WorkflowStepBase {
  kind: "transform";
  expression: string;
  input_from?: string;
  result_as?: string;
}

export interface BranchStep extends WorkflowStepBase {
  kind: "branch";
  cases: Array<{ when: string; goto: string }>;
  else?: string;
}

export interface IterateStep extends WorkflowStepBase {
  kind: "iterate";
  over: string;
  as: string;
  body: string;
}

export interface DelegateStep extends WorkflowStepBase {
  kind: "delegate";
  agent_card?: string;
  task: string;
  result_as?: string;
}

export interface CheckpointStep extends WorkflowStepBase {
  kind: "checkpoint";
  message?: string;
  require_human?: boolean;
}

export interface HumanDecisionStep extends WorkflowStepBase {
  kind: "human_decision";
  prompt: string;
  choices?: string[];
  result_as?: string;
}

export interface VerifyStep extends WorkflowStepBase {
  kind: "verify";
  assertions: string[];
  against?: string;
}

export interface EmitStep extends WorkflowStepBase {
  kind: "emit";
  output: string;
  from: string;
}

export interface SubskillStep extends WorkflowStepBase {
  kind: "subskill";
  skill_id: string;
  version?: string;
  input_bindings?: Record<string, string>;
}

export type WorkflowStep =
  | InstructStep
  | PromptStep
  | ToolStep
  | TransformStep
  | BranchStep
  | IterateStep
  | DelegateStep
  | CheckpointStep
  | HumanDecisionStep
  | VerifyStep
  | EmitStep
  | SubskillStep;

export interface Workflow {
  kind: "workflow";
  dialect_version: string;
  entrypoint: string;
  steps: WorkflowStep[];
  constraints?: SteeringConstraint[];
  preconditions?: ExplicitDeclaration<ContractPrecondition>;
  branches?: ExplicitDeclaration<ContractBranch>;
  human_decisions?: ExplicitDeclaration<ContractHumanDecision>;
  recovery?: ExplicitDeclaration<RecoveryEdge>;
  verification?: ExplicitDeclaration<VerificationAssertion>;
}

export interface CompilationIssue {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  related?: string[];
}

export interface CompilationMapping {
  from: ProvenanceRef;
  to: { kind: "knowledge" | "step" | "input" | "output" | "constraint"; id: string };
}

export interface CompilationReport {
  kind: "compilation_report";
  skill_id: string;
  /** Protocol source id. */
  source_id?: string;
  /** @deprecated Skillerr adapter field — use source_id. */
  recipe_id?: string;
  profile: SkillCompileProfile;
  created_at: string;
  mappings: CompilationMapping[];
  inferred_inputs: InputSlot[];
  issues: CompilationIssue[];
  pending_approvals: string[];
  approved: boolean;
  completeness: CompletenessReport;
  semantic_contract: "native_0.5" | "legacy_lossy";
  losses?: string[];
}

/**
 * PHASE 2: native eval/benchmark loop output. Machine-readable, honest
 * about what has and hasn't actually been graded — `pending_human` is a
 * real, common status, not an error state. See docs/EVAL.md.
 */
export type AssertionGradeStatus = "pass" | "fail" | "partial" | "pending_human";

export interface AssertionResult {
  id: string;
  assertion: string;
  check: "runtime" | "capability" | "human";
  status: AssertionGradeStatus;
  detail?: string;
}

export interface EvalCaseResult {
  id: string;
  prompt: string;
  /** Did the skill's workflow itself dry-run successfully for this case? */
  executable: boolean;
  duration_ms: number;
  /** Only set when a caller supplies real usage data — never estimated. */
  total_tokens?: number;
  assertions: AssertionResult[];
}

export interface BenchmarkReport {
  kind: "benchmark_report";
  skill_id: string;
  host: string;
  created_at: string;
  cases: EvalCaseResult[];
  summary: {
    total_cases: number;
    total_assertions: number;
    pass: number;
    fail: number;
    partial: number;
    pending_human: number;
  };
}

export interface SkillPackageFiles {
  manifest: SkillManifest;
  workflow: Workflow;
  knowledge: KnowledgeItem[];
  prompts?: Record<string, string>;
  resources?: Record<string, Uint8Array | string>;
  artifacts?: Record<string, Uint8Array | string>;
  /** Optional per-skill presentational assets, e.g. `icon.svg` — see PROTOCOL.md "Format icon slot". */
  assets?: Record<string, Uint8Array | string>;
  provenance?: {
    /** Scrubbed SkillSource or product source (never secrets). */
    source?: unknown;
    /** @deprecated Prefer source — Skillerr recipe blob. */
    recipe?: unknown;
    journey?: JourneyProvenance;
    generation_usage?: GenerationUsage;
    proof?: unknown;
    compilation_report?: CompilationReport;
    /** PHASE 2: sealed into provenance/benchmark.json when `skill eval` ran before compile. */
    benchmark?: BenchmarkReport;
    /**
     * PHASE 3: an optional sealed quality-score receipt (`@skillerr/skill-score`'s
     * ScoreResult). Typed `unknown` deliberately — this protocol package
     * does not depend on the scorer's types, matching `recipe`/`proof`'s
     * existing "product-shaped, not protocol-native" convention.
     */
    score?: unknown;
  };
  signatures?: Record<string, unknown>;
  attestation?: CreationAttestation;
  anchors?: PermanenceAnchor[];
}

export interface SkillStepRecord {
  step_id: string;
  kind: WorkflowStepKind;
  status: "pending" | "skipped" | "succeeded" | "failed" | "waiting";
  started_at?: string;
  finished_at?: string;
  input_digest?: string;
  output_digest?: string;
  adapter?: CapabilityAdapterHint;
  approval?: { actor: string; at: string; decision: "allow" | "deny" };
  error?: string;
}

export interface SkillRun {
  kind: "skill_run";
  id: string;
  skill_id: string;
  skill_version: string;
  package_digest: string;
  status: SkillRunStatus;
  mode: RuntimeMode;
  resolved_inputs: Record<string, unknown>;
  secret_refs?: Record<string, string>;
  steps: SkillStepRecord[];
  outputs?: Record<string, unknown>;
  verifications: Array<{ assertion: string; passed: boolean; detail?: string }>;
  runtime: {
    name: string;
    version: string;
    host?: string;
    model?: string;
  };
  checkpoints?: Array<{ id: string; step_id: string; at: string; state_digest: string }>;
  started_at: string;
  finished_at?: string;
  error?: string;
}

export const DEFAULT_SKILL_POLICY: SkillPolicy = {
  require_signatures: false,
  require_minted: false,
  require_anchor: false,
  max_runtime_ms: 600_000,
  max_tool_calls: 200,
  allow_network: false,
  consent_for: ["write", "network", "exec", "destructive"],
  fail_on_unsupported_step: true,
  trust_profile: "open",
};
