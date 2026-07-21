/**
 * SessionSource: inference-free intake from local agent session stores
 * (claude-code | codex | cursor). Scans known host paths for `.jsonl`
 * transcripts, resolves which session to capture, and loads a redacted
 * `CaptureContext` enrichment — no model / LLM calls anywhere.
 *
 * Composes with the existing git-floor `captureSession` (capture.ts):
 * resolve → load → merge into context → environment capture always runs.
 * Binary session attach is returned to the caller; sealing the package
 * does not invent a second container format.
 *
 * No registry / skillerr.com knowledge (spec/CONTRACT.md independence).
 * Redaction uses protocol `scrub()`; never de-redacts; never invents secrets.
 *
 * Host layouts are best-effort and pluggable via `homeDir` (and cwd-local
 * `.claude` / `.codex` / `.cursor`). See docs/CONTINUITY.md.
 */
import { existsSync } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { scrub } from "./scrub.js";
import type { CaptureContext } from "./capture.js";
import type { KnowledgeItemType } from "@skillerr/protocol";

/** Canonical SessionSource ids (store scanners + capture `--from`). */
export type SessionSourceId = "claude-code" | "codex" | "cursor";

export const SESSION_SOURCES: readonly SessionSourceId[] = [
  "claude-code",
  "codex",
  "cursor",
] as const;

/**
 * Legacy ResumeTarget agent ids from Resume Contract 1.0 (`resumePreview`).
 * `claude` is the short form; SessionSource uses `claude-code`. Prefer
 * `normalizeSessionSourceId` / `resumeAgentFromSessionSource` at boundaries.
 */
export type ResumeAgentId = "cursor" | "claude" | "codex";

export interface SessionCandidate {
  id: string;
  source: SessionSourceId;
  /** Absolute path to the session artifact (usually a `.jsonl`). */
  path: string;
  mtimeMs: number;
  size: number;
  /** Likely matches cwd / project (slug, basename, or under cwd). */
  related: boolean;
  /** Human-readable label. */
  label: string;
}

export interface ListSessionsOptions {
  cwd?: string;
  /** Omit = scan all sources. Accepts aliases (`claude` → `claude-code`). */
  from?: SessionSourceId | string;
  /**
   * Override home directory for `~/.claude` / `~/.codex` / `~/.cursor`
   * roots (tests, unusual layouts). Default: `os.homedir()`.
   */
  homeDir?: string;
}

export interface ResolveSessionOptions extends ListSessionsOptions {
  sessionId?: string;
}

export interface ResolveSessionResult {
  ok: boolean;
  session: SessionCandidate | null;
  ambiguous?: boolean;
  error?: string;
  note?: string;
  candidates?: SessionCandidate[];
}

export type SessionContextResult = CaptureContext & {
  /** Optional binary attach for the caller; not sealed into ContinuitySource by default. */
  sessionFile?: { name: string; bytes: Uint8Array };
  /** Heuristic intent line (also copied into `intent` when present). */
  intentHint?: string;
};

const MAX_WALK_FILES = 80;
const MAX_SUMMARY_LINES = 40;
const MAX_TAIL_BYTES = 256_000;
const MAX_ATTACH_BYTES = 512_000;
const AMBIGUOUS_WINDOW_MS = 120_000;

/**
 * Normalize CLI / host aliases → canonical `SessionSourceId`.
 * `claude` | `claude-code` | `claudecode` → `claude-code`.
 */
export function normalizeSessionSourceId(
  raw?: string | null,
): SessionSourceId | null {
  if (raw == null || raw === "") return null;
  const s = String(raw).toLowerCase().trim();
  if (s === "claude" || s === "claude-code" || s === "claudecode") return "claude-code";
  if (s === "codex") return "codex";
  if (s === "cursor") return "cursor";
  return null;
}

/**
 * Normalize a resume `--agent` value to a SessionSourceId.
 * Unknown / empty defaults to `cursor` (same as the registry temporary adapter).
 */
export function normalizeResumeAgent(raw?: string | null): SessionSourceId {
  return normalizeSessionSourceId(raw) ?? "cursor";
}

/**
 * Map SessionSourceId → legacy ResumeTarget.agent (`claude-code` → `claude`).
 * Keeps existing `resumePreview` consumers that match on `"claude"` working.
 */
export function resumeAgentFromSessionSource(id: SessionSourceId): ResumeAgentId {
  if (id === "claude-code") return "claude";
  return id;
}

/** Inverse: ResumeTarget / short agent → SessionSourceId. */
export function sessionSourceFromResumeAgent(agent: ResumeAgentId | string): SessionSourceId {
  return normalizeResumeAgent(agent);
}

