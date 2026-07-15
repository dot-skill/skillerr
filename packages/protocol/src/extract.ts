/**
 * Multi-skill identification → scaffold extraction for agents.
 *
 * Segmentation is an agent/adapter responsibility. This module does not invent
 * skills from free prose: the caller must supply candidate topics. It emits
 * incomplete SkillContract / SkillSource scaffolds plus completeness reports
 * so create flows stay coherent with SkillContract 1.0 and refuse incomplete
 * release compiles.
 */

import { createHash } from "node:crypto";
import type { SkillCandidate, SkillKind } from "./contract.js";
import { assessSkillContract, scaffoldSkillContract } from "./authoring.js";
import type { PackageSensitivity, SkillCompileProfile } from "./types.js";
import { PROTOCOL_VERSION } from "./types.js";

export type JourneyCandidateInput = {
  id?: string;
  title: string;
  evidence_refs?: string[];
  intent?: string;
  skill_kind?: SkillKind;
  notes?: string;
};

/** Redacted journey JSON accepted by `skill extract` / `segment`. */
export type RedactedJourneyInput = {
  kind?: "redacted_journey";
  summary: string;
  redacted?: boolean;
  sensitivity?: PackageSensitivity;
  /** Preferred: explicit skill candidates the agent identified. */
  candidates?: JourneyCandidateInput[];
  /** Convenience alias when only titles (or title objects) are known. */
  topics?: Array<string | JourneyCandidateInput>;
};

export type ExtractionScaffold = {
  candidate: SkillCandidate;
  /** Incomplete contract scaffold; placeholders intentionally fail assessment. */
  contract_scaffold: Record<string, unknown>;
  /** Incomplete SkillSource scaffold for one skill (one workspace). */
  source_scaffold: Record<string, unknown>;
  /** Suggested workspace directory slug (relative). */
  workspace_slug: string;
  /** Machine-readable missing fields / fixes for this candidate. */
  missing: Array<{ field: string; message: string; fix: string }>;
  next_steps: string[];
};

export type ExtractionReport = {
  kind: "skill_extraction";
  protocol_version: typeof PROTOCOL_VERSION;
  profile: SkillCompileProfile;
  journey_summary: string;
  redacted: boolean;
  candidate_count: number;
  scaffolds: ExtractionScaffold[];
  protocol: {
    one_workspace_per_skill: true;
    refuse_release_if_incomplete: true;
    rules: string[];
    create_path: string[];
  };
};

export type AgentGuide = {
  kind: "skill_agent_guide";
  protocol_version: typeof PROTOCOL_VERSION;
  purpose: string;
  rules: string[];
  identify_multiple_skills: string[];
  create_one_skill: string[];
  ingest: string[];
  cli: string[];
  refuse: string[];
};

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "skill-candidate";
}

function candidateId(title: string, index: number): string {
  const digest = createHash("sha256")
    .update(`${index}:${title}`)
    .digest("hex")
    .slice(0, 12);
  return `cand_${digest}`;
}

function normalizeCandidates(input: RedactedJourneyInput): JourneyCandidateInput[] {
  const fromCandidates = input.candidates ?? [];
  const fromTopics = (input.topics ?? []).map((topic) =>
    typeof topic === "string" ? { title: topic } : topic,
  );
  const merged = [...fromCandidates, ...fromTopics];
  const seen = new Set<string>();
  const out: JourneyCandidateInput[] = [];
  for (const item of merged) {
    const title = typeof item.title === "string" ? item.title.trim() : "";
    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...item, title });
  }
  return out;
}

function parseJourney(raw: unknown): RedactedJourneyInput {
  if (!raw || typeof raw !== "object") {
    throw new Error(
      'extract expects JSON object { summary, candidates|topics: [...] }. Run: skill agent-guide',
    );
  }
  const obj = raw as Record<string, unknown>;
  const summary =
    typeof obj.summary === "string"
      ? obj.summary
      : typeof obj.journey_summary === "string"
        ? obj.journey_summary
        : "";
  if (!summary.trim()) {
    throw new Error(
      "extract requires a redacted journey summary string (summary or journey_summary).",
    );
  }
  return {
    kind: "redacted_journey",
    summary: summary.trim(),
    redacted: obj.redacted !== false,
    sensitivity:
      obj.sensitivity === "private" ||
      obj.sensitivity === "shareable_redacted" ||
      obj.sensitivity === "public"
        ? obj.sensitivity
        : "shareable_redacted",
    candidates: Array.isArray(obj.candidates)
      ? (obj.candidates as JourneyCandidateInput[])
      : undefined,
    topics: Array.isArray(obj.topics)
      ? (obj.topics as Array<string | JourneyCandidateInput>)
      : undefined,
  };
}

