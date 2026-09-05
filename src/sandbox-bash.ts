/**
 * Bash under the permission gate. The tool_call hook classifies the command (dangerous shape, or the
 * most severe named path) and asks the gate. Approved commands run under the OS backend
 * (bwrap/Seatbelt/pinned); an approved out-of-project PATH is opened for that command as a grant, so
 * confinement holds. Only an approved dangerous SHAPE (sudo, download|shell) runs unconfined.
 * Blocked commands don't run.
 */
import type { ExtensionAPI, ToolCallEvent, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { stats } from "./security-status";
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { BlitzConfig } from "./config";
import type { AuditLogger } from "./audit";
import { dangerousShape, dehomeTarget, extractTargets } from "./bash-guard";
import { selectBackend, type SandboxBackend, type BackendPref, type Grant, toolTimeoutMs } from "./sandbox-backends";
import { grantsFor, type PermissionGate } from "./permission-gate";
import { cacheEnv, cacheRoot } from "./toolchain-cache";
import { ensureSandboxConfig, isBunInstall, parseAge, parseUntrusted, renderPolicy, summarizeAudit } from "./feeds/install-policy";
import { homedir } from "node:os";
import { debug, info } from "./log";
import { bashFacts } from "./bash-facts";
import { redactCommand } from "./feeds/secrets";
import { startCapabilityProbe } from "./sandbox-probe";

let activeBackend: string | null = null;
/** Name of the bash sandbox backend in use this session (bwrap | sandbox-exec | pinned), or null. */
export const activeBackendName = () => activeBackend;

export function setupSandboxedBash(pi: ExtensionAPI, config: BlitzConfig, audit: AuditLogger, gate: PermissionGate): void {
  if (!config.sandbox.enabled) { info("[Blitz:BashSandbox] disabled"); return; }
  const runDir = resolve(config.sandbox.run_dir);
  const backend: SandboxBackend | null = selectBackend((config.sandbox.backend ?? "auto") as BackendPref);
  activeBackend = backend ? backend.name : null;
  const runPlan = new Map<string, { confined: boolean; grants: Grant[] }>(); // command -> how to run it
  // Toolchain caches: one BlitzPi-owned root, routed via env and opened read-write in every confined command (G3).
  const cache = cacheRoot(config.sandbox.cache ?? "shared", runDir);
  const cacheGrant: Grant[] = cache ? [{ path: cache, write: true }] : [];
  // Bun install policy (minimumReleaseAge) rides in as XDG_CONFIG_HOME → a BlitzPi-owned .bunfig.toml, read-only.
  const policyAge = parseAge(config.feeds?.min_release_age);
  const policyDir = ensureSandboxConfig(resolve(process.env.HOME || homedir(), ".blitz", "sandbox-config"), policyAge);
  const policyGrant: Grant[] = policyDir ? [{ path: policyDir, write: false }] : [];
  // Policy env wins over the session env Pi passes through: a shell that exports XDG_CONFIG_HOME or a cache dir
  // must not steer a sandboxed command past the cache root or the install policy.
  const withCache = (env: NodeJS.ProcessEnv | undefined) => ({ ...env, ...(cache ? cacheEnv(cache) : {}), ...(policyDir ? { XDG_CONFIG_HOME: policyDir } : {}) });
  /** After a Bun install inside the sandbox: what Bun refused to run, and what the tree's advisories look like. */
  const postInstall = async (run: (cmd: string, sink: (s: string) => void) => Promise<unknown>): Promise<string> => {
    let untrustedOut = "", auditOut = "";
    await run("bun pm untrusted 2>/dev/null", (t) => { untrustedOut += t; });
    await run("bun audit --json 2>/dev/null", (t) => { auditOut += t; });
    const untrusted = parseUntrusted(untrustedOut), summary = summarizeAudit(auditOut);
    audit.log({ type: "install_policy", tool: "bash", untrusted, advisories: summary?.total ?? 0, by_severity: summary?.bySeverity ?? {}, min_release_age: policyAge });
    return renderPolicy(untrusted, summary);
  };

  pi.on("tool_call", async (event: ToolCallEvent, ctx: ExtensionContext) => {
    if ((event as any).toolName !== "bash") return;
    const command: string = (event as any).input?.command ?? "";

    const shape = dangerousShape(command);
    // With a sandbox backend, HOME is pinned to the workspace: `~` targets are workspace paths and must classify
    // that way (file tools and backend-less runs keep real-home resolution).
    const targets = shape ? [] : extractTargets(command).map((t) => (backend ? { ...t, path: dehomeTarget(t.path, runDir) } : t));
    const res = shape
      ? await gate.resolveDangerousCommand(command, shape, ctx)
      : await (async () => { const w = gate.worst(targets, command); return gate.resolve(w.action, w.zone, w.target, "bash command", ctx, command); })();

    if (!res.allow) { stats.blocked.bash++; return { block: true, reason: `[BLOCKED] ${res.reason} (${res.zone})` }; }
    // A dangerous SHAPE (sudo, download|shell, reverse shell) the user allowed runs unconfined — the backend cannot
    // host it. An approved out-of-project PATH keeps the OS sandbox: the backend opens exactly that path (G2c).
    runPlan.set(command, shape ? { confined: false, grants: [] } : { confined: true, grants: grantsFor(targets, gate.roots) });
  });

  const def = createBashToolDefinition(runDir, {
    exposeSessionEnvironment: true,
    operations: {
      exec: (command, _cwd, rawOptions) => {
        const options = { ...rawOptions, timeout: toolTimeoutMs(rawOptions.timeout) }; // Pi sends seconds; backends take ms
        const plan = runPlan.get(command) ?? { confined: true, grants: [] };
        runPlan.delete(command);
        const t0 = Date.now();
        if (plan.confined && backend) {
          audit.log({ type: "bash_exec", confined: true, backend: backend.name, command: redactCommand(command), ...bashFacts(command), ...(plan.grants.length ? { grants: plan.grants } : {}) });
          const execOpts = { ...options, env: withCache(options.env), grants: [...cacheGrant, ...policyGrant, ...plan.grants] };
          return backend.exec(command, runDir, execOpts).then(async (r) => {
            audit.log({ type: "bash_exit", backend: backend.name, exit_code: r.exitCode, aborted: !!options.signal?.aborted, ms: Date.now() - t0, command: redactCommand(command).slice(0, 120) });
            if (r.exitCode === 0 && isBunInstall(command) && !options.signal?.aborted) {
              const line = await postInstall((cmd, sink) => backend.exec(cmd, runDir, { ...execOpts, onData: (b) => sink(b.toString()), timeout: 60_000 }));
              if (line) options.onData(Buffer.from(`\n${line}\n`));
            }
            return r;
          });
        }
        // unconfined: the user approved a dangerous command shape (or there is no backend). Run in the project cwd.
        audit.log({ type: "bash_exec", confined: false, command: redactCommand(command), ...bashFacts(command) });
        debug("bash (unconfined, approved) :", command);
        const child = spawn("/bin/bash", ["-c", command], { cwd: runDir, env: { ...process.env, ...withCache(options.env) }, stdio: ["ignore", "pipe", "pipe"] });
        child.stdout.on("data", (d: Buffer) => options.onData(d));
        child.stderr.on("data", (d: Buffer) => options.onData(d));
        let timer: NodeJS.Timeout | undefined;
        if (options.timeout && options.timeout > 0) timer = setTimeout(() => child.kill("SIGKILL"), options.timeout);
        const onAbort = () => child.kill("SIGKILL");
        options.signal?.addEventListener("abort", onAbort, { once: true });
        return new Promise((r) => {
          child.on("error", (e) => { options.onData(Buffer.from(`[bash] ${e.message}\n`)); r({ exitCode: 126 }); });
          child.on("close", (code) => {
            if (timer) clearTimeout(timer); options.signal?.removeEventListener("abort", onAbort);
            audit.log({ type: "bash_exit", backend: "none", exit_code: code, aborted: !!options.signal?.aborted, ms: Date.now() - t0, command: redactCommand(command).slice(0, 120) });
            r({ exitCode: code });
          });
        });
      },
    },
  });
  pi.registerTool(def);
  // What the agent can actually reach inside the sandbox (P1). Fire-and-forget through the SAME backend the bash
  // tool uses, so the answer is the sandbox's PATH, not the host's — asking the host is how G3 got it wrong.
  // Never awaited here: the probe must not add to startup.
  startCapabilityProbe(backend, runDir, withCache(undefined),
    backend ? (cmd, onData) => backend.exec(cmd, runDir, { env: withCache(undefined), onData, timeout: 10_000, grants: [...cacheGrant, ...policyGrant] } as any) : undefined);

  info(`[Blitz:BashSandbox] gate active; backend=${backend ? backend.name : "none"}${cache ? `; toolchain cache ${config.sandbox.cache} → ${cache}` : "; toolchain cache off"}${policyDir ? `; bun minimumReleaseAge ${policyAge}s` : "; bun install policy off"}`);
}