/** Claude Code–style project dir key: `/Users/a/b` → `-Users-a-b`. */
export function claudeProjectSlug(cwd: string): string {
  // Replace path separators with `-`. Also strip characters that are illegal
  // in directory names on Windows (`:` from `C:\…`, etc.) so scanners and
  // fixtures stay portable across the CI matrix.
  return resolve(cwd)
    .replace(/\\/g, "/")
    .replace(/\//g, "-")
    .replace(/[<>:"|?*]/g, "_");
}

/** Sanitized slug (leading dashes stripped) — some hosts use this form. */
export function sanitizedProjectSlug(cwd: string): string {
  return resolve(cwd)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-|-$/g, "");
}

function projectMatchers(cwd: string): string[] {
  const abs = resolve(cwd);
  return [...new Set([claudeProjectSlug(cwd), sanitizedProjectSlug(cwd), basename(abs), abs])];
}

function isRelated(filePath: string, cwd: string): boolean {
  const abs = resolve(cwd);
  const normFile = filePath.replace(/\\/g, "/");
  const normAbs = abs.replace(/\\/g, "/");
  if (normFile === normAbs || normFile.startsWith(normAbs + "/")) return true;
  return projectMatchers(cwd).some((m) => m.length > 0 && filePath.includes(m));
}

function candidateRoots(
  source: SessionSourceId,
  cwd: string,
  home: string,
): string[] {
  const abs = resolve(cwd);
  const claudeSlug = claudeProjectSlug(cwd);
  const sanitized = sanitizedProjectSlug(cwd);
  if (source === "claude-code") {
    return [
      join(abs, ".claude"),
      join(home, ".claude", "projects", claudeSlug),
      join(home, ".claude", "projects", sanitized),
      join(home, ".claude", "projects"),
      join(home, ".config", "claude"),
    ];
  }
  if (source === "codex") {
    return [join(abs, ".codex"), join(home, ".codex", "sessions"), join(home, ".codex")];
  }
  return [
    join(abs, ".cursor"),
    join(home, ".cursor", "projects", claudeSlug, "agent-transcripts"),
    join(home, ".cursor", "projects", sanitized, "agent-transcripts"),
    join(home, ".cursor", "projects"),
    join(home, ".cursor"),
  ];
}

async function walkJsonl(
  dir: string,
  opts: { maxDepth: number; limit: number },
  depth = 0,
  out: Array<{ path: string; mtimeMs: number; size: number }> = [],
): Promise<Array<{ path: string; mtimeMs: number; size: number }>> {
  if (!existsSync(dir) || depth > opts.maxDepth || out.length >= opts.limit) return out;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (out.length >= opts.limit) break;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === ".git" || ent.name === "dist") continue;
      await walkJsonl(full, opts, depth + 1, out);
    } else if (ent.isFile() && /\.jsonl$/i.test(ent.name)) {
      try {
        const st = await stat(full);
        out.push({ path: full, mtimeMs: st.mtimeMs, size: st.size });
      } catch {
        /* skip unreadable */
      }
    }
  }
  return out;
}

async function readUtf8Tail(filePath: string, maxBytes = MAX_TAIL_BYTES): Promise<string> {
  const st = await stat(filePath);
  if (st.size <= maxBytes) return readFile(filePath, "utf8");
  const fh = await open(filePath, "r");
  try {
    const start = Math.max(0, st.size - maxBytes);
    const buf = Buffer.alloc(st.size - start);
    await fh.read(buf, 0, buf.length, start);
    const text = buf.toString("utf8");
    const nl = text.indexOf("\n");
    return nl === -1 ? text : text.slice(nl + 1);
  } finally {
    await fh.close();
  }
}

function extractText(obj: Record<string, unknown>): string {
  const content = obj.content;
  if (typeof content === "string") return content;
  const message = obj.message as Record<string, unknown> | undefined;
  if (message) {
    if (typeof message.content === "string") return message.content;
    if (Array.isArray(message.content)) {
      return message.content
        .map((c) => (typeof c === "string" ? c : (c as { text?: string })?.text ?? ""))
        .join(" ");
    }
  }
  if (typeof obj.text === "string") return obj.text;
  return "";
}

function extractRole(obj: Record<string, unknown>): string {
  if (typeof obj.role === "string") return obj.role;
  if (typeof obj.type === "string") return obj.type;
  if (typeof obj.speaker === "string") return obj.speaker;
  const message = obj.message as { role?: string } | undefined;
  if (message?.role) return message.role;
  return "event";
}

interface JsonlSummary {
  steps: Array<{ label: string; note: string }>;
  intent: string | null;
  decisions: string[];
  openThreads: string[];
}

