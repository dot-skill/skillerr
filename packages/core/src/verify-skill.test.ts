import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ingestSkillMd } from "./ingest.js";
import { compileSkillSource, approveCompilation } from "./compile.js";
import { mintSkillPackage } from "./mint.js";
import { verifySkillFolder } from "./verify-skill.js";

const FIXTURE = join(
  fileURLToPath(new URL("../../../examples/ingest-skill-md", import.meta.url)),
);

function mintedPackageBytes(): Uint8Array {
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
  const approved = approveCompilation(compiled, { inputs: ["*"], permissions: true });
  approved.files.manifest.needs_human_review = false;
  const sealed = mintSkillPackage(approved.files, { host: "cursor" });
  return sealed.packageBytes;
}

test("PART B4: verify-skill on a plain folder with no attestation reports the folder digest honestly, without implying a check happened", () => {
  const dir = mkdtempSync(join(tmpdir(), "skillerr-verify-plain-"));
  try {
    writeFileSync(join(dir, "SKILL.md"), "---\nname: plain\ndescription: d\n---\nbody\n");
    mkdirSync(join(dir, "scripts"));
    writeFileSync(join(dir, "scripts", "run.sh"), "#!/bin/sh\necho hi\n");

    const report = verifySkillFolder(dir);
    assert.match(report.folder_digest, /^sha256:[0-9a-f]{64}$/);
    assert.equal(report.files, 2);
    assert.deepEqual(report.executable_surface, ["scripts/run.sh"]);
    assert.equal(report.attestation.found, false);
    if (!report.attestation.found) {
      assert.match(report.attestation.note, /nothing cryptographic to check/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PART B4: verify-skill finds a sibling <dir>.skill sidecar and reports its attestation integrity, distinctly from folder content match", () => {
  const parent = mkdtempSync(join(tmpdir(), "skillerr-verify-sidecar-"));
  try {
    const dir = join(parent, "changelog-writer");
    mkdirSync(dir);
    writeFileSync(join(dir, "SKILL.md"), "---\nname: changelog-writer\ndescription: d\n---\nbody\n");

    const bytes = mintedPackageBytes();
    writeFileSync(`${dir}.skill`, bytes);

    const report = verifySkillFolder(dir, {
      trustOptions: { allow_development_issuer: true, allow_self_reported: true },
    });
    assert.equal(report.attestation.found, true);
    if (report.attestation.found) {
      assert.equal(report.attestation.source, `${dir}.skill`);
      assert.equal(report.attestation.trust_state, "development");
      assert.match(report.attestation.note, /does NOT prove/);
    }
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("PART B4: verify-skill respects an explicit --attestation path over the sibling <dir>.skill convention", () => {
  const parent = mkdtempSync(join(tmpdir(), "skillerr-verify-explicit-"));
  try {
    const dir = join(parent, "some-folder");
    mkdirSync(dir);
    writeFileSync(join(dir, "SKILL.md"), "---\nname: some-folder\ndescription: d\n---\nbody\n");

    const explicitPath = join(parent, "elsewhere.skill");
    writeFileSync(explicitPath, mintedPackageBytes());

    const report = verifySkillFolder(dir, {
      attestationPath: explicitPath,
      trustOptions: { allow_development_issuer: true, allow_self_reported: true },
    });
    assert.equal(report.attestation.found, true);
    if (report.attestation.found) assert.equal(report.attestation.source, explicitPath);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("PART B4: verifySkillFolder throws for a path that isn't a folder", () => {
  const dir = mkdtempSync(join(tmpdir(), "skillerr-verify-notdir-"));
  try {
    const file = join(dir, "not-a-folder.txt");
    writeFileSync(file, "hi");
    assert.throws(() => verifySkillFolder(file), /Not a folder/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
