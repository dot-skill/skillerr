import type { ValidateFunction } from "ajv";
// The base "ajv" export only understands draft-07; our schemas declare
// $schema: draft/2020-12, which needs the dedicated 2020-12 build.
import { Ajv2020 } from "ajv/dist/2020.js";
// ajv-formats' CJS default export doesn't resolve as callable under
// NodeNext without esModuleInterop (a known ajv-formats/TS interop gap) —
// the `.default` indirection is the documented workaround, not a typo.
import addFormatsImport from "ajv-formats";
const addFormats = addFormatsImport as unknown as typeof addFormatsImport.default;
import type { SkillManifest, Workflow } from "@skillerr/protocol";
import {
  assessSkillContract,
  CONTAINER_VERSION,
  PROTOCOL_VERSION,
  WORKFLOW_DIALECT_VERSION,
  isValidHostPattern,
  isValidPathPattern,
  loadSchema,
} from "@skillerr/protocol";
import { packageDigestFromContent, sealedManifestDigest, sha256Digest } from "./hash.js";
import { unpackSkill } from "./pack.js";

/**
 * PROTO-7: JSON Schemas for every container file, compiled once and reused.
 * `strict: false` because the schemas lean on allOf/if-then for the
 * workflow step-kind union, which is valid draft 2020-12 but stricter than
 * ajv's default "strict mode" heuristics care to allow.
 */
let schemaValidators:
  | {
      manifest: ValidateFunction;
      workflow: ValidateFunction;
      knowledgeItem: ValidateFunction;
      creationAttestation: ValidateFunction;
    }
  | undefined;

function getSchemaValidators(): NonNullable<typeof schemaValidators> {
  if (!schemaValidators) {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    // Schemas declare format: "date-time" (provenance timestamps); without
    // this, ajv logs "unknown format ... ignored" noise on every validate.
    addFormats(ajv);
    ajv.addSchema(loadSchema("skill-contract"));
    schemaValidators = {
      manifest: ajv.compile(loadSchema("skill-manifest")),
      workflow: ajv.compile(loadSchema("workflow")),
      knowledgeItem: ajv.compile(loadSchema("knowledge-item")),
      creationAttestation: ajv.compile(loadSchema("creation-attestation")),
    };
  }
  return schemaValidators;
}

function schemaIssues(
  validate: ValidateFunction,
  data: unknown,
  code: string,
  path?: string,
): ValidationIssue[] {
  if (validate(data)) return [];
  return (validate.errors ?? []).map((e) => ({
    severity: "error",
    code,
    message: `${e.instancePath || "(root)"} ${e.message ?? "failed schema validation"}`,
    path,
  }));
}

export interface ValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  path?: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  manifest?: SkillManifest;
  workflow?: Workflow;
}