async function summarizeJsonl(filePath: string): Promise<JsonlSummary> {
  let text = "";
  try {
    text = await readUtf8Tail(filePath);
  } catch {
    return { steps: [], intent: null, decisions: [], openThreads: [] };
  }
  const lines = text.split("\n").filter(Boolean);
  const sample = lines.slice(-Math.min(lines.length, 200)).slice(-MAX_SUMMARY_LINES);

  const rawSnippets: Array<{ role: string; text: string }> = [];
  for (const line of sample) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const t = extractText(obj).slice(0, 280);
    if (!t.trim()) continue;
    rawSnippets.push({ role: extractRole(obj), text: t });
  }

  if (!rawSnippets.length) {
    return { steps: [], intent: null, decisions: [], openThreads: [] };
  }

  const scrubbed = scrub(
    rawSnippets.map((s, i) => ({ id: `s${i}`, text: s.text })),
    { mode: "auto" },
  );
  const byId = new Map(
    (scrubbed.scrubbed as Array<{ id: string; text: string }>).map((u) => [u.id, u.text]),
  );

  const steps: Array<{ label: string; note: string }> = [];
  const decisions: string[] = [];
  const openThreads: string[] = [];
  let intent: string | null = null;

  rawSnippets.forEach((s, i) => {
    const note = (byId.get(`s${i}`) ?? s.text).trim();
    if (!note) return;
    if (!intent && /^(implement|fix|add|build|refactor)/i.test(note)) {
      intent = note.slice(0, 120);
    }
    if (/decision|chose|went with|picked/i.test(note)) {
      decisions.push(note.slice(0, 160));
    }
    if (/\?$|TODO|open question|still need/i.test(note)) {
      openThreads.push(note.slice(0, 160));
    }
    steps.push({ label: s.role.slice(0, 40), note });
  });

  return {
    steps: steps.slice(-24),
    intent,
    decisions: decisions.slice(-8),
    openThreads: openThreads.slice(-8),
  };
}

/**
 * Scan known host stores for `.jsonl` session artifacts.
 * Prefers project-related paths; newest first; deduped by absolute path.
 */
export async function listSessionCandidates(
  opts: ListSessionsOptions = {},
): Promise<SessionCandidate[]> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const home = opts.homeDir ?? homedir();
  const from = normalizeSessionSourceId(opts.from ?? null);
  const sources: SessionSourceId[] = from ? [from] : [...SESSION_SOURCES];
  const found: SessionCandidate[] = [];

  for (const src of sources) {
    const roots = candidateRoots(src, cwd, home);
    for (const root of roots) {
      if (!existsSync(root)) continue;
      const files = await walkJsonl(root, {
        maxDepth: src === "cursor" ? 5 : 4,
        limit: MAX_WALK_FILES,
      });
      for (const f of files) {
        found.push({
          id: basename(f.path, ".jsonl"),
          source: src,
          path: f.path,
          mtimeMs: f.mtimeMs,
          size: f.size,
          related: isRelated(f.path, cwd),
          label: `${src} · ${basename(f.path)}`,
        });
      }
    }
  }

  found.sort((a, b) => {
    if (a.related !== b.related) return a.related ? -1 : 1;
    return b.mtimeMs - a.mtimeMs;
  });

  const seen = new Set<string>();
  return found.filter((f) => {
    if (seen.has(f.path)) return false;
    seen.add(f.path);
    return true;
  });
}

/**
 * Resolve which session to capture.
 * - with sessionId: exact / suffix / path-includes match, or error + candidates
 * - without: most recent related (else any); if ambiguous across sources within
 *   2 minutes and no `from`, return ambiguous + candidates
 * - none found: ok with session=null (git-floor-only capture still valid)
 */
