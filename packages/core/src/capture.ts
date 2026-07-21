/**
 * Session capture: the WRITE side of the continuity surface (the read side
 * is continuity.ts). `captureSession` reads git + the working tree of a
 * directory and builds a substantive, redacted continuity payload — the
 * working set (branch, base/HEAD, changed files, redacted diff, recent
 * commits, untracked files) plus a baseline journey — then merges any
 * agent-supplied context over it and assembles a sealable continuity
 * `SkillPackageFiles`.
 *
 * The whole point (see docs/rfcs/0009-resume-contract.md): a capture in a
 * dirty git repo must NEVER come back empty. Environment capture alone
 * (zero agent cooperation) produces the diff + file list + branch +
 * commits; an agent that runs capture enriches it with intent, plan,
 * decisions, rejected paths, open threads, knowledge, and tool results.
 *
 * Kept in its own file because it reaches for git and the filesystem,
 * which the read side (continuity.ts) never does — that separation is
 * deliberate so `openContinuity`/`resumePreview`/`renderResumeContract`
 * stay pure and testable without a git repo.
 *
 * Redaction (docs/SCRUBBING.md) scrubs secrets out of the diff, commit
 * subjects, and every agent-supplied string, but never removes the diff,
 * the file list, or the journey itself — over-redaction that ate the
 * substance was the exact prod bug this feature fixes.
 *
 * No registry knowledge anywhere here (spec/CONTRACT.md's independence
 * invariant): this reads a local working tree and writes a local package;
 * it has no idea skillerr.com exists.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  KnowledgeItem,
  KnowledgeItemType,
  RedactionReport,
  SkillPackageFiles,
  PackageSensitivity,
} from "@skillerr/protocol";
import { DEFAULT_SKILL_POLICY } from "@skillerr/protocol";
import { scrub, mergeRedactionReports } from "./scrub.js";
import { sha256Hex } from "./hash.js";
import type {
  AgentContextSummary,
  ContinuityJourney,
  ContinuitySource,
  FilePointer,
  PlanItem,
  ToolResult,
  WorkingSet,
  WorkingSetCommit,
  WorkingSetFile,
} from "./continuity.js";
import type { SessionCandidate, SessionSourceId } from "./session-source.js";
import {
  loadSessionContext,
  mergeCaptureContexts,
  resolveSession,
} from "./session-source.js";

const DEFAULT_MAX_DIFF_BYTES = 200_000;
const DEFAULT_MAX_COMMITS = 20;

/**
 * Agent-supplied capture context (the richer of the two intake paths).
 * Every field is optional: an agent supplies what it knows. Merged OVER
 * the environment capture — agent values win for scalars, and array
 * fields (plan, nextSteps, knowledge, …) are agent-only since the git
 * environment can't derive them. Passed as a JSON object, a path to a
 * JSON file (`--context <file>`), `-` for stdin, or auto-discovered at
 * `.skillerr/context.json`. Every string here is scrubbed before it lands
 * in the sealed payload, same as the diff.
 */
export interface CaptureContext {
  intent?: string;
  title?: string;
  agent?: AgentContextSummary;
  /** Overrides/augments the derived git journey. */
  journey?: { summary?: string; open_questions?: string[]; decisions?: string[] };
  plan?: PlanItem[];
  nextSteps?: string[];
  /** Approaches tried and abandoned (saves the next agent from repeating them). */
  rejectedPaths?: string[];
  /** Unresolved threads; merged into the journey's open_questions. */
  openThreads?: string[];
  /** Resolved decisions; merged into the journey's decisions. */
  decisions?: string[];
  knowledge?: Array<{ title: string; body: string; type?: KnowledgeItemType }>;
  filePointers?: FilePointer[];
  toolResults?: ToolResult[];
}

