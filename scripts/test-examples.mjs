#!/usr/bin/env node
// Cross-platform replacement for the old `SKILL_HOST=x node ...` / hardcoded
// /tmp shell one-liner (broken on Windows: cmd has no env-prefix syntax and
// no /tmp). Packs every example fixture, validates the resulting .skill
// packages, and checks every example JSON file parses.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const cliPath = join(rootDir, "packages", "cli", "dist", "cli.js");
const outDir = tmpdir();

function runCli(args, env) {
  console.log(`> skill ${args.join(" ")}`);
  execFileSync(process.execPath, [cliPath, ...args], {
    cwd: rootDir,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
}

function findJsonFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...findJsonFiles(full));
    } else if (entry.endsWith(".json")) {
      results.push(full);
    }
  }
  return results;
}

console.log("Validating example JSON syntax...");
const examplesDir = join(rootDir, "examples");
const jsonFiles = findJsonFiles(examplesDir);
if (jsonFiles.length === 0) {
  throw new Error(`No example JSON files found under ${examplesDir}`);
}
for (const file of jsonFiles) {
  try {
    JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`Invalid JSON in ${file}: ${err.message}`);
  }
  console.log(`  ok: ${file}`);
}

const fixtures = [
  {
    source: join(rootDir, "examples", "knowledge-only", "recipe.json"),
    out: join(outDir, "skillerr-knowledge.skill"),
    args: ["--approve", "--profile", "continuity"],
  },
  {
    source: join(rootDir, "examples", "parameterized-integration", "recipe.json"),
    out: join(outDir, "skillerr-integration.skill"),
    args: ["--approve", "--profile", "continuity"],
  },
  {
    source: join(rootDir, "examples", "code-changing", "recipe.json"),
    out: join(outDir, "skillerr-code.skill"),
    args: ["--approve", "--profile", "continuity"],
  },
  {
    source: join(rootDir, "examples", "contract-foundation", "source.json"),
    out: join(outDir, "skillerr-contract.skill"),
    args: ["--profile", "release"],
  },
];

for (const fixture of fixtures) {
  runCli(["pack", fixture.source, ...fixture.args, "-o", fixture.out], {
    SKILL_HOST: "example-agent",
  });
  runCli(["validate", fixture.out]);
}

console.log(`\nAll ${fixtures.length} example fixtures packed + validated OK.`);
