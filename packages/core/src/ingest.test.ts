import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assessSkillContract } from "@skillerr/protocol";
import { ingestSkillMd, discoverSkillMdCandidates } from "./ingest.js";
import { compileSkillSource } from "./compile.js";
import { packSkill } from "./pack.js";
import { unpackSkill } from "./pack.js";

const FIXTURE = join(
  fileURLToPath(new URL("../../../examples/ingest-skill-md", import.meta.url)),
);

test("PHASE 1: ingestSkillMd maps a real skill-creator layout into a compiling continuity draft", () => {
  const result = ingestSkillMd(FIXTURE, { host: "cursor", now: () => "2026-07-13T00:00:00.000Z" });

  assert.equal(result.source.title, "changelog-writer");
  assert.equal(result.report.found.name, true);
  assert.equal(result.report.found.description, true);
  assert.ok(result.report.found.sections >= 3, "expected multiple ## sections mapped");
  assert.equal(result.report.found.scripts, 1);
  assert.equal(result.report.found.references, 1);
  assert.equal(result.report.found.evals, 3);
  assert.ok(result.contract.triggers.status === "specified" && result.contract.triggers.items.length > 1);

  const compiled = compileSkillSource(result.source, { profile: "continuity" });
  compiled.files.resources = { ...compiled.files.resources, ...result.resources };
  compiled.files.assets = { ...compiled.files.assets, ...result.assets };
  const packageBytes = packSkill(compiled.files);

  const unpacked = unpackSkill(packageBytes);
  assert.equal(unpacked.manifest.compile_profile, "continuity");
  assert.ok(
    Object.keys(unpacked.raw.resources ?? {}).some((p) => p.startsWith("scripts/")),
    "expected the bundled script under resources/scripts/",
  );
  assert.ok(
    Object.keys(unpacked.raw.resources ?? {}).some((p) => p.startsWith("references/")),
    "expected the reference file under resources/references/",
  );
});

test("PHASE 1: the missing-report names exactly what release still needs, never fabricates completeness", () => {
  const result = ingestSkillMd(FIXTURE, { host: "cursor" });
  const continuity = assessSkillContract(result.contract, "continuity");
  assert.equal(continuity.complete, true, JSON.stringify(continuity.issues));

  const release = assessSkillContract(result.contract, "release");
  assert.equal(release.complete, false);
  // The one thing ingest can never honestly claim: that a human reviewed it.
  assert.ok(release.issues.some((i) => i.field === "provenance.human_review"));
});

test("PHASE 1: re-ingesting the same folder is deterministic", () => {
  const a = ingestSkillMd(FIXTURE, { host: "cursor", now: () => "2026-07-13T00:00:00.000Z" });
  const b = ingestSkillMd(FIXTURE, { host: "cursor", now: () => "2026-07-13T00:00:00.000Z" });
  assert.deepEqual(a.contract, b.contract);
  assert.equal(a.source.hash, b.source.hash);
  assert.equal(a.source.id, b.source.id);
});

// PHASE B-6: skill_id is a content digest (stable identity for "this
// source"), independent of when ingest ran. package_digest is NOT
// stable across real-world re-ingests of the same source, because each
// run's `created_at` is a genuine, distinct timestamp in provenance —
// that's honest provenance, not a determinism bug. Documented in
// docs/FAQ.md's "Determinism" note; this test locks in both halves of
// that claim so a future change can't silently flip either one.
test("PHASE B-6: skill_id is stable across re-ingests with different timestamps; package_digest is not", () => {
  const a = ingestSkillMd(FIXTURE, { host: "cursor", now: () => "2026-07-13T00:00:00.000Z" });
  const b = ingestSkillMd(FIXTURE, { host: "cursor", now: () => "2026-08-01T12:34:56.000Z" });
  assert.equal(a.source.id, b.source.id);

  const compiledA = compileSkillSource(a.source, { profile: "continuity" });
  const compiledB = compileSkillSource(b.source, { profile: "continuity" });
  assert.equal(compiledA.files.manifest.id, compiledB.files.manifest.id);
  assert.notEqual(compiledA.files.manifest.package_digest, compiledB.files.manifest.package_digest);
});