function seedContract(
  title: string,
  intent: string | undefined,
  skillKind: SkillKind | undefined,
  sensitivity: PackageSensitivity,
): Record<string, unknown> {
  const scaffold = scaffoldSkillContract();
  scaffold.title = title;
  scaffold.intent =
    intent?.trim() ||
    `__required__: state the transferable intent for “${title}” (what an agent must do).`;
  if (skillKind) scaffold.skill_kind = skillKind;
  scaffold.sensitivity = sensitivity;
  return scaffold;
}

function sourceScaffold(args: {
  id: string;
  title: string;
  summary: string;
  contract: Record<string, unknown>;
  evidenceRefs: string[];
  sensitivity: PackageSensitivity;
  host: string;
}): Record<string, unknown> {
  return {
    kind: "skill_source",
    id: args.id,
    hash: `sha256:${"0".repeat(64)}`,
    title: args.title,
    summary: args.summary,
    intent: args.contract.intent,
    contract: args.contract,
    candidates: undefined,
    sections: [],
    steering: [],
    prompts: [],
    code_refs: [],
    parents: [],
    agent: {
      host: args.host,
      deployment: "unknown",
    },
    journey: {
      summary: args.summary,
      redacted: true,
      sensitivity: args.sensitivity,
    },
    inputs_declared: "inferred",
    sensitivity: args.sensitivity,
    created_at: new Date(0).toISOString(),
    actor: { id: "agent" },
    source_protocol_version: PROTOCOL_VERSION,
    source_refs: args.evidenceRefs.map((ref, i) => ({
      product: "extract",
      kind: "evidence",
      id: `ev_${i + 1}`,
      hash: ref,
    })),
  };
}

const PROTOCOL_RULES = [
  "Identify distinct transferable skills from the redacted journey; do not collapse unrelated topics into one skill.",
  "One skill workspace per candidate (skill init in its own directory).",
  "Fill a SkillContract 1.0 for each skill; section prose alone cannot satisfy release completeness.",
  "Run skill status / skill contract-check; refuse release compile when incomplete.",
  "Never invent filler declarations to force a mint; use continuity checkpoint for partial handoff.",
  "Secrets stay as {{refs}} / env refs; journey text must stay redacted.",
];

const CREATE_PATH = [
  "skill agent-guide",
  "Identify N candidate skills → write redacted_journey.json with summary + candidates|topics",
  "skill extract redacted_journey.json -o ./extraction",
  "For each selected candidate: mkdir workspace && cd workspace && skill init --title \"…\"",
  "Copy/adapt contract scaffold → complete every declaration (or explicit none/not_applicable)",
  "skill journey --summary \"…\" && skill propose … (evidence sections)",
  "skill contract-check .skill/… or contract.json --profile release",
  "skill status → skill compile -m \"…\" --approve --mint  (or checkpoint if incomplete)",
];

/**
 * Emit incomplete SkillContract/SkillSource scaffolds for agent-identified candidates.
 * Does not invent topics from free prose when candidates/topics are absent.
 */
export function extractSkillCandidates(
  raw: unknown,
  options: {
    profile?: SkillCompileProfile;
    host?: string;
  } = {},
): ExtractionReport {
  const journey = parseJourney(raw);
  const profile = options.profile ?? "release";
  const host = options.host ?? "__set_SKILL_HOST__";
  const candidates = normalizeCandidates(journey);

  if (candidates.length === 0) {
    throw new Error(
      "No skill candidates supplied. Identify distinct skills from the journey, then pass candidates:[{title,evidence_refs?}] or topics:[\"…\"]. See: skill agent-guide",
    );
  }

  const scaffolds: ExtractionScaffold[] = candidates.map((item, index) => {
    const id = item.id?.trim() || candidateId(item.title, index);
    const evidence =
      item.evidence_refs?.filter((r) => typeof r === "string" && r.trim()) ??
      [];
    if (evidence.length === 0) {
      evidence.push(`journey:${slugify(item.title)}`);
    }
    const contract = seedContract(
      item.title,
      item.intent,
      item.skill_kind,
      journey.sensitivity ?? "shareable_redacted",
    );
    const assessment = assessSkillContract(contract, profile);
    const candidate: SkillCandidate = {
      id,
      title: item.title,
      evidence_refs: evidence,
      assessment,
      // Incomplete scaffold is intentional; do not claim a complete contract.
      contract: undefined,
    };
    const workspace_slug = slugify(item.title);
    const missing = assessment.issues.map(({ field, message, fix }) => ({
      field,
      message,
      fix,
    }));
    const source = sourceScaffold({
      id: `src_${id.replace(/^cand_/, "")}`,
      title: item.title,
      summary: journey.summary,
      contract,
      evidenceRefs: evidence,
      sensitivity: journey.sensitivity ?? "shareable_redacted",
      host,
    });
    return {
      candidate,
      contract_scaffold: contract,
      source_scaffold: source,
      workspace_slug,
      missing,
      next_steps: [
        `mkdir -p ${workspace_slug} && cd ${workspace_slug} && export SKILL_HOST=${host === "__set_SKILL_HOST__" ? "cursor" : host} && skill init --title ${JSON.stringify(item.title)}`,
        "Complete contract_scaffold into a real SkillContract 1.0 (every declaration explicit).",
        `skill contract-check contract.json --profile ${profile}`,
        'skill journey --summary "…" && skill propose --json \'[…]\'',
        "skill status — refuse release compile until complete; use skill checkpoint for handoff.",
      ],
    };
  });

  return {
    kind: "skill_extraction",
    protocol_version: PROTOCOL_VERSION,
    profile,
    journey_summary: journey.summary,
    redacted: journey.redacted !== false,
    candidate_count: scaffolds.length,
    scaffolds,
    protocol: {
      one_workspace_per_skill: true,
      refuse_release_if_incomplete: true,
      rules: PROTOCOL_RULES,
      create_path: CREATE_PATH,
    },
  };
}

