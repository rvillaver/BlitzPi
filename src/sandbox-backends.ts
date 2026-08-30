/**
 * Pluggable bash execution backends. The classifier (bash-guard) decides allow/confirm/deny on every
 * OS; the BACKEND decides HOW the allowed command actually runs:
 *   - "bwrap"  : Linux OS-level isolation (workspace = only writable path). Hardened.
 *   - "pinned" : cross-platform fallback — runs the command with cwd/HOME/TMPDIR pinned to the
 *                workspace. NOT hardened (a computed path can still escape); the guard is the scope
 *                control here. This is where a future sandbox-exec/AppContainer backend slots in.
 */
import { dirname } from "node:path";
import { defaultScratchDirs } from "./zones";
import { spawn, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";

export interface Grant { path: string; write: boolean }
export interface ExecOptions {
  onData: (b: Buffer) => void;
  signal?: AbortSignal;
  timeout?: number;
  env?: NodeJS.ProcessEnv;
  /** Out-of-workspace paths the user approved for THIS command: the backend opens exactly these (read-only or
   *  read-write) instead of dropping confinement for the whole command. */
  grants?: Grant[];
}

/** The path a backend can actually open for a grant: the real path if it exists; for a write to a path that does not
 *  exist yet, its nearest existing ancestor (the directory the file will be created in); null = nothing to open. */
export function grantMount(g: Grant): string | null {
  const { existsSync } = require("node:fs");
  const { dirname } = require("node:path");
  let p = g.path;
  if (existsSync(p)) { try { return realpathSync(p); } catch { return p; } }
  if (!g.write) return null;
  for (let d = dirname(p); d !== dirname(d); d = dirname(d)) if (existsSync(d)) { try { return realpathSync(d); } catch { return d; } }
  return null;
}
export interface SandboxBackend {
  name: string;
  hardened: boolean;
  describe(runDir: string): string;
  exec(command: string, runDir: string, options: ExecOptions): Promise<{ exitCode: number | null }>;
}

export function bwrapAvailable(): boolean {
  try { return spawnSync("bwrap", ["--version"], { stdio: "ignore" }).status === 0; }
  catch { return false; }
}

export function sandboxExecAvailable(): boolean {
  if (process.platform !== "darwin") return false;
  try { return spawnSync("/usr/bin/sandbox-exec", ["-p", "(version 1)(allow default)", "true"], { stdio: "ignore" }).status === 0; }
  catch { return false; }
}

/**
 * Sandbox children are tracked and killed when Pi exits or is signalled. We deliberately do NOT use
 * bwrap's die-with-parent option: it relies on PR_SET_PDEATHSIG, which fires when the *thread* that spawned the
 * child exits — and Bun spawns from pool threads that get reaped, so sandboxes were randomly SIGKILLed
 * ~130 ms in (2 of 4 `bun add` runs died before downloading). With --unshare-pid, killing bwrap kills
 * everything inside it.
 */
const liveChildren = new Set<ReturnType<typeof spawn>>();
let exitHooksInstalled = false;
function trackChild(child: ReturnType<typeof spawn>): void {
  liveChildren.add(child);
  child.on("close", () => liveChildren.delete(child));
  if (!exitHooksInstalled) {
    exitHooksInstalled = true;
    const killAll = () => { for (const c of liveChildren) { try { c.kill("SIGKILL"); } catch { /* gone */ } } };
    process.on("exit", killAll);
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => { killAll(); process.exit(128); });
  }
}

/** Default ceiling for one command when the model gave no timeout: a hung tool must not hang a run. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 10 * 60_000;

function pump(child: ReturnType<typeof spawn>, options: ExecOptions, groupLeader = false): Promise<{ exitCode: number | null }> {
  trackChild(child);
  child.stdout?.on("data", (d: Buffer) => options.onData(d));
  child.stderr?.on("data", (d: Buffer) => options.onData(d));
  const killAll = () => { if (groupLeader && child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ } } try { child.kill("SIGKILL"); } catch { /* gone */ } };
  const limit = options.timeout && options.timeout > 0 ? options.timeout : DEFAULT_COMMAND_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; options.onData(Buffer.from(`\n[BASH] command exceeded ${Math.round(limit / 1000)} s and was stopped (pass a timeout for long jobs; start servers and probe them in the same command)\n`)); killAll(); }, limit);
  const onAbort = () => killAll();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  return new Promise((res) => {
    let done = false;
    const finish = (code: number | null) => { if (done) return; done = true; clearTimeout(timer); options.signal?.removeEventListener("abort", onAbort); res({ exitCode: timedOut ? 124 : code }); };
    child.on("error", (err) => { options.onData(Buffer.from(`[BASH] failed to start: ${err.message}\n`)); finish(126); });
    child.on("close", (code) => finish(code));
    // The shell exited but something it left behind still holds the pipes: the command is over — end the leftovers.
    child.on("exit", (code) => { setTimeout(() => { if (!done) { killAll(); finish(code); } }, 300).unref(); });
  });
}

const RO_SYSTEM_DIRS = ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc", "/opt", "/run"];