export interface CaptureOptions {
  /** Directory to capture. Default: process.cwd(). */
  cwd?: string;
  /** Session intent (e.g. from a `-m` flag). Falls back to a branch/commit-derived line. */
  intent?: string;
  title?: string;
  /**
   * Agent context: an object, a path to a JSON file, `-` for stdin, or
   * omitted (then `.skillerr/context.json` under cwd is auto-loaded if it
   * exists). Environment capture always runs regardless.
   */
  context?: CaptureContext | string;
  /**
   * SessionSource id (`claude-code` | `codex` | `cursor`, or alias `claude`).
   * When set (alone or with `sessionId`), runs inference-free store resolve +
   * load and merges that enrichment under `context` before the git floor.
   */
  from?: SessionSourceId | string;
  /** Exact / suffix session id when resolving a SessionSource store. */
  sessionId?: string;
  /**
   * Override home for SessionSource scanning (`~/.claude` etc.). Tests /
   * unusual layouts. Ignored unless `from` or `sessionId` is set.
   */
  homeDir?: string;
  /** Diff size cap in bytes (default 200000); the diff is truncated and flagged past it. */
  maxDiffBytes?: number;
  /** Recent-commit count (default 20). */
  maxCommits?: number;
  skillId?: string;
  version?: string;
  sensitivity?: PackageSensitivity;
}

export interface CaptureResult {
  /** Continuity `SkillPackageFiles`, ready for `seal()`/`packSkill`. */
  pkg: SkillPackageFiles;
  workingSet?: WorkingSet;
  journey: ContinuityJourney;
  source: ContinuitySource;
  /** The merged redaction report over the diff + commit subjects + agent strings. */
  redaction: RedactionReport;
  /** True when a git working tree was found and read. */
  hasGit: boolean;
  /** Resolved SessionSource candidate when `from` / `sessionId` was used. */
  session?: SessionCandidate | null;
  /** Note from resolve (e.g. git-floor-only when no session files found). */
  sessionNote?: string;
  /** Optional session file bytes for the caller to attach; not sealed by default. */
  sessionFile?: { name: string; bytes: Uint8Array };
}

function git(args: string[], cwd: string): string | undefined {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return undefined;
  }
}

function parseStatus(porcelain: string): { files: WorkingSetFile[]; untracked: string[] } {
  const files: WorkingSetFile[] = [];
  const untracked: string[] = [];
  for (const line of porcelain.split("\n")) {
    if (!line) continue;
    const x = line[0];
    const y = line[1];
    const rest = line.slice(3);
    if (x === "?" && y === "?") {
      untracked.push(rest);
      continue;
    }
    // Renames/copies render as "R  old -> new" (or "C  ...").
    if (x === "R" || x === "C") {
      const [from, to] = rest.split(" -> ");
      files.push({ path: to ?? rest, status: "renamed", renamedFrom: from });
      continue;
    }
    const code = x !== " " && x !== undefined ? x : y;
    const status: WorkingSetFile["status"] =
      code === "A" ? "added" : code === "D" ? "deleted" : "modified";
    files.push({ path: rest, status });
  }
  return { files, untracked };
}

function applyNumstat(files: WorkingSetFile[], numstat: string): void {
  const byPath = new Map<string, WorkingSetFile>(files.map((f) => [f.path, f]));
  for (const line of numstat.split("\n")) {
    if (!line) continue;
    const [addStr, delStr, ...pathParts] = line.split("\t");
    let path = pathParts.join("\t");
    // Rename numstat form: "old => new" or "dir/{old => new}/file".
    const arrow = path.match(/\{(.*) => (.*)\}/);
    if (arrow) path = path.replace(/\{(.*) => (.*)\}/, arrow[2]!);
    else if (path.includes(" => ")) path = path.split(" => ")[1] ?? path;
    const f = byPath.get(path);
    if (!f) continue;
    const additions = addStr === "-" ? undefined : Number(addStr);
    const deletions = delStr === "-" ? undefined : Number(delStr);
    if (additions !== undefined) f.additions = additions;
    if (deletions !== undefined) f.deletions = deletions;
    if (additions !== undefined || deletions !== undefined) {
      f.summary = `+${additions ?? 0} -${deletions ?? 0}`;
    }
  }
}

