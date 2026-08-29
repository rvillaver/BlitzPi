/**
 * Where BlitzPi lives on each operating system — the single source of truth.
 * `install.sh` mirrors this table (tests/paths.test.ts checks the two agree).
 *
 *   macOS   app: ~/Library/Application Support/BlitzPi     command: ~/.local/bin/blitzpi
 *   Linux   app: $XDG_DATA_HOME/blitzpi (~/.local/share)   command: ~/.local/bin/blitzpi
 *   Windows app: %LOCALAPPDATA%\BlitzPi                     command: %LOCALAPPDATA%\BlitzPi\bin\blitzpi.cmd
 *
 * `BLITZPI_HOME` overrides the app directory on every OS. Inside the app directory:
 *   bun/bin/bun          private Bun runtime (nothing else on the machine is required)
 *   versions/<version>/  one complete, self-contained copy per installed release
 *   current              -> versions/<version> in use
 */
import { existsSync, realpathSync } from "node:fs";
import { homedir as osHomedir } from "node:os";
import path from "node:path";

export type Platform = "darwin" | "linux" | "win32";

export interface BlitzPaths {
  platform: Platform;
  /** App directory: private runtime + installed versions. */
  home: string;
  versions: string;
  current: string;
  /** Private Bun executable. */
  bun: string;
  /** Directory the `blitzpi` command is placed in (should be on PATH). */
  binDir: string;
  /** The `blitzpi` command itself. */
  shim: string;
}

export function blitzPaths(
  platform: string = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  userHome: string = osHomedir(),
): BlitzPaths {
  const p = (platform === "darwin" || platform === "win32" ? platform : "linux") as Platform;
  const j = p === "win32" ? path.win32.join : path.posix.join;

  let home: string;
  if (env.BLITZPI_HOME) home = env.BLITZPI_HOME;
  else if (p === "darwin") home = j(userHome, "Library", "Application Support", "BlitzPi");
  else if (p === "win32") home = j(env.LOCALAPPDATA || j(userHome, "AppData", "Local"), "BlitzPi");
  else home = j(env.XDG_DATA_HOME || j(userHome, ".local", "share"), "blitzpi");

  const binDir = p === "win32" ? j(home, "bin") : j(userHome, ".local", "bin");
  return {
    platform: p,
    home,
    versions: j(home, "versions"),
    current: j(home, "current"),
    bun: j(home, "bun", "bin", p === "win32" ? "bun.exe" : "bun"),
    binDir,
    shim: j(binDir, p === "win32" ? "blitzpi.cmd" : "blitzpi"),
  };
}

/** True when `root` (a BlitzPi checkout/copy) is a version installed under the app directory. */
export function isInstalledCopy(root: string, paths: BlitzPaths = blitzPaths()): boolean {
  if (!existsSync(paths.versions)) return false;
  try {
    const real = realpathSync(root);
    const versions = realpathSync(paths.versions);
    return real.startsWith(versions + path.sep);
  } catch {
    return false;
  }
}
