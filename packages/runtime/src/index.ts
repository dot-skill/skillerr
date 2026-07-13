import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { posix as posixPath } from "node:path";
import type {
  CapabilityAdapterHint,
  CapabilityRequirement,
  InputSlot,
  RuntimeMode,
  SideEffectClass,
  SkillPackageFiles,
  SkillPermission,
  SkillRun,
  SkillStepRecord,
  TrustProfile,
  WorkflowStep,
} from "@skillerr/protocol";
import {
  inspectSkill,
  inspectTrustView,
  unpackSkill,
  validatePackageBytes,
  verifyMintTrust,
  sha256Digest,
} from "@skillerr/core";

export interface CapabilityAdapter {
  name: string;
  supports: (cap: CapabilityRequirement) => boolean;
  invoke: (
    cap: CapabilityRequirement,
    args: Record<string, unknown>,
  ) => Promise<{ ok: boolean; result?: unknown; error?: string; adapter: CapabilityAdapterHint }>;
}

export interface RuntimeHost {
  askInputs?: (slots: InputSlot[]) => Promise<Record<string, unknown>>;
  consent?: (plan: {
    title: string;
    permissions: string[];
    steps: string[];
  }) => Promise<{ allowed: boolean; actor: string; at: string }>;
  decide?: (decision: {
    id: string;
    prompt: string;
    choices?: string[];
  }) => Promise<{ decision: string; actor: string; at: string }>;
  verifyAssertion?: (assertion: {
    id: string;
    assertion: string;
    check: "runtime" | "capability" | "human" | "agent";
    evidence?: string[];
  }) => Promise<{ passed: boolean; detail?: string }>;
  resolveSecret?: (ref: string) => Promise<string>;
  env?: Record<string, string>;
  adapters?: CapabilityAdapter[];
  model?: string;
  host?: string;
}

export interface RunOptions {
  mode?: RuntimeMode;
  inputs?: Record<string, unknown>;
  resume_from?: string;
  checkpoint_state?: Record<string, unknown>;
  /** Defaults to manifest policy. Use open only for untrusted drafts. */
  trust_profile?: TrustProfile;
  /** Reference verifier only; production runtimes should use a real trust store. */
  issuer_secret?: string;
  /**
   * Explicit unsafe opt-in to execute unsigned / development / self_reported packages.
   * Required for execute when TrustView is not verified_issuer.
   */
  allow_untrusted?: boolean;
  /** Allow public-dev HMAC seals for local testing only. */
  allow_development_issuer?: boolean;
}

function loadRuntimeIdentity(): { name: string; version: string } {
  const metadata = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { name?: unknown; version?: unknown };
  if (typeof metadata.name !== "string" || typeof metadata.version !== "string") {
    throw new Error("Invalid @skillerr/runtime package metadata");
  }
  return { name: metadata.name, version: metadata.version };
}

const { name: RUNTIME_NAME, version: RUNTIME_VERSION } = loadRuntimeIdentity();

function permissionCovers(
  permissions: SkillPermission[],
  sideEffect: SideEffectClass,
): SkillPermission | undefined {
  return permissions.find((p) => p.side_effect_class === sideEffect);
}

/**
 * SEC-A: extract the real hostname from a bare host, "host:port", or full
 * URL. Using the WHATWG URL parser (rather than substring/startsWith checks
 * against the raw string) closes bypasses like
 * `https://evil.com/?q=example.com` (substring match) and
 * `example.com.attacker.io` (prefix match) against an allowlisted
 * `example.com`.
 */
