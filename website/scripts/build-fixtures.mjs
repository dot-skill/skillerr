#!/usr/bin/env node
/**
 * Build .skill fixtures from dot-skill examples into docs/public/fixtures/.
 * Requires dot-skill CLI built at ../../dot-skill or DOT_SKILL_ROOT env.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const websiteRoot = resolve(__dirname, "..");
const dotSkillRoot =
  process.env.DOT_SKILL_ROOT ?? resolve(websiteRoot, "..");
const cli = join(dotSkillRoot, "packages/cli/dist/cli.js");
const examples = join(dotSkillRoot, "examples");
const outDir = join(websiteRoot, "docs/public/fixtures");

const specs = [
  {
    name: "knowledge-only",
    src: join(examples, "knowledge-only/recipe.json"),
    args: ["--approve", "--profile", "continuity"],
  },
  {
    name: "parameterized-integration",
    src: join(examples, "parameterized-integration/recipe.json"),
    args: ["--approve", "--profile", "continuity"],
  },
  {
    name: "code-changing",
    src: join(examples, "code-changing/recipe.json"),
    args: ["--approve", "--profile", "continuity"],
  },
  {
    name: "contract-foundation",
    src: join(examples, "contract-foundation/source.json"),
    args: ["--profile", "release"],
  },
];

mkdirSync(outDir, { recursive: true });

const manifest = { built_at: new Date().toISOString(), fixtures: [] };
const env = { ...process.env, SKILL_HOST: "example-agent" };

for (const spec of specs) {
  const out = join(outDir, `${spec.name}.skill`);
  const json = execFileSync(
    "node",
    [cli, "pack", spec.src, ...spec.args, "-o", out],
    { env, encoding: "utf8" },
  );
  const meta = JSON.parse(json);
  manifest.fixtures.push({
    name: spec.name,
    file: `/fixtures/${spec.name}.skill`,
    skill_id: meta.skill_id,
    package_digest: meta.package_digest,
    completeness: meta.completeness,
  });
  console.log(`built ${spec.name}.skill (${meta.package_digest.slice(0, 19)}…)`);
}

writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`manifest → ${join(outDir, "manifest.json")}`);
