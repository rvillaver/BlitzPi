/**
 * Bash under the permission gate. The tool_call hook classifies the command (dangerous shape, or the
 * most severe named path) and asks the gate. Approved commands run under the OS backend
 * (bwrap/Seatbelt/pinned); an approved out-of-project PATH is opened for that command as a grant, so
 * confinement holds. Only an approved dangerous SHAPE (sudo, download|shell) runs unconfined.
 * Blocked commands don't run.
 */
import type { ExtensionAPI, ToolCallEvent, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { stats } from "./security-status";
import { createBashToolDefinition, createPowerShellToolDefinition } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { BlitzConfig } from "./config";
import type { AuditLogger } from "./audit";
import { dangerousShape, dehomeTarget, extractTargets, invokesContainerCli } from "./bash-guard";
import { dangerousShapePowerShell, extractTargetsPowerShell } from "./powershell-guard";
import { selectBackend, type SandboxBackend, type BackendPref, type Grant, toolTimeoutMs } from "./sandbox-backends";
import { grantsFor, type PermissionGate } from "./permission-gate";
import { cacheEnv, cacheRoot } from "./toolchain-cache";
import { ensureSandboxConfig, isBunInstall, parseAge, parseUntrusted, renderPolicy, summarizeAudit } from "./feeds/install-policy";
import { homedir } from "node:os";
import { debug, info } from "./log";
import { bashFacts } from "./bash-facts";
import { redactCommand } from "./feeds/secrets";
import { startCapabilityProbe } from "./sandbox-probe";


/** Where the container daemon listens: `DOCKER_HOST=unix://…` when set, else the usual socket, else null when there
 *  is none to reach. Only the socket is ever opened — never all of `/var` and `/run`, which is what the original
 *  fix did (audit 17, G17-3). */
function containerSocketPath(): string | null {
  const host = process.env.DOCKER_HOST;
  if (host?.startsWith("unix://")) return host.slice("unix://".length);
  for (const p of ["/var/run/docker.sock", "/run/docker.sock", "/run/podman/podman.sock"]) if (existsSync(p)) return p;
  return null;
}

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
    const toolName: string = (event as any).toolName;
    if (toolName !== "bash" && toolName !== "powershell") return;
    const command: string = (event as any).input?.command ?? "";

    // Which grammar will this command actually be read in? Pi's `powershell` tool is PowerShell by definition —
    // it used to return early here, so shapes, zones, the gate and confinement never ran for it at all. The
    // `bash` tool is POSIX everywhere except Windows, where the pinned backend hands it to powershell.exe
    // (sandbox-backends.ts): there it must be read in BOTH grammars, and the union is what the gate sees.
    // Reading a command in one grammar while another shell executes it is guarding that looks real and isn't.
    const psGrammar = toolName === "powershell";
    const bothGrammars = !psGrammar && process.platform === "win32";
    const shape = psGrammar
      ? dangerousShapePowerShell(command)
      : dangerousShape(command) ?? (bothGrammars ? dangerousShapePowerShell(command) : null);
    // With a sandbox backend, HOME is pinned to the workspace: `~` targets are workspace paths and must classify
    // that way (file tools and backend-less runs keep real-home resolution).
    // The container daemon's socket is root-owned: reaching it is a privileged out-of-project WRITE, so it is added
    // as a target *before* the gate decides, like every other escape. It used to be appended to the grants after
    // `gate.resolve()` had already returned, where no rung of the ladder could see it (audit 17, G17-1/G17-4).
    const socket = !shape && invokesContainerCli(command) ? containerSocketPath() : null;
    const posixTargets = shape || psGrammar ? [] : extractTargets(command);
    const psTargets = !shape && (psGrammar || bothGrammars) ? extractTargetsPowerShell(command) : [];
    const targets = shape
      ? []
      : [
          ...posixTargets.map((t) => (backend ? { ...t, path: dehomeTarget(t.path, runDir) } : t)),
          // Deliberately NOT dehomed. The backends pin HOME, so a POSIX `~` really is the workspace — but
          // PowerShell reads `$env:USERPROFILE`, which nothing pins, so a profile path there is genuinely
          // outside the workspace and must classify that way.
          ...psTargets,
          ...(socket ? [{ path: socket, write: true }] : []),
        ];
    // Shell expansion hides paths from extraction: `cat "$SECRET"` yields no targets at all. A *hardened* backend
    // confines the command whatever it names, so silence is correct there. A non-hardened backend (pinned — Windows,
    // and macOS without sandbox-exec) only pins cwd/HOME, so an unparseable command must not fall through to
    // worst()'s in-project seed, which would silently approve it (audit 16, G16-1).
    const opaque = !shape && !backend?.hardened && targets.length === 0 && /[$`]/.test(command);
    const res = shape
      ? await gate.resolveDangerousCommand(command, shape, ctx)
      : opaque
      ? await gate.resolve("read", "other", command, `${toolName} command (unresolvable paths, unconfined backend)`, ctx, command)
      : await (async () => { const w = gate.worst(targets, command); return gate.resolve(w.action, w.zone, w.target, `${toolName} command`, ctx, command); })();

    if (!res.allow) { stats.blocked.bash++; return { block: true, reason: `[BLOCKED] ${res.reason} (${res.zone})` }; }
    // A dangerous SHAPE (sudo, download|shell, reverse shell) the user allowed runs unconfined — the backend cannot
    // host it. An approved out-of-project PATH keeps the OS sandbox: the backend opens exactly that path (G2c).
    // Grants follow from the approved targets and nothing else. The socket, when present, is already one of them.
    const grants = grantsFor(targets, gate.roots);
    runPlan.set(command, shape ? { confined: false, grants: [] } : { confined: true, grants });
  });

  /** Shared by both shell tools: same backend, same grants, same audit. The gate above decides; this runs. */
  const execOperations = {
      exec: (command: string, _cwd: string, rawOptions: any): Promise<{ exitCode: number | null }> => {
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
        // The shell must match the platform, the same way PinnedBackend picks one: there is no /bin/bash on
        // Windows, so an approved dangerous shape there failed to spawn at all rather than running.
        const isWin = process.platform === "win32";
        const child = spawn(
          isWin ? "powershell.exe" : "/bin/bash",
          isWin ? ["-NoProfile", "-Command", command] : ["-c", command],
          { cwd: runDir, env: { ...process.env, ...withCache(options.env) }, stdio: ["ignore", "pipe", "pipe"] },
        );
        child.stdout.on("data", (d: Buffer) => options.onData(d));
        child.stderr.on("data", (d: Buffer) => options.onData(d));
        let timer: NodeJS.Timeout | undefined;
        if (options.timeout && options.timeout > 0) timer = setTimeout(() => child.kill("SIGKILL"), options.timeout);
        const onAbort = () => child.kill("SIGKILL");
        options.signal?.addEventListener("abort", onAbort, { once: true });
        return new Promise<{ exitCode: number | null }>((r) => {
          child.on("error", (e) => { options.onData(Buffer.from(`[bash] ${e.message}\n`)); r({ exitCode: 126 }); });
          child.on("close", (code) => {
            if (timer) clearTimeout(timer); options.signal?.removeEventListener("abort", onAbort);
            audit.log({ type: "bash_exit", backend: "none", exit_code: code, aborted: !!options.signal?.aborted, ms: Date.now() - t0, command: redactCommand(command).slice(0, 120) });
            r({ exitCode: code });
          });
        });
      },
  };

  pi.registerTool(createBashToolDefinition(runDir, { exposeSessionEnvironment: true, operations: execOperations }));
  // Pi registers a SEPARATE `powershell` tool, and without a replacement its commands run outside the backend
  // entirely — unpinned cwd/HOME, no grants, no audit. Same gate, same exec path. The factory throws on
  // non-Windows (getPowerShellConfig: "only available on Windows"), so it is only built there, and a throw is
  // reported rather than taking the whole security layer down with it.
  if (process.platform === "win32") {
    try {
      pi.registerTool(createPowerShellToolDefinition(runDir, { exposeSessionEnvironment: true, operations: execOperations } as any));
      info("[Blitz:BashSandbox] powershell tool registered — same gate, same backend");
    } catch (e) {
      info(`[Blitz:BashSandbox] WARNING: powershell tool NOT sandboxed (${e instanceof Error ? e.message : String(e)}) — its commands are still gated by the tool_call hook, but run outside the backend`);
    }
  }
  // What the agent can actually reach inside the sandbox (P1). Fire-and-forget through the SAME backend the bash
  // tool uses, so the answer is the sandbox's PATH, not the host's — asking the host is how G3 got it wrong.
  // Never awaited here: the probe must not add to startup.
  startCapabilityProbe(backend, runDir, withCache(undefined),
    backend ? (cmd, onData) => backend.exec(cmd, runDir, { env: withCache(undefined), onData, timeout: 10_000, grants: [...cacheGrant, ...policyGrant] } as any) : undefined);

  info(`[Blitz:BashSandbox] gate active; backend=${backend ? backend.name : "none"}${cache ? `; toolchain cache ${config.sandbox.cache} → ${cache}` : "; toolchain cache off"}${policyDir ? `; bun minimumReleaseAge ${policyAge}s` : "; bun install policy off"}`);
}
