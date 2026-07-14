import type {
  ContractAssessment,
  ContractField,
  ContractIssue,
  ContractStep,
  ExplicitDeclaration,
  SkillContract,
} from "./contract.js";
import type { SkillCompileProfile } from "./types.js";
import { isValidHostPattern, isValidPathPattern } from "./grammar.js";

/**
 * Fields each step kind needs to compile into a real workflow step.
 * compileContractStep() falls back to "" for these when absent — a fallback
 * that must stay unreachable for any contract this function calls complete.
 * (transform/checkpoint/human_decision/verify have their own documented
 * defaults or fall back to the always-required `title`, so they're exempt.)
 */
const STEP_KIND_REQUIRED_FIELDS: Partial<Record<ContractStep["kind"], (keyof ContractStep)[]>> = {
  instruct: ["instruction"],
  prompt: ["instruction"],
  tool: ["capability"],
  emit: ["output", "from"],
};

const DECLARATIONS: ContractField[] = [
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
];

function declarationIssue(
  field: ContractField,
  value: unknown,
  profile: SkillCompileProfile,
): ContractIssue | undefined {
  if (!value || typeof value !== "object") {
    return {
      field,
      code: "missing",
      message: `${field} is absent; omission is not an explicit declaration`,
      fix: `Set ${field} to {status:"specified",items:[...]} or an allowed explicit {status:"none"|"not_applicable",reason:"..."}.`,
    };
  }
  const declaration = value as Partial<ExplicitDeclaration<unknown>>;
  if (declaration.status === "specified") {
    if (!Array.isArray(declaration.items) || declaration.items.length === 0) {
      return {
        field,
        code: "empty",
        message: `${field} is specified but has no items`,
        fix: `Add at least one structured ${field} item or explicitly declare none/not_applicable with a reason.`,
      };
    }
    return;
  }
  if (declaration.status !== "none" && declaration.status !== "not_applicable") {
    return {
      field,
      code: "invalid",
      message: `${field}.status is invalid`,
      fix: `Use specified, none, or not_applicable.`,
    };
  }
  if (!("reason" in declaration) || typeof declaration.reason !== "string" || !declaration.reason.trim()) {
    return {
      field,
      code: "invalid",
      message: `${field} ${declaration.status} declaration needs a reason`,
      fix: `Add a concrete reason explaining why ${field} is ${declaration.status}.`,
    };
  }
  if (
    profile === "release" &&
    (field === "triggers" || field === "steps" || field === "verification")
  ) {
    return {
      field,
      code: "profile_required",
      message: `${field} must be specified for release`,
      fix: `Provide at least one structured ${field} item. Release skills must be discoverable, actionable, and verifiable.`,
    };
  }
  return;
}