/** Alias for adapters that prefer "segment" vocabulary. */
export const segmentJourney = extractSkillCandidates;

/** Structured agent-facing create / multi-skill protocol (also printed by CLI). */
export function agentCreateGuide(): AgentGuide {
  return {
    kind: "skill_agent_guide",
    protocol_version: PROTOCOL_VERSION,
    purpose:
      "Create portable .skill packages with SkillContract 1.0. Identify multiple skills from a conversation when warranted; enforce completeness; never fake a release.",
    rules: PROTOCOL_RULES,
    identify_multiple_skills: [
      "Read the redacted journey / work summary. List distinct transferable skills (separate intents, triggers, or runtimes).",
      "Do not invent a multi-skill auto-pipeline beyond this protocol. You identify; the CLI scaffolds.",
      "Write JSON: { \"kind\":\"redacted_journey\", \"summary\":\"…\", \"redacted\":true, \"candidates\":[{ \"title\":\"…\", \"evidence_refs\":[\"…\"], \"intent\":\"…\", \"skill_kind\":\"procedure|knowledge|integration\" }] }",
      "Run: skill extract journey.json -o ./extraction",
      "Present candidates + missing[] reports to the human. Only proceed on selected skills.",
      "One directory / one skill init per selected candidate. Never merge unrelated candidates into one workspace.",
    ],
    create_one_skill: [
      "export SKILL_HOST=<your-host-id>",
      "skill init --title \"…\"",
      "skill journey --summary \"Redacted human+AI journey…\"",
      "Complete SkillContract 1.0 (skill contract-template → edit → skill contract-check).",
      "skill propose --json '[{\"title\":\"…\",\"body\":\"…\",\"type\":\"decision|integration|…\"}]' for evidence sections",
      "skill status — inspect completeness / missing",
      "Partial handoff: skill checkpoint -m \"WIP\"",
      "Release only when complete: skill compile -m \"…\" --approve --mint",
      "On compile_refused: list missing fields/fixes; do not pack a fake release.",
    ],
    ingest: [
      "skill inspect ./file.skill",
      "skill validate ./file.skill",
      "skill verify-trust ./file.skill",
      "skill load ./file.skill   # continuity resume",
      "skill run ./file.skill   # dry-run by default",
    ],
    cli: [
      "skill agent-guide [--json]",
      "skill extract <journey.json> [-o dir] [--profile release|continuity]",
      "skill segment …          # alias of extract",
      "skill contract-template",
      "skill contract-check <contract-or-source.json> [--profile release|continuity]",
      "skill status",
    ],
    refuse: [
      "Refuse release compile/mint when contract assessment is incomplete.",
      "Refuse to invent filler skills or filler contract fields to satisfy gates.",
      "Refuse to create multiple skills in one workspace.",
      "Refuse to proceed without SKILL_HOST on create/mint paths.",
    ],
  };
}

/** Human-readable text form of agentCreateGuide (for terminals / AGENT.md parity). */
export function formatAgentGuide(guide: AgentGuide = agentCreateGuide()): string {
  const lines = [
    `skill agent-guide — Open .skill Protocol v${guide.protocol_version}`,
    "",
    guide.purpose,
    "",
    "Rules:",
    ...guide.rules.map((r) => `  - ${r}`),
    "",
    "Identify → propose multiple skills:",
    ...guide.identify_multiple_skills.map((r, i) => `  ${i + 1}. ${r}`),
    "",
    "Create one skill (complete or refuse):",
    ...guide.create_one_skill.map((r) => `  $ ${r}`),
    "",
    "Ingest / load / run:",
    ...guide.ingest.map((r) => `  $ ${r}`),
    "",
    "CLI:",
    ...guide.cli.map((r) => `  $ ${r}`),
    "",
    "Refuse when:",
    ...guide.refuse.map((r) => `  - ${r}`),
    "",
  ];
  return lines.join("\n");
}

/** Type guard helper for partial SkillContract assessments on scaffolds. */
export function assessExtractionScaffold(
  scaffold: ExtractionScaffold,
  profile: SkillCompileProfile = "release",
): SkillCandidate["assessment"] {
  return assessSkillContract(scaffold.contract_scaffold, profile);
}