test("PHASE 1: passing the SKILL.md file directly (not its folder) still locates sibling scripts/references/evals", () => {
  const result = ingestSkillMd(join(FIXTURE, "SKILL.md"), { host: "cursor" });
  assert.equal(result.source.title, "changelog-writer");
  assert.equal(result.report.found.scripts, 1);
  assert.equal(result.report.found.evals, 3);
});

test("PHASE 1: scripts/references/assets/evals are all optional — a bare SKILL.md-only folder still ingests", () => {
  const dir = mkdtempSync(join(tmpdir(), "skillerr-ingest-bare-"));
  try {
    writeFileSync(
      join(dir, "SKILL.md"),
      "---\nname: bare-skill\ndescription: Use when testing the bare ingest path.\n---\n\nJust one paragraph of guidance, no headings.\n",
    );
    const result = ingestSkillMd(dir, { host: "cursor" });
    assert.equal(result.source.title, "bare-skill");
    assert.equal(result.report.found.scripts, 0);
    assert.equal(result.report.found.references, 0);
    assert.equal(result.report.found.assets, 0);
    assert.equal(result.report.found.evals, 0);
    assert.equal(Object.keys(result.resources).length, 0);
    assert.equal(Object.keys(result.assets).length, 0);
    assert.equal(result.contract.capabilities.status, "none");

    const continuity = assessSkillContract(result.contract, "continuity");
    assert.equal(continuity.complete, true, JSON.stringify(continuity.issues));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PART B1: license, compatibility, metadata, and allowed-tools frontmatter are mapped, never silently dropped", () => {
  const result = ingestSkillMd(FIXTURE, { host: "cursor" });

  assert.equal(result.source.license, "MIT");
  assert.ok(result.source.license_url?.endsWith("LICENSE"), `expected license_url to point at the bundled LICENSE, got ${result.source.license_url}`);
  assert.equal(result.report.found.license, true);
  assert.equal(result.report.found.compatibility, true);
  assert.equal(result.report.found.metadata_keys, 3);
  assert.equal(result.report.found.allowed_tools, 2);
  assert.equal(result.report.found.assets, 1);

  assert.equal(result.contract.preconditions.status, "specified");
  if (result.contract.preconditions.status === "specified") {
    assert.equal(result.contract.preconditions.items.length, 1);
    assert.equal(result.contract.preconditions.items[0]!.check, "human");
  }

  assert.equal(result.contract.permissions.status, "specified");
  if (result.contract.permissions.status === "specified") {
    assert.equal(result.contract.permissions.items.length, 2);
    for (const item of result.contract.permissions.items) {
      assert.equal(item.consent, "explicit_human", "allowed-tools must never be auto-authorized");
    }
  }

  assert.equal(result.source.extensions?.agentskills?.compatibility, "Requires read access to the repository's git history.");
  assert.deepEqual(result.source.extensions?.agentskills?.allowed_tools, ["Bash", "Read"]);
  const metadata = result.source.extensions?.agentskills?.metadata as Record<string, unknown> | undefined;
  assert.equal(metadata?.author, "skillerr-examples");
  assert.equal(metadata?.version, "1.0");
  assert.equal(metadata?.internal, "true");

  assert.ok(
    result.report.notes.some((n) => n.includes("allowed-tools")),
    "expected a note explaining the allowed-tools mapping",
  );
});

test("PART B1: nested metadata:\\n  key: value block form parses", () => {
  const dir = mkdtempSync(join(tmpdir(), "skillerr-ingest-nested-meta-"));
  try {
    writeFileSync(
      join(dir, "SKILL.md"),
      [
        "---",
        "name: nested-meta-skill",
        "description: Use when testing nested metadata parsing.",
        "metadata:",
        "  author: jane",
        "  team: platform",
        "---",
        "",
        "One paragraph of guidance.",
        "",
      ].join("\n"),
    );
    const result = ingestSkillMd(dir, { host: "cursor" });
    assert.equal(result.report.found.metadata_keys, 2);
    const metadata = result.source.extensions?.agentskills?.metadata as Record<string, unknown> | undefined;
    assert.equal(metadata?.author, "jane");
    assert.equal(metadata?.team, "platform");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PART B1: dotted metadata.key: value flat form parses into the same nested slot", () => {
  const dir = mkdtempSync(join(tmpdir(), "skillerr-ingest-dotted-meta-"));
  try {
    writeFileSync(
      join(dir, "SKILL.md"),
      [
        "---",
        "name: dotted-meta-skill",
        "description: Use when testing dotted metadata parsing.",
        "metadata.internal: true",
        "metadata.owner: platform-team",
        "---",
        "",
        "One paragraph of guidance.",
        "",
      ].join("\n"),
    );
    const result = ingestSkillMd(dir, { host: "cursor" });
    assert.equal(result.report.found.metadata_keys, 2);
    const metadata = result.source.extensions?.agentskills?.metadata as Record<string, unknown> | undefined;
    assert.equal(metadata?.internal, "true");
    assert.equal(metadata?.owner, "platform-team");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PART B1: unrecognized frontmatter keys pass through to extensions.agentskills.* verbatim, never interpreted", () => {
  const dir = mkdtempSync(join(tmpdir(), "skillerr-ingest-passthrough-"));
  try {
    writeFileSync(
      join(dir, "SKILL.md"),
      [
        "---",
        "name: passthrough-skill",
        "description: Use when testing unrecognized-key passthrough.",
        "context: fork",
        "---",
        "",
        "One paragraph of guidance.",
        "",
      ].join("\n"),
    );
    const result = ingestSkillMd(dir, { host: "cursor" });
    assert.equal(result.source.extensions?.agentskills?.context, "fork");
    assert.ok(result.report.notes.some((n) => n.includes("context")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PART B2: discoverSkillMdCandidates finds skills via a .claude-plugin manifest", () => {
  const dir = mkdtempSync(join(tmpdir(), "skillerr-discover-manifest-"));
  try {
    mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(dir, ".claude-plugin", "marketplace.json"),
      JSON.stringify({
        plugins: [{ name: "demo", source: ".", skills: ["./skills/review", "./skills/missing"] }],
      }),
    );
    mkdirSync(join(dir, "skills", "review"), { recursive: true });
    writeFileSync(join(dir, "skills", "review", "SKILL.md"), "---\nname: review\ndescription: d\n---\nbody\n");

    const candidates = discoverSkillMdCandidates(dir);
    assert.equal(candidates.length, 1, "the manifest's second entry has no SKILL.md and must not be listed");
    assert.equal(candidates[0]!.source, "manifest");
    assert.ok(candidates[0]!.path.endsWith(join("skills", "review", "SKILL.md")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PART B2: discoverSkillMdCandidates falls back to a flat skills/<name>/SKILL.md catalog", () => {
  const dir = mkdtempSync(join(tmpdir(), "skillerr-discover-catalog-"));
  try {
    mkdirSync(join(dir, "skills", "alpha"), { recursive: true });
    mkdirSync(join(dir, "skills", "beta"), { recursive: true });
    writeFileSync(join(dir, "skills", "alpha", "SKILL.md"), "---\nname: alpha\ndescription: d\n---\nbody\n");
    writeFileSync(join(dir, "skills", "beta", "SKILL.md"), "---\nname: beta\ndescription: d\n---\nbody\n");

    const candidates = discoverSkillMdCandidates(dir);
    assert.equal(candidates.length, 2);
    assert.ok(candidates.every((c) => c.source === "catalog"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PART B2: discoverSkillMdCandidates returns empty (not throw) for a folder with neither convention", () => {
  const dir = mkdtempSync(join(tmpdir(), "skillerr-discover-empty-"));
  try {
    assert.deepEqual(discoverSkillMdCandidates(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
