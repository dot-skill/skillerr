#!/usr/bin/env node
/**
 * skill — Open .skill Protocol CLI
 *
 * AI agents create; humans review. Continuity drafts for handoff; release for mint.
 *
 *   npm i -g skillerr                # or: npx -y skillerr --help
 *   export SKILL_HOST=cursor
 *   skill init --title "…"
 *   skill propose --json '[…]'
 *   skill journey --summary "…"
 *   skill checkpoint                 # continuity draft (partial OK)
 *   skill compile -m "…" --mint      # release (complete or refuse)
 *   skill inspect ./file.skill       # ingest: inspect before run
 *   skill load ./file.skill          # resume handoff in another AI
 */

import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  inspectSkill,
  inspectTrustView,
  migrateLegacySkill,
  toSkillMdAdapter,
  unpackSkill,
  validatePackageBytes,
  mintSkillPackage,
  verifyMintTrust,
  compileRecipeToSkill,
  compileSkillSource,
  approveCompilation,
  redactSecrets,
  CompileRefusalError,
  createEd25519Signer,
  derivePublicKeyPem,
  loadTrustStore,
  defaultTrustStorePath,
  loadOrCreateDefaultIssuer,
  signerFromIssuer,
  type IssuerSigner,
  type ResolvedIssuer,
  ingestSkillMd,
  discoverSkillMdCandidates,
  exportAgentSkillFolder,
  deriveAgentSkillName,
  resolveAgentSkillsDir,
  verifySkillFolder,
  packSkill,
  buildFileMap,
  finalizeManifest,
  runEvalCase,
  buildBenchmarkReport,
  addPermanenceAnchor,
  anchorToRekor,
  verifyRekorAnchor,
  checkRekorOnline,
  rekorSearchUrl,
  mintKeylessAnchor,
  verifyKeylessAnchor,
  assessClaims,
  validateContractSchema,
  scrub,
  type ScrubCustomRule,
  captureSession,
  openContinuity,
  resumePreview,
  renderResumeContract,
  seal,
  type CaptureContext,
} from "@skillerr/core";
import type { AnchorVerification, KeylessVerification, AnchorSubject } from "@skillerr/core";
import type { GradeOverride } from "@skillerr/core";
import { buildSkillAssessment } from "./score-adapter.js";
import { runSkillArchive } from "@skillerr/runtime";
import { lookup, list, verify as registryVerify, publish as registryPublish } from "@skillerr/registry";
import type { Recipe, SectionType, Skill, SkillContract, SkillSource } from "@skillerr/protocol";
import {
  agentCreateGuide,
  assessSkillContract,
  explainContractAssessment,
  extractSkillCandidates,
  formatAgentGuide,
  isValidAgentHost,
  scaffoldSkillContract,
  detectAgentRuntimeMarkers,
} from "@skillerr/protocol";
import {
  initWorkspace,
  requireWorkspace,
  proposeSection,
  proposeMany,
  stage,
  unstage,
  status,
  compileWorkspace,
  checkpoint,
  discardSection,
  loadHead,
  loadSkillHandoff,
  materializeSkillIntoWorkspace,
  findWorkspaceRoot,
  loadWorkspaceContract,
  saveWorkspaceContract,
  setJourney,
  requireAgentHost,
  WORKSPACE_DIR,
  listSections,
  loadConfig,
} from "@skillerr/workspace";

function loadPackageVersion(): string {
  const metadata = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version?: unknown };
  if (typeof metadata.version !== "string" || metadata.version.length === 0) {
    throw new Error("Invalid @skillerr/cli package version metadata");
  }
  return metadata.version;
}

const VERSION = loadPackageVersion();

/**
 * ASCII rendition of the skillerr mark (scroll + rising wave) for terminal
 * contexts, since the real SVG/PNG mark (assets/skillerr-mark.svg) can't
 * render there. Only shown on --help/bare invocation, not on every command
 * — this CLI's primary consumer is an agent piping/parsing output, and only
 * printed when stdout is a real TTY with color support (respects NO_COLOR),
 * so it never pollutes scripted or redirected output.
 */
function banner(): string {
  if (!process.stdout.isTTY || process.env.NO_COLOR) return "";
  const teal = "\x1b[36m";
  const reset = "\x1b[0m";
  return `${teal}     /\\  /\\  /\\
    /  \\/  \\/  \\
   /____________\\${reset}
`;
}

