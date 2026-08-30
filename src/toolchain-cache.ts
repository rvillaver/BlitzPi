/**
 * Toolchain caches under the sandbox. Package managers write their caches to the user's home (Bun:
 * `$BUN_INSTALL/install/cache`, npm: `~/.npm/_cacache`, pip: `~/.cache/pip`, …). The sandbox pins HOME to the
 * workspace, but env vars set by the tools' installers (`BUN_INSTALL=~/.bun` …) still point at the real home —
 * outside the workspace, so `bun install` fails with EPERM in ~40 ms. Instead of opening the host caches (a
 * poisoned cache would reach every project and the user's own shell), every sandboxed command gets one
 * BlitzPi-owned cache root and the env vars that route each tool into it.
 *   sandbox.cache: shared  → ~/.blitz/cache/<tool>            (default; shared across projects, never the host's)
 *                  project → <project>/.blitz/cache/<tool>    (fully per-project; re-downloads per project)
 *                  off     → no cache routing (the pre-1.2.104 behaviour)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type CacheMode = "shared" | "project" | "off";

/** Env var → cache subdirectory. Only caches — never a tool's home/bin dir (CARGO_HOME, BUN_INSTALL hold binaries). */
export const CACHE_ENV: Record<string, string> = {
  BUN_INSTALL_CACHE_DIR: "bun",
  npm_config_cache: "npm",
  YARN_CACHE_FOLDER: "yarn",
  npm_config_store_dir: "pnpm", // pnpm's content-addressable store
  XDG_CACHE_HOME: "xdg", // pip, uv, poetry, cargo registry index, many CLIs
  PIP_CACHE_DIR: "pip",
  UV_CACHE_DIR: "uv",
  GOCACHE: "go-build",
  GOMODCACHE: "go-mod",
};

export function cacheRoot(mode: CacheMode, projectRoot: string, home = process.env.HOME || os.homedir()): string | null {
  if (mode === "off") return null;
  return mode === "project" ? path.join(projectRoot, ".blitz", "cache") : path.join(home, ".blitz", "cache");
}

/** The env that routes every known package manager into `root`; directories are created so tools never fall back. */
export function cacheEnv(root: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, sub] of Object.entries(CACHE_ENV)) {
    const dir = path.join(root, sub);
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* unwritable root → the tool reports it */ }
    env[name] = dir;
  }
  return env;
}
