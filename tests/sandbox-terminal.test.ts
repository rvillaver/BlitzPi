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
  const r = spawnSync("script", ["-qec", runner, "/dev/null"], { cwd: path.join(__dirname, ".."), encoding: "utf-8", timeout: 90_000 });
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