function extractHostname(value: string): string | undefined {
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return url.hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Exact hostname match, or a `*.example.com` allowlist entry matching as a
 * dot-anchored suffix — never a bare substring/prefix match.
 */
function hostMatchesAllowlist(hostArg: string, allowed: string[]): boolean {
  const hostname = extractHostname(hostArg);
  if (!hostname) return false;
  return allowed.some((entry) => {
    const pattern = entry.trim().toLowerCase();
    if (pattern.startsWith("*.")) {
      const bare = pattern.slice(2);
      return hostname === bare || hostname.endsWith(`.${bare}`);
    }
    return hostname === pattern;
  });
}

/**
 * SEC-B: normalize with posix-resolve semantics before comparing so
 * `/data/../etc/passwd` can't pass a `startsWith("/data/")` prefix check —
 * it normalizes to `/etc/passwd`, which correctly fails against root `/data`.
 */
function isPathWithinRoot(pathArg: string, root: string): boolean {
  const normPath = posixPath.normalize(pathArg);
  const normRoot = posixPath.normalize(root).replace(/\/+$/, "") || "/";
  return normPath === normRoot || normPath.startsWith(`${normRoot}/`);
}

/**
 * Deny-by-default: refuse undeclared network / filesystem / secret adapter use.
 * Fail closed when consent is required but missing.
 */
export function assertCapabilityAllowed(
  pkg: SkillPackageFiles,
  cap: CapabilityRequirement,
  args: Record<string, unknown> = {},
): void {
  const policy = pkg.manifest.policy;
  const side = cap.side_effect_class;

  if (side === "network") {
    if (!policy.allow_network) {
      throw new Error(
        `Denied: capability ${cap.name} requires network but policy.allow_network=false (deny-by-default)`,
      );
    }
    const perm = permissionCovers(pkg.manifest.permissions, "network");
    if (!perm) {
      throw new Error(
        `Denied: capability ${cap.name} uses network but no network permission is declared`,
      );
    }
    const hostArg =
      typeof args.host === "string"
        ? args.host
        : typeof args.url === "string"
          ? args.url
          : typeof args.endpoint === "string"
            ? args.endpoint
            : undefined;
    if (perm.hosts?.length) {
      // Deny-by-default extends to "can't tell what host this call targets"
      // — an allowlist was declared, so silently letting an unattributable
      // call through would defeat it.
      if (!hostArg || !hostMatchesAllowlist(hostArg, perm.hosts)) {
        throw new Error(
          `Denied: network host/url not in declared permission.hosts for ${cap.name}`,
        );
      }
    }
  }

  if (side === "read" || side === "write" || side === "destructive" || side === "exec") {
    const perm = permissionCovers(pkg.manifest.permissions, side);
    // SEC-H: `read` used to be exempt from deny-by-default (undeclared reads
    // were allowed), contradicting the documented deny-by-default model and
    // leaving an exfiltration path (read an arbitrary file, emit it later).
    // A declared read permission is now required like write/destructive.
    // PHASE 4: `exec` had the exact same gap and had gone unnoticed — this
    // whole `if` was originally read/write/destructive only, so a `tool`
    // step invoking an `exec`-class capability (the bundled-script case
    // this phase documents) fell through every branch below unchecked and
    // was silently allowed regardless of permissions/consent, the most
    // dangerous side_effect_class to have had this gap. `exec` now
    // requires a declared permission exactly like the others.
    if (!perm) {
      throw new Error(
        `Denied: capability ${cap.name} uses ${side} but no matching permission is declared`,
      );
    }
    const pathArg =
      typeof args.path === "string"
        ? args.path
        : typeof args.file === "string"
          ? args.file
          : typeof args.root === "string"
            ? args.root
            : undefined;
    const roots = policy.filesystem_roots;
    if (pathArg && roots?.length) {
      const ok = roots.some((root) => isPathWithinRoot(pathArg, root));
      if (!ok) {
        throw new Error(
          `Denied: path ${pathArg} outside policy.filesystem_roots for ${cap.name}`,
        );
      }
    }
    if (pathArg && perm.paths?.length) {
      const ok = perm.paths.some((p) => isPathWithinRoot(pathArg, p));
      if (!ok) {
        throw new Error(
          `Denied: path ${pathArg} not in declared permission.paths for ${cap.name}`,
        );
      }
    }
  }

  if (side === "none") {
    // no side effects — allowed
  }
}

function assertSecretAccessAllowed(
  pkg: SkillPackageFiles,
  slotName: string,
): void {
  const slot = pkg.manifest.inputs.find((i) => i.name === slotName);
  if (!slot || (slot.sensitivity !== "secret" && slot.source !== "secret")) {
    throw new Error(
      `Denied: secret access for undeclared slot ${slotName} (deny-by-default)`,
    );
  }
}

/** Resolve a secret ref only if the input slot declares secret sensitivity/source. */
export async function resolveDeclaredSecret(
  pkg: SkillPackageFiles,
  slotName: string,
  host: RuntimeHost,
): Promise<string> {
  assertSecretAccessAllowed(pkg, slotName);
  if (!host.resolveSecret) {
    throw new Error("Denied: no resolveSecret callback (fail closed for secrets)");
  }
  return host.resolveSecret(slotName);
}

function substitute(template: string, inputs: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_, name: string) => {
    const v = inputs[name];
    return v === undefined || v === null ? `{{${name}}}` : String(v);
  });
}

