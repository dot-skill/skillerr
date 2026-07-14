import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assessSkillContract } from "@skillerr/protocol";
import { ingestSkillMd } from "./ingest.js";
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