export function validateManifestShape(manifest: SkillManifest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  // PROTO-7: schema-check first — catches wrong types/enums/shapes the
  // hand-written checks below don't (they mostly check presence/semantics).
  issues.push(...schemaIssues(getSchemaValidators().manifest, manifest, "schema_manifest"));
  if (manifest.kind !== "dot-skill") {
    issues.push({ severity: "error", code: "kind", message: "kind must be dot-skill" });
  }
  if (!manifest.id) issues.push({ severity: "error", code: "id", message: "id required" });
  if (!manifest.version)
    issues.push({ severity: "error", code: "version", message: "version required" });
  if (!manifest.title)
    issues.push({ severity: "error", code: "title", message: "title required" });
  if (!manifest.description)
    issues.push({
      severity: "error",
      code: "description",
      message: "description required",
    });
  if (!manifest.entrypoint)
    issues.push({
      severity: "error",
      code: "entrypoint",
      message: "entrypoint required",
    });
  if (manifest.container_version !== CONTAINER_VERSION) {
    issues.push({
      severity: "warning",
      code: "container_version",
      message: `Unexpected container_version ${manifest.container_version}`,
    });
  }
  if (manifest.protocol_version !== PROTOCOL_VERSION) {
    issues.push({
      severity: "error",
      code: "protocol_version",
      message: `Unsupported protocol_version ${manifest.protocol_version}; expected ${PROTOCOL_VERSION}`,
    });
  }
  // manifest.inputs and manifest.policy.consent_for are required protocol
  // fields. Nothing structurally checked their presence before — code that
  // reads them defensively falls back to `?? []`, so a package with either
  // field stripped passed silently instead of failing validation. That
  // matters beyond hygiene: runtime's consent gating loops over
  // policy.consent_for, so a stripped array would silently skip requiring
  // consent for write/network/exec/destructive side effects.
  if (!Array.isArray(manifest.inputs)) {
    issues.push({
      severity: "error",
      code: "inputs_missing",
      message: "manifest.inputs is required and must be an array",
    });
  }
  if (!manifest.policy || typeof manifest.policy !== "object") {
    issues.push({
      severity: "error",
      code: "policy_missing",
      message: "manifest.policy is required",
    });
  } else if (!Array.isArray(manifest.policy.consent_for)) {
    issues.push({
      severity: "error",
      code: "policy_consent_for_missing",
      message: "manifest.policy.consent_for is required and must be an array",
    });
  }
  // SEC-F: package_digest excludes skill.json, and sealed_manifest_digest
  // only exists once minted — without manifest_digest, a draft/continuity
  // package's own permissions/capabilities/policy carry no integrity
  // binding at all, and hand-edited tampering passes validate silently.
  // Checked on every package, minted or not.
  if (!manifest.manifest_digest) {
    issues.push({
      severity: "error",
      code: "manifest_digest_missing",
      message:
        "manifest.manifest_digest is required; without it permissions/policy/capabilities have no integrity binding",
    });
  } else {
    // Recomputing can itself throw on a sufficiently malformed/tampered
    // manifest (e.g. a required array field stripped) — that is itself a
    // mismatch, not a crash. validate() must always return a report.
    let recomputed: string | undefined;
    try {
      recomputed = sealedManifestDigest(manifest);
    } catch {
      recomputed = undefined;
    }
    if (recomputed === undefined || manifest.manifest_digest !== recomputed) {
      issues.push({
        severity: "error",
        code: "manifest_digest_mismatch",
        message:
          "manifest.manifest_digest does not match the recomputed identity/permissions/policy/capabilities/content claims — the manifest may have been altered after packing",
      });
    }
  }
  // PROTO-5: validate hosts/paths grammar at the manifest level too — a
  // manifest can reach here via the legacy (non-contract) compile path, or
  // via direct tampering, neither of which goes through
  // assessSkillContract's authoring-time grammar check.
  for (const permission of manifest.permissions ?? []) {
    for (const host of permission.hosts ?? []) {
      if (!isValidHostPattern(host)) {
        issues.push({
          severity: "error",
          code: "invalid_host_pattern",
          message: `permissions[].hosts contains an invalid host pattern: ${JSON.stringify(host)}`,
          path: permission.description,
        });
      }
    }
    for (const path of permission.paths ?? []) {
      if (!isValidPathPattern(path)) {
        issues.push({
          severity: "error",
          code: "invalid_path_pattern",
          message: `permissions[].paths contains an invalid path pattern: ${JSON.stringify(path)}`,
          path: permission.description,
        });
      }
    }
  }
  if (manifest.compile_profile === "release") {
    if (!manifest.contract) {
      issues.push({
        severity: "error",
        code: "release_contract_missing",
        message: "Release packages require a native 0.5 authoring contract",
      });
    } else {
      for (const issue of assessSkillContract(manifest.contract, "release").issues) {
        issues.push({
          severity: "error",
          code: `contract_${issue.code}`,
          message: `${issue.field}: ${issue.message}`,
          path: issue.field,
        });
      }
    }
  }
  if (manifest.mint?.mint_status === "minted") {
    if (manifest.compile_profile !== "release") {
      issues.push({
        severity: "error",
        code: "minted_profile",
        message: "Minted packages must use compile_profile=release",
      });
    }
    if (!manifest.completeness?.complete) {
      issues.push({
        severity: "error",
        code: "minted_incomplete",
        message: "Minted packages require a complete release report",
      });
    }
  }
  for (const input of manifest.inputs ?? []) {
    if (input.sensitivity === "secret" && input.examples?.length) {
      issues.push({
        severity: "error",
        code: "secret_examples",
        message: `Input ${input.name} is secret but includes examples`,
        path: input.name,
      });
    }
  }
  return issues;
}

export function validateWorkflowShape(
  workflow: Workflow,
  entrypoint: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  issues.push(...schemaIssues(getSchemaValidators().workflow, workflow, "schema_workflow"));
  if (workflow.kind !== "workflow") {
    issues.push({ severity: "error", code: "workflow_kind", message: "kind must be workflow" });
  }
  if (workflow.dialect_version !== WORKFLOW_DIALECT_VERSION) {
    issues.push({
      severity: "warning",
      code: "dialect",
      message: `Unexpected dialect_version ${workflow.dialect_version}`,
    });
  }
  const ids = new Set(workflow.steps.map((s) => s.id));
  if (!ids.has(entrypoint)) {
    issues.push({
      severity: "error",
      code: "entrypoint_missing",
      message: `Entrypoint ${entrypoint} not in steps`,
    });
  }
  for (const step of workflow.steps) {
    if (!step.id || !step.kind) {
      issues.push({
        severity: "error",
        code: "step",
        message: "Each step needs id and kind",
      });
    }
    const refs = [
      ...(typeof step.next === "string" ? [step.next] : step.next ?? []),
      ...(step.on_fail ? [step.on_fail] : []),
      ...(step.kind === "branch"
        ? [...step.cases.map((branch) => branch.goto), ...(step.else ? [step.else] : [])]
        : []),
    ];
    for (const ref of refs) {
      if (!ids.has(ref)) {
        issues.push({
          severity: "error",
          code: "step_reference_missing",
          message: `Step ${step.id} references missing step ${ref}`,
          path: step.id,
        });
      }
    }
  }
  return issues;
}