/** Assess a full or partial contract without compiling it. */
export function assessSkillContract(
  value: unknown,
  profile: SkillCompileProfile = "release",
): ContractAssessment {
  const issues: ContractIssue[] = [];
  const contract = (value ?? {}) as Partial<SkillContract>;
  const addMissingText = (field: "title" | "intent", value: unknown) => {
    if (typeof value !== "string" || !value.trim()) {
      issues.push({
        field,
        code: "missing",
        message: `${field} is required`,
        fix: `Set ${field} to a precise, non-empty string.`,
      });
    }
  };

  if (contract.kind !== "skill_contract" || contract.contract_version !== "1.0") {
    issues.push({
      field: "contract",
      code: "invalid",
      message: "Expected kind=skill_contract and contract_version=1.0",
      fix: "Start from scaffoldSkillContract() and preserve its kind/version fields.",
    });
  }
  addMissingText("title", contract.title);
  addMissingText("intent", contract.intent);
  if (!["knowledge", "procedure", "integration"].includes(contract.skill_kind ?? "")) {
    issues.push({
      field: "skill_kind",
      code: "missing",
      message: "skill_kind must classify the contract",
      fix: "Choose knowledge, procedure, or integration.",
    });
  }
  if (!["private", "shareable_redacted", "public"].includes(contract.sensitivity ?? "")) {
    issues.push({
      field: "sensitivity",
      code: "missing",
      message: "sensitivity is required",
      fix: "Choose private, shareable_redacted, or public.",
    });
  }

  for (const field of DECLARATIONS) {
    const issue = declarationIssue(field, contract[field as keyof SkillContract], profile);
    if (issue) issues.push(issue);
  }

  const validateItems = (
    field: ContractField,
    declaration: unknown,
    requiredKeys: string[],
  ) => {
    const d = declaration as { status?: string; items?: unknown[] } | undefined;
    if (d?.status !== "specified" || !Array.isArray(d.items)) return;
    d.items.forEach((item, index) => {
      if (!item || typeof item !== "object") return;
      const missing = requiredKeys.filter((key) => !(key in item));
      if (missing.length) {
        issues.push({
          field,
          code: "invalid",
          message: `${field}.items[${index}] lacks ${missing.join(", ")}`,
          fix: `Add ${missing.join(", ")} to ${field}.items[${index}].`,
        });
      }
    });
  };
  validateItems("triggers", contract.triggers, ["id", "description"]);
  validateItems("inputs", contract.inputs, [
    "name",
    "description",
    "schema",
    "required",
    "sensitivity",
    "source",
    "ask_when",
    "approval",
  ]);
  validateItems("preconditions", contract.preconditions, ["id", "assertion", "check", "on_failure"]);
  validateItems("steps", contract.steps, ["id", "title", "kind"]);
  {
    const stepsDeclaration = contract.steps as
      | { status?: string; items?: ContractStep[] }
      | undefined;
    if (stepsDeclaration?.status === "specified" && Array.isArray(stepsDeclaration.items)) {
      stepsDeclaration.items.forEach((item, index) => {
        if (!item || typeof item !== "object") return;
        const required = STEP_KIND_REQUIRED_FIELDS[item.kind] ?? [];
        const missing = required.filter((key) => {
          const value = item[key];
          return typeof value !== "string" || !value.trim();
        });
        if (missing.length) {
          issues.push({
            field: "steps",
            code: "invalid",
            message: `steps.items[${index}] (kind=${item.kind}) lacks ${missing.join(", ")}`,
            fix: `Add ${missing.join(", ")} to steps.items[${index}] — a ${item.kind} step cannot compile without it.`,
          });
        }
      });
    }
  }
  validateItems("branches", contract.branches, ["id", "condition", "then"]);
  validateItems("human_decisions", contract.human_decisions, [
    "id",
    "prompt",
    "required_before",
    "irreversible",
    "approval",
  ]);
  validateItems("capabilities", contract.capabilities, [
    "name",
    "description",
    "side_effect_class",
    "fallback",
    "required",
  ]);
  validateItems("permissions", contract.permissions, [
    "id",
    "side_effect_class",
    "description",
    "consent",
  ]);
  // PROTO-5: hosts/paths are matched ad hoc by the runtime unless they're
  // validated against a real grammar here first — this is what makes
  // SEC-A/SEC-B's runtime fixes trustworthy rather than the only line of
  // defense. A malformed pattern (a full URL, an embedded wildcard, a
  // relative or ".."-containing path) is rejected at authoring time.
  {
    const permissionsDeclaration = contract.permissions as
      | { status?: string; items?: import("./contract.js").ContractPermission[] }
      | undefined;
    if (
      permissionsDeclaration?.status === "specified" &&
      Array.isArray(permissionsDeclaration.items)
    ) {
      permissionsDeclaration.items.forEach((item, index) => {
        if (!item || typeof item !== "object") return;
        for (const host of item.hosts ?? []) {
          if (!isValidHostPattern(host)) {
            issues.push({
              field: "permissions",
              code: "invalid",
              message: `permissions.items[${index}].hosts contains an invalid host pattern: ${JSON.stringify(host)}`,
              fix: 'Use an exact hostname ("example.com") or a "*.example.com" suffix wildcard — never a URL, port, or embedded wildcard.',
            });
          }
        }
        for (const path of item.paths ?? []) {
          if (!isValidPathPattern(path)) {
            issues.push({
              field: "permissions",
              code: "invalid",
              message: `permissions.items[${index}].paths contains an invalid path pattern: ${JSON.stringify(path)}`,
              fix: 'Use an absolute, normalized path ("/data") — no "..", no backslashes, no relative segments.',
            });
          }
        }
      });
    }
  }
  validateItems("forbidden_actions", contract.forbidden_actions, [
    "id",
    "description",
    "enforcement",
  ]);
  validateItems("outputs", contract.outputs, [
    "name",
    "description",
    "schema",
    "required",
  ]);
  validateItems("recovery", contract.recovery, ["id", "from_step", "condition", "action"]);
  validateItems("verification", contract.verification, [
    "id",
    "assertion",
    "check",
    "required",
  ]);
  validateItems("corrections", contract.corrections, ["id", "lesson"]);

  const provenance = contract.provenance;
  for (const [field, value] of [
    ["provenance.evidence", provenance?.evidence],
    ["provenance.limitations", provenance?.limitations],
  ] as const) {
    const issue = declarationIssue(field, value, profile);
    if (issue) issues.push(issue);
  }
  if (!provenance?.human_review) {
    issues.push({
      field: "provenance.human_review",
      code: "missing",
      message: "human review state is absent",
      fix: 'Declare {status:"not_reviewed"} or provide reviewed actor, time, scope, and optional digest.',
    });
  } else if (profile === "release" && provenance.human_review.status !== "reviewed") {
    issues.push({
      field: "provenance.human_review",
      code: "profile_required",
      message: "release requires recorded human semantic review",
      fix: "Have a human review the contract and record actor, timestamp, scope, and preferably the reviewed digest. A CLI flag cannot create this evidence.",
    });
  } else if (
    provenance.human_review.status === "reviewed" &&
    (!provenance.human_review.actor?.trim() ||
      !provenance.human_review.at?.trim() ||
      !provenance.human_review.scope?.length)
  ) {
    issues.push({
      field: "provenance.human_review",
      code: "approval_invalid",
      message: "reviewed status lacks actor, timestamp, or scope evidence",
      fix: "Record the real reviewer actor, review timestamp, and non-empty semantic scope.",
    });
  }

  const complete = issues.length === 0;
  return {
    kind: "contract_assessment",
    profile,
    complete,
    release_eligible: profile === "release" && complete,
    issues,
  };
}