function captureWorkingSet(
  cwd: string,
  maxDiffBytes: number,
  maxCommits: number,
): { workingSet: WorkingSet; rawDiff: string; rawSubjects: string[] } | undefined {
  const inside = git(["rev-parse", "--is-inside-work-tree"], cwd);
  if (inside?.trim() !== "true") return undefined;

  const branchRaw = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd)?.trim();
  const branch = branchRaw && branchRaw !== "HEAD" ? branchRaw : undefined;
  const headSha = git(["rev-parse", "--short", "HEAD"], cwd)?.trim();

  // Base = merge-base with upstream if set, else with origin/HEAD, main, or master.
  let baseSha: string | undefined;
  for (const ref of ["@{upstream}", "origin/HEAD", "main", "master"]) {
    const base = git(["merge-base", "HEAD", ref], cwd)?.trim();
    if (base) {
      baseSha = git(["rev-parse", "--short", base], cwd)?.trim();
      break;
    }
  }

  const porcelain = git(["status", "--porcelain"], cwd) ?? "";
  const { files, untracked } = parseStatus(porcelain);
  const numstat = git(["diff", "--numstat", "HEAD"], cwd);
  if (numstat) applyNumstat(files, numstat);

  let rawDiff = git(["diff", "HEAD"], cwd) ?? "";
  let diffTruncated = false;
  if (Buffer.byteLength(rawDiff, "utf8") > maxDiffBytes) {
    rawDiff = Buffer.from(rawDiff, "utf8").subarray(0, maxDiffBytes).toString("utf8");
    diffTruncated = true;
  }

  const commits: WorkingSetCommit[] = [];
  const rawSubjects: string[] = [];
  const log = git(["log", "-n", String(maxCommits), "--format=%h%x1f%s"], cwd);
  if (log) {
    for (const line of log.split("\n")) {
      if (!line) continue;
      const [sha, subject] = line.split("\x1f");
      if (sha) {
        commits.push({ sha, subject: subject ?? "" });
        rawSubjects.push(subject ?? "");
      }
    }
  }

  const dirty = files.length > 0 || untracked.length > 0;
  const workingSet: WorkingSet = {
    branch,
    baseSha,
    headSha,
    dirty,
    files,
    diff: rawDiff || undefined,
    diffTruncated: diffTruncated || undefined,
    commits,
    untracked,
  };
  return { workingSet, rawDiff, rawSubjects };
}

