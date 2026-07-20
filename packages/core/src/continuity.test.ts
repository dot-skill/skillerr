/**
 * Tests for the continuity surface (spec/CONTRACT.md Section 3,
 * docs/rfcs/0009-resume-contract.md) — built on real packed continuity
 * data (provenance.journey/source, knowledge), not a mocked shortcut.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { packSkill } from "./pack.js";
import { isContinuity, openContinuity, resumePreview } from "./continuity.js";
import { DEFAULT_SKILL_POLICY, type SkillPackageFiles } from "@skillerr/protocol";

function continuityPackage(overrides: Partial<SkillPackageFiles> = {}): SkillPackageFiles {
  return {
    manifest: {
      kind: "dot-skill",
      id: "skl_continuity_unit",
      version: "1.0.0",
      title: "Continuity unit test skill",
      description: "Minimal continuity package for continuity.ts tests",
      intent: "Resume this debugging session",
      container_version: "1",
      protocol_version: "1.0.0",
      entrypoint: "s1",
      inputs: [],
      outputs: [],
      capabilities: [],
      permissions: [],
      policy: { ...DEFAULT_SKILL_POLICY },
      content: [],
      package_digest: "sha256:" + "0".repeat(64),
      provenance_mode: "full",
      compile_profile: "continuity",
    },
    workflow: {
      kind: "workflow",
      dialect_version: "1.1",
      entrypoint: "s1",
      steps: [{ id: "s1", kind: "emit", output: "result", from: "s1" }],
    },
    knowledge: [
      {
        kind: "knowledge",
        id: "k1",
        type: "decision",
        title: "Chose Postgres over SQLite",
        body: "Needed concurrent writes from two workers.",
        fidelity: "exact",
      },
    ],
    provenance: {
      source: {
        agent: { host: "cursor", provider: "anthropic", model: "claude-sonnet-5", deployment: "hosted" },
      },
      journey: {
        summary: "Debugged a race condition in the write path.",
        open_questions: ["Should the retry backoff be exponential or fixed?"],
        decisions: ["Use Postgres advisory locks instead of a queue."],
        redacted: true,
        sensitivity: "private",
      },
    },
    ...overrides,
  };
}

function releasePackage(): SkillPackageFiles {
  const pkg = continuityPackage();
  pkg.manifest.compile_profile = "release";
  return pkg;
}

test("isContinuity: true for compile_profile continuity, false for release, accepts a bare manifest or {manifest}", () => {
  const continuity = continuityPackage();
  const release = releasePackage();
  assert.equal(isContinuity(continuity.manifest), true);
  assert.equal(isContinuity({ manifest: continuity.manifest }), true);
  assert.equal(isContinuity(release.manifest), false);
});

test("openContinuity: opens a real packed continuity package and reshapes real provenance into the contract shape", async () => {
  const pkg = continuityPackage();
  const zip = packSkill(pkg);
  const opened = await openContinuity(zip);

  assert.equal(opened.profile, "continuity");
  assert.match(opened.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(opened.digest, opened.manifest.package_digest);
  assert.equal(opened.intent, "Resume this debugging session");
  assert.deepEqual(opened.agentContext, {
    host: "cursor",
    provider: "anthropic",
    model: "claude-sonnet-5",
    deployment: "hosted",
  });
  assert.equal(opened.journey.summary, "Debugged a race condition in the write path.");
  assert.deepEqual(opened.journey.open_questions, ["Should the retry backoff be exponential or fixed?"]);
  assert.deepEqual(opened.journey.decisions, ["Use Postgres advisory locks instead of a queue."]);
  assert.equal(opened.knowledge.length, 1);
  assert.equal(opened.knowledge[0]!.title, "Chose Postgres over SQLite");
  assert.equal(opened.sections.length, 1);
  assert.equal(opened.sections[0]!.id, "k1");
  assert.equal(opened.sections[0]!.title, "Chose Postgres over SQLite");
});

test("openContinuity: journey open_questions/decisions become distinct, correctly-severity-tagged gaps", async () => {
  const zip = packSkill(continuityPackage());
  const opened = await openContinuity(zip);
  assert.equal(opened.gaps.length, 2);
  const openQ = opened.gaps.find((g) => g.kind === "open_question");
  const decision = opened.gaps.find((g) => g.kind === "decision");
  assert.ok(openQ && decision);
  assert.equal(openQ!.severity, "warn");
  assert.equal(openQ!.detail, "Should the retry backoff be exponential or fixed?");
  assert.equal(decision!.severity, "info");
  assert.equal(decision!.detail, "Use Postgres advisory locks instead of a queue.");
});

test("openContinuity: refuses a release package, never silently accepts it", async () => {
  const zip = packSkill(releasePackage());
  await assert.rejects(() => openContinuity(zip), /Not a continuity package/);
});

test("openContinuity: handles missing journey/source gracefully (proof_only-style provenance)", async () => {
  const pkg = continuityPackage({ provenance: undefined });
  const zip = packSkill(pkg);
  const opened = await openContinuity(zip);
  assert.deepEqual(opened.journey, { summary: "", open_questions: [], decisions: [] });
  assert.deepEqual(opened.gaps, []);
  assert.deepEqual(opened.agentContext, {
    host: undefined,
    provider: undefined,
    model: undefined,
    deployment: undefined,
  });
});

test("resumePreview: derives a Resume Contract 1.0 from an opened continuity package, one target per agent, host-agnostic command", async () => {
  const zip = packSkill(continuityPackage());
  const opened = await openContinuity(zip);
  const resume = resumePreview(opened);

  assert.equal(resume.version, "1.0");
  assert.equal(resume.digest, opened.digest);
  assert.equal(resume.intent, opened.intent);
  assert.deepEqual(resume.agentContext, opened.agentContext);
  assert.deepEqual(resume.gaps, opened.gaps);
  assert.deepEqual(resume.knowledge, opened.knowledge);

  assert.equal(resume.resumeTargets.length, 3);
  const agents = resume.resumeTargets.map((t) => t.agent).sort();
  assert.deepEqual(agents, ["claude", "codex", "cursor"]);
  for (const target of resume.resumeTargets) {
    assert.equal(target.command, "skill load <path> --into .");
    assert.doesNotMatch(target.command, /skillerr\.com|npx @skillerr\/add/, "must never bake in a registry-specific install command");
  }
});
