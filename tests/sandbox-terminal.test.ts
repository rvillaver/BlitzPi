/**
 * A sandboxed command must never reach the user's terminal. Without setsid the child inherits our controlling
 * tty, so anything prompting through /dev/tty (sudo, ssh/git passphrases, gh auth) reads the user's keystrokes
 * behind the TUI and leaves termios in raw/no-echo — the garbled prompt line after an interactive command.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { selectBackend } from "../src/sandbox-backends";

const probe = path.join(__dirname, "fixtures", "tty-probe.ts");
const hasScript = spawnSync("sh", ["-c", "command -v script"], { encoding: "utf-8" }).status === 0;

// ts-node runs the fixture; `script` gives the whole thing a real controlling terminal to try to steal.
function probeUnderPty(pref: string): string | null {
  const runner = fs.existsSync(path.join(__dirname, "..", "node_modules", ".bin", "ts-node"))
    ? `node_modules/.bin/ts-node --compiler-options '{"module":"commonjs"}' ${probe} ${pref}`
    : `bun ${probe} ${pref}`;
  // `script` takes the command differently on each side: GNU reads it from `-c`, BSD/macOS takes it as
  // positional words after the typescript file. `-c` on BSD is "illegal option" and the probe never runs,
  // so the test used to report UNEXPECTED here rather than NO_TTY.
  const args = process.platform === "linux"
    ? ["-qec", runner, "/dev/null"]
    : ["-qe", "/dev/null", "sh", "-c", runner];
  // stdin is explicitly NOT inherited. BSD `script` runs tcgetattr on its own stdin, and jest hands a
  // worker a socket, which fails with "tcgetattr/ioctl: Operation not supported on socket" before the
  // probe runs at all. The child still gets its own pty either way — that is `script`'s whole job, and
  // it is the tty the probe tries to steal.
  const r = spawnSync("script", args, {
    cwd: path.join(__dirname, ".."), encoding: "utf-8", timeout: 90_000, stdio: ["ignore", "pipe", "pipe"],
  });
  const out = (r.stdout || "") + (r.stderr || "");
  if (/STOLE_TTY/.test(out)) return "STOLE_TTY";
  if (/NO_TTY/.test(out)) return "NO_TTY";
  if (/\bSKIP\b/.test(out)) return null;
  return out.trim() ? `UNEXPECTED: ${out.trim().slice(-300)}` : null;
}

describe("sandboxed commands cannot open the user's terminal", () => {
  for (const pref of ["bwrap", "pinned"] as const) {
    test(`${pref} backend runs with no controlling tty`, () => {
      if (process.platform === "win32" || !hasScript || !selectBackend(pref)) return; // nothing to check on this host
      const seen = probeUnderPty(pref);
      if (seen === null) return; // backend unavailable inside the pty run
      expect(seen).toBe("NO_TTY");
    }, 120_000);
  }
});
