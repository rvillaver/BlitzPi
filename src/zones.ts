/**
 * Zone classifier — maps any absolute path to a security zone. See docs/SECURITY-ZONES.md.
 * The coding flow is confined to the project; the security layer (audit, reading the install) is exempt
 * and never routed through this.
 */
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

export type Zone =
  | "project"         // the user's project folder (the launch/anchor dir)
  | "project-config"  // <project>/.blitz — this project's security policy
  | "goodbehavior"    // <project>/.blitz/goodbehavior and <project>/.pi/skills
  | "install"         // BlitzPi's own program files
  | "global"          // ~/.blitz — global audit trail + defaults
  | "system"          // /usr /bin /etc /lib ... (+ macOS/Windows equivalents)
  | "plumbing"        // /dev/null and friends — I/O plumbing, not data
  | "scratch"         // the OS temp dir (/tmp, $TMPDIR) — throwaway working space, writable in the sandbox
  | "other";          // anything else (other projects, ~/.ssh, documents)

const PLUMBING = new Set([
  "/dev/null", "/dev/zero", "/dev/stdin", "/dev/stdout", "/dev/stderr",
  "/dev/tty", "/dev/random", "/dev/urandom", "/dev/full",
]);

const SYSTEM_PREFIXES = [
  "/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc", "/opt", "/run", "/proc", "/sys", "/boot",
  "/System", "/Library", "/private/etc", "/private/var", // macOS
];
/** Windows: compared case-insensitively on the normalised path (drive letter + backslashes). */
const WINDOWS_SYSTEM_PREFIXES = ["C:\\Windows", "C:\\Program Files", "C:\\Program Files (x86)", "C:\\ProgramData"];

/** The path module for the roots' platform: Windows paths are resolved with `path.win32` even in a Linux test. */
const P = (roots: { platform?: string }) => (roots.platform === "win32" || (!roots.platform && process.platform === "win32") ? path.win32 : path.posix);
const isWin = (roots: { platform?: string }) => P(roots) === path.win32;
const norm = (roots: { platform?: string }, p: string) => (isWin(roots) ? P(roots).resolve(p).toLowerCase() : P(roots).resolve(p));

function underIn(roots: { platform?: string }, p: string, root: string): boolean {
  if (!root) return false;
  const a = norm(roots, p), r = norm(roots, root);
  return a === r || a.startsWith(r + P(roots).sep);
}
function under(p: string, root: string): boolean { return underIn({}, p, root); }

export interface ZoneRoots {
  project: string;       // the project/anchor dir
  install: string;       // BlitzPi install dir
  home?: string;         // user home (for ~/.blitz)
  scratch?: string[];    // temp dirs (default: os.tmpdir() + /tmp, symlinks resolved)
  platform?: string;     // "win32" makes paths resolve as Windows paths (default: this process's platform)
}

/** Temp directories that count as scratch space, with symlinks resolved (macOS: /tmp → /private/tmp). */
export function defaultScratchDirs(): string[] {
  const out = new Set<string>();
  for (const d of [os.tmpdir(), "/tmp"]) {
    out.add(path.resolve(d));
    try { out.add(fs.realpathSync(d)); } catch { /* absent */ }
  }
  return [...out];
}

/**
 * Resolve symlinks, so a link inside the project cannot smuggle a target outside it. Without this, a symlink at
 * `<project>/x` pointing at `~/.ssh` classified as `project` — the silent rung — and was never asked about.
 *
 * `realpathSync` throws on a path that does not exist yet (any file about to be created), so walk up to the
 * nearest existing ancestor and re-join the remainder: canonicalize what exists, invent nothing for what doesn't.
 * Nothing here is hardcoded — every prefix comes from the filesystem at call time.
 */
function canonical(p: typeof path.posix, abs: string): string {
  let head = abs, tail = "";
  for (;;) {
    try { const real = fs.realpathSync(head); return tail ? p.join(real, tail) : real; } catch { /* not there */ }
    const parent = p.dirname(head);
    if (parent === head) return abs; // nothing along this path exists — fall back to the lexical form
    tail = tail ? p.join(p.basename(head), tail) : p.basename(head);
    head = parent;
  }
}

export function classifyZone(target: string, roots: ZoneRoots): Zone {
  const p = P(roots);
  const home = roots.home || os.homedir();
  const win = isWin(roots);
  // `~` resolves to the real home here (right for file tools, which run unpinned); confined bash commands pre-map
  // `~` to the workspace before classification (bash-guard.dehomeTarget), where HOME is pinned to the project.
  const t = target === "~" || target.startsWith("~/") || target.startsWith("~\\") ? p.join(home, target.slice(1)) : target;
  // A target still carrying an unexpanded shell expansion (`$HOME`, `$(…)`, backticks) cannot be resolved here.
  // Joining it to the project root would claim it is in-project — the permissive answer for the one case we
  // genuinely cannot classify (audit 15/16). Unknown resolves to `other`, the conservative zone.
  if (/[$`]/.test(t)) return "other";
  // Canonicalization is skipped when classifying for a platform that isn't this one (the win32-on-Linux tests):
  // there is no real filesystem behind those paths, so realpath would only ever fail on them.
  const synthetic = (roots.platform ?? process.platform) !== process.platform;
  const memo = new Map<string, string>();
  const C = (s: string) => {
    if (synthetic) return s;
    let v = memo.get(s); if (v === undefined) { v = canonical(p, s); memo.set(s, v); }
    return v;
  };
  const lexical = p.isAbsolute(t) ? p.resolve(t) : p.resolve(roots.project, t);
  // Plumbing is matched on the LEXICAL path, before canonicalization. These are names for I/O streams, not places
  // on disk: `/dev/stderr` is a symlink to `/proc/self/fd/2`, so resolving it first would reclassify every
  // ordinary `2>/dev/stderr` redirection as a system-zone touch.
  if (!win && (PLUMBING.has(lexical) || lexical.startsWith("/dev/fd/"))) return "plumbing";
  if (win && /^\\\\\.\\(nul|con|prn)$/i.test(lexical)) return "plumbing";

  const abs = C(lexical);
  // Both sides are canonicalized: resolving only the target would misclassify in-project files whenever the
  // project root itself sits under a symlink (macOS `/tmp` → `/private/tmp` is the everyday case).
  const u = (root: string) => underIn(roots, abs, C(root));

  const gbDirs = [p.join(roots.project, ".blitz", "goodbehavior"), p.join(roots.project, ".pi", "skills")];
  if (gbDirs.some(u)) return "goodbehavior";
  if (u(p.join(roots.project, ".blitz", "transfer"))) return "project"; // chat file transfer: plain workspace files
  if (u(p.join(roots.project, ".blitz"))) return "project-config";
  if (u(roots.project)) return "project";

  if ((roots.scratch ?? defaultScratchDirs()).some(u)) return "scratch";

  if (u(p.join(home, ".blitz"))) return "global";
  if (roots.install && u(roots.install)) return "install";

  if (win) { const a = abs.toLowerCase(); if (WINDOWS_SYSTEM_PREFIXES.some((pre) => a === pre.toLowerCase() || a.startsWith(pre.toLowerCase() + "\\"))) return "system"; }
  else if (SYSTEM_PREFIXES.some((pre) => abs === pre || abs.startsWith(pre + path.sep))) return "system";

  return "other";
}