export function validatePackageBytes(archive: Uint8Array): ValidationResult {
  const issues: ValidationIssue[] = [];
  let unpacked;
  try {
    unpacked = unpackSkill(archive);
  } catch (e) {
    return {
      ok: false,
      issues: [
        {
          severity: "error",
          code: "unpack",
          message: e instanceof Error ? e.message : String(e),
        },
      ],
    };
  }

  issues.push(...validateManifestShape(unpacked.manifest));
  issues.push(...validateWorkflowShape(unpacked.workflow, unpacked.manifest.entrypoint));

  // PROTO-7: schema-check every knowledge item and the DSSE creation
  // attestation envelope too — the two container file kinds that don't
  // have a dedicated top-level validate*Shape() function of their own.
  const validators = getSchemaValidators();
  for (const item of unpacked.knowledge) {
    issues.push(...schemaIssues(validators.knowledgeItem, item, "schema_knowledge_item", item.id));
  }
  const dsseEnvelope = unpacked.raw.signatures?.["creation.dsse.json"];
  if (dsseEnvelope) {
    issues.push(
      ...schemaIssues(validators.creationAttestation, dsseEnvelope, "schema_creation_attestation"),
    );
  }

  const computed: Array<{ path: string; digest: string }> = [];
  for (const [path, data] of Object.entries(unpacked.files)) {
    if (path === "skill.json" || path.startsWith("signatures/")) continue;
    const digest = sha256Digest(data);
    computed.push({ path, digest });
    const listed = unpacked.manifest.content.find((c) => c.path === path);
    if (!listed) {
      issues.push({
        severity: "error",
        code: "missing_content_entry",
        message: `File ${path} not listed in manifest.content`,
        path,
      });
    } else if (listed.digest !== digest) {
      issues.push({
        severity: "error",
        code: "digest_mismatch",
        message: `Digest mismatch for ${path}`,
        path,
      });
    }
  }

  for (const entry of unpacked.manifest.content) {
    if (!unpacked.files[entry.path]) {
      issues.push({
        severity: "error",
        code: "missing_file",
        message: `Manifest lists missing file ${entry.path}`,
        path: entry.path,
      });
    }
  }

  const expectedPkg = packageDigestFromContent(computed);
  if (unpacked.manifest.package_digest !== expectedPkg) {
    issues.push({
      severity: "error",
      code: "package_digest",
      message: "package_digest does not match content index",
    });
  }

  if (unpacked.manifest.policy.require_signatures) {
    const sigs = Object.keys(unpacked.files).filter((p) => p.startsWith("signatures/"));
    if (sigs.length === 0) {
      issues.push({
        severity: "error",
        code: "signatures_required",
        message: "Policy requires signatures but none present",
      });
    }
  }

  const ok = !issues.some((i) => i.severity === "error");
  return {
    ok,
    issues,
    manifest: unpacked.manifest,
    workflow: unpacked.workflow,
  };
}

export function inspectSkill(archive: Uint8Array): {
  ok: boolean;
  summary: {
    id: string;
    version: string;
    title: string;
    description: string;
    intent?: string;
    license?: string;
    license_url?: string;
    inputs: string[];
    permissions: string[];
    capabilities: string[];
    package_digest: string;
    sealed_manifest_digest?: string;
    mint_status?: string;
    needs_human_review?: boolean;
    trust_label?: string;
    trust_state?: string;
  };
  issues: ValidationIssue[];
} {
  const result = validatePackageBytes(archive);
  if (!result.manifest) {
    return {
      ok: false,
      summary: {
        id: "",
        version: "",
        title: "",
        description: "",
        inputs: [],
        permissions: [],
        capabilities: [],
        package_digest: "",
        trust_label: "INVALID",
        trust_state: "untrusted",
      },
      issues: result.issues,
    };
  }
  const m = result.manifest;
  const mint_status = m.mint?.mint_status ?? "draft";
  // inspectSkill is deliberately lightweight (no signature verification —
  // that's inspectTrustView / `skill inspect --trust`). mint_status and
  // attestation_digest are plain manifest fields the package itself claims;
  // neither proves a valid signature exists. Label accordingly instead of
  // the confident-sounding "SEALED", which read as verified when it wasn't.
  const claimsSealed = mint_status === "minted" && Boolean(m.attestation_digest);
  let trust_label = "UNSIGNED / OPEN — untrusted";
  let trust_state = "untrusted";
  if (claimsSealed) {
    trust_label = "CLAIMS SEALED (unverified — run `skill inspect --trust` to verify the signature)";
    trust_state = "self_reported";
  }
  return {
    ok: result.ok,
    summary: {
      id: m.id,
      version: m.version,
      title: m.title,
      description: m.description,
      intent: m.intent,
      license: m.license,
      license_url: m.license_url,
      inputs: m.inputs.filter((i) => i.required).map((i) => i.name),
      permissions: m.permissions.map((p) => p.side_effect_class),
      capabilities: m.capabilities.map((c) => c.name),
      package_digest: m.package_digest,
      sealed_manifest_digest: m.sealed_manifest_digest,
      mint_status,
      needs_human_review: m.needs_human_review,
      trust_label,
      trust_state,
    },
    issues: result.issues,
  };
}
