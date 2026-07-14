import type {
  AskWhen,
  CapabilityFallback,
  InputSource,
  JsonSchema,
  PackageSensitivity,
  SensitivityLevel,
  SideEffectClass,
} from "./types.js";

/** Protocol-native contract introduced in 0.5. Product adapters must map into this vocabulary. */
export type SkillKind = "knowledge" | "procedure" | "integration";
export type DeclarationStatus = "specified" | "none" | "not_applicable";

export type ExplicitDeclaration<T> =
  | { status: "specified"; items: T[] }
  | { status: "none"; reason: string }
  | { status: "not_applicable"; reason: string };

export interface ContractTrigger {
  id: string;
  description: string;
  examples?: string[];
}

export type InputApproval = "none" | "human_before_use";

export interface ContractInput {
  name: string;
  description: string;
  schema: JsonSchema;
  required: boolean;
  default?: unknown;
  sensitivity: SensitivityLevel;
  source: InputSource;
  ask_when: AskWhen;
  approval: InputApproval;
}

export interface ContractPrecondition {
  id: string;
  assertion: string;
  check: "agent" | "capability" | "human";
  on_failure: string;
}

export type ContractStepKind =
  | "instruct"
  | "prompt"
  | "tool"
  | "transform"
  | "checkpoint"
  | "human_decision"
  | "verify"
  | "emit";

export interface ContractStep {
  id: string;
  title: string;
  kind: ContractStepKind;
  instruction?: string;
  capability?: string;
  arguments?: Record<string, unknown>;
  argument_bindings?: Record<string, string>;
  result_as?: string;
  output?: string;
  from?: string;
  assertions?: string[];
  decision?: string;
  next?: string;
  on_failure?: string;
  optional?: boolean;
}

export interface ContractBranch {
  id: string;
  after_step?: string;
  condition: string;
  then: string;
  otherwise?: string;
}

export interface ContractHumanDecision {
  id: string;
  prompt: string;
  choices?: string[];
  required_before: string;
  irreversible: boolean;
  /** Declares an approval gate. It is never evidence that approval was granted. */
  approval: "explicit_human";
}

export interface ContractCapability {
  name: string;
  description: string;
  input_schema?: JsonSchema;
  output_schema?: JsonSchema;
  side_effect_class: SideEffectClass;
  fallback: CapabilityFallback;
  required: boolean;
}

export interface ContractPermission {
  id: string;
  side_effect_class: SideEffectClass;
  description: string;
  paths?: string[];
  hosts?: string[];
  consent: "none" | "explicit_human";
}

export interface ForbiddenAction {
  id: string;
  description: string;
  enforcement: "runtime" | "host" | "review";
}

export interface ContractOutput {
  name: string;
  description: string;
  schema: JsonSchema;
  required: boolean;
  media_type?: string;
  assertions?: string[];
}

export interface RecoveryEdge {
  id: string;
  from_step: string;
  condition: string;
  action: string;
  goto?: string;
  terminal?: boolean;
}

export interface VerificationAssertion {
  id: string;
  assertion: string;
  check: "runtime" | "capability" | "human";
  evidence?: string[];
  required: boolean;
}

/**
 * PHASE 2: a native eval/benchmark case — a test prompt plus the
 * assertions a run against it should satisfy. Reuses VerificationAssertion
 * rather than inventing a parallel shape; `check` still means what it
 * means there (runtime = machine-gradable, human/capability = needs a
 * human or a capability call to judge). See docs/EVAL.md.
 */
export interface EvalCase {
  id: string;
  prompt: string;
  assertions: VerificationAssertion[];
  /** Optional input files the prompt references (paths are informational — not auto-loaded). */
  files?: string[];
}

export interface ContractCorrection {
  id: string;
  lesson: string;
  applies_to?: string[];
}

export interface ContractEvidence {
  id: string;
  kind: "source" | "section" | "test" | "review" | "external";
  ref: string;
  digest?: string;
  supports: string[];
}

export interface ContractProvenance {
  evidence: ExplicitDeclaration<ContractEvidence>;
  limitations: ExplicitDeclaration<string>;
  human_review:
    | { status: "not_reviewed" }
    | { status: "reviewed"; actor: string; at: string; scope: string[]; digest?: string };
}

/**
 * Complete transferable skill authoring contract.
 *
 * Every declaration is required on the wire. `none` and `not_applicable` are
 * deliberate author statements; an absent field is an ambiguous omission.
 */
export interface SkillContract {
  kind: "skill_contract";
  contract_version: "1.0";
  skill_kind: SkillKind;
  title: string;
  intent: string;
  sensitivity: PackageSensitivity;
  triggers: ExplicitDeclaration<ContractTrigger>;
  inputs: ExplicitDeclaration<ContractInput>;
  preconditions: ExplicitDeclaration<ContractPrecondition>;
  steps: ExplicitDeclaration<ContractStep>;
  branches: ExplicitDeclaration<ContractBranch>;
  human_decisions: ExplicitDeclaration<ContractHumanDecision>;
  capabilities: ExplicitDeclaration<ContractCapability>;
  permissions: ExplicitDeclaration<ContractPermission>;
  forbidden_actions: ExplicitDeclaration<ForbiddenAction>;
  outputs: ExplicitDeclaration<ContractOutput>;
  recovery: ExplicitDeclaration<RecoveryEdge>;
  verification: ExplicitDeclaration<VerificationAssertion>;
  corrections: ExplicitDeclaration<ContractCorrection>;
  provenance: ContractProvenance;
  /**
   * PHASE 2: optional native eval/benchmark cases. Unlike every field
   * above, this is genuinely optional (not `ExplicitDeclaration` requiring
   * an explicit none/not_applicable reason) — most skills won't have this
   * authored yet, and assessSkillContract() does not require it for either
   * profile. See docs/EVAL.md.
   */
  evals?: EvalCase[];
}

export type ContractField =
  | "contract"
  | "title"
  | "intent"
  | "skill_kind"
  | "sensitivity"
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
  | "provenance.evidence"
  | "provenance.limitations"
  | "provenance.human_review";

export interface ContractIssue {
  field: ContractField;
  code: "missing" | "empty" | "invalid" | "profile_required" | "approval_invalid";
  message: string;
  fix: string;
}

export interface ContractAssessment {
  kind: "contract_assessment";
  profile: "continuity" | "release";
  complete: boolean;
  release_eligible: boolean;
  issues: ContractIssue[];
}

export interface SkillCandidate {
  id: string;
  title: string;
  evidence_refs: string[];
  assessment: ContractAssessment;
  contract?: SkillContract;
}