function missingInputs(
  slots: InputSlot[],
  provided: Record<string, unknown>,
  env: Record<string, string>,
): InputSlot[] {
  return slots.filter((slot) => {
    if (!slot.required && slot.ask_when !== "always") return false;
    if (slot.ask_when === "never") return false;
    if (provided[slot.name] !== undefined) return false;
    if (slot.default !== undefined) return false;
    if (slot.source === "environment" && env[slot.name] !== undefined) return false;
    if (slot.ask_when === "if_missing" || slot.ask_when === "always" || slot.required) {
      return true;
    }
    return false;
  });
}

function resolveInputsSync(
  slots: InputSlot[],
  provided: Record<string, unknown>,
  env: Record<string, string>,
): { resolved: Record<string, unknown>; secret_refs: Record<string, string>; missing: InputSlot[] } {
  const resolved: Record<string, unknown> = { ...provided };
  const secret_refs: Record<string, string> = {};
  for (const slot of slots) {
    if (resolved[slot.name] !== undefined) {
      if (slot.sensitivity === "secret") {
        secret_refs[slot.name] = String(resolved[slot.name]);
        resolved[slot.name] = `secret:${slot.name}`;
      }
      continue;
    }
    if (slot.source === "environment" && env[slot.name] !== undefined) {
      resolved[slot.name] = env[slot.name];
      continue;
    }
    if (slot.default !== undefined) {
      resolved[slot.name] = slot.default;
    }
  }
  return { resolved, secret_refs, missing: missingInputs(slots, resolved, env) };
}

export function explainPackage(pkg: SkillPackageFiles): {
  title: string;
  description: string;
  inputs: InputSlot[];
  permissions: string[];
  steps: Array<{ id: string; kind: string; title?: string }>;
  constraints: string[];
} {
  return {
    title: pkg.manifest.title,
    description: pkg.manifest.description,
    inputs: pkg.manifest.inputs,
    permissions: pkg.manifest.permissions.map(
      (p) => `${p.side_effect_class}: ${p.description}`,
    ),
    steps: pkg.workflow.steps.map((s) => ({ id: s.id, kind: s.kind, title: s.title })),
    constraints: (pkg.workflow.constraints ?? []).map((c) => `${c.effect}: ${c.statement}`),
  };
}

