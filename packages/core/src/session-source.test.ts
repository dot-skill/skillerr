/**
 * SessionSource tests: real temp dirs + fake `.jsonl` fixtures (no hollow
 * mocks). Covers list/resolve/load, ambiguous dual-source, scrub of secrets
 * in session lines, and captureSession({ from }) composing over the git floor.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureSession } from "./capture.js";
import {
  claudeProjectSlug,
  listSessionCandidates,
  loadSessionContext,
  normalizeSessionSourceId,
  resolveSession,
  resumeAgentFromSessionSource,
} from "./session-source.js";

function git(args: string[], cwd: string): void {
  execFileSync("git", args, {
    cwd,
    stdio: "ignore",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "t@e.st",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "t@e.st",
    },
  });
}

function makeDirtyRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "skillerr-ss-git-"));
  git(["init", "-b", "main"], dir);
  writeFileSync(join(dir, "app.js"), "export const version = 1;\n");
  git(["add", "."], dir);
  git(["commit", "-m", "initial"], dir);
  writeFileSync(join(dir, "app.js"), "export const version = 2;\n");
  git(["add", "app.js"], dir);
  git(["commit", "-m", "bump"], dir);
  writeFileSync(join(dir, "feature.js"), "export function newFeature() { return 1; }\n");
  git(["add", "feature.js"], dir);
  writeFileSync(join(dir, "app.js"), "export const version = 3;\n");
  return dir;
}

function writeJsonl(path: string, lines: object[]): void {
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

function makeHomeWithSessions(cwd: string): { home: string; claudePath: string; cursorPath: string } {
  const home = mkdtempSync(join(tmpdir(), "skillerr-ss-home-"));
  const slug = claudeProjectSlug(cwd);
  const claudeDir = join(home, ".claude", "projects", slug);
  mkdirSync(claudeDir, { recursive: true });
  const claudePath = join(claudeDir, "sess-claude.jsonl");
  writeJsonl(claudePath, [
    { role: "user", content: "Implement the SessionSource scanner for continuity capture" },
    { role: "assistant", content: "Decision: chose jsonl walk over model summarization" },
    { role: "user", content: "Still need ambiguous dual-source handling?" },
    {
      role: "assistant",
      content: "apiKey sk-abcdefghijklmnopqrstuvwx keep this code path",
    },
  ]);

  const cursorDir = join(home, ".cursor", "projects", slug, "agent-transcripts");
  mkdirSync(cursorDir, { recursive: true });
  const cursorPath = join(cursorDir, "sess-cursor.jsonl");
  // Same mtime window — touch by writing after a tiny delay is flaky; set via
  // resolve ambiguity by writing both "now". Tests set mtime via utimes if needed.
  writeJsonl(cursorPath, [
    { role: "user", content: "Fix the hollow handoff in the registry client" },
    { message: { role: "assistant", content: [{ type: "text", text: "Went with core captureSession" }] } },
  ]);

  return { home, claudePath, cursorPath };
}

test("normalizeSessionSourceId: claude aliases → claude-code", () => {
  assert.equal(normalizeSessionSourceId("claude"), "claude-code");
  assert.equal(normalizeSessionSourceId("claude-code"), "claude-code");
  assert.equal(normalizeSessionSourceId("ClaudeCode"), "claude-code");
  assert.equal(normalizeSessionSourceId("cursor"), "cursor");
  assert.equal(normalizeSessionSourceId("nope"), null);
  assert.equal(resumeAgentFromSessionSource("claude-code"), "claude");
});

test("listSessionCandidates: finds related claude-code jsonl under home slug", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "skillerr-ss-cwd-"));
  const { home, claudePath } = makeHomeWithSessions(cwd);
  try {
    const list = await listSessionCandidates({ cwd, from: "claude-code", homeDir: home });
    assert.ok(list.length >= 1);
    assert.equal(list[0]!.source, "claude-code");
    assert.equal(list[0]!.path, claudePath);
    assert.equal(list[0]!.related, true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("resolveSession: explicit sessionId matches; missing id errors with candidates", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "skillerr-ss-cwd-"));
  const { home } = makeHomeWithSessions(cwd);
  try {
    const hit = await resolveSession({
      cwd,
      from: "claude",
      sessionId: "sess-claude",
      homeDir: home,
    });
    assert.equal(hit.ok, true);
    assert.equal(hit.session?.id, "sess-claude");

    const miss = await resolveSession({
      cwd,
      from: "claude-code",
      sessionId: "does-not-exist",
      homeDir: home,
    });
    assert.equal(miss.ok, false);
    assert.ok((miss.candidates?.length ?? 0) >= 1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("resolveSession: ambiguous when two sources are both recent and related", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "skillerr-ss-cwd-"));
  const { home, claudePath, cursorPath } = makeHomeWithSessions(cwd);
  // Force close mtimes
  const now = Date.now();
  const { utimesSync } = await import("node:fs");
  utimesSync(claudePath, new Date(now), new Date(now));
  utimesSync(cursorPath, new Date(now - 1_000), new Date(now - 1_000));
  try {
    const r = await resolveSession({ cwd, homeDir: home });
    assert.equal(r.ok, false);
    assert.equal(r.ambiguous, true);
    assert.ok((r.candidates?.length ?? 0) >= 2);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("resolveSession: no session → ok with session=null (git-floor-only)", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "skillerr-ss-empty-"));
  const home = mkdtempSync(join(tmpdir(), "skillerr-ss-empty-home-"));
  try {
    const r = await resolveSession({ cwd, from: "codex", homeDir: home });
    assert.equal(r.ok, true);
    assert.equal(r.session, null);
    assert.match(r.note ?? "", /git floor only/i);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("loadSessionContext: scrubs secrets from session lines, keeps substance", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "skillerr-ss-cwd-"));
  const { home, claudePath } = makeHomeWithSessions(cwd);
  try {
    const list = await listSessionCandidates({ cwd, from: "claude-code", homeDir: home });
    const loaded = await loadSessionContext(list[0]!);
    const blob = JSON.stringify(loaded);
    assert.ok(!blob.includes("sk-abcdefghijklmnopqrstuvwx"), "openai-format secret scrubbed from context + attach");
    assert.ok(
      blob.includes("{{redacted:openai_key") ||
        Buffer.from(loaded.sessionFile?.bytes ?? []).toString("utf8").includes("{{redacted:openai_key"),
      "stable redaction placeholder present",
    );
    assert.equal(loaded.filePointers?.[0]?.path, claudePath);
    assert.ok(loaded.sessionFile?.bytes?.length);
    assert.equal(loaded.agent?.host, "claude-code");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("captureSession({ from }): merges session enrichment over dirty git floor", async () => {
  const dir = makeDirtyRepo();
  const { home } = makeHomeWithSessions(dir);
  try {
    const result = await captureSession({
      cwd: dir,
      from: "claude-code",
      homeDir: home,
      intent: "Wire SessionSource into capture",
    });
    assert.equal(result.hasGit, true);
    assert.ok(result.workingSet?.dirty);
    assert.ok((result.workingSet?.files.length ?? 0) >= 1);
    assert.ok(result.session?.source === "claude-code");
    assert.equal(result.source.agent?.host, "claude-code");
    assert.ok((result.source.filePointers?.length ?? 0) >= 1);
    // Explicit -m intent wins over session heuristic
    assert.match(result.pkg.manifest.intent ?? "", /Wire SessionSource/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("captureSession({ from }) with empty store: still substantive git capture", async () => {
  const dir = makeDirtyRepo();
  const home = mkdtempSync(join(tmpdir(), "skillerr-ss-nofiles-"));
  try {
    const result = await captureSession({
      cwd: dir,
      from: "cursor",
      homeDir: home,
    });
    assert.equal(result.hasGit, true);
    assert.ok(result.workingSet?.dirty);
    assert.equal(result.session, null);
    assert.match(result.sessionNote ?? "", /git floor only/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