function deriveJourneySummary(ws: WorkingSet | undefined): string {
  if (!ws) return "Session captured outside a git repository; no working-set state available.";
  const where = ws.branch ? `branch \`${ws.branch}\`` : "detached HEAD";
  if (!ws.dirty) {
    return `Clean working tree on ${where}${ws.headSha ? ` at \`${ws.headSha}\`` : ""}; no uncommitted changes.`;
  }
  const totalAdd = ws.files.reduce((n, f) => n + (f.additions ?? 0), 0);
  const totalDel = ws.files.reduce((n, f) => n + (f.deletions ?? 0), 0);
  const parts = [`${ws.files.length} changed file(s) (+${totalAdd} -${totalDel})`];
  if (ws.untracked.length) parts.push(`${ws.untracked.length} untracked`);
  return `Work in progress on ${where}: ${parts.join(", ")}.`;
}

function loadContext(cwd: string, context: CaptureContext | string | undefined): CaptureContext {
  if (context && typeof context === "object") return context;
  let raw: string | undefined;
  if (context === "-") {
    raw = readFileSync(0, "utf8"); // stdin
  } else if (typeof context === "string") {
    raw = readFileSync(context, "utf8");
  } else {
    const wellKnown = join(cwd, ".skillerr", "context.json");
    if (existsSync(wellKnown)) raw = readFileSync(wellKnown, "utf8");
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw) as CaptureContext;
  } catch (e) {
    throw new Error(`Agent context is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Captures the current session state into a sealable continuity package.
 * Environment (git) capture always runs; agent context, when supplied,
 * enriches it. Never fabricates content: an empty repo with no context
 * says so honestly, a dirty repo carries its real diff.
 *
 * When `from` and/or `sessionId` is set, resolves a local SessionSource
 * store (inference-free), loads redacted enrichment, and merges it under
 * any explicit `context` before the git floor. Ambiguous / missing
 * sessionId throws; no session found continues as git-floor-only.
 */
export async function captureSession(opts: CaptureOptions = {}): Promise<CaptureResult> {
  const cwd = opts.cwd ?? process.cwd();
  const maxDiffBytes = opts.maxDiffBytes ?? DEFAULT_MAX_DIFF_BYTES;
  const maxCommits = opts.maxCommits ?? DEFAULT_MAX_COMMITS;

  let session: SessionCandidate | null | undefined;
  let sessionNote: string | undefined;
  let sessionFile: CaptureResult["sessionFile"];
  let context: CaptureContext;

  const wantsSession = opts.from != null || opts.sessionId != null;
  if (wantsSession) {
    const resolved = await resolveSession({
      cwd,
      from: opts.from,
      sessionId: opts.sessionId,
      homeDir: opts.homeDir,
    });
    if (!resolved.ok) {
      const detail = resolved.candidates?.length
        ? ` Candidates: ${resolved.candidates.map((c) => `${c.source}:${c.id}`).join(", ")}`
        : "";
      const err = new Error(`${resolved.error ?? "Session resolve failed"}.${detail}`);
      (err as Error & { ambiguous?: boolean; candidates?: SessionCandidate[] }).ambiguous =
        resolved.ambiguous;
      (err as Error & { candidates?: SessionCandidate[] }).candidates = resolved.candidates;
      throw err;
    }
    session = resolved.session;
    sessionNote = resolved.note;
    const explicit = loadContext(cwd, opts.context);
    if (session) {
      const loaded = await loadSessionContext(session);
      sessionFile = loaded.sessionFile;
      const {
        sessionFile: _sf,
        intentHint: _hint,
        ...sessionCtx
      } = loaded;
      context = mergeCaptureContexts(sessionCtx, explicit);
    } else {
      context = explicit;
    }
  } else {
    context = loadContext(cwd, opts.context);
  }

  const captured = captureWorkingSet(cwd, maxDiffBytes, maxCommits);
  const hasGit = captured !== undefined;

  // Scrub the diff, commit subjects, and agent strings together in one
  // pass so "same secret -> same placeholder" holds across them. Order is
  // stable so the merged report is deterministic.
  const scrubUnits: Array<{ id: string; text: string }> = [];
  if (captured?.rawDiff) scrubUnits.push({ id: "diff", text: captured.rawDiff });
  captured?.rawSubjects.forEach((s, i) => scrubUnits.push({ id: `commit_${i}`, text: s }));
  scrubUnits.push({ id: "intent_opt", text: opts.intent ?? "" });
  const agentStrings: string[] = [
    context.intent ?? "",
    context.journey?.summary ?? "",
    ...(context.journey?.open_questions ?? []),
    ...(context.journey?.decisions ?? []),
    ...(context.openThreads ?? []),
    ...(context.decisions ?? []),
    ...(context.nextSteps ?? []),
    ...(context.rejectedPaths ?? []),
    ...(context.plan ?? []).map((p) => p.text),
    ...(context.knowledge ?? []).flatMap((k) => [k.title, k.body]),
    ...(context.toolResults ?? []).map((t) => t.summary),
  ];
  agentStrings.forEach((s, i) => scrubUnits.push({ id: `agent_${i}`, text: s }));

  const scrubbed = scrub(scrubUnits, { mode: "auto" });
  const scrubbedUnits = scrubbed.scrubbed as Array<{ id: string; text: string }>;
  const byId = new Map(scrubbedUnits.map((u) => [u.id, u.text]));
  const redaction = mergeRedactionReports([scrubbed.report]);

  // Rebuild the working set with the scrubbed diff + subjects.
  let workingSet = captured?.workingSet;
  if (workingSet) {
    workingSet = {
      ...workingSet,
      diff: byId.get("diff") ?? workingSet.diff,
      commits: workingSet.commits.map((c, i) => ({ ...c, subject: byId.get(`commit_${i}`) ?? c.subject })),
    };
  }

  const scrubbedAgent = (i: number): string => byId.get(`agent_${i}`) ?? agentStrings[i] ?? "";
  // Re-walk agentStrings indices in the same order they were pushed.
  let ai = 0;
  const sIntent = scrubbedAgent(ai++);
  const sJourneySummary = scrubbedAgent(ai++);
  const sOpenQ = (context.journey?.open_questions ?? []).map(() => scrubbedAgent(ai++));
  const sDecJourney = (context.journey?.decisions ?? []).map(() => scrubbedAgent(ai++));
  const sOpenThreads = (context.openThreads ?? []).map(() => scrubbedAgent(ai++));
  const sDecisions = (context.decisions ?? []).map(() => scrubbedAgent(ai++));
  const sNextSteps = (context.nextSteps ?? []).map(() => scrubbedAgent(ai++));
  const sRejected = (context.rejectedPaths ?? []).map(() => scrubbedAgent(ai++));
  const sPlan = (context.plan ?? []).map((p) => ({ ...p, text: scrubbedAgent(ai++) }));
  const sKnowledge = (context.knowledge ?? []).map((k) => {
    const title = scrubbedAgent(ai++);
    const body = scrubbedAgent(ai++);
    return { ...k, title, body };
  });
  const sToolResults = (context.toolResults ?? []).map((t) => ({ ...t, summary: scrubbedAgent(ai++) }));

  // Priority: explicit -m intent, else agent-context intent, else a
  // git-derived summary line. All already scrubbed in the batch above.
  const optIntent = byId.get("intent_opt") ?? "";
  const intent = optIntent || sIntent || deriveJourneySummary(workingSet);

  const journey: ContinuityJourney = {
    summary: sJourneySummary || context.journey?.summary || deriveJourneySummary(workingSet),
    open_questions: [...sOpenQ, ...sOpenThreads],
    decisions: [...sDecJourney, ...sDecisions],
  };

  const source: ContinuitySource = {
    kind: "continuity_source",
    agent: context.agent,
    workingSet,
    plan: sPlan.length ? sPlan : undefined,
    nextSteps: sNextSteps.length ? sNextSteps : undefined,
    rejectedPaths: sRejected.length ? sRejected : undefined,
    filePointers: context.filePointers?.length ? context.filePointers : undefined,
    toolResults: sToolResults.length ? sToolResults : undefined,
  };

  const knowledge: KnowledgeItem[] = sKnowledge.map((k, i) => ({
    kind: "knowledge",
    id: `k${i + 1}`,
    type: k.type ?? "decision",
    title: k.title,
    body: k.body,
    fidelity: "exact",
    pinned: true,
  }));

  const title = (opts.title ?? context.title)?.trim() || (intent ? intent.slice(0, 80) : "Continuity checkpoint");
  const idBasis = `${title}\n${workingSet?.headSha ?? ""}\n${journey.summary}`;
  const skillId = opts.skillId ?? `skl_${sha256Hex(idBasis).slice(0, 24)}`;
  const sensitivity = opts.sensitivity ?? "shareable_redacted";

  const pkg: SkillPackageFiles = {
    manifest: {
      kind: "dot-skill",
      id: skillId,
      version: opts.version ?? "0.0.0",
      title,
      description: journey.summary,
      intent,
      container_version: "1",
      protocol_version: "1.0.0",
      entrypoint: "resume",
      inputs: [],
      outputs: [],
      capabilities: [],
      permissions: [],
      policy: { ...DEFAULT_SKILL_POLICY },
      content: [],
      package_digest: "sha256:" + "0".repeat(64),
      provenance_mode: "redacted",
      compile_profile: "continuity",
      package_sensitivity: sensitivity,
    },
    workflow: {
      kind: "workflow",
      dialect_version: "1.1",
      entrypoint: "resume",
      steps: [{ id: "resume", kind: "emit", output: "briefing", from: "resume" }],
    },
    knowledge,
    provenance: {
      source: source as unknown as Record<string, unknown>,
      journey: {
        summary: journey.summary,
        open_questions: journey.open_questions,
        decisions: journey.decisions,
        redacted: true,
        sensitivity,
      },
      redaction,
    },
  };

  return { pkg, workingSet, journey, source, redaction, hasGit, session, sessionNote, sessionFile };
}