export async function resolveSession(
  opts: ResolveSessionOptions = {},
): Promise<ResolveSessionResult> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const source = normalizeSessionSourceId(opts.from ?? null);
  if (opts.from != null && opts.from !== "" && !source) {
    return {
      ok: false,
      session: null,
      error: `Unknown session source "${opts.from}" (expected claude-code|codex|cursor, or alias claude)`,
    };
  }
  const all = await listSessionCandidates({
    cwd,
    from: source ?? undefined,
    homeDir: opts.homeDir,
  });

  if (opts.sessionId) {
    const id = opts.sessionId;
    const hit =
      all.find((s) => s.id === id || s.path.endsWith(id)) ||
      all.find((s) => s.path.includes(id));
    if (!hit) {
      return {
        ok: false,
        session: null,
        error: `No session matching "${id}"${source ? ` for source ${source}` : ""}`,
        candidates: all.slice(0, 12),
      };
    }
    return { ok: true, session: hit, ambiguous: false };
  }

  if (!all.length) {
    return {
      ok: true,
      session: null,
      ambiguous: false,
      note: source
        ? `No ${source} session files found; capturing git floor only.`
        : "No agent session files found; capturing git floor only.",
    };
  }

  const related = all.filter((s) => s.related);
  const pool = related.length ? related : all;
  const top = pool[0]!;
  const second = pool[1];
  if (
    !source &&
    second &&
    top.source !== second.source &&
    Math.abs(top.mtimeMs - second.mtimeMs) < AMBIGUOUS_WINDOW_MS
  ) {
    return {
      ok: false,
      session: null,
      ambiguous: true,
      error: "Multiple recent sessions from different sources; pass from or sessionId",
      candidates: pool.slice(0, 8),
    };
  }

  return { ok: true, session: top, ambiguous: false };
}

/**
 * Load redacted CaptureContext enrichment from a session file (NO model call).
 * Includes a filePointer to the jsonl; optional binary attach for the caller
 * (capped; oversized files are summarized but not fully attached).
 */
export async function loadSessionContext(
  session: SessionCandidate,
): Promise<SessionContextResult> {
  const summary = await summarizeJsonl(session.path);

  let sessionFile: SessionContextResult["sessionFile"];
  try {
    const st = await stat(session.path);
    if (st.size <= MAX_ATTACH_BYTES) {
      const rawText = await readFile(session.path, "utf8");
      const fileScrub = scrub([{ id: "session_file", text: rawText }], { mode: "auto" });
      const scrubbedText =
        (fileScrub.scrubbed as Array<{ id: string; text: string }>)[0]?.text ?? rawText;
      sessionFile = {
        name: `session/${session.source}/${basename(session.path)}`,
        bytes: new TextEncoder().encode(scrubbedText),
      };
    }
  } catch {
    sessionFile = undefined;
  }

  const knowledgeType: KnowledgeItemType = "lesson";
  const intent =
    summary.intent ?? `Resumed from ${session.source} session ${session.id}`;

  return {
    intent: summary.intent ?? undefined,
    intentHint: summary.intent ?? undefined,
    agent: {
      host: session.source,
      provider: session.source,
    },
    journey: {
      summary: intent,
      open_questions: summary.openThreads,
      decisions: summary.decisions,
    },
    plan: undefined,
    nextSteps: summary.openThreads.slice(0, 5),
    rejectedPaths: undefined,
    openThreads: summary.openThreads,
    decisions: summary.decisions,
    knowledge: summary.steps.slice(0, 6).map((s, i) => ({
      title: s.label || `Step ${i + 1}`,
      body: s.note || "",
      type: knowledgeType,
    })),
    filePointers: [
      {
        path: session.path,
        note: "session_jsonl",
      },
    ],
    toolResults: undefined,
    sessionFile,
  };
}

/**
 * Merge session enrichment under explicit agent context.
 * Explicit values win for scalars; non-empty explicit arrays replace session arrays.
 */
export function mergeCaptureContexts(
  base: CaptureContext,
  overlay: CaptureContext,
): CaptureContext {
  const pickArr = <T>(o: T[] | undefined, b: T[] | undefined): T[] | undefined =>
    o && o.length ? o : b && b.length ? b : undefined;

  return {
    intent: overlay.intent ?? base.intent,
    title: overlay.title ?? base.title,
    agent: overlay.agent ?? base.agent,
    journey: {
      summary: overlay.journey?.summary ?? base.journey?.summary,
      open_questions: pickArr(overlay.journey?.open_questions, base.journey?.open_questions),
      decisions: pickArr(overlay.journey?.decisions, base.journey?.decisions),
    },
    plan: pickArr(overlay.plan, base.plan),
    nextSteps: pickArr(overlay.nextSteps, base.nextSteps),
    rejectedPaths: pickArr(overlay.rejectedPaths, base.rejectedPaths),
    openThreads: pickArr(overlay.openThreads, base.openThreads),
    decisions: pickArr(overlay.decisions, base.decisions),
    knowledge: pickArr(overlay.knowledge, base.knowledge),
    filePointers: pickArr(overlay.filePointers, base.filePointers),
    toolResults: pickArr(overlay.toolResults, base.toolResults),
  };
}

/** @internal test helper — roots a scanner would consider (absolute). */
export function sessionCandidateRootsForTest(
  source: SessionSourceId,
  cwd: string,
  homeDir: string,
): string[] {
  return candidateRoots(source, cwd, homeDir);
}
