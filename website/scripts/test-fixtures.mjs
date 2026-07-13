#!/usr/bin/env node
/**
 * Validate built fixtures: inspect --trust, validate, dry-run.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const websiteRoot = resolve(__dirname, "..");
const dotSkillRoot =
  process.env.DOT_SKILL_ROOT ?? resolve(websiteRoot, "..");
const cli = join(dotSkillRoot, "packages/cli/dist/cli.js");
const fixturesDir = join(websiteRoot, "docs/public/fixtures");
const manifest = JSON.parse(
  readFileSync(join(fixturesDir, "manifest.json"), "utf8"),
);

let failed = 0;

for (const fx of manifest.fixtures) {
  const path = join(fixturesDir, `${fx.name}.skill`);
  const label = fx.name;
  try {
    execFileSync("node", [cli, "validate", path], { stdio: "pipe" });
    execFileSync("node", [cli, "inspect", path, "--trust"], { stdio: "pipe" });
    execFileSync("node", [cli, "run", path], { stdio: "pipe" });
    console.log(`OK  ${label}`);
  } catch (e) {
    failed++;
    console.error(`FAIL ${label}:`, e.stderr?.toString() || e.message);
  }
}

if (failed) {
  console.error(`${failed} fixture(s) failed`);
  process.exit(1);
}
console.log(`All ${manifest.fixtures.length} fixtures passed validate / inspect / dry-run.`);
