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
  loadTrustStore,
  defaultTrustStorePath,
} from "@skillerr/core";
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

function usage(exitCode = 1): never {
  console.log(`skill — Open .skill Protocol CLI v${VERSION}

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
  skill mint [--host name] [--signer-key <pem>] [--key-id id]
                                       Seal release (host required). Default seal is
                                       public-dev HMAC (development trust only). Pass
                                       --signer-key for a configured Ed25519 issuer
                                       seal (verified_issuer-eligible) — see
                                       skill keygen and docs/KEY-CEREMONY.md
  skill keygen [-o dir] [--key-id id]  Generate an Ed25519 issuer keypair for
                                       production signing (docs/KEY-CEREMONY.md)

Multi-skill identify:
  skill agent-guide [--json]           Exact create/identify protocol steps
  skill extract <journey.json> [-o dir] [--profile release|continuity]
                                       Candidate SkillContract/source scaffolds
  skill segment …                      Alias of extract

Ingest / run:
  skill inspect <file.skill> [--trust] [--trust-store <path>]
                                       TrustView (no compile / no model body)
  skill validate <file.skill>          Structure + hash integrity
  skill unpack <file.skill>
  skill verify-trust <file.skill> [--profile minted] [--allow-development-issuer]
                     [--allow-self-reported] [--trust-store <path>]
                                       Default trust store: ~/.skillerr/trust-store.json
  skill run <file.skill> [--mode execute] [--allow-untrusted]
                                       Dry-run by default; execute refuses
                                       unsigned/dev seals without --allow-untrusted
  skill pack <source.json> [-o out.skill] [--approve] [--profile release]
  skill contract-template              0.5 authoring contract scaffold
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
Docs:     https://dot-skill.github.io/skillerr-com/
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
      const root = requireWorkspace();
      const head = await loadHead(root);
      const file = rest.find((a) => a.endsWith(".skill")) ?? head.package_path;
      if (!file) throw new Error("No package to mint. Run skill compile first.");
      const bytes = new Uint8Array(await readFile(resolve(file)));
      const unpacked = unpackSkill(bytes);
      if (unpacked.raw.manifest.compile_profile === "continuity") {
        throw new Error("Cannot mint continuity draft. Recompile with --profile release first.");
      }
      const signerKeyPath = opt(rest, "--signer-key");
      const signer = signerKeyPath
        ? createEd25519Signer(
            await readFile(resolve(signerKeyPath), "utf8"),
            opt(rest, "--key-id") ?? "configured-issuer",
          )
        : undefined;
      const { packageBytes, files, attestation } = mintSkillPackage(unpacked.raw, {
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
        console.log(JSON.stringify(inspectTrustView(bytes, { trust_store }), null, 2));
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
      console.log(
        JSON.stringify(
          verifyMintTrust(new Uint8Array(await readFile(resolve(file!))), profile, {
            allow_development_issuer: flag(rest, "--allow-development-issuer"),
            allow_self_reported: flag(rest, "--allow-self-reported"),
            trust_store,
          }),
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
              `Keep ${privPath} offline/secret — see docs/KEY-CEREMONY.md.`,
              `Mint with it: skill mint --host <agent-host> --signer-key ${privPath} --key-id ${keyId}`,
              `Pin the public key for verifiers — add an entry to ~/.skillerr/trust-store.json (or --trust-store <path>):`,
              JSON.stringify(
                {
                  key_id: keyId,
                  public_key_pem: "<paste contents of " + pubPath + ">",
                  algorithm: "ed25519",
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
