import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ingestSkillMd } from "./ingest.js";
import { compileSkillSource } from "./compile.js";
import { buildFileMap, finalizeManifest, packSkill, unpackSkill } from "./pack.js";
import { deriveAgentSkillName, exportAgentSkillFolder } from "./export.js";

const FIXTURE = join(
  fileURLToPath(new URL("../../../examples/ingest-skill-md", import.meta.url)),
);

/** Ingest -> release-compile -> pack -> unpack, the same finalize-then-pack order `skill ingest` uses in the CLI. */
function ingestAndCompile() {
  const result = ingestSkillMd(FIXTURE, { host: "cursor", now: () => "2026-07-13T00:00:00.000Z" });
  result.contract.provenance.human_review = {
    status: "reviewed",
    actor: "unit-test",
    at: "2026-07-13T00:00:00.000Z",
    scope: ["complete contract"],
  };
  const compiled = compileSkillSource(result.source, { profile: "release" });
  compiled.files.resources = { ...compiled.files.resources, ...result.resources };
  compiled.files.assets = { ...compiled.files.assets, ...result.assets };
  const fileMap = buildFileMap(compiled.files);
  compiled.files.manifest = finalizeManifest(compiled.files.manifest, fileMap);
  const packageBytes = packSkill(compiled.files);
  return unpackSkill(packageBytes);
}

test("PART B3/B5: golden round trip, ingest -> mint-ready compile -> export-skill -> re-ingest preserves frontmatter fidelity and resources", () => {
  const unpacked = ingestAndCompile();

  const name = deriveAgentSkillName(unpacked.raw);
  assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/, "derived name must be a spec-valid slug");
  assert.ok(name.length <= 64);

  const parentDir = mkdtempSync(join(tmpdir(), "skillerr-export-"));
  const outDir = join(parentDir, name);
  try {
    const { report } = exportAgentSkillFolder(unpacked.raw, outDir);
    assert.equal(report.name, name);
    assert.equal(basename(outDir), report.name, "output dir basename must match the derived name");
    assert.equal(report.warnings.length, 0, JSON.stringify(report.warnings));
    assert.equal(report.license, true);
    assert.equal(report.compatibility, true);
    assert.equal(report.metadata_keys, 3);
    assert.equal(report.allowed_tools, 2);
    assert.equal(report.scripts, 1);
    assert.equal(report.references, 1);
    assert.equal(report.assets, 1);

    assert.ok(existsSync(join(outDir, "SKILL.md")));
    assert.ok(existsSync(join(outDir, "scripts", "lint_changelog.py")));
    assert.ok(existsSync(join(outDir, "references", "style-guide.md")));
    assert.ok(existsSync(join(outDir, "assets", "example-entry.md")));

    const skillMd = readFileSync(join(outDir, "SKILL.md"), "utf8");
    assert.match(skillMd, /^---\n/);
    assert.match(skillMd, new RegExp(`^name: ${name}$`, "m"));
    assert.match(skillMd, /^license: MIT$/m);
    assert.match(skillMd, /^allowed-tools: Bash Read$/m);
    assert.match(skillMd, /^metadata:$/m);
    assert.match(skillMd, /^ {2}internal: "true"$/m);

    // The strongest fidelity check: re-run the same ingest machinery over
    // the exported folder and confirm it reports the same fields found as
    // the original fixture did, a real round trip, not just a string match.
    const reIngested = ingestSkillMd(outDir, { host: "cursor" });
    assert.equal(reIngested.report.found.license, true);
    assert.equal(reIngested.report.found.compatibility, true);
    assert.equal(reIngested.report.found.metadata_keys, 3);
    assert.equal(reIngested.report.found.allowed_tools, 2);
    assert.equal(reIngested.report.found.scripts, 1);
    assert.equal(reIngested.report.found.references, 1);
    assert.equal(reIngested.report.found.assets, 1);
    assert.ok(reIngested.report.found.sections >= 3);
  } finally {
    rmSync(parentDir, { recursive: true, force: true });
  }
});

test("PART B3: export-skill warns (does not silently rename) when the output dir basename does not match the derived name", () => {
  const unpacked = ingestAndCompile();
  const dir = mkdtempSync(join(tmpdir(), "skillerr-export-mismatch-"));
  try {
    const outDir = join(dir, "totally-different-name");
    const { report } = exportAgentSkillFolder(unpacked.raw, outDir);
    assert.ok(report.warnings.some((w) => w.includes("does not match")));
    assert.ok(existsSync(join(outDir, "SKILL.md")), "export still writes to the exact dir given, unrenamed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PART B3: exportAgentSkillFolder throws loudly on a title that slugifies to empty, never emits an invalid name", () => {
  const unpacked = ingestAndCompile();
  unpacked.raw.manifest.title = "!!!";
  if (unpacked.raw.manifest.contract) unpacked.raw.manifest.contract.title = "!!!";
  const dir = mkdtempSync(join(tmpdir(), "skillerr-export-badtitle-"));
  try {
    assert.throws(() => exportAgentSkillFolder(unpacked.raw, join(dir, "out")), /valid Agent Skills "name"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
