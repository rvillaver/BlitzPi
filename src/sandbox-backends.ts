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

export interface ExecOptions {
  onData: (b: Buffer) => void;
  signal?: AbortSignal;
  timeout?: number;
  env?: NodeJS.ProcessEnv;
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

function pump(child: ReturnType<typeof spawn>, options: ExecOptions): Promise<{ exitCode: number | null }> {
  child.stdout?.on("data", (d: Buffer) => options.onData(d));
  child.stderr?.on("data", (d: Buffer) => options.onData(d));
  let timer: NodeJS.Timeout | undefined;
  if (options.timeout && options.timeout > 0) timer = setTimeout(() => child.kill("SIGKILL"), options.timeout);
  const onAbort = () => child.kill("SIGKILL");
  options.signal?.addEventListener("abort", onAbort, { once: true });
  return new Promise((res) => {
    child.on("error", (err) => { options.onData(Buffer.from(`[BASH] failed to start: ${err.message}\n`)); res({ exitCode: 126 }); });
    child.on("close", (code) => { if (timer) clearTimeout(timer); options.signal?.removeEventListener("abort", onAbort); res({ exitCode: code }); });
  });
}

const RO_SYSTEM_DIRS = ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc", "/opt", "/run"];
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
    args.push("--proc", "/proc", "--dev", "/dev",
      "--bind", runDir, runDir, "--chdir", runDir,
      "--unshare-user", "--unshare-ipc", "--unshare-pid", "--unshare-uts", "--unshare-cgroup",
      "--die-with-parent", "--setenv", "HOME", runDir,
      "/bin/bash", "-c", command);
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
    const child = spawn(shell, shellArgs, { cwd: runDir, env, stdio: ["ignore", "pipe", "pipe"] });
    return pump(child, options);
  }
}

class SandboxExecBackend implements SandboxBackend {
  name = "sandbox-exec";
  hardened = true;
  describe(runDir: string) { return `macOS Seatbelt — file writes confined to ${runDir} (reads gated by the guard; network kept)`; }
  private profile(runDir: string): string {
    // SBPL: allow by default, then deny all writes, then re-allow writes only inside the workspace,
    // the scratch (temp) dirs, plus the char devices a shell needs.
    const esc = (p: string) => p.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return [
      "(version 1)",
      "(allow default)",
      "(deny file-write*)",
      `(allow file-write* (subpath "${esc(runDir)}"))`,
      ...defaultScratchDirs().map((d) => `(allow file-write* (subpath "${esc(d)}"))`),
      '(allow file-write* (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr") (literal "/dev/tty") (literal "/dev/dtracehelper") (literal "/dev/random") (literal "/dev/urandom"))',
    ].join("\n");
  }
  exec(command: string, runDir: string, options: ExecOptions) {
    // Seatbelt matches the REAL path; on macOS /var→/private/var, /tmp→/private/tmp, so resolve symlinks
    // before building the profile or an in-workspace write under a symlinked dir is wrongly denied.
    let real = runDir; try { real = realpathSync(runDir); } catch { /* keep runDir */ }
    const env = { ...process.env, ...options.env, HOME: real };
    const args = ["-p", this.profile(real), "/bin/bash", "-c", command];
    const child = spawn("/usr/bin/sandbox-exec", args, { cwd: real, env, stdio: ["ignore", "pipe", "pipe"] });
    return pump(child, options);
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
