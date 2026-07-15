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

import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
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
  ingestSkillMd,
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
  loadWorkspaceContract,
  saveWorkspaceContract,
  setJourney,
  requireAgentHost,
  WORKSPACE_DIR,
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
  skill compile -m "msg" [--approve] [--mint] [--profile release|continuity]
                                       Release refuses if incomplete
  skill load <file.skill>              Resume continuity in another AI
  skill mint [file.skill] [--host name] [--signer-key <pem>] [--key-id id]
             [--transparency] [--rekor-url <url>] [--keyless] [--fulcio-url <url>]
                                       Seal release (host required). No file arg
                                       uses the current workspace's last compile;
                                       an explicit file works standalone, same as
                                       inspect/validate. Default seal is public-dev
                                       HMAC (development trust only). Pass
                                       --signer-key for a configured Ed25519 issuer
                                       seal (verified_issuer-eligible) — see
                                       skill keygen and the wiki's Key Ceremony page
                                       --transparency additionally logs the sealed
                                       digest to a public Rekor transparency log
                                       (requires --signer-key; default log is the
                                       public rekor.sigstore.dev — PERMANENT and
                                       WORLD-READABLE once logged, never anchor a
                                       secret skill). Prints a search.sigstore.dev
                                       link so anyone can check the entry
                                       independently, not just trust this tool's
                                       word. See docs/TRANSPARENCY.md
                                       --keyless adds a second, independent
                                       anchor via Fulcio + Rekor, bound to your
                                       OIDC identity instead of --signer-key —
                                       no interactive setup needed in CI (GitHub
                                       Actions' ambient id-token: write, same
                                       mechanism npm trusted publishing uses);
                                       fails closed outside such an environment.
                                       No local/interactive login yet. Combines
                                       with any signer choice, or none.
  skill keygen [-o dir] [--key-id id]  Generate an Ed25519 issuer keypair for
                                       production signing (wiki: Key Ceremony)

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
                                       exactly what still needs authoring)
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

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const rest = argv.slice(1);
  if (!cmd || cmd === "-h" || cmd === "--help") usage(0);
  if (cmd === "-V" || cmd === "--version") {
    console.log(VERSION);
    return;
  }

  switch (cmd) {
    case "agent-guide": {
      if (flag(rest, "--json")) {
        console.log(JSON.stringify(agentCreateGuide(), null, 2));
      } else {
        console.log(formatAgentGuide());
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
      console.log(
        JSON.stringify(
          {
            assessment,
            explanation: explainContractAssessment(assessment),
          },
          null,
          2,
        ),
      );
      process.exit(assessment.complete ? 0 : 2);
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
      const file = rest[0];
      if (!file) usage();
      const handoff = await loadSkillHandoff(resolve(file!));
      console.log(
        JSON.stringify(
          {
            ok: true,
            handoff,
            agent_prompt:
              "Resume from this .skill continuity package. Honor journey, knowledge, open_questions, and typed inputs. Do not invent missing private data.",
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
      const bytes = new Uint8Array(await readFile(resolve(file)));
      const unpacked = unpackSkill(bytes);
      if (unpacked.raw.manifest.compile_profile === "continuity") {
        throw new Error("Cannot mint continuity draft. Recompile with --profile release first.");
      }
      const signerKeyPath = opt(rest, "--signer-key");
      const signerKeyPem = signerKeyPath ? await readFile(resolve(signerKeyPath), "utf8") : undefined;
      const signer = signerKeyPem
        ? createEd25519Signer(signerKeyPem, opt(rest, "--key-id") ?? "configured-issuer")
        : undefined;
      const { packageBytes: mintedBytes, files, attestation } = mintSkillPackage(unpacked.raw, {
        host: requireAgentHost(opt(rest, "--host")),
        provider: process.env.SKILL_PROVIDER,
        model: process.env.SKILL_MODEL,
        deployment: (process.env.SKILL_DEPLOYMENT as
          | "local"
          | "hosted"
          | "hybrid"
          | "unknown"
          | undefined) ?? "unknown",
        endpoint: process.env.SKILL_ENDPOINT
          ? redactSecrets(process.env.SKILL_ENDPOINT)
          : undefined,
        agent_runtime: process.env.SKILL_AGENT_RUNTIME ?? "@skillerr/cli",
        agent_version:
          process.env.SKILL_AGENT_VERSION ??
          (process.env.SKILL_AGENT_RUNTIME ? "unknown" : VERSION),
        signer,
        // A configured signer only ever earns verified_issuer trust when the
        // mint call also carries real agent-runtime evidence (session id /
        // markers) — see resolveHostClaimBinding in @skillerr/core/mint.
        // Without evidence this throws a clear, actionable error rather than
        // silently minting as self_reported.
        host_claim_binding: signer ? "verified_issuer" : undefined,
        agent_runtime_evidence: signer
          ? { session_id: process.env.SKILL_SESSION_ID }
          : undefined,
      });
      let packageBytes = mintedBytes;
      // Named once, reused by both anchor kinds below. This is what makes
      // a Rekor entry self-describing instead of a naked digest (RFC 0007).
      const anchorSubject: AnchorSubject = {
        skill_id: files.manifest.id,
        skill_version: files.manifest.version,
        package_digest: files.manifest.package_digest,
        issuer_class: attestation.issuer_class,
      };
      let transparency: Record<string, unknown> | undefined;
      if (flag(rest, "--transparency")) {
        if (!signer) {
          transparency = { ok: false, error: "--transparency requires --signer-key (public-dev HMAC isn't anchored)" };
        } else {
          try {
            const publicKeyPem = derivePublicKeyPem(signerKeyPem!);
            const { anchor, log_index } = await anchorToRekor(
              attestation.sealed_manifest_digest,
              signer,
              publicKeyPem,
              anchorSubject,
              { rekorUrl: opt(rest, "--rekor-url") },
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
              // Independently checkable on sigstore's own UI — don't just take our word for it.
              rekor_url: rekorSearchUrl(anchor, log_index),
            };
          } catch (e) {
            // Anchoring is additive — a network/Rekor failure never discards
            // an already-valid mint, it's just reported honestly.
            transparency = { ok: false, error: e instanceof Error ? e.message : String(e) };
          }
        }
      }
      let keyless: Record<string, unknown> | undefined;
      if (flag(rest, "--keyless")) {
        // Independent of --transparency/--signer-key entirely — this
        // doesn't touch the container's own seal, it adds a second,
        // separately-checkable claim: an OIDC identity (not our own key)
        // attesting to this digest via Fulcio + Rekor. See docs/TRANSPARENCY.md.
        try {
          const { anchor, log_index, owner_identity } = await mintKeylessAnchor(
            attestation.sealed_manifest_digest,
            anchorSubject,
            { rekorUrl: opt(rest, "--rekor-url"), fulcioUrl: opt(rest, "--fulcio-url") },
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
      const out = opt(rest, "-o") ?? file;
      await writeFile(resolve(out!), packageBytes);
      console.log(
        JSON.stringify(
          {
            ok: true,
            out,
            mint_status: files.manifest.mint?.mint_status,
            content_id: files.manifest.mint?.content_id,
            package_digest: files.manifest.package_digest,
            generation_usage: attestation.generation_usage,
            ...(transparency ? { transparency } : {}),
            ...(keyless ? { keyless } : {}),
          },
          null,
          2,
        ),
      );
      break;
    }

    case "publish": {
      console.error(
        "Publish is not part of the open .skill happy path.\n" +
          "Share the .skill file (git, chat, drive). Optional local log: skill registry publish <file>\n" +
          "Hosted registries are product concerns, not this protocol.",
      );
      process.exit(2);
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
      const { source, contract, resources, assets, report } = ingestSkillMd(resolve(inputPath!), {
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
              ? `Release-ready as authored. Review, then: skill pack <source> --approve --profile release, or promote this workspace and skill compile --mint.`
              : `Continuity draft written to ${out}. Fill the fields listed in missing_for_release (start with provenance.human_review — ingest can never fabricate that), then re-assess before a release compile.`,
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
      const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" },
      });
      const outDir = opt(rest, "-o") ?? ".";
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
              `Keep ${privPath} offline/secret — see the wiki's Key Ceremony page.`,
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
