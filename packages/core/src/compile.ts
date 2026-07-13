import { createHash } from "node:crypto";
import type {
  CompletenessPart,
  CompletenessReport,
  CompilationIssue,
  CompilationMapping,
  CompilationReport,
  ContractAssessment,
  ContractStep,
  GenerationUsage,
  InputSlot,
  KnowledgeItem,
  KnowledgeItemType,
  Recipe,
  SkillCompileProfile,
  SkillPackageFiles,
  SkillSection,
  SkillSource,
  SteeringConstraint,
  WorkflowStep,
} from "@skillerr/protocol";
import {
  DEFAULT_SKILL_POLICY,
  CONTAINER_VERSION,
  PROTOCOL_VERSION,
  WORKFLOW_DIALECT_VERSION,
  assessSkillContract,
  isValidAgentHost,
  recipeToSkillSource,
} from "@skillerr/protocol";
import { canonicalize } from "./hash.js";
import { packSkill, finalizeManifest, buildFileMap } from "./pack.js";

const PLACEHOLDER_RE =
  /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}|<([A-Z][A-Z0-9_]+)>|\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

const SECRET_PATTERNS: RegExp[] = [
  /\b(?:sk|pk|api)[_-][A-Za-z0-9]{8,}\b/g,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/g,
];

/**
 * Pure hex runs (git SHAs, sha256/sha1 content digests, …) match the broad
 * 40+ char base64-alphabet pattern above but are not secrets — redacting
 * them corrupts knowledge bodies that legitimately reference a commit or
 * digest. Any real secret candidate uses at least one non-hex character
 * (mixed case beyond a-f, digits mixed with `+`/`/`/`=`, …).
 */
function looksLikeHexDigestNotSecret(match: string): boolean {
  return /^[0-9a-fA-F]+$/.test(match);
}

const GENERALIZABLE_PATTERNS: Array<{
  re: RegExp;
  name: string;
  reason: string;
}> = [
  {
    re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    name: "email",
    reason: "Email addresses vary per deployment",
  },
  {
    re: /\bhttps?:\/\/[^\s)]+/gi,
    name: "base_url",
    reason: "Service URLs are environment-specific",
  },
  {
    re: /\b(?:sk|pk|api)[_-][A-Za-z0-9]{8,}\b/g,
    name: "api_credential_ref",
    reason: "Credentials must be secret refs, never embedded",
  },
];

/**
 * PROTO-1: skill_id is derived from the source's own content (hash +
 * contract, when present) rather than a random UUID. The same logical
 * skill compiled twice gets the same identity — random ids meant identity
 * carried no integrity meaning and every rebuild silently changed it,
 * which also made byte-identical repacking (SEC-J) impossible. A
 * human-friendly label still lives in manifest.title, separate from id.
 */
function contentAddressedSkillId(source: SkillSource): string {
  const seed = source.contract
    ? `${source.hash}:${canonicalize(source.contract)}`
    : source.hash;
  return `skl_${createHash("sha256").update(seed).digest("hex").slice(0, 12)}`;
}

function knowledgeTypeFor(section: SkillSection): KnowledgeItemType {
  switch (section.type) {
    case "decision":
      return "decision";
    case "tradeoff":
      return "tradeoff";
    case "lesson":
      return "lesson";
    case "correction_note":
      return "correction";
    case "requirement":
    case "intent":
      return "constraint";
    case "reference":
    case "resource":
    case "doc":
      return "reference";
    default:
      return "rule";
  }
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 40) || "value"
  );
}

/**
 * Scrub likely secrets from text before packaging.
 * `onRedact` is called for every match actually replaced (not for hex
 * digests skipped as false positives) so callers building a
 * compilation_report can turn a redaction into a loud, inspectable entry
 * instead of a silent content change.
 */
export function redactSecrets(text: string, onRedact?: (match: string) => void): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    re.lastIndex = 0;
    out = out.replace(re, (match) => {
      if (looksLikeHexDigestNotSecret(match)) return match;
      onRedact?.(match);
      return "{{secret_ref}}";
    });
  }
  return out;
}

/** redactSecrets(), but pushes a loud `secret_redacted` report entry for any match. */
function redactSecretsReported(
  text: string,
  issues: CompilationIssue[],
  context: string,
  relatedId?: string,
): string {
  let count = 0;
  const out = redactSecrets(text, () => {
    count += 1;
  });
  if (count > 0) {
    issues.push({
      severity: "info",
      code: "secret_redacted",
      message: `${count} likely secret(s) redacted from ${context}`,
      related: relatedId ? [relatedId] : undefined,
    });
  }
  return out;
}

export class CompileRefusalError extends Error {
  readonly kind = "compile_refused" as const;
  readonly profile: SkillCompileProfile;
  readonly missing: CompletenessPart[];
  readonly hints: string[];
  readonly completeness: CompletenessReport;