/** Machine-readable authoring template. Placeholder values intentionally fail assessment. */
export function scaffoldSkillContract(): Record<string, unknown> {
  const declaration = { status: "__required__: specified|none|not_applicable", items: [] };
  return {
    kind: "skill_contract",
    contract_version: "1.0",
    skill_kind: "__required__: knowledge|procedure|integration",
    title: "",
    intent: "",
    sensitivity: "__required__: private|shareable_redacted|public",
    triggers: structuredClone(declaration),
    inputs: structuredClone(declaration),
    preconditions: structuredClone(declaration),
    steps: structuredClone(declaration),
    branches: structuredClone(declaration),
    human_decisions: structuredClone(declaration),
    capabilities: structuredClone(declaration),
    permissions: structuredClone(declaration),
    forbidden_actions: structuredClone(declaration),
    outputs: structuredClone(declaration),
    recovery: structuredClone(declaration),
    verification: structuredClone(declaration),
    corrections: structuredClone(declaration),
    provenance: {
      evidence: structuredClone(declaration),
      limitations: structuredClone(declaration),
      human_review: { status: "__required__: not_reviewed|reviewed" },
    },
  };
}

export function explainContractAssessment(assessment: ContractAssessment): {
  complete: boolean;
  fixes: Array<{ field: ContractField; message: string; fix: string }>;
} {
  return {
    complete: assessment.complete,
    fixes: assessment.issues.map(({ field, message, fix }) => ({ field, message, fix })),
  };
}
