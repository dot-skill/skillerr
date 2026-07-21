/**
 * Continuity surface: capture, open, recognize, and render-resume a
 * continuity .skill package, matching spec/CONTRACT.md's Section 3
 * continuity contract (captureSession/openContinuity/isContinuity/
 * resumePreview/renderResumeContract + Resume Contract 1.0 — see
 * docs/rfcs/0009-resume-contract.md).
 *
 * The read side (openContinuity/resumePreview/renderResumeContract) is
 * built directly on real continuity-profile data — `unpackSkill`'s
 * `manifest.compile_profile`, `provenance.journey` (a real, typed
 * `JourneyProvenance`), `provenance.source` (a `ContinuitySource` the
 * capture side writes), and `knowledge` — not on any invented file
 * convention. A continuity package never carries an attestation and is
 * never mint-eligible (mint requires `compile_profile === "release"`, see
 * mint.ts), so `isContinuity` is a simple, sufficient,
 * mutually-exclusive-with-minted check.
 *
 * The capture side lives in `capture.ts` (`captureSession`) — kept in a
 * separate file because it reaches for git/the filesystem, which the read
 * side never does. Both agree on the `ContinuitySource` shape defined here.
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

/** One changed path in the working set, with its status and change size. */
export interface WorkingSetFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
  /** Lines added, when countable (binary/untracked files may omit). */
  additions?: number;
  /** Lines deleted, when countable. */
  deletions?: number;
  /** Short human summary, e.g. "+12 -3". */
  summary?: string;
  /** Original path when `status === "renamed"`. */
  renamedFrom?: string;
}

/** One recent commit reachable from HEAD (subject is redacted at capture). */
export interface WorkingSetCommit {
  sha: string;
  subject: string;
}

/**
 * The state of the work itself at capture time: the git branch, the
 * base/HEAD it sits on, the changed files, a (redacted) unified diff, the
 * recent commit trail, and notable untracked files. This is the field that
 * makes a resume actionable — without it a briefing is just an intent line.
 */
export interface WorkingSet {
  branch?: string;
  /** Base commit the branch diverged from (merge-base), when derivable. */
  baseSha?: string;
  headSha?: string;
  /** True when there are staged/unstaged changes or untracked files. */
  dirty: boolean;
  files: WorkingSetFile[];
  /** Redacted unified diff (staged + unstaged). Secrets scrubbed, code kept. */
  diff?: string;
  /** True when `diff` was cut off at the size cap (see captureSession). */
  diffTruncated?: boolean;
  commits: WorkingSetCommit[];
  untracked: string[];
}

/** A single plan/todo entry carried into the resume. */
export interface PlanItem {
  status: "todo" | "in_progress" | "done";
  text: string;
}

/** A pointer to a key file the receiving agent should open (path, not a dump). */
export interface FilePointer {
  path: string;
  note?: string;
}

/** A key tool-call result an agent chose to preserve (redacted summary only). */
export interface ToolResult {
  tool: string;
  summary: string;
}

/**
 * The continuity-profile shape written into `provenance.source` by
 * `captureSession` and read back by `openContinuity`. `provenance.source`
 * is typed `unknown` at the protocol level ("scrubbed SkillSource or
 * product source"); this is the concrete shape the continuity lane uses,
 * kept fully additive — it introduces no new `.skill` container entry or
 * `SkillManifest` field, just a documented structure inside the existing
 * `provenance/source.json`. Every string field is already redacted by the
 * time it lands here.
 */
export interface ContinuitySource {
  kind: "continuity_source";
  agent?: AgentContextSummary;
  workingSet?: WorkingSet;
  plan?: PlanItem[];
  nextSteps?: string[];
  /** Paths tried and abandoned — saves the next agent from repeating them. */
  rejectedPaths?: string[];
  filePointers?: FilePointer[];
  toolResults?: ToolResult[];
}

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
  /** Work state (git) recovered from `provenance.source`, when captured. */
  workingSet?: WorkingSet;
  plan?: PlanItem[];
  nextSteps?: string[];
  rejectedPaths?: string[];
  filePointers?: FilePointer[];
  toolResults?: ToolResult[];
}