export async function runSkillPackage(
  pkg: SkillPackageFiles,
  host: RuntimeHost = {},
  options: RunOptions = {},
): Promise<SkillRun> {
  const mode: RuntimeMode = options.mode ?? "execute";
  const started = new Date().toISOString();
  const runId = `run_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const stepRecords: SkillStepRecord[] = [];
  const verifications: SkillRun["verifications"] = [];
  const outputs: Record<string, unknown> = {};
  const stepOutputs: Record<string, unknown> = { ...(options.checkpoint_state ?? {}) };

  const env = host.env ?? Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  );

  let { resolved, secret_refs, missing } = resolveInputsSync(
    pkg.manifest.inputs,
    options.inputs ?? {},
    env,
  );

  if (missing.length && host.askInputs && mode !== "inspect" && mode !== "explain") {
    const answered = await host.askInputs(missing);
    ({ resolved, secret_refs, missing } = resolveInputsSync(
      pkg.manifest.inputs,
      { ...resolved, ...answered },
      env,
    ));
  }

  if (mode === "inspect" || mode === "explain") {
    return {
      kind: "skill_run",
      id: runId,
      skill_id: pkg.manifest.id,
      skill_version: pkg.manifest.version,
      package_digest: pkg.manifest.package_digest,
      status: missing.length ? "paused" : "succeeded",
      mode,
      resolved_inputs: resolved,
      secret_refs,
      steps: [],
      outputs: { explanation: explainPackage(pkg), missing_inputs: missing.map((m) => m.name) },
      verifications: [],
      runtime: {
        name: RUNTIME_NAME,
        version: RUNTIME_VERSION,
        host: host.host,
        model: host.model,
      },
      started_at: started,
      finished_at: new Date().toISOString(),
    };
  }

  if (missing.length) {
    return {
      kind: "skill_run",
      id: runId,
      skill_id: pkg.manifest.id,
      skill_version: pkg.manifest.version,
      package_digest: pkg.manifest.package_digest,
      status: "paused",
      mode,
      resolved_inputs: resolved,
      secret_refs,
      steps: [],
      verifications: [],
      runtime: {
        name: RUNTIME_NAME,
        version: RUNTIME_VERSION,
        host: host.host,
        model: host.model,
      },
      started_at: started,
      finished_at: new Date().toISOString(),
      error: `Missing required inputs: ${missing.map((m) => m.name).join(", ")}`,
    };
  }

  const consentNeeded = new Set<string>(
    pkg.manifest.permissions
      .filter((p) => p.requires_consent)
      .map((p) => p.side_effect_class),
  );
  for (const side of pkg.manifest.policy.consent_for ?? []) {
    if (
      pkg.manifest.capabilities.some((c) => c.side_effect_class === side) ||
      pkg.manifest.permissions.some((p) => p.side_effect_class === side)
    ) {
      consentNeeded.add(side);
    }
  }
  if (mode === "execute" && consentNeeded.size) {
    if (!host.consent) {
      return failRun(
        runId,
        pkg,
        mode,
        resolved,
        secret_refs,
        stepRecords,
        verifications,
        started,
        host,
        "Explicit permission consent required; runtime host has no authenticated consent callback (fail closed)",
      );
    }
    const consent = await host.consent({
      title: pkg.manifest.title,
      permissions: [...consentNeeded],
      steps: pkg.workflow.steps.map((s) => `${s.id}:${s.kind}`),
    });
    if (!consent.actor || !consent.at) {
      return failRun(
        runId,
        pkg,
        mode,
        resolved,
        secret_refs,
        stepRecords,
        verifications,
        started,
        host,
        "Permission consent callback returned invalid actor/timestamp evidence",
      );
    }
    if (!consent.allowed) {
      return {
        kind: "skill_run",
        id: runId,
        skill_id: pkg.manifest.id,
        skill_version: pkg.manifest.version,
        package_digest: pkg.manifest.package_digest,
        status: "cancelled",
        mode,
        resolved_inputs: resolved,
        secret_refs,
        steps: [],
        verifications: [],
        runtime: {
          name: RUNTIME_NAME,
          version: RUNTIME_VERSION,
          host: host.host,
          model: host.model,
        },
        started_at: started,
        finished_at: new Date().toISOString(),
        error: "User denied permissions",
      };
    }
  }

  const adapters = host.adapters ?? [];
  for (const cap of pkg.manifest.capabilities) {
    if (!cap.required) continue;
    const ok = adapters.some((a) => a.supports(cap));
    if (!ok && cap.fallback === "fail") {
      return {
        kind: "skill_run",
        id: runId,
        skill_id: pkg.manifest.id,
        skill_version: pkg.manifest.version,
        package_digest: pkg.manifest.package_digest,
        status: "failed",
        mode,
        resolved_inputs: resolved,
        secret_refs,
        steps: [],
        verifications: [],
        runtime: {
          name: RUNTIME_NAME,
          version: RUNTIME_VERSION,
          host: host.host,
          model: host.model,
        },
        started_at: started,
        finished_at: new Date().toISOString(),
        error: `Required capability unavailable: ${cap.name}`,
      };
    }
  }

  const byId = new Map(pkg.workflow.steps.map((s) => [s.id, s]));
  let current: string | undefined =
    options.resume_from ?? pkg.workflow.entrypoint ?? pkg.manifest.entrypoint;
  let toolCalls = 0;
  const dry = mode === "dry_run";

  while (current) {
    const step = byId.get(current);
    if (!step) {
      return failRun(runId, pkg, mode, resolved, secret_refs, stepRecords, verifications, started, host, `Unknown step ${current}`);
    }

    const record: SkillStepRecord = {
      step_id: step.id,
      kind: step.kind,
      status: "pending",
      started_at: new Date().toISOString(),
    };

    try {
      if (step.kind === "checkpoint" && step.require_human && mode === "execute") {
        record.status = "waiting";
        record.finished_at = new Date().toISOString();
        stepRecords.push(record);
        return {
          kind: "skill_run",
          id: runId,
          skill_id: pkg.manifest.id,
          skill_version: pkg.manifest.version,
          package_digest: pkg.manifest.package_digest,
          status: "paused",
          mode,
          resolved_inputs: resolved,
          secret_refs,
          steps: stepRecords,
          outputs,
          verifications,
          runtime: {
            name: RUNTIME_NAME,
            version: RUNTIME_VERSION,
            host: host.host,
            model: host.model,
          },
          checkpoints: [
            {
              id: `cp_${step.id}`,
              step_id: step.id,
              at: new Date().toISOString(),
              state_digest: sha256Digest(JSON.stringify(stepOutputs)),
            },
          ],
          started_at: started,
          finished_at: new Date().toISOString(),
        };
      }

      const result = await executeStep(step, {
        inputs: resolved,
        secret_refs,
        stepOutputs,
        pkg,
        adapters,
        dry,
        host,
      });
      if (result.toolCall) toolCalls += 1;
      if (toolCalls > pkg.manifest.policy.max_tool_calls) {
        throw new Error("max_tool_calls exceeded");
      }
      record.status = result.skipped ? "skipped" : "succeeded";
      record.adapter = result.adapter;
      record.output_digest = result.output !== undefined
        ? sha256Digest(JSON.stringify(result.output))
        : undefined;
      if (result.output !== undefined) {
        stepOutputs[step.id] = result.output;
        if (result.resultAs) stepOutputs[result.resultAs] = result.output;
      }
      if (result.emit) {
        outputs[result.emit.name] = result.emit.value;
      }
      if (result.verifications) verifications.push(...result.verifications);
      record.finished_at = new Date().toISOString();
      stepRecords.push(record);
      current = result.next ?? nextStepId(step);
    } catch (e) {
      record.status = "failed";
      record.error = e instanceof Error ? e.message : String(e);
      record.finished_at = new Date().toISOString();
      stepRecords.push(record);
      if (step.on_fail) {
        current = step.on_fail;
        continue;
      }
      if (step.optional) {
        current = nextStepId(step);
        continue;
      }
      return failRun(
        runId,
        pkg,
        mode,
        resolved,
        secret_refs,
        stepRecords,
        verifications,
        started,
        host,
        record.error,
      );
    }
  }

  for (const out of pkg.manifest.outputs) {
    if (out.required && outputs[out.name] === undefined) {
      const last = stepRecords.filter((s) => s.status === "succeeded").at(-1);
      if (last && stepOutputs[last.step_id] !== undefined) {
        outputs[out.name] = stepOutputs[last.step_id];
      } else {
        verifications.push({
          assertion: `output:${out.name}`,
          passed: false,
          detail: "Required output missing",
        });
      }
    }
  }

  const failedVerify = verifications.some((v) => !v.passed);
  return {
    kind: "skill_run",
    id: runId,
    skill_id: pkg.manifest.id,
    skill_version: pkg.manifest.version,
    package_digest: pkg.manifest.package_digest,
    status: failedVerify ? "failed" : "succeeded",
    mode,
    resolved_inputs: resolved,
    secret_refs,
    steps: stepRecords,
    outputs,
    verifications,
    runtime: {
      name: RUNTIME_NAME,
      version: RUNTIME_VERSION,
      host: host.host,
      model: host.model,
    },
    started_at: started,
    finished_at: new Date().toISOString(),
    error: failedVerify ? "Verification failed" : undefined,
  };
}

function nextStepId(step: WorkflowStep): string | undefined {
  if (!step.next) return undefined;
  return Array.isArray(step.next) ? step.next[0] : step.next;
}

function failRun(
  runId: string,
  pkg: SkillPackageFiles,
  mode: RuntimeMode,
  resolved: Record<string, unknown>,
  secret_refs: Record<string, string>,
  steps: SkillStepRecord[],
  verifications: SkillRun["verifications"],
  started: string,
  host: RuntimeHost,
  error: string,
): SkillRun {
  return {
    kind: "skill_run",
    id: runId,
    skill_id: pkg.manifest.id,
    skill_version: pkg.manifest.version,
    package_digest: pkg.manifest.package_digest,
    status: "failed",
    mode,
    resolved_inputs: resolved,
    secret_refs,
    steps,
    verifications,
    runtime: {
      name: RUNTIME_NAME,
      version: RUNTIME_VERSION,
      host: host.host,
      model: host.model,
    },
    started_at: started,
    finished_at: new Date().toISOString(),
    error,
  };
}

async function executeStep(
  step: WorkflowStep,
  ctx: {
    inputs: Record<string, unknown>;
    secret_refs: Record<string, string>;
    stepOutputs: Record<string, unknown>;
    pkg: SkillPackageFiles;
    adapters: CapabilityAdapter[];
    dry: boolean;
    host: RuntimeHost;
  },
): Promise<{
  output?: unknown;
  resultAs?: string;
  next?: string;
  skipped?: boolean;
  toolCall?: boolean;
  adapter?: CapabilityAdapterHint;
  emit?: { name: string; value: unknown };
  verifications?: SkillRun["verifications"];
}> {
  switch (step.kind) {
    case "instruct": {
      const text = substitute(step.text, ctx.inputs);
      const constraints = (ctx.pkg.workflow.constraints ?? [])
        .map((c) => `- [${c.effect}] ${c.statement}`)
        .join("\n");
      return {
        output: {
          instruction: text,
          knowledge_refs: step.knowledge_refs,
          constraints,
          dry_run: ctx.dry,
        },
      };
    }
    case "prompt": {
      const rendered = substitute(step.template, {
        ...ctx.inputs,
        ...Object.fromEntries(
          Object.entries(step.input_bindings ?? {}).map(([k, v]) => [
            k,
            ctx.inputs[v] ?? ctx.stepOutputs[v],
          ]),
        ),
      });
      return { output: { prompt: rendered } };
    }
    case "tool": {
      const cap = ctx.pkg.manifest.capabilities.find((c) => c.name === step.capability);
      if (!cap) throw new Error(`Unknown capability ${step.capability}`);
      const args = { ...(step.arguments ?? {}) };
      for (const [k, bind] of Object.entries(step.argument_bindings ?? {})) {
        args[k] = ctx.inputs[bind] ?? ctx.stepOutputs[bind];
      }
      // Deny-by-default capability gate (even in dry_run for visibility of refusals).
      assertCapabilityAllowed(ctx.pkg, cap, args);
      if (ctx.dry) {
        return {
          output: { dry_run: true, capability: cap.name, arguments: step.arguments },
          resultAs: step.result_as,
          toolCall: true,
        };
      }
      const adapter = ctx.adapters.find((a) => a.supports(cap));
      if (!adapter) {
        if (cap.fallback === "skip_if_optional" || step.optional) {
          return { skipped: true };
        }
        if (cap.fallback === "ask_human") {
          throw new Error(`Capability ${cap.name} requires human/tool adapter`);
        }
        throw new Error(`No adapter for capability ${cap.name}`);
      }
      const inv = await adapter.invoke(cap, args);
      if (!inv.ok) throw new Error(inv.error ?? "tool failed");
      return {
        output: inv.result,
        resultAs: step.result_as,
        toolCall: true,
        adapter: inv.adapter,
      };
    }
    case "transform": {
      const input = step.input_from
        ? ctx.stepOutputs[step.input_from] ?? ctx.inputs[step.input_from]
        : ctx.stepOutputs;
      if (step.expression === "identity") {
        return { output: input, resultAs: step.result_as };
      }
      if (step.expression.startsWith("jsonpath:")) {
        const key = step.expression.slice("jsonpath:".length).replace(/^\$\.?/, "");
        const val =
          input && typeof input === "object"
            ? (input as Record<string, unknown>)[key]
            : undefined;
        return { output: val, resultAs: step.result_as };
      }
      throw new Error(`Unsupported transform: ${step.expression}`);
    }
    case "branch": {
      for (const c of step.cases) {
        if (evalWhen(c.when, ctx.inputs, ctx.stepOutputs)) {
          return { next: c.goto, output: { branched: c.goto } };
        }
      }
      if (step.else) return { next: step.else, output: { branched: step.else } };
      return { output: { branched: null } };
    }
    case "iterate": {
      const collection = ctx.inputs[step.over] ?? ctx.stepOutputs[step.over];
      if (!Array.isArray(collection)) throw new Error(`iterate.over ${step.over} is not an array`);
      const results = [];
      for (const item of collection) {
        results.push({ [step.as]: item, body: step.body });
      }
      return { output: results };
    }
    case "delegate": {
      if (ctx.dry) return { output: { dry_run: true, task: step.task }, resultAs: step.result_as };
      throw new Error("delegate requires an A2A adapter (not configured)");
    }
    case "checkpoint": {
      return { output: { checkpoint: true, message: step.message } };
    }
    case "human_decision": {
      if (ctx.dry) {
        return {
          output: { awaiting_human: true, prompt: step.prompt, choices: step.choices },
          resultAs: step.result_as,
        };
      }
      if (!ctx.host.decide) {
        throw new Error(
          `human_decision ${step.id} unsupported: runtime requires an authenticated decide callback; input values cannot spoof human approval`,
        );
      }
      const evidence = await ctx.host.decide({
        id: step.id,
        prompt: step.prompt,
        choices: step.choices,
      });
      if (!evidence.actor || !evidence.at || !evidence.decision) {
        throw new Error(`human_decision ${step.id} returned invalid approval evidence`);
      }
      return { output: evidence, resultAs: step.result_as };
    }
    case "verify": {
      const results: SkillRun["verifications"] = [];
      for (const assertion of step.assertions) {
        if (assertion === "all_required_inputs_resolved") {
          const missing = ctx.pkg.manifest.inputs.filter(
            (i) => i.required && ctx.inputs[i.name] === undefined,
          );
          results.push({
            assertion,
            passed: missing.length === 0,
            detail: missing.length ? missing.map((m) => m.name).join(",") : undefined,
          });
        } else if (
          assertion.startsWith("constraint_present:") ||
          assertion.startsWith("honor:")
        ) {
          const cid = assertion.slice(assertion.indexOf(":") + 1);
          const c = ctx.pkg.workflow.constraints?.find((x) => x.id === cid);
          results.push({
            assertion,
            passed: Boolean(c),
            detail: c
              ? `Constraint is present (behavioral compliance is host responsibility): ${c.statement}`
              : "Constraint missing",
          });
        } else if (assertion.startsWith("exists:")) {
          const key = assertion.slice("exists:".length);
          const val = ctx.stepOutputs[key] ?? ctx.inputs[key];
          results.push({ assertion, passed: val !== undefined });
        } else if (
          assertion.startsWith("precondition:") ||
          assertion.startsWith("contract_assertion:")
        ) {
          const id = assertion.slice(assertion.indexOf(":") + 1);
          const definition =
            ctx.pkg.workflow.preconditions?.status === "specified"
              ? ctx.pkg.workflow.preconditions.items.find((item) => item.id === id)
              : ctx.pkg.workflow.verification?.status === "specified"
                ? ctx.pkg.workflow.verification.items.find((item) => item.id === id)
                : undefined;
          if (!definition) {
            results.push({ assertion, passed: false, detail: "Contract assertion missing" });
          } else if (!ctx.host.verifyAssertion) {
            results.push({
              assertion,
              passed: false,
              detail:
                "Unsupported domain assertion: runtime host must provide verifyAssertion; presence is not proof",
            });
          } else {
            const checked = await ctx.host.verifyAssertion({
              id: definition.id,
              assertion: "assertion" in definition ? definition.assertion : "",
              check: definition.check,
              evidence: "evidence" in definition ? definition.evidence : undefined,
            });
            results.push({ assertion, ...checked });
          }
        } else {
          results.push({
            assertion,
            passed: !ctx.pkg.manifest.policy.fail_on_unsupported_step,
            detail: ctx.pkg.manifest.policy.fail_on_unsupported_step
              ? "Unsupported assertion"
              : "Unrecognized assertion treated as advisory",
          });
        }
      }
      if (results.some((r) => !r.passed)) {
        throw new Error(`Verification failed: ${results.filter((r) => !r.passed).map((r) => r.assertion).join(", ")}`);
      }
      return { output: { verified: true }, verifications: results };
    }
    case "emit": {
      const value = ctx.stepOutputs[step.from] ?? ctx.inputs[step.from];
      return { output: value, emit: { name: step.output, value } };
    }
    case "subskill": {
      throw new Error(`subskill ${step.skill_id} not resolved in this runtime invocation`);
    }
    default: {
      const _exhaustive: never = step;
      void _exhaustive;
      throw new Error("Unsupported step kind");
    }
  }
}

function evalWhen(
  expr: string,
  inputs: Record<string, unknown>,
  stepOutputs: Record<string, unknown>,
): boolean {
  const m = expr.match(/^input:([a-zA-Z0-9_]+)(?:==(.*))?$/);
  if (!m) {
    throw new Error(
      `Unsupported branch expression ${JSON.stringify(expr)}; supported form is input:name or input:name==value`,
    );
  }
  const val = inputs[m[1]!] ?? stepOutputs[m[1]!];
  if (m[2] === undefined) return Boolean(val);
  return String(val) === m[2];
}

export async function runSkillArchive(
  archive: Uint8Array,
  host: RuntimeHost = {},
  options: RunOptions = {},
): Promise<SkillRun> {
  const validation = validatePackageBytes(archive);
  if (!validation.ok) {
    const started = new Date().toISOString();
    return {
      kind: "skill_run",
      id: `run_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      skill_id: validation.manifest?.id ?? "invalid",
      skill_version: validation.manifest?.version ?? "0.0.0",
      package_digest: validation.manifest?.package_digest ?? "",
      status: "failed",
      mode: options.mode ?? "execute",
      resolved_inputs: {},
      steps: [],
      verifications: validation.issues.map((i) => ({
        assertion: i.code,
        passed: false,
        detail: i.message,
      })),
      runtime: { name: RUNTIME_NAME, version: RUNTIME_VERSION, host: host.host, model: host.model },
      started_at: started,
      finished_at: new Date().toISOString(),
      error: "Package validation failed",
    };
  }
  const unpacked = unpackSkill(archive);
  const manifest = unpacked.manifest;
  const mode = options.mode ?? "execute";
  const trustView = inspectTrustView(archive);

  // Execute refuses unsigned / development / self_reported unless explicit unsafe flag.
  if (mode === "execute" || mode === "resume") {
    const trusted = trustView.trust_state === "verified_issuer";
    if (!trusted && !options.allow_untrusted) {
      const started = new Date().toISOString();
      return {
        kind: "skill_run",
        id: `run_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        skill_id: manifest.id,
        skill_version: manifest.version,
        package_digest: manifest.package_digest,
        status: "failed",
        mode,
        resolved_inputs: {},
        steps: [],
        verifications: [
          {
            assertion: "trust_gate",
            passed: false,
            detail: `${trustView.label}. Pass allow_untrusted / --allow-untrusted to execute anyway.`,
          },
        ],
        runtime: {
          name: RUNTIME_NAME,
          version: RUNTIME_VERSION,
          host: host.host,
          model: host.model,
        },
        started_at: started,
        finished_at: new Date().toISOString(),
        error: `Refusing execute: ${trustView.label}`,
      };
    }
  }

  const trustProfile: TrustProfile =
    options.trust_profile ??
    (manifest.policy.require_anchor
      ? "anchored"
      : manifest.policy.require_minted || manifest.policy.require_signatures
        ? "minted"
        : manifest.policy.trust_profile ?? "open");
  if (trustProfile !== "open") {
    const nonExecute = mode === "dry_run" || mode === "inspect" || mode === "explain";
    const trust = verifyMintTrust(archive, trustProfile, {
      issuer_secret: options.issuer_secret,
      allow_development_issuer:
        options.allow_development_issuer ??
        (options.allow_untrusted === true || nonExecute),
      allow_self_reported: options.allow_untrusted === true || nonExecute,
    });
    if (!trust.ok) {
      const started = new Date().toISOString();
      return {
        kind: "skill_run",
        id: `run_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        skill_id: manifest.id,
        skill_version: manifest.version,
        package_digest: manifest.package_digest,
        status: "failed",
        mode,
        resolved_inputs: {},
        steps: [],
        verifications: trust.issues.map((issue) => ({
          assertion: issue.code,
          passed: issue.severity !== "error",
          detail: issue.message,
        })),
        runtime: {
          name: RUNTIME_NAME,
          version: RUNTIME_VERSION,
          host: host.host,
          model: host.model,
        },
        started_at: started,
        finished_at: new Date().toISOString(),
        error: "Package trust verification failed",
      };
    }
  } else if ((mode === "execute" || mode === "resume") && !options.allow_untrusted) {
    // Open profile packages are explicitly untrusted for execute.
    const started = new Date().toISOString();
    return {
      kind: "skill_run",
      id: `run_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      skill_id: manifest.id,
      skill_version: manifest.version,
      package_digest: manifest.package_digest,
      status: "failed",
      mode,
      resolved_inputs: {},
      steps: [],
      verifications: [
        {
          assertion: "open_untrusted",
          passed: false,
          detail: "Open/unsigned packages require --allow-untrusted for execute",
        },
      ],
      runtime: {
        name: RUNTIME_NAME,
        version: RUNTIME_VERSION,
        host: host.host,
        model: host.model,
      },
      started_at: started,
      finished_at: new Date().toISOString(),
      error: "Refusing execute of open/untrusted package without --allow-untrusted",
    };
  }
  return runSkillPackage(unpacked.raw, host, options);
}

export {
  inspectSkill,
  inspectTrustView,
  validatePackageBytes,
  unpackSkill,
  explainPackage as explain,
};