function usage(exitCode = 1): never {
  console.log(`${banner()}skill — Open .skill Protocol CLI v${VERSION}

Easily create, inspect, and run portable .skill packages.
Agents create; humans approve releases.

Create:
  skill init [--title name]
  skill status                         Completeness + staged sections
  skill contract-init [--force]        Scaffold .skill/contract.json to author
  skill propose --title T --body B     Requires SKILL_HOST
  skill propose --json '[...]'
  skill journey --summary "…"          Redacted human+AI journey (no secrets)
  skill add [id...]                    Stage (default: ALL)
  skill unstage [id...] | skill review | skill discard <id>
  skill checkpoint [-m msg]            Continuity handoff (partial OK)
  skill capture [-o file.skill] [-m msg] [--context file.json|-]
                                       [--from claude-code|codex|cursor]
                                       [--session <id>]
                                       Capture the current session into a
                                       sealed continuity .skill: git working
                                       set (branch, base/HEAD, redacted diff,
                                       changed files, recent commits, untracked)
                                       plus optional agent context and optional
                                       inference-free SessionSource enrichment
                                       (--from/--session; no model call). Env
                                       capture always runs — a dirty repo is
                                       never empty. Secrets scrubbed; code and
                                       file list kept. Not minted. See
                                       docs/CONTINUITY.md.
  skill resume <file.skill> [--json]   Print a paste-ready resume briefing
                                       (Resume Contract 1.0) from a continuity
                                       .skill: intent, working-set summary,
                                       changed files, plan, next steps,
                                       decisions, open threads, knowledge. Refuses
                                       a release/catalog package. --json emits the
                                       structured contract instead of the briefing.
  skill compile -m "msg" [--approve] [--mint] [--profile release|continuity]
                                       Release refuses if incomplete
  skill load <file.skill> [--into dir] [--host name] [--force]
                                       Resume a .skill. Inside a workspace (or
                                       with --into <dir>) it MATERIALIZES the
                                       package into an editable workspace:
                                       stages its knowledge as sections and
                                       writes .skill/contract.json, so an
                                       ingested continuity package can be taken
                                       forward to a signed release (record
                                       provenance.human_review in the contract,
                                       then skill compile --profile release
                                       --mint). Never fabricates human review.
                                       With no workspace and no --into, it's a
                                       read-only preview (nothing written).
  skill publish [file.skill] [--host name] [--rekor-url <url>] [--keyless]
                                       Seal a release AND publish a public,
                                       independently-checkable provenance
                                       record. WHAT ACTUALLY GOES PUBLIC: only
                                       skill_id, skill_version, issuer_class,
                                       and two SHA-256 digests (a Sigstore
                                       Rekor transparency-log entry, RFC 0007).
                                       NEVER published: the .skill file itself,
                                       its title, intent, knowledge sections,
                                       journey, assets, or any other content.
                                       Nothing is uploaded except that one
                                       small, opaque JSON record; the package
                                       stays local, share it yourself if you
                                       want to. That record IS permanent and
                                       world-readable once logged (anyone can
                                       later confirm skill_id/digest pairs
                                       existed), so still don't run this on a
                                       skill_id you want to keep unlisted, but
                                       the record itself carries no skill
                                       content. Zero setup: a per-user signing
                                       key is auto-generated on first use (the
                                       public log needs a key but NO login).
                                       This is a public provenance anchor, NOT
                                       a marketplace. --no-transparency seals
                                       without anchoring, publishing nothing.
                                       See docs/TRANSPARENCY.md
  skill mint [file.skill] [--host name] [--signer-key <pem>] [--key-id id]
             [--transparency] [--rekor-url <url>] [--keyless] [--fulcio-url <url>]
                                       Seal release (host required). No file arg
                                       uses the current workspace's last compile;
                                       an explicit file works standalone, same as
                                       inspect/validate. Default seal is public-dev
                                       HMAC, trust_state=development: real,
                                       verifiable cryptography, but the signing
                                       key is public (bundled with every
                                       install), so it proves structural
                                       sealing only, never a specific issuer's
                                       identity. Pass --signer-key for a
                                       configured Ed25519 issuer seal
                                       (verified_issuer-eligible, a private key
                                       only you hold), see skill keygen and
                                       docs/KEY-CEREMONY.md.
                                       --transparency anchors the sealed digest
                                       to a public Rekor transparency log and
                                       prints a search.sigstore.dev link
                                       (independently checkable, not just this
                                       tool's word). Publishes only skill_id,
                                       skill_version, issuer_class, and two
                                       SHA-256 digests, never the package's
                                       content, see skill publish above for the
                                       exact boundary. Needs a signing key but
                                       NO login: if none is configured, a
                                       per-user key is auto-generated on first
                                       use (same as skill publish). Default log
                                       is the public rekor.sigstore.dev,
                                       PERMANENT and WORLD-READABLE once
                                       logged.
                                       --keyless adds a second, independent
                                       anchor via Fulcio + Rekor, bound to your
                                       OIDC identity instead of a local key.
                                       Same publish boundary as above (no
                                       content, ever). This one DOES need an
                                       ambient OIDC token (CI, e.g. GitHub
                                       Actions id-token: write); it fails
                                       closed with no local login yet.
  skill keygen [-o dir] [--key-id id]  With no -o: provision your default
                                       per-user issuer key (~/.skillerr/
                                       issuer-key.pem) and pin its public key in
                                       your own trust store, so skill publish /
                                       mint --transparency sign with it. With
                                       -o <dir>: write a named production keypair
                                       you manage yourself (docs/KEY-CEREMONY.md).

Multi-skill identify:
  skill agent-guide [--json]           Exact create/identify protocol steps
  skill extract <journey.json> [-o dir] [--profile release|continuity]
                                       Candidate SkillContract/source scaffolds
  skill segment …                      Alias of extract

Ingest / run:
  skill ingest <path> [-o out.skill] [--host $SKILL_HOST]
                                       Import a SKILL.md or skill-creator-style
                                       folder into a continuity .skill (never
                                       fabricates release completeness — prints
                                       exactly what still needs authoring).
                                       Reads license/compatibility/metadata/
                                       allowed-tools frontmatter, never auto-
                                       authorizing allowed-tools. If <path> has
                                       no direct SKILL.md but a plugin manifest
                                       (.claude-plugin/marketplace.json or
                                       plugin.json) or a skills/<name>/ catalog,
                                       lists candidates instead of failing.
  skill export-skill <file.skill> -o <dir> [--agent claude|cursor|<host>]
                                       Reverse of ingest: materializes a spec-
                                       valid Agent Skills folder (SKILL.md +
                                       scripts/references/assets) from a sealed
                                       .skill. --agent computes the standard
                                       install dir (e.g. .claude/skills/<name>/)
                                       automatically. Validates with skills-ref
                                       validate if installed, otherwise enforces
                                       name/description constraints internally.
  skill verify-skill <dir> [--attestation <file.skill>] [--trust-store <path>]
                                       Check a plain (unsealed) Agent Skills
                                       folder: reports a content digest and
                                       flags scripts/* as executable surface.
                                       If a sidecar <dir>.skill (or
                                       --attestation) exists, also verifies
                                       ITS attestation integrity, this does
                                       not prove the folder's current files
                                       match the sealed package byte-for-byte,
                                       see the report's own note. With no
                                       attestation at all, says so honestly:
                                       nothing cryptographic to check.
  skill eval <workspace|file.skill> [--host] [--responses f.json]
             [--grade f.json] [--usage f.json] [-o benchmark.json] [--attach]
                                       Run contract.evals, grade what's
                                       machine-checkable, leave the rest
                                       pending_human (never a fabricated
                                       pass). --attach seals it into the
                                       next compile's provenance/benchmark.json
  skill score <file.skill> [--profile release|continuity] [--emit] [-o out]
                                       Maps provenance/benchmark.json into
                                       @skillerr/skill-score's input and
                                       prints score+confidence+coverage.
                                       Falls back to writing assessment.json
                                       if the (optional) scorer isn't
                                       installed. --emit seals a sealed
                                       provenance/score.json copy.
  skill inspect <file.skill> [--trust] [--trust-store <path>] [--claims]
                                       TrustView (no compile / no model body)
                                       --claims (with --trust) adds a claims
                                       block splitting every field into two
                                       separate arrays — verified (crypto-
                                       checked) and self_reported (env/signer-
                                       asserted, never independently checked)
                                       — so nothing can structurally present a
                                       self-reported field as verified. Offline
                                       only: any transparency_log/keyless_identity
                                       anchor is not re-verified here, see
                                       skill verify-trust --claims for that.
  skill validate <file.skill>          Structure + hash integrity
  skill scrub <path|-> [--secrets-from f...] [--custom rules.json]
              [--mode auto|report-only] [--report out.json]
              [--entropy n] [--strict]
                                       Deterministic, non-AI secret scrubber
                                       (docs/SCRUBBING.md). <path> may be a
                                       file, "-" for stdin, or a workspace
                                       directory (scrubs staged sections +
                                       journey as one report, read-only:
                                       never rewrites workspace files).
                                       Prints a reproducible RedactionReport
                                       (same rules_digest + input always
                                       yields the same output). Known-format
                                       vendor keys are auto-redacted; only
                                       high-entropy strings are flagged
                                       needs_review, never auto-removed.
                                       --secrets-from opts into exact-match
                                       redaction against real secret values
                                       loaded from those files (.env, AWS/SSH
                                       credentials, etc.) — only the matched
                                       KEY NAME is ever reported, never the
                                       value. --mode report-only finds
                                       without rewriting. --strict exits 2 if
                                       any needs_review finding remains.
                                       compile/checkpoint/pack already run
                                       this automatically and seal the result
                                       to provenance/redaction.json.
  skill unpack <file.skill>
  skill verify-trust <file.skill> [--profile minted] [--allow-development-issuer]
                     [--allow-self-reported] [--trust-store <path>] [--online]
                     [--claims]
                                       Default trust store: ~/.skillerr/trust-store.json
                                       If the package has a transparency_log anchor,
                                       verifies its Rekor inclusion proof offline
                                       (no network) against the pinned issuer key,
                                       and (if verified, and logged to the public
                                       instance) prints a search.sigstore.dev link
                                       so you can check the same entry yourself.
                                       A keyless_identity anchor (see --keyless
                                       under skill mint) is verified the same
                                       way, but against Fulcio's CA instead of a
                                       pinned key, and reports owner_identity —
                                       always re-derived from the certificate
                                       during this check, never just echoed from
                                       the package's own claim.
                                       --online additionally re-fetches the entry
                                       live from Rekor as an extra check
                                       --claims adds the same verified/self_reported
                                       split as skill inspect --trust --claims,
                                       here including anchor verification results
  skill run <file.skill> [--mode execute] [--allow-untrusted]
                                       Dry-run by default; execute refuses
                                       unsigned/dev seals without --allow-untrusted
  skill pack <source.json> [-o out.skill] [--approve] [--profile release]
  skill contract-template              1.0 authoring contract scaffold
  skill contract-check <contract.json> Completeness + fixes
  skill registry list|lookup <digest>  Optional local transparency log

Env:
  SKILL_HOST (required to create)   SKILL_PROVIDER  SKILL_MODEL
  SKILL_DEPLOYMENT  SKILL_ENDPOINT  SKILL_ACTOR
  SKILL_AGENT_RUNTIME  SKILL_AGENT_VERSION  SKILL_SESSION_ID
  SKILL_AGENT_INVOCATION               Agent runtime marker (anti env-only spoof)
  SKILL_INPUT_TOKENS  SKILL_OUTPUT_TOKENS

Notes:
  SKILL_HOST alone never yields verified_issuer trust. Public-dev HMAC is
  development-only. human/cli/shell/manual hosts are denylisted for mint.

Install:  npm i -g skillerr   →  skill --help
Docs:     https://www.skillerr.com/docs/
`);
  process.exit(exitCode);
}

function flag(args: string[], name: string): boolean {
  return args.includes(name);
}

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Collects every occurrence of a repeatable flag, e.g. --secrets-from a --secrets-from b. */
function optAll(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name && i + 1 < args.length) values.push(args[i + 1]!);
  }
  return values;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/** True when a real agent runtime is attested (session id or runtime markers), not just SKILL_HOST. */
function hasAgentEvidence(): boolean {
  return (
    !!process.env.SKILL_SESSION_ID?.trim() || detectAgentRuntimeMarkers().length > 0
  );
}

interface ResolvedMintSigner {
  signer?: IssuerSigner;
  signerKeyPem?: string;
  /** Set when a key was auto-provisioned/reused, for a loud, honest notice in output. */
  issuer_key?: {
    key_id: string;
    key_path: string;
    created: boolean;
    pinned: boolean;
    note: string;
  };
}

/**
 * Resolve the signing key for a mint/publish.
 * - `--signer-key <pem>` always wins (explicit configured issuer).
 * - Otherwise, only when a key is actually required (transparency/publish),
 *   use the per-user default issuer key, creating it on first use. The public
 *   Rekor log needs a key but no login, so this is enough to produce a public
 *   URL with zero setup.
 * - Otherwise (plain `skill mint` with no key): no signer, the unchanged
 *   public-dev HMAC path (development trust). Kept identical so plain mint's
 *   behavior and tests are untouched.
 */
async function resolveMintSigner(
  rest: string[],
  opts: { requireKey: boolean },
): Promise<ResolvedMintSigner> {
  const signerKeyPath = opt(rest, "--signer-key");
  if (signerKeyPath) {
    const signerKeyPem = await readFile(resolve(signerKeyPath), "utf8");
    return {
      signer: createEd25519Signer(signerKeyPem, opt(rest, "--key-id") ?? "configured-issuer"),
      signerKeyPem,
    };
  }
  if (opts.requireKey) {
    const issuer: ResolvedIssuer = loadOrCreateDefaultIssuer();
    return {
      signer: signerFromIssuer(issuer),
      signerKeyPem: issuer.private_key_pem,
      issuer_key: {
        key_id: issuer.key_id,
        key_path: issuer.key_path,
        created: issuer.created,
        pinned: issuer.pinned,
        note: issuer.created
          ? `No signing key was configured, so a per-user skillerr issuer key was generated at ${issuer.key_path} and pinned in your own trust store. It signs your mints and public anchors. To let others verify you as verified_issuer, share this key id (${issuer.key_id}) and its public key so they can pin it. Keep the private key file secret.`
          : `Using your existing skillerr issuer key (${issuer.key_id}) at ${issuer.key_path}.`,
      },
    };
  }
  return {};
}

