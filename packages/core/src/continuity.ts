/**
 * Continuity surface: open, recognize, and preview-resume a continuity
 * .skill package, matching spec/CONTRACT.md's Section 3 continuity
 * contract (openContinuity/isContinuity/resumePreview + Resume Contract
 * 1.0 — see docs/rfcs/0009-resume-contract.md).
 *
 * Built directly on real continuity-profile data — `unpackSkill`'s
 * `manifest.compile_profile`, `provenance.journey` (a real, typed
 * `JourneyProvenance`, not `unknown`), and `knowledge` — not on any
 * invented file convention. A continuity package never carries an
 * attestation and is never mint-eligible (mint requires
 * `compile_profile === "release"`, see mint.ts), so `isContinuity` is a
 * simple, sufficient, mutually-exclusive-with-minted check.
 *
 * Independence: no registry knowledge anywhere in this file. In
 * particular, `resumePreview`'s resume targets deliberately use this
 * repo's own `skill load <path>` (already real, already host-agnostic —
 * see docs/CLI-FLOW.md) rather than any product-specific install command;
 * a registry can layer its own download URL into `<path>` without this
 * package needing to know that URL scheme exists.
 */
import type { AgentContext, JourneyProvenance, KnowledgeItem, SkillManifest } from "@skillerr/protocol";
import { unpackSkill } from "./pack.js";

export interface Gap {
  id: string;
  kind: "open_question" | "decision";
  detail: string;
  severity: "info" | "warn" | "block";
}

export interface ContinuitySection {
  id: string;
  title: string;
  body: string;
}

export interface ContinuityJourney {
  summary: string;
  open_questions: string[];
  decisions: string[];
}

/**
 * Subset of the real `AgentContext` (protocol/src/source.ts) relevant to a
 * resume preview. `host` is required on the real (authoring-time)
 * `AgentContext`, but optional here: a `proof_only`-provenance continuity
 * package genuinely has no recoverable agent context post-pack, and that's
 * a real state to represent honestly, not paper over with a fallback value.
 */
export type AgentContextSummary = Partial<Pick<AgentContext, "host" | "provider" | "model" | "deployment">>;

export interface ContinuityOpenResult {
  manifest: SkillManifest;
  /** `sha256:...`, `manifest.package_digest` by construction. */
  digest: string;
  profile: "continuity";
  agentContext: AgentContextSummary;
  intent?: string;
  journey: ContinuityJourney;
  gaps: Gap[];
  knowledge: KnowledgeItem[];
  sections: ContinuitySection[];
}

export interface ResumeTarget {
  agent: "cursor" | "claude" | "codex";
  label: string;
  /** `<path>` is a placeholder — the caller substitutes its own file path or download location. */
  command: string;
}

export interface ResumeContract {
  version: "1.0";
  digest: string;
  intent?: string;
  agentContext: AgentContextSummary;
  gaps: Gap[];
  knowledge: KnowledgeItem[];
  resumeTargets: ResumeTarget[];
}

/**
 * `pkg` accepts anything carrying a manifest (an already-unpacked result,
 * or a bare manifest) so this can gate either before or after a full
 * `openContinuity` call. Sufficient on its own: mint requires
 * `compile_profile === "release"` (mint.ts), so `"continuity"` and
 * "minted" are already mutually exclusive — no separate mint-status check
 * needed.
 */
export function isContinuity(pkg: { manifest: SkillManifest } | SkillManifest): boolean {
  const manifest = "manifest" in pkg ? pkg.manifest : pkg;
  return manifest.compile_profile === "continuity";
}

function journeyFrom(journey: JourneyProvenance | undefined): ContinuityJourney {
  return {
    summary: journey?.summary ?? "",
    open_questions: journey?.open_questions ?? [],
    decisions: journey?.decisions ?? [],
  };
}

function gapsFrom(journey: ContinuityJourney): Gap[] {
  return [
    ...journey.open_questions.map(
      (detail, i): Gap => ({ id: `open_question_${i + 1}`, kind: "open_question", detail, severity: "warn" }),
    ),
    ...journey.decisions.map(
      (detail, i): Gap => ({ id: `decision_${i + 1}`, kind: "decision", detail, severity: "info" }),
    ),
  ];
}

/**
 * Opens a sealed continuity package. Refuses (throws) anything that isn't
 * `compile_profile === "continuity"` — a release/catalog package is never
 * silently accepted here. Redaction already happened at compile time
 * (docs/SCRUBBING.md); this never de-redacts, it only reshapes already-
 * sealed content into the continuity contract's shape.
 */
export async function openContinuity(zip: Buffer | Uint8Array): Promise<ContinuityOpenResult> {
  const bytes = zip instanceof Uint8Array ? zip : new Uint8Array(zip);
  const unpacked = unpackSkill(bytes);
  if (!isContinuity(unpacked.manifest)) {
    throw new Error(
      `Not a continuity package: compile_profile is "${unpacked.manifest.compile_profile ?? "unset"}", expected "continuity". Release/catalog packages are refused, not silently accepted.`,
    );
  }
  const source = unpacked.raw.provenance?.source as { agent?: Partial<AgentContext> } | undefined;
  const journey = journeyFrom(unpacked.raw.provenance?.journey);
  const gaps = gapsFrom(journey);
  const sections: ContinuitySection[] = unpacked.knowledge.map((k) => ({ id: k.id, title: k.title, body: k.body }));

  return {
    manifest: unpacked.manifest,
    digest: unpacked.manifest.package_digest,
    profile: "continuity",
    agentContext: {
      host: source?.agent?.host,
      provider: source?.agent?.provider,
      model: source?.agent?.model,
      deployment: source?.agent?.deployment,
    },
    intent: unpacked.manifest.intent,
    journey,
    gaps,
    knowledge: unpacked.knowledge,
    sections,
  };
}

/**
 * Resume Contract 1.0 (docs/rfcs/0009-resume-contract.md): a stable,
 * host-agnostic shape describing what a receiving agent needs to resume a
 * continuity session — working context (agentContext, intent), unresolved
 * threads (gaps), and prior knowledge, plus a resume command per agent.
 * Pure and synchronous: everything it needs is already in `pkg` (the
 * result of `openContinuity`), no further I/O.
 */
export function resumePreview(pkg: ContinuityOpenResult): ResumeContract {
  const command = "skill load <path> --into .";
  return {
    version: "1.0",
    digest: pkg.digest,
    intent: pkg.intent,
    agentContext: pkg.agentContext,
    gaps: pkg.gaps,
    knowledge: pkg.knowledge,
    resumeTargets: [
      { agent: "cursor", label: "Cursor", command },
      { agent: "claude", label: "Claude Code", command },
      { agent: "codex", label: "Codex", command },
    ],
  };
}