  constructor(report: CompletenessReport) {
    super(
      `compile_refused (${report.profile}): missing [${report.missing.join(", ")}]. ${report.hints.join(" ")}`,
    );
    this.name = "CompileRefusalError";
    this.profile = report.profile;
    this.missing = report.missing;
    this.hints = report.hints;
    this.completeness = report;
  }
}

export interface CompileOptions {
  skill_id?: string;
  version?: string;
  title?: string;
  description?: string;
  /**
   * compilation_report.created_at. Defaults to source.created_at (not
   * wall-clock) so compiling the same source twice is byte-identical
   * (SEC-J). Pass explicitly to record a different, still-deterministic
   * timestamp.
   */
  created_at?: string;
  provenance_mode?: "full" | "redacted" | "proof_only";
  profile?: SkillCompileProfile;
  /** When true, inferred inputs are marked approved (human already reviewed). */
  approve_inferred_inputs?: boolean;
  approve_permissions?: boolean;
  generation_usage?: GenerationUsage;
  /**
   * Continuity may emit partial packages.
   * Release refuses unless complete — set true only in tests that assert refusal.
   */
  allow_incomplete?: boolean;
}

export interface CompileResult {
  files: SkillPackageFiles;
  report: CompilationReport;
  packageBytes: Uint8Array;
  pending_approvals: string[];
  completeness: CompletenessReport;
}

const HINTS: Partial<Record<CompletenessPart, string>> = {
  agent_context:
    "Set SKILL_HOST to an AI host (cursor, ollama, lmstudio, llama-cpp, custom-agent, …). This is asserted provenance, not cryptographic proof.",
  intent: "Add an intent/summary section describing what this skill is for.",
  sections: "Agent must propose at least one section (decision, integration, workflow, …).",
  workflow: "Need actionable workflow content (integration, prompt, implementation, or workflow_note).",
  knowledge_or_prompts: "Need knowledge sections or prompt templates — not an empty package.",
  inputs_declared:
    "Declare typed inputs or set SkillSource.inputs_declared='none'. Placeholders like {{base_url}} become inputs.",
  journey:
    "Provide a redacted journey summary of the human+AI work (no raw chat, no secrets).",
  generation_usage: "Optional but recommended: report token usage used to create this skill.",
  human_approvals: "Human must approve inferred inputs/permissions before release mint.",
};

export function assessCompleteness(
  source: SkillSource,
  opts: {
    profile: SkillCompileProfile;
    hasWorkflowAction: boolean;
    hasKnowledge: boolean;
    hasInputsDeclared: boolean;
    pendingApprovals: string[];
  },
): CompletenessReport {
  const present: CompletenessPart[] = [];
  const missing: CompletenessPart[] = [];

  const check = (part: CompletenessPart, ok: boolean) => {
    if (ok) present.push(part);
    else missing.push(part);
  };

  check("agent_context", isValidAgentHost(source.agent.host));
  check(
    "intent",
    Boolean((source.intent ?? source.summary ?? source.title)?.trim().length),
  );
  check("sections", source.sections.length >= 1);
  check("knowledge_or_prompts", opts.hasKnowledge || source.prompts.length > 0);
  check("workflow", opts.hasWorkflowAction);
  check("inputs_declared", opts.hasInputsDeclared);
  check(
    "journey",
    Boolean(source.journey?.summary?.trim()) && source.journey.redacted !== false,
  );

  if (source.generation_usage?.total_tokens || source.generation_usage?.input_tokens) {
    present.push("generation_usage");
  }

  if (opts.profile === "release") {
    check("human_approvals", opts.pendingApprovals.length === 0);
    // generation_usage recommended but not hard-required for release
  } else {
    // continuity: drop soft requirements from missing
    const soft = new Set<CompletenessPart>([
      "workflow",
      "inputs_declared",
      "human_approvals",
      "generation_usage",
    ]);
    for (let i = missing.length - 1; i >= 0; i--) {
      if (soft.has(missing[i]!)) missing.splice(i, 1);
    }
  }

  const requiredMissing =
    opts.profile === "continuity"
      ? missing.filter((m) =>
          ["agent_context", "sections", "intent", "journey", "knowledge_or_prompts"].includes(m),
        )
      : missing.filter((m) => m !== "generation_usage");

  return {
    kind: "completeness_report",
    profile: opts.profile,
    complete: requiredMissing.length === 0,
    present,
    missing: requiredMissing,
    hints: requiredMissing.map((m) => HINTS[m] ?? `Complete the ${m} declaration.`),
  };
}

function sectionHasWorkflowAction(sections: SkillSection[]): boolean {
  return sections.some((s) =>
    ["integration", "prompt", "implementation_note", "workflow_note", "code", "config"].includes(
      s.type,
    ),
  );
}

