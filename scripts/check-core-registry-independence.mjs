#!/usr/bin/env node
/**
 * Enforces spec/CONTRACT.md's hard dependency-direction invariant:
 * skillerr-registry depends on @skillerr/core, never the reverse. Fails if
 * packages/core ever gains a dependency on the private registry product or
 * calls its API directly.
 *
 * Deliberately narrow, not a blanket "no skillerr.com string anywhere"
 * check: transparency.ts's ANCHOR_PREDICATE_TYPE
 * ("https://skillerr.com/attestations/skill/v1") is a legitimate in-toto
 * predicate-type namespace URI, the standard way that spec identifies
 * predicate shapes — it's an opaque string tag, not a live endpoint this
 * package calls, and isn't a coupling to the registry product. This script
 * only flags an actual dependency (package.json) or an actual API call
 * (a skillerr.com/api/* reference), not an identifier string.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const coreDir = join(root, "packages/core");

let failed = false;
function fail(msg) {
  console.error(`::error::${msg}`);
  failed = true;
}

// 1. packages/core/package.json must never depend on the private registry.
const pkg = JSON.parse(readFileSync(join(coreDir, "package.json"), "utf8"));
for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
  const deps = pkg[field] ?? {};
  for (const name of Object.keys(deps)) {
    if (name === "skillerr-registry" || name.includes("skillerr-registry")) {
      fail(`packages/core/package.json's "${field}" depends on "${name}" — @skillerr/core must never depend on the registry (spec/CONTRACT.md).`);
    }
  }
}

// 2. No source file may import the private registry package or call its API.
function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, files);
    else if (entry.endsWith(".ts")) files.push(full);
  }
  return files;
}

const importPattern = /from\s+["']([^"']*skillerr-registry[^"']*)["']|require\(\s*["']([^"']*skillerr-registry[^"']*)["']/;
const apiCallPattern = /skillerr\.com\/api\//;

for (const file of walk(join(coreDir, "src"))) {
  const text = readFileSync(file, "utf8");
  const rel = file.slice(root.length + 1);
  const importMatch = text.match(importPattern);
  if (importMatch) {
    fail(`${rel}: imports "${importMatch[1] ?? importMatch[2]}" — @skillerr/core must never import the registry (spec/CONTRACT.md).`);
  }
  if (apiCallPattern.test(text)) {
    fail(`${rel}: references a skillerr.com/api/* path — @skillerr/core must never call the registry's API directly. If this needs registry data, define it as an input parameter instead; the registry calls into core, not the other way around.`);
  }
}

if (failed) {
  console.error("\ncheck-core-registry-independence: FAILED, see errors above.");
  process.exit(1);
}
console.log("check-core-registry-independence: OK, @skillerr/core has no dependency on or coupling to the registry.");
