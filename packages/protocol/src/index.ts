/** Open .skill Protocol: types, constants, authoring APIs, and schemas. See PROTOCOL_VERSION (types.ts) for the current spec version, never hardcode it in a comment, it drifts. */

export {
  PROTOCOL_VERSION,
  CONTAINER_VERSION,
  WORKFLOW_DIALECT_VERSION,
  MEDIA_TYPE,
  MANIFEST_MEDIA_TYPE,
  DEFAULT_SKILL_POLICY,
} from "./types.js";

export type {
  SkillCompileProfile,
  PackageSensitivity,
  ProvenanceMode,
  MintStatus,
  PermanenceAnchorKind,
  TrustProfile,
  TrustState,
  HostClaimBinding,
  IssuerClass,
  InputSource,
  SensitivityLevel,
  AskWhen,
  SideEffectClass,
  CapabilityFallback,
  KnowledgeItemType,
  SteeringEffect,
  WorkflowStepKind,
  SkillRunStatus,
  RuntimeMode,
  CompletenessPart,
  GenerationUsage,
  JourneyProvenance,
  CompletenessReport,
  JsonSchema,
  ContentDigest,
  ProvenanceRef,
  InputSlot,
  OutputContract,
  CapabilityAdapterHint,
  CapabilityRequirement,
  SkillPermission,
  SkillPolicy,
  SkillDependency,
  MintRecord,
  SealedManifestClaims,
  CreationAttestation,
  TrustView,
  PermanenceAnchor,
  SkillManifest,
  KnowledgeItem,
  SteeringConstraint,
  WorkflowStepBase,
  InstructStep,
  PromptStep,
  ToolStep,
  TransformStep,
  BranchStep,
  IterateStep,
  DelegateStep,
  CheckpointStep,
  HumanDecisionStep,
  VerifyStep,
  EmitStep,
  SubskillStep,
  WorkflowStep,
  Workflow,
  CompilationIssue,
  CompilationMapping,
  CompilationReport,
  SkillPackageFiles,
  SkillStepRecord,
  SkillRun,
  AssertionGradeStatus,
  AssertionResult,
  EvalCaseResult,
  BenchmarkReport,
  RedactionFinding,
  RedactionReport,
} from "./types.js";

export {
  FORBIDDEN_AGENT_HOSTS,
  AGENT_RUNTIME_MARKER_ENVS,
  isValidAgentHost,
  detectAgentRuntimeMarkers,
  hasAgentRuntimeEvidence,
} from "./source.js";

export {
  assessSkillContract,
  scaffoldSkillContract,
  explainContractAssessment,
} from "./authoring.js";

export { isValidHostPattern, isValidPathPattern } from "./grammar.js";

export { loadSchema } from "./schemas.js";
export type { SchemaName } from "./schemas.js";

export {
  extractSkillCandidates,
  segmentJourney,
  agentCreateGuide,
  formatAgentGuide,
  assessExtractionScaffold,
} from "./extract.js";

export type {
  JourneyCandidateInput,
  RedactedJourneyInput,
  ExtractionScaffold,
  ExtractionReport,
  AgentGuide,
} from "./extract.js";

export type {
  SkillKind,
  DeclarationStatus,
  ExplicitDeclaration,
  ContractTrigger,
  InputApproval,
  ContractInput,
  ContractPrecondition,
  ContractStepKind,
  ContractStep,
  ContractBranch,
  ContractHumanDecision,
  ContractCapability,
  ContractPermission,
  ForbiddenAction,
  ContractOutput,
  RecoveryEdge,
  VerificationAssertion,
  ContractCorrection,
  ContractEvidence,
  ContractProvenance,
  SkillContract,
  ContractField,
  ContractIssue,
  ContractAssessment,
  SkillCandidate,
  EvalCase,
} from "./contract.js";

export type {
  SectionType,
  SectionAuthor,
  CodeRef,
  Attachment,
  PersonRef,
  SkillSection,
  SteeringEvent,
  PromptVersion,
  AgentContext,
  SkillSource,
  SteeringVerb,
  CaptureFidelity,
} from "./source.js";

export { recipeToSkillSource } from "./recipe.js";

export type {
  IngredientType,
  VisibilityIntent,
  RecipeIngredient,
  Recipe,
  Skill,
} from "./recipe.js";
