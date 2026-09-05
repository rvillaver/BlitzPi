/**
 * What can the agent actually reach INSIDE its sandbox? (EMBEDDED-PYTHON-RUNTIME P1 — gaps G5/G6/G8.)
 *
 * The agent's PATH inside the sandbox is not the host's. bwrap binds only `RO_SYSTEM_DIRS`
 * (`/usr /bin /sbin /lib /lib64 /etc /opt /run`) plus the BlitzPi runtime dir — so a toolchain installed under
 * `~/.local`, `~/.bun`, mise, asdf, nvm or a language version manager is on the host's PATH and **absent** from the
 * sandbox. Asking the host (`which python3`) therefore answers a different question than the one that matters, and
 * answers it wrong: that is exactly gap G3. This probe runs the check through the live backend, so what it reports
 * is what a bash tool call would actually find.
 *
 * Cost: one backend spawn, started at extension setup and never awaited on the startup path. Callers read
 * `capabilityLine()`, which returns null until the result is in — a probe must not become the thing that makes
 * startup slower.
 */
import type { SandboxBackend } from "./sandbox-backends";
import { debug } from "./log";

/** Short and fixed on purpose: every entry costs nothing to check, but the line has to stay readable. */
export const PROBED_TOOLS = ["bash", "bun", "node", "python3", "git", "make", "cc", "go", "ruby"] as const;

export interface SandboxCapabilities {
  /** Tools resolvable on PATH inside the sandbox, in PROBED_TOOLS order. */
  available: string[];
  /** Probed tools that are NOT reachable inside the sandbox, whatever the host has. */
  missing: string[];
  /** null when there is no backend: the command runs unconfined, so the host's PATH is the truth. */
  backend: string | null;
}

let result: SandboxCapabilities | null = null;
let inFlight: Promise<SandboxCapabilities | null> | null = null;

/** `command -v` per tool: POSIX, no subprocess per lookup, and silent when a tool is absent. */
function probeCommand(): string {
  return `for t in ${PROBED_TOOLS.join(" ")}; do command -v "$t" >/dev/null 2>&1 && echo "$t"; done`;
}

function parse(stdout: string, backend: string | null): SandboxCapabilities {
  const seen = new Set(stdout.split("\n").map((l) => l.trim()).filter(Boolean));
  const available = PROBED_TOOLS.filter((t) => seen.has(t));
  return { available, missing: PROBED_TOOLS.filter((t) => !seen.has(t)), backend };
}

/**
 * Start the probe. Fire-and-forget: never await this on a startup path.
 * With no backend there is nothing to confine the command, so the probe still runs — through the same code path
 * the bash tool would use — and the answer is simply the host's PATH, which is then the honest answer.
 */
export function startCapabilityProbe(
  backend: SandboxBackend | null,
  runDir: string,
  env: NodeJS.ProcessEnv | undefined,
  exec?: (command: string, onData: (b: Buffer) => void) => Promise<{ exitCode: number | null }>,
): Promise<SandboxCapabilities | null> {
  if (inFlight) return inFlight;
  let out = "";
  const run = exec
    ? exec(probeCommand(), (b) => { out += b.toString(); })
    : backend
      ? backend.exec(probeCommand(), runDir, { env, onData: (b: Buffer) => { out += b.toString(); }, timeout: 10_000 } as any)
      : null;
  if (!run) { result = null; return Promise.resolve(null); }
  inFlight = run
    .then(() => {
      result = parse(out, backend ? backend.name : null);
      debug(`[Blitz:Probe] inside ${result.backend ?? "no sandbox"}: ${result.available.join(" ") || "(nothing found)"}`);
      return result;
    })
    .catch((e) => { debug(`[Blitz:Probe] failed: ${(e as Error).message}`); result = null; return null; });
  return inFlight;
}

/** The probe's result, or null if it has not finished (or could not run). Never blocks. */
export function capabilities(): SandboxCapabilities | null { return result; }

/**
 * Wait for the probe, but never longer than `maxMs`. The probe is started at extension setup and measures ~27 ms
 * (one bwrap spawn) on this machine, so by the time a banner renders it is normally already done and this returns
 * immediately. The cap is what keeps that "normally" from becoming a startup regression on a slower box: past it,
 * the header simply omits the line rather than making anyone wait for it.
 */
export async function awaitCapabilities(maxMs = 250): Promise<SandboxCapabilities | null> {
  if (result || !inFlight) return result;
  let timer: NodeJS.Timeout | undefined;
  const capped = new Promise<null>((r) => { timer = setTimeout(() => r(null), maxMs); (timer as any).unref?.(); });
  const winner = await Promise.race([inFlight, capped]);
  if (timer) clearTimeout(timer);
  return winner ?? result;
}

/**
 * One header line, or null when there is nothing trustworthy to say yet. Deliberately names what is MISSING as well
 * as what is present: "python3 is not in here" is the fact that changes what the agent decides to do.
 */
export function capabilityLine(): string | null {
  if (!result) return null;
  const where = result.backend ? `in the ${result.backend} sandbox` : "on PATH (no sandbox backend)";
  const missing = result.missing.length ? ` · not available: ${result.missing.join(", ")}` : "";
  return `     toolchain ${where}: ${result.available.join(", ") || "none of the probed tools"}${missing}`;
}

/** Tests only. */
export function __resetProbe(): void { result = null; inFlight = null; }
export const __parse = parse;
export const __probeCommand = probeCommand;