function declaredItems<T>(declaration: { status: string; items?: T[] } | undefined): T[] {
  if (!declaration) return [];
  return declaration.status === "specified" ? declaration.items ?? [] : [];
}

function contractCompleteness(
  assessment: ContractAssessment,
  profile: SkillCompileProfile,
): CompletenessReport {
  const missing = [...new Set(
    assessment.issues.map((issue) => {
      const root = issue.field.split(".")[0]!;
      return (root === "contract" ? "semantic_contract" : root) as CompletenessPart;
    }),
  )];
  const contractParts: CompletenessPart[] = [
    "semantic_contract",
    "intent",
    "triggers",
    "inputs",
    "preconditions",
    "steps",
    "branches",
    "human_decisions",
    "capabilities",
    "permissions",
    "forbidden_actions",
    "outputs",
    "recovery",
    "verification",
    "corrections",
    "provenance",
  ];
  return {
    kind: "completeness_report",
    profile,
    complete: assessment.complete,
    present: contractParts.filter((part) => !missing.includes(part)),
    missing,
    hints: assessment.issues.map((issue) => `${issue.field}: ${issue.fix}`),
  };
}

function compileContractStep(step: ContractStep): WorkflowStep {
  const base = {
    id: step.id,
    title: step.title,
    optional: step.optional,
    next: step.next,
    on_fail: step.on_failure,
  };
  switch (step.kind) {
    case "instruct":
      return { ...base, kind: "instruct", text: step.instruction ?? "" };
    case "prompt":
      return { ...base, kind: "prompt", template: step.instruction ?? "" };
    case "tool":
      return {
        ...base,
        kind: "tool",
        capability: step.capability ?? "",
        arguments: step.arguments,
        argument_bindings: step.argument_bindings,
        result_as: step.result_as,
      };
    case "transform":
      return {
        ...base,
        kind: "transform",
        expression: step.instruction ?? "identity",
        result_as: step.result_as,
      };
    case "checkpoint":
      return { ...base, kind: "checkpoint", message: step.instruction };
    case "human_decision":
      return {
        ...base,
        kind: "human_decision",
        prompt: step.instruction ?? step.decision ?? step.title,
        result_as: step.result_as,
      };
    case "verify":
      return { ...base, kind: "verify", assertions: step.assertions ?? [] };
    case "emit":
      return {
        ...base,
        kind: "emit",
        output: step.output ?? "",
        from: step.from ?? "",
      };
  }
}