/**
 * Mint `rawPkg` and, if requested, anchor it to a public/keyless transparency
 * log. Shared by `skill mint` and `skill publish`. Returns the (possibly
 * anchored) bytes plus a structured result the caller renders.
 */
async function mintAndAnchor(
  rawPkg: import("@skillerr/core").UnpackResult["raw"],
  opts: {
    host: string;
    signer?: IssuerSigner;
    signerKeyPem?: string;
    transparency: boolean;
    keyless: boolean;
    rekorUrl?: string;
    fulcioUrl?: string;
  },
): Promise<{
  packageBytes: Uint8Array;
  mint_status?: string;
  content_id?: string;
  package_digest: string;
  generation_usage?: unknown;
  transparency?: Record<string, unknown>;
  keyless?: Record<string, unknown>;
}> {
  const { signer } = opts;
  // A configured/auto key earns verified_issuer only with real agent-runtime
  // evidence; without it we bind self_reported rather than throwing, so the
  // public anchor still works and the seal stays honest about the host claim.
  const evidence = hasAgentEvidence();
  const { packageBytes: mintedBytes, files, attestation } = mintSkillPackage(rawPkg, {
    host: opts.host,
    provider: process.env.SKILL_PROVIDER,
    model: process.env.SKILL_MODEL,
    deployment:
      (process.env.SKILL_DEPLOYMENT as "local" | "hosted" | "hybrid" | "unknown" | undefined) ??
      "unknown",
    endpoint: process.env.SKILL_ENDPOINT ? redactSecrets(process.env.SKILL_ENDPOINT) : undefined,
    agent_runtime: process.env.SKILL_AGENT_RUNTIME ?? "@skillerr/cli",
    agent_version:
      process.env.SKILL_AGENT_VERSION ?? (process.env.SKILL_AGENT_RUNTIME ? "unknown" : VERSION),
    signer,
    host_claim_binding: signer ? (evidence ? "verified_issuer" : "self_reported") : undefined,
    agent_runtime_evidence: signer ? { session_id: process.env.SKILL_SESSION_ID } : undefined,
  });
  let packageBytes = mintedBytes;
  const anchorSubject: AnchorSubject = {
    skill_id: files.manifest.id,
    skill_version: files.manifest.version,
    package_digest: files.manifest.package_digest,
    issuer_class: attestation.issuer_class,
  };

  let transparency: Record<string, unknown> | undefined;
  if (opts.transparency) {
    if (!signer) {
      transparency = {
        ok: false,
        error: "transparency anchoring needs a signing key, none was resolved",
      };
    } else {
      try {
        const publicKeyPem = derivePublicKeyPem(opts.signerKeyPem!);
        const { anchor, log_index } = await anchorToRekor(
          attestation.sealed_manifest_digest,
          signer,
          publicKeyPem,
          anchorSubject,
          { rekorUrl: opts.rekorUrl },
        );
        packageBytes = addPermanenceAnchor(packageBytes, {
          ...anchor,
          package_digest: files.manifest.package_digest,
        });
        transparency = {
          ok: true,
          located_at: anchor.located_at,
          anchored_at: anchor.anchored_at,
          log_index,
          rekor_url: rekorSearchUrl(anchor, log_index),
        };
      } catch (e) {
        // Anchoring is additive: a network/Rekor failure never discards an
        // already-valid mint, it's reported honestly.
        transparency = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
  }

  let keyless: Record<string, unknown> | undefined;
  if (opts.keyless) {
    try {
      const { anchor, log_index, owner_identity } = await mintKeylessAnchor(
        attestation.sealed_manifest_digest,
        anchorSubject,
        { rekorUrl: opts.rekorUrl, fulcioUrl: opts.fulcioUrl },
      );
      packageBytes = addPermanenceAnchor(packageBytes, {
        ...anchor,
        package_digest: files.manifest.package_digest,
      });
      keyless = {
        ok: true,
        owner_identity,
        located_at: anchor.located_at,
        anchored_at: anchor.anchored_at,
        log_index,
        rekor_url: rekorSearchUrl(anchor, log_index),
      };
    } catch (e) {
      keyless = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  return {
    packageBytes,
    mint_status: files.manifest.mint?.mint_status,
    content_id: files.manifest.mint?.content_id,
    package_digest: files.manifest.package_digest,
    generation_usage: attestation.generation_usage,
    ...(transparency ? { transparency } : {}),
    ...(keyless ? { keyless } : {}),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const rest = argv.slice(1);
  if (!cmd || cmd === "-h" || cmd === "--help") usage(0);
  if (cmd === "-V" || cmd === "--version") {
    console.log(VERSION);
    return;
  }
  // `skill <cmd> --help` must print help, not treat `--help` as a file arg or
  // trip over requireWorkspace() first. Per-command help isn't structured, so
  // the full usage is the honest answer.
  if (rest.includes("-h") || rest.includes("--help")) usage(0);

  switch (cmd) {
    case "agent-guide": {
      if (flag(rest, "--json")) {
        // skillerr_cli_version is added here, not inside agentCreateGuide()
        // itself: @skillerr/protocol has no dependency on (and shouldn't
        // hardcode) the skillerr CLI package's own version, only this CLI
        // caller knows it.
        console.log(JSON.stringify({ ...agentCreateGuide(), skillerr_cli_version: VERSION }, null, 2));
      } else {
        console.log(formatAgentGuide(undefined, VERSION));
      }
      break;
    }
    case "extract":
    case "segment": {
      const file = rest.find((a) => !a.startsWith("-"));
      if (!file) {
        console.error(
          "Usage: skill extract <journey.json> [-o dir] [--profile release|continuity]\n" +
            "       journey.json: { summary, candidates|topics: [...] }\n" +
            "       See: skill agent-guide",
        );
        process.exit(2);
      }
      const profile = (opt(rest, "--profile") as "release" | "continuity") ?? "release";
      const outDir = opt(rest, "-o") ?? opt(rest, "--out");
      const raw = JSON.parse(await readFile(resolve(file!), "utf8")) as unknown;
      const report = extractSkillCandidates(raw, {
        profile,
        host: process.env.SKILL_HOST,
      });
      if (outDir) {
        const root = resolve(outDir);
        await mkdir(root, { recursive: true });
        await writeFile(join(root, "extraction.json"), `${JSON.stringify(report, null, 2)}\n`);
        for (const scaffold of report.scaffolds) {
          const dir = join(root, "candidates", scaffold.workspace_slug);
          await mkdir(dir, { recursive: true });
          await writeFile(
            join(dir, "contract.json"),
            `${JSON.stringify(scaffold.contract_scaffold, null, 2)}\n`,
          );
          await writeFile(
            join(dir, "source.json"),
            `${JSON.stringify(scaffold.source_scaffold, null, 2)}\n`,
          );
          await writeFile(
            join(dir, "assessment.json"),
            `${JSON.stringify(
              {
                candidate: scaffold.candidate,
                missing: scaffold.missing,
                next_steps: scaffold.next_steps,
              },
              null,
              2,
            )}\n`,
          );
        }
      }
      console.log(
        JSON.stringify(
          {
            ok: true,
            written: outDir ? resolve(outDir) : null,
            ...report,
            note:
              "Scaffolds are intentionally incomplete. Complete each SkillContract, one workspace per candidate, then contract-check / status before release compile.",
          },
          null,
          2,
        ),
      );
      // Non-zero if any candidate is incomplete (expected for fresh extract).
      process.exit(report.scaffolds.every((s) => s.candidate.assessment.complete) ? 0 : 2);
      break;
    }
    case "contract-template": {
      console.log(JSON.stringify(scaffoldSkillContract(), null, 2));
      break;
    }
    case "contract-init": {
      const root = requireWorkspace();
      const existing = await loadWorkspaceContract(root);
      if ((existing.contract || existing.error) && !flag(rest, "--force")) {
        console.error(
          existing.error
            ? `.skill/contract.json exists but is unusable: ${existing.error}\nRe-run with --force to overwrite.`
            : ".skill/contract.json already exists. Re-run with --force to overwrite.",
        );
        process.exit(2);
      }
      // Scaffold is deliberately incomplete (placeholder values fail assessment
      // on purpose) — written as-is so the agent fills it in, then contract-check.
      await saveWorkspaceContract(root, scaffoldSkillContract() as unknown as SkillContract);
      console.log(
        JSON.stringify(
          {
            ok: true,
            path: ".skill/contract.json",
            hint: "Fill in every declaration, then `skill contract-check .skill/contract.json` before compiling.",
          },
          null,
          2,
        ),
      );
      break;
    }
    case "contract-check": {
      const file = rest[0];
      if (!file) usage();
      const profile = (opt(rest, "--profile") as "release" | "continuity") ?? "release";
      const parsed = JSON.parse(await readFile(resolve(file!), "utf8")) as
        | SkillSource
        | unknown;
      const contract =
        parsed && typeof parsed === "object" && "kind" in parsed && parsed.kind === "skill_source"
          ? (parsed as SkillSource).contract
          : parsed;
      const assessment = assessSkillContract(contract, profile);
      // assessSkillContract's hand-rolled checks (required keys per item,
      // cross-field rules) never ran actual JSON Schema validation, so this
      // command reported "complete" on schema-invalid contracts (bad enums,
      // wrong types) that only failed once packed and validated by
      // validatePackageBytes at mint time, far too late for an authoring
      // agent's fast feedback loop. Reported separately, not merged into
      // assessment.issues: ContractIssue's code/field are closed unions
      // that don't fit ajv's arbitrary schema paths.
      const schema_issues = validateContractSchema(contract);
      console.log(
        JSON.stringify(
          {
            assessment,
            schema_issues,
            explanation: explainContractAssessment(assessment),
          },
          null,
          2,
        ),
      );
      process.exit(assessment.complete && schema_issues.length === 0 ? 0 : 2);
      break;
    }
    case "init": {
      const title = opt(rest, "--title");
      const { root, created } = await initWorkspace(process.cwd(), { title });
      console.log(
        JSON.stringify(
          {
            ok: true,
            created,
            root,
            hint: created
              ? "Set SKILL_HOST, then: skill propose … → skill checkpoint | skill compile -m \"…\" --mint"
              : "Already a skill workspace",
          },
          null,
          2,
        ),
      );
      break;
    }

    case "status": {
      const root = requireWorkspace();
      const st = await status(root);
      console.log(
        JSON.stringify(
          {
            root: st.root,
            title: st.title,
            agent_host_ok: st.agent_host_ok,
            journey_summary: st.journey_summary,
            completeness: st.completeness,
            staged: st.staged.map((i) => ({ id: i.id, type: i.type, title: i.title })),
            unstaged: st.unstaged.map((i) => ({ id: i.id, type: i.type, title: i.title })),
            head: st.head,
          },
          null,
          2,
        ),
      );
      break;
    }

    case "propose": {
      requireAgentHost();
      const root = requireWorkspace();
      const json = opt(rest, "--json");
      if (json) {
        const items = JSON.parse(json) as Array<{
          title: string;
          body: string;
          type?: SectionType;
        }>;
        const made = await proposeMany(root, items);
        console.log(
          JSON.stringify({ ok: true, count: made.length, ids: made.map((m) => m.id) }, null, 2),
        );
        break;
      }
      const title = opt(rest, "--title");
      const body = opt(rest, "--body");
      const type = opt(rest, "--type") as SectionType | undefined;
      if (!title || !body) {
        console.error("Usage: skill propose --title T --body B [--type decision]");
        console.error('   or: skill propose --json \'[{"title":"…","body":"…"}]\'');
        process.exit(2);
      }
      const section = await proposeSection(root, { title, body, type });
      console.log(JSON.stringify({ ok: true, section }, null, 2));
      break;
    }

    case "journey": {
      const root = requireWorkspace();
      const summary = opt(rest, "--summary");
      if (!summary) {
        console.error("Usage: skill journey --summary \"Redacted human+AI journey…\"");
        process.exit(2);
      }
      const open = opt(rest, "--open");
      const config = await setJourney(root, {
        summary,
        open_questions: open ? open.split("|") : undefined,
      });
      console.log(JSON.stringify({ ok: true, journey_summary: config.journey_summary }, null, 2));
      break;
    }

    case "add": {
      const root = requireWorkspace();
      const ids = rest.filter((a) => !a.startsWith("-"));
      const index = await stage(root, ids.length ? ids : "all");
      console.log(JSON.stringify({ ok: true, staged: index.staged }, null, 2));
      break;
    }

    case "unstage": {
      const root = requireWorkspace();
      const ids = rest.filter((a) => !a.startsWith("-"));
      const index = await unstage(root, ids.length ? ids : "all");
      console.log(JSON.stringify({ ok: true, staged: index.staged }, null, 2));
      break;
    }

    case "review": {
      const root = requireWorkspace();
      const st = await status(root);
      console.log(
        JSON.stringify(
          {
            staged: st.staged.map((i) => ({
              id: i.id,
              type: i.type,
              title: i.title,
              body: i.body,
              source: i.source,
            })),
          },
          null,
          2,
        ),
      );
      break;
    }

    case "discard": {
      const root = requireWorkspace();
      const id = rest[0];
      if (!id) usage();
      await discardSection(root, id!);
      console.log(JSON.stringify({ ok: true, discarded: id }, null, 2));
      break;
    }

    case "checkpoint": {
      const root = requireWorkspace();
      try {
        const result = await checkpoint(root, {
          message: opt(rest, "-m") ?? opt(rest, "--message"),
          summary: opt(rest, "--summary"),
          input_tokens: opt(rest, "--input-tokens")
            ? Number(opt(rest, "--input-tokens"))
            : undefined,
          output_tokens: opt(rest, "--output-tokens")
            ? Number(opt(rest, "--output-tokens"))
            : undefined,
        });
        console.log(
          JSON.stringify(
            {
              ok: true,
              profile: "continuity",
              package_path: result.package_path,
              package_digest: result.package_digest,
              skill_id: result.compile.files.manifest.id,
              completeness: result.compile.completeness,
              hint: "Hand this .skill to another AI via: skill load <path>",
            },
            null,
            2,
          ),
        );
      } catch (e) {
        if (e instanceof CompileRefusalError) {
          console.log(
            JSON.stringify(
              {
                ok: false,
                kind: "compile_refused",
                profile: e.profile,
                missing: e.missing,
                hints: e.hints,
              },
              null,
              2,
            ),
          );
          process.exit(2);
        }
        throw e;
      }
      break;
    }

    case "compile":
    case "bake": {
      if (cmd === "bake") {
        console.error(
          "note: `bake` is a legacy alias; the protocol command is `skill compile`",
        );
      }
      const root = requireWorkspace();
      const profile = (opt(rest, "--profile") as "release" | "continuity") ?? "release";
      try {
        const result = await compileWorkspace(root, {
          message: opt(rest, "-m") ?? opt(rest, "--message"),
          title: opt(rest, "--title"),
          summary: opt(rest, "--summary"),
          add_all: !flag(rest, "--no-all"),
          approve: flag(rest, "--approve"),
          mint: flag(rest, "--mint"),
          profile,
          host: opt(rest, "--host"),
          agent_runtime: process.env.SKILL_AGENT_RUNTIME ?? "@skillerr/cli",
          agent_version:
            process.env.SKILL_AGENT_VERSION ??
            (process.env.SKILL_AGENT_RUNTIME ? "unknown" : VERSION),
          input_tokens: opt(rest, "--input-tokens")
            ? Number(opt(rest, "--input-tokens"))
            : undefined,
          output_tokens: opt(rest, "--output-tokens")
            ? Number(opt(rest, "--output-tokens"))
            : undefined,
        });
        console.log(
          JSON.stringify(
            {
              ok: true,
              profile: result.profile,
              package_path: result.package_path,
              package_digest: result.package_digest,
              skill_id: result.compile.files.manifest.id,
              minted: result.minted,
              completeness: result.compile.completeness,
              pending_approvals: result.compile.pending_approvals,
              generation_usage: result.compile.files.provenance?.generation_usage,
            },
            null,
            2,
          ),
        );
      } catch (e) {
        if (e instanceof CompileRefusalError) {
          console.log(
            JSON.stringify(
              {
                ok: false,
                kind: "compile_refused",
                profile: e.profile,
                missing: e.missing,
                hints: e.hints,
                message:
                  "Skill generation stopped. Complete missing parts with the AI agent, then compile again.",
              },
              null,
              2,
            ),
          );
          process.exit(2);
        }
        throw e;
      }
      break;
    }

    case "load": {
      const file = rest.find((a) => !a.startsWith("-"));
      if (!file) usage();
      const resolvedFile = resolve(file);
      const handoff = await loadSkillHandoff(resolvedFile);

      // Materialize into an editable workspace when one is in scope: an
      // explicit --into <dir>, or the current workspace. Otherwise stay a
      // read-only preview (back-compat), and say so plainly.
      const into = opt(rest, "--into");
      const targetRoot = into ? resolve(into) : findWorkspaceRoot();

      if (!targetRoot) {
        console.log(
          JSON.stringify(
            {
              ok: true,
              mode: "read_only_preview",
              handoff,
              agent_prompt:
                "Preview of a .skill continuity package. Nothing was written to disk. To take this package forward to a release, resume it into an editable workspace: `skill load <file.skill> --into <dir>` (or run `skill init` in a folder, then `skill load <file.skill>`).",
            },
            null,
            2,
          ),
        );
        break;
      }

      const result = await materializeSkillIntoWorkspace(targetRoot, resolvedFile, {
        host: requireAgentHost(opt(rest, "--host")),
        force: flag(rest, "--force"),
      });
      const nextSteps = result.needs_human_review
        ? [
            `Review the staged sections: skill review`,
            `Record human review in ${join(targetRoot, ".skill", "contract.json")}: set provenance.human_review to {"status":"reviewed","actor":"<you>","at":"<ISO timestamp>","scope":["contract","knowledge"]}. A CLI flag can never create this evidence, a human has to actually review the mapped contract.`,
            `Then compile a signed release: skill compile -m "reviewed" --approve --mint --profile release`,
          ]
        : [
            `Contract already records human review. Compile a signed release: skill compile -m "reviewed" --approve --mint --profile release`,
          ];
      console.log(
        JSON.stringify(
          {
            ok: true,
            mode: "materialized",
            root: result.root,
            skill_id: result.skill_id,
            title: result.title,
            sections_staged: result.sections,
            contract_written: result.contract_written,
            needs_human_review: result.needs_human_review,
            handoff,
            next_steps: nextSteps,
          },
          null,
          2,
        ),
      );
      break;
    }

    case "mint": {
      requireAgentHost(opt(rest, "--host"));
      // An explicit file argument works standalone, same as inspect/validate/
      // verify-trust — mint only needs a workspace to find an *implicit*
      // package (the last compile's head.package_path). Requiring one even
      // when the caller names a file was an inconsistency with every other
      // file-taking command, and blocked minting a package that was never
      // produced via a workspace (e.g. `skill pack <source.json>` output).
      const explicitFile = rest.find((a) => a.endsWith(".skill"));
      const file = explicitFile ?? (await loadHead(requireWorkspace())).package_path;
      if (!file) throw new Error("No package to mint. Run skill compile first.");
      const unpacked = unpackSkill(new Uint8Array(await readFile(resolve(file))));
      if (unpacked.raw.manifest.compile_profile === "continuity") {
        throw new Error("Cannot mint continuity draft. Recompile with --profile release first.");
      }
      const transparency = flag(rest, "--transparency");
      const { signer, signerKeyPem, issuer_key } = await resolveMintSigner(rest, {
        requireKey: transparency,
      });
      const result = await mintAndAnchor(unpacked.raw, {
        host: requireAgentHost(opt(rest, "--host")),
        signer,
        signerKeyPem,
        transparency,
        keyless: flag(rest, "--keyless"),
        rekorUrl: opt(rest, "--rekor-url"),
        fulcioUrl: opt(rest, "--fulcio-url"),
      });
      const out = opt(rest, "-o") ?? file;
      await writeFile(resolve(out!), result.packageBytes);
      console.log(
        JSON.stringify(
          {
            ok: true,
            out,
            mint_status: result.mint_status,
            content_id: result.content_id,
            package_digest: result.package_digest,
            generation_usage: result.generation_usage,
            ...(issuer_key ? { issuer_key } : {}),
            ...(result.transparency ? { transparency: result.transparency } : {}),
            ...(result.keyless ? { keyless: result.keyless } : {}),
          },
          null,
          2,
        ),
      );
      break;
    }

    case "publish": {
      // One-shot: seal a release and publish a public, independently-checkable
      // provenance record (a Sigstore Rekor transparency-log entry), printing
      // the search.sigstore.dev URL. This is NOT a marketplace/hosted registry
      // (still out of scope), it's the public provenance anchor, made
      // frictionless: a per-user signing key is auto-provisioned on first use
      // (the public log needs a key but no login), so `skill publish` works
      // with zero setup.
      //
      // Content-privacy boundary (buildAnchorStatement in
      // @skillerr/core/transparency.ts, enforced twice: assertAnchorStatementPrivacy
      // at runtime + additionalProperties:false in the JSON Schema): the
      // logged predicate is exactly {skill_id, skill_version,
      // sealed_manifest_digest, package_digest, issuer_class}, opaque
      // identifiers and SHA-256 digests only. Never title, intent, knowledge,
      // journey, assets, or any other content, and the .skill file itself is
      // never uploaded anywhere by this command. That small record IS
      // permanent and world-readable once logged, so a skill_id you want to
      // keep unlisted still shouldn't be published, but it carries no skill
      // content. See docs/TRANSPARENCY.md "What gets logged".
      const host = requireAgentHost(opt(rest, "--host"));
      const explicitFile = rest.find((a) => a.endsWith(".skill"));
      const file = explicitFile ?? (await loadHead(requireWorkspace())).package_path;
      if (!file) {
        throw new Error(
          "No package to publish. Compile a release first (skill compile --profile release), or pass a <file.skill>.",
        );
      }
      const unpacked = unpackSkill(new Uint8Array(await readFile(resolve(file))));
      if (unpacked.raw.manifest.compile_profile === "continuity") {
        throw new Error(
          "Cannot publish a continuity draft. Take it to a release first: record provenance.human_review, then skill compile --profile release. See docs/FROM-SKILL-CREATOR.md.",
        );
      }
      const noTransparency = flag(rest, "--no-transparency");
      const keyless = flag(rest, "--keyless");
      const { signer, signerKeyPem, issuer_key } = await resolveMintSigner(rest, {
        requireKey: !noTransparency,
      });
      const result = await mintAndAnchor(unpacked.raw, {
        host,
        signer,
        signerKeyPem,
        transparency: !noTransparency,
        keyless,
        rekorUrl: opt(rest, "--rekor-url"),
        fulcioUrl: opt(rest, "--fulcio-url"),
      });
      const out = opt(rest, "-o") ?? file;
      await writeFile(resolve(out!), result.packageBytes);
      const publicUrl =
        (result.transparency?.ok && (result.transparency.rekor_url as string)) ||
        (result.keyless?.ok && (result.keyless.rekor_url as string)) ||
        undefined;
      console.log(
        JSON.stringify(
          {
            ok: true,
            out,
            mint_status: result.mint_status,
            package_digest: result.package_digest,
            public_url: publicUrl,
            ...(publicUrl
              ? {
                  message: `Published. Only skill_id, skill_version, issuer_class, and two SHA-256 digests were logged, never the .skill file, its title, intent, knowledge, or any other content. That small record is permanent and world-readable: anyone can verify it independently at ${publicUrl} (Sigstore's own log, not this tool's word).`,
                  published_fields: ["skill_id", "skill_version", "sealed_manifest_digest", "package_digest", "issuer_class"],
                  not_published: "The .skill file itself, and everything in it (title, intent, knowledge, journey, assets), never leaves this machine because of this command.",
                }
              : {
                  message:
                    "Sealed, but the public anchor did not complete (see transparency/keyless below). Nothing was published. The .skill itself is still valid; re-run to retry anchoring.",
                }),
            ...(issuer_key ? { issuer_key } : {}),
            ...(result.transparency ? { transparency: result.transparency } : {}),
            ...(result.keyless ? { keyless: result.keyless } : {}),
          },
          null,
          2,
        ),
      );
      break;
    }

    case "inspect": {
      const file = rest[0];
      if (!file) usage();
      const bytes = new Uint8Array(await readFile(resolve(file!)));
      if (flag(rest, "--trust")) {
        const trust_store = loadTrustStore(opt(rest, "--trust-store") ?? defaultTrustStorePath());
        const view = inspectTrustView(bytes, { trust_store });
        if (flag(rest, "--claims")) {
          // Offline only — inspect never touches the network, so
          // transparency/keyless anchors aren't cryptographically verified
          // here even if present (that's what verify-trust does). A claim
          // this function can't check just doesn't appear as verified.
          console.log(JSON.stringify({ ...view, claims: assessClaims(view) }, null, 2));
        } else {
          console.log(JSON.stringify(view, null, 2));
        }
      } else {
        console.log(JSON.stringify(inspectSkill(bytes), null, 2));
      }
      break;
    }
    case "scrub": {
      const target = rest[0];
      if (!target) usage();
      const mode = (opt(rest, "--mode") as "auto" | "report-only" | undefined) ?? "auto";
      const secretsFromArg = optAll(rest, "--secrets-from").map((p) => resolve(p));
      const entropyArg = opt(rest, "--entropy");
      const reportOut = opt(rest, "--report");
      const strict = flag(rest, "--strict");

      let customRules: ScrubCustomRule[] | undefined;
      const customPath = opt(rest, "--custom");
      try {
        if (customPath) {
          const raw = JSON.parse(await readFile(resolve(customPath), "utf8")) as
            | ScrubCustomRule[]
            | { rules: ScrubCustomRule[] };
          customRules = Array.isArray(raw) ? raw : raw.rules;
        }
      } catch (e) {
        console.log(
          JSON.stringify(
            { ok: false, error: `Failed to read/parse --custom rules file: ${e instanceof Error ? e.message : String(e)}` },
            null,
            2,
          ),
        );
        process.exit(2);
      }

      const scrubOpts = {
        secretsFrom: secretsFromArg.length ? secretsFromArg : undefined,
        customRules,
        mode,
        entropyThreshold: entropyArg ? Number(entropyArg) : undefined,
      };

      // <path> may be a workspace directory (its own .skill/ working tree) —
      // scrub every staged section + the journey summary as one document, so
      // "same value -> same token" holds document-wide, matching how
      // compile/checkpoint scrub it (see docs/SCRUBBING.md). Never rewrites
      // workspace files in place either way: staged content only changes via
      // the normal compile/checkpoint path, which already seals its own
      // provenance/redaction.json.
      const workspaceRoot = existsSync(target) && statSync(target).isDirectory()
        ? findWorkspaceRoot(resolve(target))
        : undefined;
      let result: ReturnType<typeof scrub>;
      if (workspaceRoot) {
        const sections = await listSections(workspaceRoot);
        const config = await loadConfig(workspaceRoot);
        const units = [
          ...sections.map((s) => ({ id: s.id, text: s.body })),
          ...(config.journey_summary ? [{ id: "journey_summary", text: config.journey_summary }] : []),
          ...(config.open_questions ?? []).map((q, i) => ({ id: `open_question_${i}`, text: q })),
        ];
        result = scrub(units, { ...scrubOpts, mode: "report-only" });
      } else {
        let text: string;
        try {
          text = target === "-" ? await readStdin() : await readFile(resolve(target), "utf8");
        } catch (e) {
          console.log(
            JSON.stringify(
              { ok: false, error: `Failed to read ${target}: ${e instanceof Error ? e.message : String(e)}` },
              null,
              2,
            ),
          );
          process.exit(2);
        }
        result = scrub(text, scrubOpts);
      }

      if (reportOut) {
        await writeFile(resolve(reportOut), JSON.stringify(result.report, null, 2) + "\n", "utf8");
      }
      console.log(
        JSON.stringify(
          {
            ok: true,
            report: result.report,
            scrubbed: mode === "report-only" ? undefined : result.scrubbed,
          },
          null,
          2,
        ),
      );
      process.exit(strict && result.report.summary.needs_review > 0 ? 2 : 0);
      break;
    }
    case "capture": {
      // Captures the current session (git working set + optional agent
      // context / SessionSource) into a sealed continuity .skill.
      // Environment capture always runs; a dirty repo is never empty.
      // See docs/CONTINUITY.md.
      const out = opt(rest, "-o") ?? opt(rest, "--out");
      const message = opt(rest, "-m") ?? opt(rest, "--message");
      const context: CaptureContext | string | undefined = opt(rest, "--context");
      const from = opt(rest, "--from");
      const sessionId = opt(rest, "--session");
      let result;
      try {
        result = await captureSession({
          cwd: process.cwd(),
          intent: message,
          context,
          from,
          sessionId,
        });
      } catch (e) {
        const err = e as Error & { ambiguous?: boolean; candidates?: Array<{ source: string; id: string; path: string }> };
        console.log(
          JSON.stringify(
            {
              ok: false,
              error: err.message,
              ambiguous: err.ambiguous ?? false,
              candidates: err.candidates?.slice(0, 12).map((c) => ({
                source: c.source,
                id: c.id,
                path: c.path,
              })),
            },
            null,
            2,
          ),
        );
        process.exit(2);
      }
      const sealed = await seal(result.pkg);
      if (out) await writeFile(resolve(out), sealed.zip);
      console.log(
        JSON.stringify(
          {
            ok: true,
            digest: sealed.digest,
            has_git: result.hasGit,
            session: result.session
              ? {
                  source: result.session.source,
                  id: result.session.id,
                  path: result.session.path,
                }
              : null,
            session_note: result.sessionNote,
            working_set: result.workingSet
              ? {
                  branch: result.workingSet.branch,
                  dirty: result.workingSet.dirty,
                  changed_files: result.workingSet.files.length,
                  untracked: result.workingSet.untracked.length,
                  commits: result.workingSet.commits.length,
                  diff_bytes: result.workingSet.diff?.length ?? 0,
                }
              : null,
            journey_summary: result.journey.summary,
            redaction: result.redaction.summary,
            written: out ? resolve(out) : undefined,
            note: out
              ? undefined
              : "No -o <file> given, nothing written. Re-run with -o handoff.skill to save the sealed continuity package.",
          },
          null,
          2,
        ),
      );
      process.exit(0);
      break;
    }
    case "resume": {
      // Reads a sealed continuity .skill and prints a paste-ready resume
      // briefing (Resume Contract 1.0). No preview/pending framing.
      const file = rest.find((a) => !a.startsWith("-"));
      if (!file) usage();
      const opened = await openContinuity(new Uint8Array(await readFile(resolve(file))));
      const contract = resumePreview(opened);
      if (flag(rest, "--json")) {
        console.log(JSON.stringify({ ok: true, contract }, null, 2));
      } else {
        console.log(renderResumeContract(contract));
      }
      process.exit(0);
      break;
    }
    case "validate": {
      const file = rest[0];
      if (!file) usage();
      const result = validatePackageBytes(new Uint8Array(await readFile(resolve(file!))));
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.ok ? 0 : 2);
      break;
    }
    case "unpack": {
      const file = rest[0];
      if (!file) usage();
      const u = unpackSkill(new Uint8Array(await readFile(resolve(file!))));
      console.log(
        JSON.stringify(
          {
            manifest: u.manifest,
            workflow: u.workflow,
            knowledge: u.knowledge,
            journey: u.raw.provenance?.journey,
            generation_usage: u.raw.provenance?.generation_usage,
          },
          null,
          2,
        ),
      );
      break;
    }
    case "ingest": {
      const inputPath = rest[0];
      if (!inputPath) usage();
      const host = requireAgentHost(opt(rest, "--host"));
      const out = opt(rest, "-o") ?? "out.skill";

      const resolvedInput = resolve(inputPath!);
      const hasDirectSkillMd =
        existsSync(resolvedInput) &&
        (statSync(resolvedInput).isDirectory()
          ? existsSync(join(resolvedInput, "SKILL.md"))
          : true);
      if (!hasDirectSkillMd) {
        const candidates = discoverSkillMdCandidates(resolvedInput);
        if (candidates.length > 0) {
          console.log(
            JSON.stringify(
              {
                ok: true,
                multi_skill: true,
                source_path: resolvedInput,
                candidates,
                next: "No single SKILL.md at this path, re-run `skill ingest <candidate path>` for one of the candidates above.",
              },
              null,
              2,
            ),
          );
          break;
        }
      }

      const { source, contract, resources, assets, report } = ingestSkillMd(resolvedInput, {
        host,
      });
      const compiled = compileSkillSource(source, { profile: "continuity" });
      compiled.files.resources = { ...compiled.files.resources, ...resources };
      compiled.files.assets = { ...compiled.files.assets, ...assets };
      // Resources/assets are merged in after compileSkillSource already
      // finalized the manifest, so its package_digest is stale (computed
      // over the pre-merge content index). Re-finalize before packing so
      // the digest we print below matches what's actually in the archive —
      // same finalize-then-pack order compile.ts already uses.
      const fileMap = buildFileMap(compiled.files);
      compiled.files.manifest = finalizeManifest(compiled.files.manifest, fileMap);
      const packageBytes = packSkill(compiled.files);
      await writeFile(resolve(out), packageBytes);

      const releaseAssessment = assessSkillContract(contract, "release");
      console.log(
        JSON.stringify(
          {
            ok: true,
            out,
            skill_id: compiled.files.manifest.id,
            package_digest: compiled.files.manifest.package_digest,
            found: report.found,
            notes: report.notes,
            release_ready: releaseAssessment.complete,
            missing_for_release: releaseAssessment.issues.map((i) => ({
              field: i.field,
              message: i.message,
              fix: i.fix,
            })),
            next: releaseAssessment.complete
              ? `Continuity draft written to ${out}. To seal a signed release: skill load ${out} --into <dir> to materialize an editable workspace, then skill compile -m "reviewed" --approve --mint --profile release.`
              : `Continuity draft written to ${out}. To take it to a release: (1) skill load ${out} --into <dir> to materialize an editable workspace; (2) fill the fields in missing_for_release by editing <dir>/.skill/contract.json, starting with provenance.human_review, which ingest can never fabricate; (3) skill compile -m "reviewed" --approve --mint --profile release; (4) optional public URL: skill publish <dir>/.skill/objects/<id>.skill.`,
          },
          null,
          2,
        ),
      );
      break;
    }
    case "eval": {
      const inputArg = rest[0];
      const host = requireAgentHost(opt(rest, "--host"));

      let contract: SkillContract | undefined;
      let dryRunBytes: Uint8Array | undefined;
      let skillId: string;
      let workspaceRoot: string | undefined;

      if (inputArg && inputArg.endsWith(".skill")) {
        const bytes = new Uint8Array(await readFile(resolve(inputArg)));
        const unpacked = unpackSkill(bytes);
        contract = unpacked.manifest.contract;
        dryRunBytes = bytes;
        skillId = unpacked.manifest.id;
      } else {
        workspaceRoot = requireWorkspace(inputArg ? resolve(inputArg) : undefined);
        const loaded = await loadWorkspaceContract(workspaceRoot);
        if (loaded.error) {
          throw new Error(`.skill/contract.json is present but broken: ${loaded.error}`);
        }
        contract = loaded.contract;
        const compiled = await compileWorkspace(workspaceRoot, { profile: "continuity", host });
        dryRunBytes = compiled.compile.packageBytes;
        skillId = compiled.compile.files.manifest.id;
      }

      if (!contract?.evals || contract.evals.length === 0) {
        console.log(
          JSON.stringify(
            {
              ok: false,
              error:
                "No evals declared. Add an `evals` array to the contract (see docs/EVAL.md) — id, prompt, and assertions per case.",
            },
            null,
            2,
          ),
        );
        process.exit(2);
      }

      const readJsonOpt = async (flagName: string): Promise<Record<string, unknown>> => {
        const path = opt(rest, flagName);
        if (!path) return {};
        return JSON.parse(await readFile(resolve(path), "utf8")) as Record<string, unknown>;
      };
      const responses = (await readJsonOpt("--responses")) as Record<string, string>;
      const usage = (await readJsonOpt("--usage")) as Record<string, number>;
      const grades = (await readJsonOpt("--grade")) as Record<
        string,
        Record<string, GradeOverride>
      >;

      const results = [];
      for (const evalCase of contract.evals) {
        const start = Date.now();
        let executable = false;
        if (dryRunBytes) {
          const run = await runSkillArchive(dryRunBytes, { host }, { mode: "dry_run" });
          executable = run.status === "succeeded" || run.status === "paused";
        }
        results.push(
          runEvalCase(evalCase, {
            response: responses[evalCase.id],
            executable,
            duration_ms: Date.now() - start,
            total_tokens: usage[evalCase.id],
            overrides: grades[evalCase.id],
          }),
        );
      }

      const report = buildBenchmarkReport(skillId, host, results);
      const out = opt(rest, "-o") ?? "benchmark.json";
      await writeFile(resolve(out), JSON.stringify(report, null, 2) + "\n");

      if (workspaceRoot && flag(rest, "--attach")) {
        await writeFile(
          join(workspaceRoot, WORKSPACE_DIR, "benchmark.json"),
          JSON.stringify(report, null, 2) + "\n",
        );
      }

      console.log(
        JSON.stringify(
          {
            ok: true,
            out,
            summary: report.summary,
            attached: Boolean(workspaceRoot && flag(rest, "--attach")),
            next:
              report.summary.pending_human > 0
                ? `${report.summary.pending_human} assertion(s) still need a human/agent verdict — supply --grade <file.json> and re-run, or review ${out} directly. Never treat pending_human as a pass.`
                : "All assertions graded.",
          },
          null,
          2,
        ),
      );
      break;
    }
    case "score": {
      const file = rest[0];
      if (!file) usage();
      const profile = (opt(rest, "--profile") ?? "release") as "release" | "continuity";
      const bytes = new Uint8Array(await readFile(resolve(file!)));
      const validation = validatePackageBytes(bytes);
      const unpacked = unpackSkill(bytes);
      const assessment = buildSkillAssessment({
        manifest: unpacked.manifest,
        benchmark: unpacked.raw.provenance?.benchmark,
        provenanceSource: unpacked.raw.provenance?.source,
        valid: validation.ok,
      });

      let scoreResult: unknown;
      try {
        const skillScore = await import("@skillerr/skill-score");
        scoreResult = skillScore.scoreSkill(assessment, profile);
      } catch {
        // @skillerr/skill-score is an optional peer, not installed here.
        // This is expected, not a failure: ok stays true (the mapped
        // assessment was written successfully), scored is false so a
        // caller can tell "no score" apart from "something broke".
        const assessmentOut = opt(rest, "-o") ?? "assessment.json";
        await writeFile(resolve(assessmentOut), JSON.stringify(assessment, null, 2) + "\n");
        console.log(
          JSON.stringify(
            {
              ok: true,
              scored: false,
              notice: "@skillerr/skill-score is not installed — wrote the mapped assessment instead of a score.",
              assessment_out: assessmentOut,
              next: `npm i -D @skillerr/skill-score, then re-run — or score it directly: skill-score ${assessmentOut} ${profile}`,
              evidence_count: assessment.evidence.length,
            },
            null,
            2,
          ),
        );
        break;
      }

      if (flag(rest, "--emit")) {
        const sealed = {
          ...unpacked.raw,
          provenance: { ...unpacked.raw.provenance, score: scoreResult },
        };
        // Usage text promises "a sealed copy" — silently overwriting the
        // original input file when -o isn't given would break that promise
        // and destroy the caller's original package. Derive a sibling path
        // instead of defaulting to `file!`.
        const out =
          opt(rest, "-o") ??
          (file!.endsWith(".skill") ? `${file!.slice(0, -".skill".length)}.scored.skill` : `${file!}.scored.skill`);
        await writeFile(resolve(out), packSkill(sealed));
        console.log(JSON.stringify({ ok: true, out, score: scoreResult }, null, 2));
      } else {
        console.log(JSON.stringify({ ok: true, score: scoreResult }, null, 2));
      }
      break;
    }
    case "pack": {
      const file = rest[0];
      if (!file) usage();
      requireAgentHost(opt(rest, "--host"));
      const approve = flag(rest, "--approve");
      const profile = (opt(rest, "--profile") as "release" | "continuity") ?? "release";
      const out = opt(rest, "-o") ?? "out.skill";
      const raw = JSON.parse(await readFile(resolve(file!), "utf8")) as Recipe | SkillSource;
      let compiled;
      try {
        if (raw.kind === "skill_source") {
          compiled = compileSkillSource(raw, {
            profile,
            approve_inferred_inputs: approve,
            approve_permissions: approve,
          });
        } else {
          const recipe = raw as Recipe;
          if (!recipe.provenance.hosts.length || !isValidAgentHost(recipe.provenance.hosts[0])) {
            recipe.provenance.hosts = [requireAgentHost(opt(rest, "--host"))];
          }
          compiled = compileRecipeToSkill(recipe, {
            profile,
            approve_inferred_inputs: approve,
            approve_permissions: approve,
            host: requireAgentHost(opt(rest, "--host")),
          });
        }
        if (approve) compiled = approveCompilation(compiled, { inputs: ["*"], permissions: true });
      } catch (e) {
        if (e instanceof CompileRefusalError) {
          console.log(
            JSON.stringify(
              { ok: false, kind: "compile_refused", missing: e.missing, hints: e.hints },
              null,
              2,
            ),
          );
          process.exit(2);
        }
        throw e;
      }
      await writeFile(resolve(out), compiled.packageBytes);
      console.log(
        JSON.stringify(
          {
            out,
            skill_id: compiled.files.manifest.id,
            package_digest: compiled.files.manifest.package_digest,
            completeness: compiled.completeness,
          },
          null,
          2,
        ),
      );
      break;
    }
    case "run": {
      const file = rest[0];
      if (!file) usage();
      const mode = (opt(rest, "--mode") ?? "dry_run") as
        | "dry_run"
        | "execute"
        | "explain"
        | "inspect";
      const inputs: Record<string, unknown> = {};
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === "--input" && rest[i + 1]) {
          const [k, ...v] = rest[i + 1]!.split("=");
          inputs[k!] = v.join("=");
        }
      }
      const run = await runSkillArchive(
        new Uint8Array(await readFile(resolve(file!))),
        { host: process.env.SKILL_HOST ?? "runtime" },
        {
          mode,
          inputs,
          allow_untrusted: flag(rest, "--allow-untrusted"),
          allow_development_issuer: flag(rest, "--allow-development-issuer"),
        },
      );
      console.log(JSON.stringify(run, null, 2));
      process.exit(run.status === "succeeded" || run.status === "paused" ? 0 : 2);
      break;
    }
    case "verify-trust": {
      const file = rest[0];
      if (!file) usage();
      const profile = (opt(rest, "--profile") ?? "minted") as "open" | "minted" | "anchored";
      const trust_store = loadTrustStore(opt(rest, "--trust-store") ?? defaultTrustStorePath());
      const bytes = new Uint8Array(await readFile(resolve(file!)));
      const result = verifyMintTrust(bytes, profile, {
        allow_development_issuer: flag(rest, "--allow-development-issuer"),
        allow_self_reported: flag(rest, "--allow-self-reported"),
        trust_store,
      });
      // Transparency anchors are optional and orthogonal to trust_state
      // (see docs/TRANSPARENCY.md) — checked here, additively, never
      // replacing the mint trust check above.
      const manifest = unpackSkill(bytes).manifest;
      const anchors = manifest.anchors ?? [];
      // The subject a statement_version anchor claims to be about is
      // re-derived from THIS package, then checked, never trusted from the
      // anchor's own words, same pattern as --keyless re-deriving
      // owner_identity from the cert (RFC 0007).
      const expectedSubject = { skill_id: manifest.id, package_digest: manifest.package_digest };
      const tlogAnchor = anchors.find((a) => a.kind === "transparency_log");
      let transparency: unknown;
      let transparencyOffline: AnchorVerification | undefined;
      if (tlogAnchor && result.attestation?.sealed_manifest_digest) {
        const pinnedKey = trust_store.keys.find((k) => k.key_id === tlogAnchor.issuer);
        if (!pinnedKey) {
          transparency = { ok: false, error: `No trust-store entry for issuer "${tlogAnchor.issuer}" — cannot verify anchor` };
        } else {
          const offline = await verifyRekorAnchor(
            tlogAnchor,
            result.attestation.sealed_manifest_digest,
            pinnedKey.public_key_pem,
            expectedSubject,
          );
          transparencyOffline = offline;
          // Independently checkable on sigstore's own UI — don't just take
          // our word for it. undefined (not a guessed link) unless the
          // anchor verified AND lives on the public Rekor instance.
          const withUrl = offline.ok
            ? { ...offline, rekor_url: rekorSearchUrl(tlogAnchor, offline.log_index) }
            : offline;
          if (flag(rest, "--online") && offline.log_index) {
            const online = await checkRekorOnline(offline.log_index, tlogAnchor.located_at);
            transparency = { ...withUrl, online_check: online };
          } else {
            transparency = withUrl;
          }
        }
      }
      // Same additive pattern as the transparency_log anchor above, but
      // verified against Fulcio's CA (part of the trusted root) instead of
      // a trust-store-pinned key — see verifyKeylessAnchor.
      const keylessAnchor = anchors.find((a) => a.kind === "keyless_identity");
      let keyless: unknown;
      let keylessOffline: KeylessVerification | undefined;
      if (keylessAnchor && result.attestation?.sealed_manifest_digest) {
        const offline = await verifyKeylessAnchor(
          keylessAnchor,
          result.attestation.sealed_manifest_digest,
          expectedSubject,
        );
        keylessOffline = offline;
        const withUrl = offline.ok
          ? { ...offline, rekor_url: rekorSearchUrl(keylessAnchor, offline.log_index) }
          : offline;
        if (flag(rest, "--online") && offline.log_index) {
          const online = await checkRekorOnline(offline.log_index, keylessAnchor.located_at);
          keyless = { ...withUrl, online_check: online };
        } else {
          keyless = withUrl;
        }
      }
      let claims: unknown;
      if (flag(rest, "--claims")) {
        // inspectTrustView is a second, cheap, fully-offline call here —
        // verifyMintTrust's own return shape doesn't carry everything
        // assessClaims needs (agent.*, host_claim_binding, etc).
        const view = inspectTrustView(bytes, { trust_store });
        claims = assessClaims(view, { transparency: transparencyOffline, keyless: keylessOffline });
      }
      console.log(
        JSON.stringify(
          {
            ...result,
            ...(transparency ? { transparency } : {}),
            ...(keyless ? { keyless } : {}),
            ...(claims ? { claims } : {}),
            docs: "https://github.com/dot-skill/skillerr/blob/main/docs/WHAT-IS-VERIFIABLE.md",
          },
          null,
          2,
        ),
      );
      break;
    }
    case "keygen": {
      // Default (no -o): provision the per-user default issuer key at
      // ~/.skillerr/issuer-key.pem and pin its public half in your own trust
      // store. This is the key `skill mint --transparency`/`skill publish`
      // auto-use, so a public provenance URL works with zero further setup.
      if (!opt(rest, "-o")) {
        const issuer = loadOrCreateDefaultIssuer();
        console.log(
          JSON.stringify(
            {
              ok: true,
              key_id: issuer.key_id,
              private_key: issuer.key_path,
              created: issuer.created,
              is_default_issuer: true,
              next_steps: [
                issuer.created
                  ? `Generated your default skillerr issuer key and pinned its public key in your own trust store.`
                  : `Your default skillerr issuer key already exists; pinned in your own trust store.`,
                `skill publish <file.skill> (or skill mint --transparency) now signs with it and prints a public search.sigstore.dev URL, no more setup.`,
                `Keep ${issuer.key_path} secret (mode 0600). To let OTHERS verify you as verified_issuer, share this key_id (${issuer.key_id}) + its public key so they can pin it. See docs/KEY-CEREMONY.md.`,
              ],
            },
            null,
            2,
          ),
        );
        break;
      }
      // -o <dir>: the named production key-ceremony path. Writes a named
      // keypair you manage yourself; does not touch the default issuer or
      // your trust store.
      const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" },
      });
      const outDir = opt(rest, "-o")!;
      const keyId = opt(rest, "--key-id") ?? `issuer-${new Date().toISOString().slice(0, 10)}`;
      await mkdir(resolve(outDir), { recursive: true });
      const privPath = resolve(outDir, `${keyId}.pem`);
      const pubPath = resolve(outDir, `${keyId}.pub.pem`);
      await writeFile(privPath, privateKey as unknown as string, { mode: 0o600 });
      await writeFile(pubPath, publicKey as unknown as string);
      console.log(
        JSON.stringify(
          {
            ok: true,
            key_id: keyId,
            private_key: privPath,
            public_key: pubPath,
            next_steps: [
              `Keep ${privPath} offline/secret, see docs/KEY-CEREMONY.md.`,
              `Mint with it: skill mint --host <agent-host> --signer-key ${privPath} --key-id ${keyId}`,
              `Pin the public key for verifiers — add an entry to ~/.skillerr/trust-store.json (or --trust-store <path>):`,
              JSON.stringify(
                {
                  version: 1,
                  keys: [
                    {
                      key_id: keyId,
                      public_key_pem: "<paste contents of " + pubPath + ">",
                      algorithm: "ed25519",
                    },
                  ],
                },
                null,
                2,
              ),
            ],
          },
          null,
          2,
        ),
      );
      break;
    }
    case "registry": {
      const sub = rest[0];
      if (sub === "list") {
        console.log(
          JSON.stringify(await list(undefined, Number(opt(rest, "--limit") ?? 50)), null, 2),
        );
      } else if (sub === "lookup") {
        const digest = rest[1];
        if (!digest) usage();
        console.log(JSON.stringify(await lookup(digest!), null, 2));
      } else if (sub === "verify") {
        const file = rest[1];
        if (!file) usage();
        console.log(
          JSON.stringify(
            await registryVerify(new Uint8Array(await readFile(resolve(file!)))),
            null,
            2,
          ),
        );
      } else if (sub === "publish") {
        const file = rest[1];
        if (!file) usage();
        const bytes = new Uint8Array(await readFile(resolve(file!)));
        const digest = unpackSkill(bytes).manifest.package_digest;
        console.log(
          JSON.stringify(
            {
              ...(await registryPublish(digest, { path: file })),
              note: "Local transparency log only — not a public marketplace.",
            },
            null,
            2,
          ),
        );
      } else usage();
      break;
    }
    case "migrate-legacy": {
      const file = rest[0];
      if (!file) usage();
      const out = opt(rest, "-o") ?? "migrated.skill";
      const legacy = JSON.parse(await readFile(resolve(file!), "utf8")) as Skill;
      const { packageBytes, files } = migrateLegacySkill(legacy);
      await writeFile(resolve(out), packageBytes);
      console.log(JSON.stringify({ out, skill_id: files.manifest.id }, null, 2));
      break;
    }
    case "to-skill-md": {
      const file = rest[0];
      if (!file) usage();
      const out = opt(rest, "-o") ?? "SKILL.md";
      const md = toSkillMdAdapter(
        unpackSkill(new Uint8Array(await readFile(resolve(file!)))).raw,
      );
      await writeFile(resolve(out), md, "utf8");
      console.log(
        JSON.stringify(
          { out, warning: "Lossy adapter — markdown is never the source of truth." },
          null,
          2,
        ),
      );
      break;
    }
    case "export-skill": {
      const file = rest[0];
      if (!file) usage();
      const agent = opt(rest, "--agent");
      let outDir = opt(rest, "-o");

      const unpacked = unpackSkill(new Uint8Array(await readFile(resolve(file!))));

      if (agent && !outDir) {
        outDir = resolveAgentSkillsDir(agent, deriveAgentSkillName(unpacked.raw));
      }
      if (!outDir) {
        console.error("export-skill requires -o <dir> or --agent <host> (e.g. claude, cursor).\n");
        usage();
      }
      const resolvedOut = resolve(outDir!);

      const { report } = exportAgentSkillFolder(unpacked.raw, resolvedOut);

      let validation: { tool: "skills-ref" | "internal-only"; ok: boolean; output?: string } = {
        tool: "internal-only",
        ok: true,
      };
      try {
        const stdout = execFileSync("skills-ref", ["validate", resolvedOut], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        validation = { tool: "skills-ref", ok: true, output: stdout.trim() };
      } catch (e) {
        const err = e as NodeJS.ErrnoException & { stdout?: Buffer | string; stderr?: Buffer | string };
        if (err.code === "ENOENT") {
          // skills-ref not on PATH, exportAgentSkillFolder already
          // guarantees a valid name/description by construction, so
          // internal-only validation is a real (if narrower) check, not a
          // silent skip. Reflected honestly in `validation.tool` above.
        } else {
          const output = [err.stdout, err.stderr]
            .filter(Boolean)
            .map(String)
            .join("\n")
            .trim();
          console.error(
            JSON.stringify(
              {
                ok: false,
                out: resolvedOut,
                error: "skills-ref validate reported this folder as invalid",
                output: output || err.message,
              },
              null,
              2,
            ),
          );
          process.exit(2);
        }
      }

      console.log(
        JSON.stringify(
          { ok: true, out: resolvedOut, report, validation },
          null,
          2,
        ),
      );
      break;
    }
    case "verify-skill": {
      const dir = rest[0];
      if (!dir) usage();
      const attestationPath = opt(rest, "--attestation");
      const trust_store = loadTrustStore(opt(rest, "--trust-store") ?? defaultTrustStorePath());
      const report = verifySkillFolder(resolve(dir!), {
        attestationPath: attestationPath ? resolve(attestationPath) : undefined,
        trustOptions: {
          allow_development_issuer: flag(rest, "--allow-development-issuer"),
          allow_self_reported: flag(rest, "--allow-self-reported"),
          trust_store,
        },
      });
      console.log(JSON.stringify({ ok: true, ...report }, null, 2));
      break;
    }
    case "help":
      usage();
      break;
    default:
      console.error(`Unknown command: ${cmd}\n`);
      usage();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
