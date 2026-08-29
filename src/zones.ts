/**
 * Zone classifier — maps any absolute path to a security zone. See docs/SECURITY-ZONES.md.
 * The coding flow is confined to the project; the security layer (audit, reading the install) is exempt
 * and never routed through this.
 */
import path from "node:path";
import os from "node:os";

export type Zone =
  | "project"         // the user's project folder (the launch/anchor dir)
  | "project-config"  // <project>/.blitz — this project's security policy
  | "goodbehavior"    // <project>/.blitz/goodbehavior and <project>/.pi/skills
  | "install"         // BlitzPi's own program files
  | "global"          // ~/.blitz — global audit trail + defaults
  | "system"          // /usr /bin /etc /lib ... (+ macOS/Windows equivalents)
  | "plumbing"        // /dev/null and friends — I/O plumbing, not data
  | "other";          // anything else (other projects, ~/.ssh, documents)

const PLUMBING = new Set([
  "/dev/null", "/dev/zero", "/dev/stdin", "/dev/stdout", "/dev/stderr",
  "/dev/tty", "/dev/random", "/dev/urandom", "/dev/full",
]);

const SYSTEM_PREFIXES = [
  "/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc", "/opt", "/run", "/proc", "/sys", "/boot",
  "/System", "/Library", "/private/etc", "/private/var", // macOS
  "C:\\Windows", "C:\\Program Files", // Windows
];

function under(p: string, root: string): boolean {
  if (!root) return false;
  const a = path.resolve(p);
  const r = path.resolve(root);
  return a === r || a.startsWith(r + path.sep);
}

export interface ZoneRoots {
  project: string;       // the project/anchor dir
  install: string;       // BlitzPi install dir
  home?: string;         // user home (for ~/.blitz)
}

export function classifyZone(target: string, roots: ZoneRoots): Zone {
  const home = roots.home || os.homedir();
  const abs = path.isAbsolute(target) ? path.resolve(target) : path.resolve(roots.project, target);

  if (PLUMBING.has(abs) || abs.startsWith("/dev/fd/")) return "plumbing";

  const gbDirs = [path.join(roots.project, ".blitz", "goodbehavior"), path.join(roots.project, ".pi", "skills")];
  if (gbDirs.some((d) => under(abs, d))) return "goodbehavior";
  if (under(abs, path.join(roots.project, ".blitz"))) return "project-config";
  if (under(abs, roots.project)) return "project";

  if (under(abs, path.join(home, ".blitz"))) return "global";
  if (roots.install && under(abs, roots.install)) return "install";

  if (SYSTEM_PREFIXES.some((pre) => abs === pre || abs.startsWith(pre + path.sep) || abs.startsWith(pre + "\\"))) return "system";

  return "other";
}