function compileNativeContract(
  source: SkillSource,
  opts: CompileOptions,
  profile: SkillCompileProfile,
): CompileResult {
  const contract = source.contract!;
  if (!isValidAgentHost(source.agent.host) || !source.journey?.summary?.trim()) {
    const missing: CompletenessPart[] = [];
    const hints: string[] = [];
    if (!isValidAgentHost(source.agent.host)) {
      missing.push("agent_context");
      hints.push(HINTS.agent_context!);
    }
    if (!source.journey?.summary?.trim()) {
      missing.push("journey");
      hints.push(HINTS.journey!);
    }
    throw new CompileRefusalError({
      kind: "completeness_report",
      profile,
      complete: false,
      present: [],
      missing,
      hints,
    });
  }
  const assessment = assessSkillContract(contract, profile);
  const completeness = contractCompleteness(assessment, profile);
  if (!assessment.complete && !opts.allow_incomplete && profile === "release") {
    throw new CompileRefusalError(completeness);
  }

  const skillId = opts.skill_id ?? contentAddressedSkillId(source);
  const inputs = declaredItems(contract.inputs).map((input) => ({
    name: input.name,
    description: input.description,
    schema: structuredClone(input.schema),
    required: input.required,
    ...(input.default !== undefined ? { default: structuredClone(input.default) } : {}),
    sensitivity: input.sensitivity,
    source: input.source,
    ask_when: input.ask_when,
    approval: input.approval,
    // Contract review approves the slot definition; human_before_use remains a runtime gate.
    approved: true,
  }));
  const outputs = declaredItems(contract.outputs).map((output) => ({
    name: output.name,
    description: output.description,
    schema: structuredClone(output.schema),
    required: output.required,
    media_type: output.media_type,
    assert: output.assertions,
  }));
  const capabilities = declaredItems(contract.capabilities).map((capability) => ({
    ...structuredClone(capability),
  }));
  const permissions = declaredItems(contract.permissions).map((permission) => ({
    side_effect_class: permission.side_effect_class,
    description: permission.description,
    paths: permission.paths,
    hosts: permission.hosts,
    requires_consent: permission.consent === "explicit_human",
  }));

  const redactionIssues: CompilationIssue[] = [];
  const knowledge: KnowledgeItem[] = source.sections.map((section) => ({
    kind: "knowledge",
    id: `k_${section.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16)}`,
    type: knowledgeTypeFor(section),
    title: section.title,
    body: redactSecretsReported(
      section.body,
      redactionIssues,
      `knowledge section "${section.title}"`,
      section.id,
    ),
    fidelity: "exact",
    pinned: true,
    sensitivity: section.sensitivity === "public" ? "public" : "private",
    provenance: [{ kind: "section", id: section.id, revision: section.revision, hash: source.hash }],
  }));

  const steps = declaredItems(contract.steps).map(compileContractStep);
  for (let i = 0; i < steps.length - 1; i++) {
    if (!steps[i]!.next) steps[i]!.next = steps[i + 1]!.id;
  }
  let entrypoint = steps[0]?.id;

  for (const branch of declaredItems(contract.branches)) {
    const branchStep: WorkflowStep = {
      id: branch.id,
      kind: "branch",
      title: `Conditional branch: ${branch.condition}`,
      cases: [{ when: branch.condition, goto: branch.then }],
      else: branch.otherwise,
    };
    steps.push(branchStep);
    if (branch.after_step) {
      const parent = steps.find((step) => step.id === branch.after_step);
      if (parent) parent.next = branch.id;
    }
  }

  for (const decision of declaredItems(contract.human_decisions)) {
    const decisionStep: WorkflowStep = {
      id: decision.id,
      kind: "human_decision",
      title: decision.prompt,
      prompt: decision.prompt,
      choices: decision.choices,
      result_as: decision.id,
      next: decision.required_before,
    };
    for (const step of steps) {
      if (step.next === decision.required_before) step.next = decision.id;
    }
    if (entrypoint === decision.required_before) entrypoint = decision.id;
    steps.push(decisionStep);
  }

  for (const input of declaredItems(contract.inputs).filter(
    (item) => item.approval === "human_before_use",
  )) {
    const id = `approve_input_${slug(input.name)}`;
    steps.push({
      id,
      kind: "human_decision",
      title: `Approve input ${input.name}`,
      prompt: `Approve use of input ${input.name}: ${input.description}`,
      choices: ["approve", "deny"],
      result_as: id,
      next: entrypoint,
    });
    entrypoint = id;
  }

  for (const edge of declaredItems(contract.recovery)) {
    const from = steps.find((step) => step.id === edge.from_step);
    if (from && edge.goto) from.on_fail = edge.goto;
  }

  if (declaredItems(contract.preconditions).length) {
    const id = "contract_preconditions";
    steps.push({
      id,
      kind: "verify",
      title: "Verify contract preconditions",
      assertions: declaredItems(contract.preconditions).map((item) => `precondition:${item.id}`),
      next: entrypoint,
    });
    entrypoint = id;
  }

  const verification = declaredItems(contract.verification);
  if (verification.length) {
    const id = "contract_verification";
    const terminal = steps.find((step) => !step.next && step.id !== id);
    if (terminal) terminal.next = id;
    steps.push({
      id,
      kind: "verify",
      title: "Verify domain assertions",
      assertions: verification.map((item) => `contract_assertion:${item.id}`),
    });
    if (!entrypoint) entrypoint = id;
  }

  if (!entrypoint) {
    const id = "contract_noop";
    steps.push({
      id,
      kind: "instruct",
      title: "No operational steps declared",
      text: contract.intent,
    });
    entrypoint = id;
  }

  const constraints: SteeringConstraint[] = declaredItems(contract.forbidden_actions).map(
    (forbidden) => ({
      kind: "steering_constraint",
      id: forbidden.id,
      verb: "reject",
      effect: "forbidden",
      statement: forbidden.description,
    }),
  );
  const safeJourney = {
    ...source.journey,
    summary: redactSecretsReported(source.journey.summary, redactionIssues, "journey summary"),
    open_questions: source.journey.open_questions?.map((q) =>
      redactSecretsReported(q, redactionIssues, "journey open question"),
    ),
    decisions: source.journey.decisions?.map((d) =>
      redactSecretsReported(d, redactionIssues, "journey decision"),
    ),
    redacted: true,
  };
  const report: CompilationReport = {
    kind: "compilation_report",
    skill_id: skillId,
    source_id: source.id,
    profile,
    created_at: opts.created_at ?? source.created_at,
    mappings: [],
    inferred_inputs: [],
    issues: [
      ...assessment.issues.map((issue) => ({
        severity: (profile === "release" ? "error" : "warning") as CompilationIssue["severity"],
        code: `contract_${issue.code}`,
        message: `${issue.field}: ${issue.message}`,
        related: [issue.field],
      })),
      ...redactionIssues,
    ],
    pending_approvals: [],
    approved: contract.provenance.human_review.status === "reviewed",
    completeness,
    semantic_contract: "native_0.5",
  };
  const files: SkillPackageFiles = {
    manifest: {
      kind: "dot-skill",
      id: skillId,
      version: opts.version ?? "1.0.0",
      title: opts.title ?? contract.title,
      description: opts.description ?? source.summary ?? contract.intent,
      intent: contract.intent,
      contract: structuredClone(contract),
      triggers: declaredItems(contract.triggers),
      preconditions: structuredClone(contract.preconditions),
      branches: structuredClone(contract.branches),
      human_decisions: structuredClone(contract.human_decisions),
      forbidden_actions: structuredClone(contract.forbidden_actions),
      recovery: structuredClone(contract.recovery),
      verification: structuredClone(contract.verification),
      corrections: structuredClone(contract.corrections),
      authors: source.actor ? [source.actor] : undefined,
      container_version: CONTAINER_VERSION,
      protocol_version: PROTOCOL_VERSION,
      entrypoint,
      inputs,
      outputs,
      capabilities,
      permissions,
      policy: { ...DEFAULT_SKILL_POLICY },
      content: [],
      package_digest: "sha256:" + "0".repeat(64),
      provenance_mode: opts.provenance_mode ?? (profile === "continuity" ? "redacted" : "full"),
      compile_profile: profile,
      completeness,
      package_sensitivity: contract.sensitivity,
      mint: { mint_status: "draft" },
      needs_human_review:
        profile === "continuity" || contract.provenance.human_review.status !== "reviewed",
    },
    workflow: {
      kind: "workflow",
      dialect_version: WORKFLOW_DIALECT_VERSION,
      entrypoint,
      steps,
      constraints,
      preconditions: structuredClone(contract.preconditions),
      branches: structuredClone(contract.branches),
      human_decisions: structuredClone(contract.human_decisions),
      recovery: structuredClone(contract.recovery),
      verification: structuredClone(contract.verification),
    },
    knowledge,
    provenance: {
      source:
        opts.provenance_mode === "proof_only"
          ? undefined
          : {
              id: source.id,
              hash: source.hash,
              title: source.title,
              contract: structuredClone(contract),
              agent: {
                ...source.agent,
                endpoint: source.agent.endpoint
                  ? redactSecrets(source.agent.endpoint)
                  : undefined,
              },
              section_ids: source.sections.map((section) => `${section.id}@${section.revision}`),
              source_refs: source.source_refs,
            },
      journey: safeJourney,
      generation_usage: opts.generation_usage ?? source.generation_usage,
      proof: { source_id: source.id, source_hash: source.hash },
      compilation_report: report,
    },
  };
  const fileMap = buildFileMap(files);
  files.manifest = finalizeManifest(files.manifest, fileMap);
  const packageBytes = packSkill(files);
  return {
    files,
    report,
    packageBytes,
    pending_approvals: [],
    completeness,
  };
}

