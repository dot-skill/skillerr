/** @skillerr/core — pack, unpack, validate, mint, compile .skill packages. */

export {
  canonicalize,
  sha256Hex,
  sha256Digest,
  packageDigestFromContent,
  buildSealedManifestClaims,
  sealedManifestDigest,
  PUBLIC_DEV_MINT_KEY,
  PUBLIC_DEV_MINT_KEY_ID,
} from "./hash.js";
export {
  normalizePath,
  assertSafePaths,
  MAX_ENTRIES,
  MAX_UNCOMPRESSED_BYTES,
  MAX_COMPRESSION_RATIO,
  UnsafePathError,
} from "./paths.js";
export {
  buildFileMap,
  finalizeManifest,
  packSkill,
  unpackSkill,
  UnsafeZipError,
} from "./pack.js";
export type { PackOptions, UnpackResult } from "./pack.js";
export {
  validateManifestShape,
  validateWorkflowShape,
  validatePackageBytes,
  validateContractSchema,
  inspectSkill,
} from "./validate.js";
export type { ValidationIssue, ValidationResult } from "./validate.js";
export { migrateLegacySkill, toSkillMdAdapter } from "./migrate.js";
export { ingestSkillMd, discoverSkillMdCandidates } from "./ingest.js";
export { gradeAssertion, runEvalCase, buildBenchmarkReport } from "./eval.js";
export type { GradeOverride, RunEvalCaseOptions } from "./eval.js";
export type { IngestOptions, IngestResult, IngestReport, SkillMdCandidate } from "./ingest.js";
export {
  exportAgentSkillFolder,
  deriveAgentSkillName,
  resolveAgentSkillsDir,
  AGENT_SKILLS_INSTALL_DIRS,
} from "./export.js";
export type { ExportReport, ExportResult } from "./export.js";
export { verifySkillFolder } from "./verify-skill.js";
export type { VerifySkillReport, VerifySkillOptions } from "./verify-skill.js";
export {
  mintSkillPackage,
  addPermanenceAnchor,
  verifyMintTrust,
  inspectTrustView,
  SEAL_ALGORITHM,
} from "./mint.js";
export type { MintOptions, VerifyMintTrustOptions } from "./mint.js";
export { createEd25519Signer, verifyEd25519Signature, derivePublicKeyPem } from "./signer.js";
export type { IssuerSigner } from "./signer.js";
export { loadTrustStore, saveTrustStore, pinKeyToTrustStore, defaultTrustStorePath } from "./trust-store.js";
export type { TrustStore, TrustStoreKey } from "./trust-store.js";
export {
  skillerrHomeDir,
  defaultIssuerKeyPath,
  issuerKeyIdFor,
  generateEd25519KeyPair,
  loadDefaultIssuer,
  loadOrCreateDefaultIssuer,
  signerFromIssuer,
} from "./default-issuer.js";
export type { ResolvedIssuer } from "./default-issuer.js";
export {
  compileSkillSource,
  compileRecipeToSkill,
  approveCompilation,
  assessCompleteness,
  CompileRefusalError,
} from "./compile.js";
export type { CompileOptions, CompileResult } from "./compile.js";
export { scrub, redactSecrets, rulesDigest, mergeRedactionReports } from "./scrub.js";
export type {
  ScrubInput,
  ScrubUnit,
  ScrubOptions,
  ScrubCustomRule,
  ScrubResult,
} from "./scrub.js";
export {
  anchorToRekor,
  verifyRekorAnchor,
  checkRekorOnline,
  rekorSearchUrl,
  mintKeylessAnchor,
  verifyKeylessAnchor,
  buildAnchorStatement,
  assertAnchorStatementPrivacy,
  ANCHOR_STATEMENT_TYPE,
  ANCHOR_PREDICATE_TYPE,
  ANCHOR_STATEMENT_VERSION,
} from "./transparency.js";
export type {
  TransparencyOptions,
  TransparencyAnchorResult,
  VerifyAnchorOptions,
  AnchorVerification,
  KeylessIdentityOptions,
  KeylessAnchorResult,
  KeylessVerification,
  AnchorSubject,
  ExpectedAnchorSubject,
  SkillAnchorStatement,
} from "./transparency.js";
export { assessClaims } from "./claims.js";
export type { VerifiedClaim, SelfReportedClaim, ClaimsAssurance, AssessClaimsOptions } from "./claims.js";
export {
  seal,
  openSealed,
  sign,
  verifySignature,
  RekorAnchor,
  capabilitiesFromPermission,
  evaluateReleaseProfile,
  verify,
  generateSBOM,
} from "./trust-spine.js";
export type {
  SealInput,
  SealResult,
  OpenSealedResult,
  Signature,
  SignOpts,
  Commitment,
  Anchor,
  RekorAnchorConfig,
  CapabilityKind,
  Capability,
  GateResult,
  Evidence,
  VerifyResult,
  RevocationRecord,
  SBOM,
  SBOMComponent,
  SBOMHash,
} from "./trust-spine.js";
export {
  buildLeaf,
  treeHash,
  buildSignedTreeHead,
  generateInclusionProof,
  verifyInclusion,
  generateConsistencyProof,
  verifyConsistency,
} from "./merkle-log.js";
export type {
  LogEvent,
  Leaf,
  InclusionProof,
  SignedTreeHead,
  ConsistencyProof,
} from "./merkle-log.js";
export { isContinuity, openContinuity, resumePreview, renderResumeContract } from "./continuity.js";
export { captureSession } from "./capture.js";
export type { CaptureOptions, CaptureContext, CaptureResult } from "./capture.js";
export {
  SESSION_SOURCES,
  listSessionCandidates,
  resolveSession,
  loadSessionContext,
  mergeCaptureContexts,
  normalizeSessionSourceId,
  normalizeResumeAgent,
  resumeAgentFromSessionSource,
  sessionSourceFromResumeAgent,
  claudeProjectSlug,
  sanitizedProjectSlug,
} from "./session-source.js";
export type {
  SessionSourceId,
  SessionCandidate,
  ListSessionsOptions,
  ResolveSessionOptions,
  ResolveSessionResult,
  SessionContextResult,
  ResumeAgentId,
} from "./session-source.js";
export type {
  Gap,
  ContinuitySection,
  ContinuityJourney,
  AgentContextSummary,
  ContinuityOpenResult,
  ResumeTarget,
  ResumeContract,
  WorkingSet,
  WorkingSetFile,
  WorkingSetCommit,
  PlanItem,
  FilePointer,
  ToolResult,
  ContinuitySource,
} from "./continuity.js";