/** bwrap's init waits for EVERY process in the pid namespace, so `server &` kept the tool call open forever (the
 *  app-stack hang, 2026-08-30). A command ends when its shell ends: run it in a subshell, then kill whatever it left
 *  behind inside the namespace (`kill -9 -1` reaches only sandbox processes there), and return its own exit code. */
export function wrapForNamespace(command: string): string {
  return `( ${command}
); __rc=$?; kill -9 -1 2>/dev/null; exit $__rc`;
}
/** The runtime running BlitzPi (the private Bun when installed) must be reachable inside the sandbox. */
const RUNTIME_DIR = dirname(process.execPath);

class BwrapBackend implements SandboxBackend {
  name = "bwrap";
  hardened = true;
  describe(runDir: string) { return `bubblewrap — workspace ${runDir} is the only writable path (host network kept)`; }
  exec(command: string, runDir: string, options: ExecOptions) {
    const args: string[] = [];
    for (const d of RO_SYSTEM_DIRS) args.push("--ro-bind-try", d, d);
    args.push("--ro-bind-try", RUNTIME_DIR, RUNTIME_DIR);
    for (const d of defaultScratchDirs()) args.push("--bind-try", d, d); // scratch: the host temp dir, shared with the file tools
    for (const g of options.grants ?? []) { const m = grantMount(g); if (m) args.push(g.write ? "--bind-try" : "--ro-bind-try", m, m); } // approved escapes, and only those
    args.push("--proc", "/proc", "--dev", "/dev",
      "--bind", runDir, runDir, "--chdir", runDir,
      "--unshare-user", "--unshare-ipc", "--unshare-pid", "--unshare-uts", "--unshare-cgroup",
      "--setenv", "HOME", runDir,
      "/bin/bash", "-c", wrapForNamespace(command));
    const child = spawn("bwrap", args, { env: { ...process.env, ...options.env, HOME: runDir }, stdio: ["ignore", "pipe", "pipe"] });
    return pump(child, options);
  }
}

class PinnedBackend implements SandboxBackend {
  name = "pinned";
  hardened = false;
  describe(runDir: string) { return `cwd/HOME pinned to ${runDir} (scope guard active; not OS-isolated)`; }
  exec(command: string, runDir: string, options: ExecOptions) {
    const isWin = process.platform === "win32";
    const shell = isWin ? "powershell.exe" : "/bin/bash";
    const shellArgs = isWin ? ["-NoProfile", "-Command", command] : ["-c", command];
    const env = { ...process.env, ...options.env, HOME: runDir };
    const child = spawn(shell, shellArgs, { cwd: runDir, env, stdio: ["ignore", "pipe", "pipe"], detached: !isWin });
    return pump(child, options, !isWin);
  }
}

class SandboxExecBackend implements SandboxBackend {
  name = "sandbox-exec";
  hardened = true;
  describe(runDir: string) { return `macOS Seatbelt — file writes confined to ${runDir} (reads gated by the guard; network kept)`; }
  private profile(runDir: string, grants: Grant[] = []): string {
    // SBPL: allow by default, then deny all writes, then re-allow writes only inside the workspace,
    // the scratch (temp) dirs, plus the char devices a shell needs.
    const esc = (p: string) => p.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return [
      "(version 1)",
      "(allow default)",
      "(deny file-write*)",
      `(allow file-write* (subpath "${esc(runDir)}"))`,
      ...defaultScratchDirs().map((d) => `(allow file-write* (subpath "${esc(d)}"))`),
      ...grants.filter((g) => g.write).map(grantMount).filter((m): m is string => !!m).map((m) => `(allow file-write* (subpath "${esc(m)}"))`), // approved escapes, and only those
      '(allow file-write* (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr") (literal "/dev/tty") (literal "/dev/dtracehelper") (literal "/dev/random") (literal "/dev/urandom"))',
    ].join("\n");
  }
  exec(command: string, runDir: string, options: ExecOptions) {
    // Seatbelt matches the REAL path; on macOS /var→/private/var, /tmp→/private/tmp, so resolve symlinks
    // before building the profile or an in-workspace write under a symlinked dir is wrongly denied.
    let real = runDir; try { real = realpathSync(runDir); } catch { /* keep runDir */ }
    const env = { ...process.env, ...options.env, HOME: real };
    const args = ["-p", this.profile(real, options.grants ?? []), "/bin/bash", "-c", command];
    const child = spawn("/usr/bin/sandbox-exec", args, { cwd: real, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    return pump(child, options, true);
  }
}

export type BackendPref = "auto" | "bwrap" | "sandbox-exec" | "pinned" | "none";

/** Choose a backend. auto = bwrap when available (Linux hardening), else pinned (cross-platform). */
export function selectBackend(pref: BackendPref): SandboxBackend | null {
  switch (pref) {
    case "none": return null;
    case "bwrap": return bwrapAvailable() ? new BwrapBackend() : null;
    case "sandbox-exec": return sandboxExecAvailable() ? new SandboxExecBackend() : null;
    case "pinned": return new PinnedBackend();
    case "auto":
    default:
      if (bwrapAvailable()) return new BwrapBackend();          // Linux OS isolation
      if (sandboxExecAvailable()) return new SandboxExecBackend(); // macOS OS isolation (no install)
      return new PinnedBackend();                                // cross-platform fallback (guard only)
  }
}