export function compileSkillSource(
  source: SkillSource,
  opts: CompileOptions = {},
): CompileResult {
  const profile: SkillCompileProfile = opts.profile ?? "release";
  if (source.contract) return compileNativeContract(source, opts, profile);
  if (profile === "release") {
    throw new CompileRefusalError({
      kind: "completeness_report",
      profile,
      complete: false,
      present: [],
      missing: ["semantic_contract"],
      hints: [
        source.contract_load_error
          ? `A contract was found but could not be used, so release refuses rather than silently falling back: ${source.contract_load_error}`
          : "Legacy 0.4 SkillSource/Recipe text is a lossy adapter. Add a protocol 0.5 SkillContract and assess it before release compile; use continuity only for migration.",
      ],
    });
  }
  const skillId = opts.skill_id ?? contentAddressedSkillId(source);
  const version = opts.version ?? "1.0.0";
  const issues: CompilationIssue[] = [];
  const mappings: CompilationMapping[] = [];
  const knowledge: KnowledgeItem[] = [];
  const steps: WorkflowStep[] = [];
  const inferredInputs: InputSlot[] = [];
  const inputNames = new Set<string>();
  const constraints: SteeringConstraint[] = [];

  if (!isValidAgentHost(source.agent.host)) {
    const completeness = assessCompleteness(source, {
      profile,
      hasWorkflowAction: false,
      hasKnowledge: false,
      hasInputsDeclared: true,
      pendingApprovals: ["agent_context"],
    });
    completeness.missing = ["agent_context"];
    completeness.complete = false;
    completeness.hints = [HINTS.agent_context!];
    throw new CompileRefusalError(completeness);
  }

  const addInput = (slot: InputSlot) => {
    if (inputNames.has(slot.name)) {
      const existing = inferredInputs.find((i) => i.name === slot.name);
      if (existing && slot.sensitivity === "secret") {
        existing.sensitivity = "secret";
        existing.source = "secret";
      }
      return;
    }
    inputNames.add(slot.name);
    inferredInputs.push(slot);
  };

  for (const section of source.sections) {
    let body = redactSecretsReported(
      section.body,
      issues,
      `knowledge section "${section.title}"`,
      section.id,
    );
    PLACEHOLDER_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PLACEHOLDER_RE.exec(section.body))) {
      const rawName = m[1] || m[2] || m[3] || "value";
      const name = slug(rawName);
      const isSecret = /secret|credential|token|password|key/i.test(name);
      addInput({
        name,
        schema: { type: "string" },
        description: `Value for ${name} generalized from section ${section.title}`,
        source: isSecret ? "secret" : "human",
        required: true,
        sensitivity: isSecret ? "secret" : "private",
        ask_when: "if_missing",
        provenance: [{ kind: "section", id: section.id, revision: section.revision }],
        generalization_reason: "Explicit placeholder in approved text",
        approved: opts.approve_inferred_inputs === true,
      });
    }

    for (const pat of GENERALIZABLE_PATTERNS) {
      pat.re.lastIndex = 0;
      if (pat.re.test(section.body)) {
        const name = pat.name;
        addInput({
          name,
          schema: { type: "string" },
          description: pat.reason,
          source: name.includes("credential") ? "secret" : "human",
          required: true,
          sensitivity: name.includes("credential") ? "secret" : "private",
          ask_when: "if_missing",
          provenance: [{ kind: "section", id: section.id, revision: section.revision }],
          generalization_reason: pat.reason,
          approved: opts.approve_inferred_inputs === true,
        });
        if (name.includes("credential")) {
          body = body.replace(pat.re, "{{api_credential_ref}}");
        }
      }
    }

    const kid = `k_${section.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16)}`;
    const item: KnowledgeItem = {
      kind: "knowledge",
      id: kid,
      type: knowledgeTypeFor(section),
      title: section.title,
      body,
      fidelity: "exact",
      pinned: true,
      sensitivity: section.sensitivity === "public" ? "public" : "private",
      provenance: [
        { kind: "section", id: section.id, revision: section.revision, hash: source.hash },
      ],
    };
    knowledge.push(item);
    mappings.push({
      from: { kind: "section", id: section.id, revision: section.revision },
      to: { kind: "knowledge", id: kid },
    });

    if (section.type === "prompt") {
      const stepId = `s_prompt_${kid}`;
      steps.push({
        id: stepId,
        kind: "prompt",
        title: section.title,
        template: body,
        knowledge_refs: [kid],
        provenance: [{ kind: "section", id: section.id, revision: section.revision }],
      });
      mappings.push({
        from: { kind: "section", id: section.id, revision: section.revision },
        to: { kind: "step", id: stepId },
      });
    } else if (
      section.type === "integration" ||
      section.type === "implementation_note" ||
      section.type === "workflow_note"
    ) {
      const stepId = `s_instruct_${kid}`;
      steps.push({
        id: stepId,
        kind: "instruct",
        title: section.title,
        text: body,
        knowledge_refs: [kid],
        provenance: [{ kind: "section", id: section.id, revision: section.revision }],
      });
      mappings.push({
        from: { kind: "section", id: section.id, revision: section.revision },
        to: { kind: "step", id: stepId },
      });
    } else if (section.type === "question") {
      issues.push({
        severity: "warning",
        code: "unresolved_question",
        message: `Section ${section.title} is a question — may need an input slot or human_decision`,
        related: [section.id],
      });
    }
  }

  for (const s of source.steering) {
    const cid = `c_${s.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16)}`;
    const effect =
      s.verb === "affirm" ? "invariant" : s.verb === "reject" ? "forbidden" : "decision_rule";
    const statement = s.note?.trim() || `${s.verb} on ${s.target_kind} ${s.target_id}`;
    constraints.push({
      kind: "steering_constraint",
      id: cid,
      verb: s.verb,
      effect,
      statement,
      source_steering_id: s.id,
      targets: [s.target_id],
      provenance: [{ kind: "steering", id: s.id }],
    });
    mappings.push({
      from: { kind: "steering", id: s.id },
      to: { kind: "constraint", id: cid },
    });
  }

  if (steps.length === 0 && knowledge.length > 0) {
    steps.push({
      id: "s_apply_knowledge",
      kind: "instruct",
      title: "Apply captured knowledge",
      text:
        "Follow the pinned knowledge items and steering constraints exactly. Ask only for declared inputs. Resume from journey provenance when continuing prior work.",
      knowledge_refs: knowledge.map((k) => k.id),
    });
  }

  for (let i = 0; i < steps.length - 1; i++) {
    if (!steps[i]!.next) steps[i]!.next = steps[i + 1]!.id;
  }

  if (steps.length > 0) {
    const last = steps[steps.length - 1]!;
    const verifyId = "s_verify";
    const emitId = "s_emit";
    last.next = verifyId;
    steps.push({
      id: verifyId,
      kind: "verify",
      title: "Verify constraints",
      assertions: [
        "all_required_inputs_resolved",
        ...constraints
          .filter((c) => c.effect === "invariant")
          .map((c) => `constraint_present:${c.id}`),
      ],
      next: emitId,
    });
    steps.push({
      id: emitId,
      kind: "emit",
      title: "Emit result",
      output: "result",
      from: last.id,
    });
  }

  const pending: string[] = [];
  for (const slot of inferredInputs) {
    if (!slot.approved) pending.push(`input:${slot.name}`);
    mappings.push({
      from: slot.provenance?.[0] ?? { kind: "author", id: "compiler" },
      to: { kind: "input", id: slot.name },
    });
  }

  const needsCodeWrite = source.sections.some((i) => i.type === "code");
  const permissions = needsCodeWrite
    ? [
        {
          side_effect_class: "write" as const,
          description: "May modify project files when applying code knowledge",
          requires_consent: true,
        },
      ]
    : [];
  if (needsCodeWrite && !opts.approve_permissions) {
    pending.push("permission:write");
    issues.push({
      severity: "warning",
      code: "permission_approval",
      message: "Write permission inferred from code sections — requires human approval",
    });
  }

  // Explicit "no inputs" declaration when none inferred
  const hasInputsDeclared =
    inferredInputs.length > 0 || source.inputs_declared === "none";
  const safeJourney = {
    ...source.journey,
    summary: redactSecretsReported(source.journey.summary, issues, "journey summary"),
    open_questions: source.journey.open_questions?.map((q) =>
      redactSecretsReported(q, issues, "journey open question"),
    ),
    decisions: source.journey.decisions?.map((d) => redactSecretsReported(d, issues, "journey decision")),
    redacted: true,
  };

  const usage = opts.generation_usage ?? source.generation_usage;
  const completeness = assessCompleteness(source, {
    profile,
    hasWorkflowAction:
      sectionHasWorkflowAction(source.sections) || source.prompts.length > 0,
    hasKnowledge: knowledge.length > 0,
    hasInputsDeclared,
    pendingApprovals: pending,
  });
  if (!source.contract) {
    completeness.complete = false;
    if (!completeness.missing.includes("semantic_contract")) {
      completeness.missing.push("semantic_contract");
    }
    const code = source.contract_load_error ? "contract_unparsable" : "contract_missing";
    const message = source.contract_load_error
      ? `.skill/contract.json could not be used: ${source.contract_load_error}`
      : "No .skill contract was authored; compiling from legacy text sections only.";
    completeness.hints.push(
      source.contract_load_error
        ? message
        : "Add a 0.5 SkillContract. Legacy text was retained for continuity but structured semantics are unknown.",
    );
    issues.push({ severity: "warning", code, message });
  }

  if (!completeness.complete && profile === "continuity") {
    // continuity still requires hard parts
    const hard = completeness.missing.filter((m) =>
      ["agent_context", "sections", "intent", "journey", "knowledge_or_prompts"].includes(m),
    );
    if (hard.length && !opts.allow_incomplete) {
      throw new CompileRefusalError({ ...completeness, missing: hard, complete: false });
    }
  }

  if (inferredInputs.some((i) => !i.approved)) {
    issues.push({
      severity: "info",
      code: "pending_input_approval",
      message: "Inferred input slots require human approval before release mint",
    });
  }

  if (!steps.length) {
    // continuity with only questions etc.
    steps.push({
      id: "s_resume",
      kind: "instruct",
      title: "Resume continuity",
      text: source.journey.summary || "Continue from open questions in provenance.",
      knowledge_refs: knowledge.map((k) => k.id),
    });
    steps.push({
      id: "s_emit",
      kind: "emit",
      title: "Emit result",
      output: "result",
      from: "s_resume",
    });
    steps[0]!.next = "s_emit";
  }

  const entrypoint = steps[0]!.id;
  const report: CompilationReport = {
    kind: "compilation_report",
    skill_id: skillId,
    source_id: source.id,
    recipe_id: source.source_refs?.find((r) => r.kind === "recipe")?.id,
    profile,
    created_at: opts.created_at ?? source.created_at,
    mappings,
    inferred_inputs: inferredInputs,
    issues,
    pending_approvals: pending,
    approved: pending.length === 0,
    completeness,
    semantic_contract: "legacy_lossy",
    losses: [
      "intent/triggers may be inferred from title or summary",
      "inputs inferred from placeholders lose original schema semantics",
      "preconditions, branches, outputs, recovery, and verification may remain prose",
      "human review cannot be reconstructed from legacy text",
    ],
  };

  const files: SkillPackageFiles = {
    manifest: {
      kind: "dot-skill",
      id: skillId,
      version,
      title: opts.title ?? source.title,
      description:
        opts.description ??
        source.summary ??
        `Skill compiled from source ${source.id}`,
      intent: source.intent ?? source.summary,
      triggers: [{ id: "legacy_title", description: source.title }],
      authors: source.actor ? [source.actor] : undefined,
      container_version: CONTAINER_VERSION,
      protocol_version: PROTOCOL_VERSION,
      entrypoint,
      inputs: inferredInputs,
      outputs: [
        {
          name: "result",
          description: "Primary textual or structured result of the skill",
          schema: { type: "string" },
          required: true,
        },
      ],
      capabilities: needsCodeWrite
        ? [
            {
              name: "filesystem.write",
              description: "Write files in the workspace",
              side_effect_class: "write",
              fallback: "ask_human",
              required: false,
              adapters: [{ kind: "host", name: "workspace" }],
            },
          ]
        : [],
      permissions,
      policy: { ...DEFAULT_SKILL_POLICY },
      content: [],
      package_digest: "sha256:" + "0".repeat(64),
      provenance_mode: opts.provenance_mode ?? (profile === "continuity" ? "redacted" : "full"),
      compile_profile: profile,
      completeness,
      package_sensitivity: source.sensitivity,
      mint: { mint_status: "draft" },
      needs_human_review: pending.length > 0 || profile === "continuity",
      legacy: true,
    },
    workflow: {
      kind: "workflow",
      dialect_version: WORKFLOW_DIALECT_VERSION,
      entrypoint,
      steps,
      constraints,
    },
    knowledge,
    prompts: source.prompts.length
      ? Object.fromEntries(
          source.prompts.map((prompt) => [
            `${prompt.id}.txt`,
            redactSecretsReported(prompt.body, issues, `prompt "${prompt.id}"`, prompt.id),
          ]),
        )
      : undefined,
    provenance: {
      source:
        opts.provenance_mode === "proof_only"
          ? undefined
          : {
              id: source.id,
              hash: source.hash,
              title: source.title,
              agent: {
                ...source.agent,
                endpoint: source.agent.endpoint
                  ? redactSecrets(source.agent.endpoint)
                  : undefined,
              },
              sensitivity: source.sensitivity,
              section_ids: source.sections.map((s) => `${s.id}@${s.revision}`),
              source_refs: source.source_refs,
            },
      journey: safeJourney,
      generation_usage: usage,
      proof: {
        source_id: source.id,
        source_hash: source.hash,
        section_ids: source.sections.map((s) => `${s.id}@${s.revision}`),
        agent_host: source.agent.host,
      },
      compilation_report: report,
    },
  };

  const fileMap = buildFileMap(files);
  files.manifest = finalizeManifest(files.manifest, fileMap);
  const packageBytes = packSkill(files);

  return {
    files,
    report,
    packageBytes,
    pending_approvals: pending,
    completeness,
  };
}

