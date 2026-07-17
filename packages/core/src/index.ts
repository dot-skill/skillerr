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
  redactSecrets,
  CompileRefusalError,
} from "./compile.js";
export type { CompileOptions, CompileResult } from "./compile.js";
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