export interface ResumeTarget {
  /**
   * Legacy short ids from Resume Contract 1.0. SessionSource scanners use
   * canonical `claude-code` (see `normalizeSessionSourceId` /
   * `resumeAgentFromSessionSource`). `claude` here means Claude Code —
   * kept for existing consumers; do not drop without a deprecation path.
   */
  agent: "cursor" | "claude" | "codex";
  label: string;
  /** `<path>` is a placeholder — the caller substitutes its own file path or download location. */
  command: string;
}

/**
 * Resume Contract 1.0 (docs/rfcs/0009-resume-contract.md): the stable,
 * host-agnostic set a receiving agent must reconstruct to pick up a
 * session — working set, plan/todo, decisions + rejected paths, open
 * threads, knowledge, intent, agent context — plus a resume command per
 * agent. `renderResumeContract` turns this into a paste-ready briefing.
 */
export interface ResumeContract {
  version: "1.0";
  digest: string;
  intent?: string;
  agentContext: AgentContextSummary;
  workingSet?: WorkingSet;
  plan?: PlanItem[];
  nextSteps: string[];
  /** Resolved decisions carried forward (from the redacted journey). */
  decisions: string[];
  /** Approaches tried and abandoned. */
  rejectedPaths: string[];
  /** Unresolved questions the next agent should pick up. */
  openThreads: string[];
  /** Kept for back-compat: open_questions (warn) + decisions (info), tagged. */
  gaps: Gap[];
  knowledge: KnowledgeItem[];
  filePointers: FilePointer[];
  toolResults: ToolResult[];
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
 * silently accepted here. Redaction already happened at capture/compile
 * time (docs/SCRUBBING.md); this never de-redacts, it only reshapes
 * already-sealed content into the continuity contract's shape.
 */
export async function openContinuity(zip: Buffer | Uint8Array): Promise<ContinuityOpenResult> {
  const bytes = zip instanceof Uint8Array ? zip : new Uint8Array(zip);
  const unpacked = unpackSkill(bytes);
  if (!isContinuity(unpacked.manifest)) {
    throw new Error(
      `Not a continuity package: compile_profile is "${unpacked.manifest.compile_profile ?? "unset"}", expected "continuity". Release/catalog packages are refused, not silently accepted.`,
    );
  }
  const source = unpacked.raw.provenance?.source as Partial<ContinuitySource> | undefined;
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
    workingSet: source?.workingSet,
    plan: source?.plan,
    nextSteps: source?.nextSteps,
    rejectedPaths: source?.rejectedPaths,
    filePointers: source?.filePointers,
    toolResults: source?.toolResults,
  };
}

/**
 * Resume Contract 1.0: a stable, host-agnostic shape describing everything
 * a receiving agent needs to resume a continuity session. Pure and
 * synchronous: everything it needs is already in `pkg` (the result of
 * `openContinuity`), no further I/O.
 */
export function resumePreview(pkg: ContinuityOpenResult): ResumeContract {
  const command = "skill load <path> --into .";
  return {
    version: "1.0",
    digest: pkg.digest,
    intent: pkg.intent,
    agentContext: pkg.agentContext,
    workingSet: pkg.workingSet,
    plan: pkg.plan,
    nextSteps: pkg.nextSteps ?? [],
    decisions: pkg.journey.decisions,
    rejectedPaths: pkg.rejectedPaths ?? [],
    openThreads: pkg.journey.open_questions,
    gaps: pkg.gaps,
    knowledge: pkg.knowledge,
    filePointers: pkg.filePointers ?? [],
    toolResults: pkg.toolResults ?? [],
    resumeTargets: [
      { agent: "cursor", label: "Cursor", command },
      { agent: "claude", label: "Claude Code", command },
      { agent: "codex", label: "Codex", command },
    ],
  };
}

