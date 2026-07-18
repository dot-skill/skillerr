#!/usr/bin/env node
/**
 * Fails loudly if a hardcoded "reference packages X.Y.Z" / "@ **X.Y.Z**"
 * mention in the docs has drifted from packages/skillerr/package.json, the
 * single source of truth for the package/CLI version (see docs/ROADMAP.md's
 * own "if this line ever drifts from that file, the file wins" note, which
 * this script now actually enforces instead of relying on a human to
 * notice).
 *
 * The protocol spec version (docs/PROTOCOL.md's own "1.0.0 (Stable)") is a
 * deliberately separate axis from the package/CLI version, see
 * docs/PROTOCOL.md's compatibility table, this script never treats a
 * protocol-version mention as a package-version drift. But a doc that
 * mentions the protocol version *at all* and never once mentions the
 * current package version anywhere in the same file reads as stale to a
 * skimming reader, even though the protocol number is technically correct,
 * exactly the bug found in docs/PROTOCOL.md's opening "Status:" line and
 * docs/FAQ.md's "Is this ready to use?" answer (both said only "1.0.0
 * (Stable)", nothing else, on a project already several package releases
 * past that). Every doc below that mentions the protocol version must also
 * mention the current package version somewhere in the file now.
 *
 * Also checks that README.md's test-count badge and prose agree with each
 * other (the two have drifted apart before, see docs/ROADMAP.md's own
 * changelog note about a badge stuck at 148 while prose said 165).
 *
 * The README.md <-> packages/skillerr/README.md sync itself is checked
 * separately in .github/workflows/ci.yml (runs sync-npm-readme.mjs, then
 * `git diff --exit-code`), not duplicated here.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgVersion = JSON.parse(
  readFileSync(join(root, "packages/skillerr/package.json"), "utf8"),
).version;

let failed = false;
function fail(msg) {
  console.error(`::error::${msg}`);
  failed = true;
}

const versionChecks = [
  { file: "README.md", pattern: /`skillerr` @ \*\*([\d.]+)\*\*/ },
  { file: "docs/ROADMAP.md", pattern: /reference packages \*\*([\d.]+)\*\*/ },
  { file: "docs/WHAT-IS-VERIFIABLE.md", pattern: /reference packages ([\d.]+):/ },
];
for (const { file, pattern } of versionChecks) {
  const text = readFileSync(join(root, file), "utf8");
  const m = text.match(pattern);
  if (!m) {
    fail(
      `${file}: expected a package-version mention matching ${pattern} but found none. ` +
        `If the wording changed intentionally, update this script's pattern too.`,
    );
    continue;
  }
  if (m[1] !== pkgVersion) {
    fail(
      `${file}: mentions package/CLI version ${m[1]}, but packages/skillerr/package.json is ${pkgVersion}. ` +
        `Update ${file} as part of the lockstep release checklist (docs/ROADMAP.md, CHANGELOG.md, etc).`,
    );
  }
}

const protocolVersionDocs = [
  "README.md",
  "GOVERNANCE.md",
  "CONTRIBUTING.md",
  "docs/PROTOCOL.md",
  "docs/FAQ.md",
  "docs/ROADMAP.md",
  "docs/WHAT-IS-VERIFIABLE.md",
];
for (const file of protocolVersionDocs) {
  const text = readFileSync(join(root, file), "utf8");
  if (!/1\.0(\.0)? \(Stable\)/.test(text)) continue;
  if (!text.includes(pkgVersion)) {
    fail(
      `${file}: mentions the protocol version ("1.0.0 (Stable)") but never mentions the current package version (${pkgVersion}) anywhere in the file. ` +
        `A protocol-version-only mention reads as stale even when it's technically correct. Pair it with the current package version, e.g. "reference packages ${pkgVersion}".`,
    );
  }
}

{
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const badge = readme.match(/tests-(\d+)%20passing/);
  const prose = readme.match(/backed by (\d+) tests passing/);
  if (!badge || !prose) {
    fail("README.md: could not find both the test-count badge and the 'N tests passing' prose sentence to cross-check.");
  } else if (badge[1] !== prose[1]) {
    fail(
      `README.md: test badge says ${badge[1]} but the prose says ${prose[1]} tests passing, they must match. ` +
        `Run the full suite and update both.`,
    );
  }
}

if (failed) {
  console.error("\ncheck-doc-versions: FAILED, see errors above.");
  process.exit(1);
}
console.log(
  `check-doc-versions: OK, all hardcoded package-version mentions match packages/skillerr/package.json (${pkgVersion}), test-count badge/prose agree.`,
);