/** Skillerr / legacy adapter entry — converts Recipe then compiles. */
export function compileRecipeToSkill(
  recipe: Recipe,
  opts: CompileOptions & { host?: string; model?: string } = {},
): CompileResult {
  const source = recipeToSkillSource(recipe, {
    agent: {
      host: opts.host ?? recipe.provenance.hosts[0],
      model: opts.model ?? recipe.provenance.models[0],
    },
  });
  if (opts.generation_usage) source.generation_usage = opts.generation_usage;
  return compileSkillSource(source, opts);
}

export function approveCompilation(
  result: CompileResult,
  approvals: { inputs?: string[]; permissions?: boolean },
): CompileResult {
  const files = structuredClone(result.files) as SkillPackageFiles;
  for (const slot of files.manifest.inputs) {
    if (
      !approvals.inputs ||
      approvals.inputs.includes(slot.name) ||
      approvals.inputs.includes("*")
    ) {
      slot.approved = true;
    }
  }
  const pending = files.manifest.inputs
    .filter((i) => !i.approved)
    .map((i) => `input:${i.name}`);
  if (files.manifest.permissions.some((p) => p.requires_consent) && !approvals.permissions) {
    pending.push(
      ...files.manifest.permissions
        .filter((p) => p.requires_consent)
        .map((p) => `permission:${p.side_effect_class}`),
    );
  }
  files.manifest.needs_human_review =
    pending.length > 0 || files.manifest.compile_profile === "continuity";
  if (files.provenance?.compilation_report) {
    files.provenance.compilation_report.pending_approvals = pending;
    files.provenance.compilation_report.approved = pending.length === 0;
    files.provenance.compilation_report.inferred_inputs = files.manifest.inputs;
    if (files.provenance.compilation_report.completeness) {
      const c = files.provenance.compilation_report.completeness;
      if (pending.length === 0) {
        c.missing = c.missing.filter((m) => m !== "human_approvals");
        if (!c.present.includes("human_approvals")) c.present.push("human_approvals");
        c.complete = c.missing.length === 0;
      }
      files.manifest.completeness = c;
    }
  }
  const fileMap = buildFileMap(files);
  files.manifest = finalizeManifest(files.manifest, fileMap);
  return {
    files,
    report: files.provenance!.compilation_report!,
    packageBytes: packSkill(files),
    pending_approvals: pending,
    completeness: files.manifest.completeness!,
  };
}