function renderWorkingSet(ws: WorkingSet): string[] {
  const lines: string[] = ["## Working set"];
  const head = ws.branch ? `branch \`${ws.branch}\`` : "detached HEAD";
  const range =
    ws.baseSha && ws.headSha
      ? ` (\`${ws.baseSha}\`..\`${ws.headSha}\`)`
      : ws.headSha
        ? ` (HEAD \`${ws.headSha}\`)`
        : "";
  lines.push(`- ${head}${range}${ws.dirty ? " — uncommitted changes present" : " — clean tree"}`);

  if (ws.files.length) {
    lines.push("", "### Changed files");
    for (const f of ws.files) {
      const size = f.summary ?? (f.additions != null || f.deletions != null ? `+${f.additions ?? 0} -${f.deletions ?? 0}` : "");
      const rename = f.renamedFrom ? ` (from ${f.renamedFrom})` : "";
      lines.push(`- \`${f.path}\` — ${f.status}${rename}${size ? ` ${size}` : ""}`);
    }
  }
  if (ws.untracked.length) {
    lines.push("", "### Untracked", ...ws.untracked.map((p) => `- \`${p}\``));
  }
  if (ws.commits.length) {
    lines.push("", "### Recent commits", ...ws.commits.map((c) => `- \`${c.sha}\` ${c.subject}`));
  }
  if (ws.diff) {
    lines.push("", "### Diff (redacted)", "", "```diff", ws.diff.replace(/\n+$/, ""), "```");
    if (ws.diffTruncated) lines.push("_(diff truncated at capture-time size cap)_");
  }
  return lines;
}

/**
 * Renders a Resume Contract 1.0 into a substantive, paste-ready markdown
 * briefing — working-set summary, changed-file list, plan/next steps,
 * decisions, rejected paths, open threads, knowledge, and the resume
 * commands. Deliberately emits no "preview"/"pending" language: when the
 * fields are populated it renders them, and when a section is genuinely
 * empty it is simply omitted rather than shown as a placeholder. A capture
 * with a real working set therefore never renders as a hollow header.
 */
export function renderResumeContract(contract: ResumeContract): string {
  const lines: string[] = ["# Resume briefing (Resume Contract 1.0)"];

  lines.push("", "## Intent", contract.intent?.trim() ? contract.intent.trim() : "_No intent recorded._");

  const ac = contract.agentContext;
  if (ac.host || ac.provider || ac.model || ac.deployment) {
    lines.push("", "## Agent context (self-reported)");
    if (ac.host) lines.push(`- host: ${ac.host}`);
    if (ac.provider) lines.push(`- provider: ${ac.provider}`);
    if (ac.model) lines.push(`- model: ${ac.model}`);
    if (ac.deployment) lines.push(`- deployment: ${ac.deployment}`);
  }

  lines.push("", "## Digest", `\`${contract.digest}\``);

  if (contract.workingSet) {
    lines.push("", ...renderWorkingSet(contract.workingSet));
  }

  if (contract.plan?.length) {
    const mark = { todo: "[ ]", in_progress: "[~]", done: "[x]" } as const;
    lines.push("", "## Plan", ...contract.plan.map((p) => `- ${mark[p.status]} ${p.text}`));
  }
  if (contract.nextSteps.length) {
    lines.push("", "## Next steps", ...contract.nextSteps.map((s) => `- ${s}`));
  }
  if (contract.decisions.length) {
    lines.push("", "## Decisions", ...contract.decisions.map((d) => `- ${d}`));
  }
  if (contract.rejectedPaths.length) {
    lines.push("", "## Tried and abandoned", ...contract.rejectedPaths.map((r) => `- ${r}`));
  }
  if (contract.openThreads.length) {
    lines.push("", "## Open threads", ...contract.openThreads.map((q) => `- ${q}`));
  }
  if (contract.filePointers.length) {
    lines.push(
      "",
      "## Key files",
      ...contract.filePointers.map((f) => `- \`${f.path}\`${f.note ? ` — ${f.note}` : ""}`),
    );
  }
  if (contract.toolResults.length) {
    lines.push("", "## Notable tool results", ...contract.toolResults.map((t) => `- **${t.tool}**: ${t.summary}`));
  }
  if (contract.knowledge.length) {
    lines.push("", "## Knowledge");
    for (const k of contract.knowledge) {
      lines.push(`- **${k.title}** — ${k.body}`);
    }
  }

  lines.push("", "## Resume");
  for (const t of contract.resumeTargets) {
    lines.push(`- ${t.label}: \`${t.command}\``);
  }

  lines.push(
    "",
    "Paste this briefing into your agent to continue. Continuity is not a release, not minted, not anchored.",
  );
  return lines.join("\n") + "\n";
}
