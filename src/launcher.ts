/**
 * BlitzPi launcher — runs the real Pi coding agent with the Blitz extension loaded from source.
 * `blitzpi <args>` == `pi -e <repo>/src/index.ts <args>`; every Pi flag/command passes through.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { blitzPaths, isInstalledCopy } from "./paths";

export const REPO_ROOT = resolve(__dirname, "..");
export const BLITZ_EXTENSION = join(REPO_ROOT, "src", "index.ts");

/** Pi packages BlitzPi ships with (installed in this repo's node_modules, loaded by path). */
export const BUNDLED_PI_PACKAGES = [
  "pi-commandcode-provider", // Command Code models (/login → Use a subscription → Command Code)
  "pi-web-access", // web_search / fetch_content (keyless Exa/DuckDuckGo fallbacks)
  "pi-mcp-adapter", // MCP servers from .mcp.json / ~/.pi/agent/mcp.json
  "@tintinweb/pi-subagents", // subagents defined in .pi/agents/*.md
  "pi-cc-extensions", // Claude-Code-style TUI (/ccstyle) + cc-dark/cc-light themes
];

// `update` and `uninstall` are BlitzPi's own (self-update / remove the app); Pi's package versions
// of them are moot because every package BlitzPi uses is bundled.
const PI_SUBCOMMANDS = new Set(["install", "remove", "list", "config", "auth"]);

/** `blitzpi update` / `blitzpi uninstall`: run the bundled install.sh against the installed copy. */
export type SelfServiceCommand = "update" | "uninstall" | "versions" | "rollback" | "use";
const INSTALLER_FLAG: Record<SelfServiceCommand, string> = { update: "--update", uninstall: "--uninstall", versions: "--list", rollback: "--rollback", use: "--use" };
const INSTALLER_FLAG_PS: Record<SelfServiceCommand, string> = { update: "-Update", uninstall: "-Uninstall", versions: "-List", rollback: "-Rollback", use: "-Use" };
const SOURCE_HINT: Record<SelfServiceCommand, string> = {
  update: "Update it with: git pull && bun install",
  uninstall: "Nothing to uninstall; delete the checkout instead.",
  versions: "Releases: git tag --sort=-v:refname   ·   installed copies live under the app directory (blitzpi --help)",
  rollback: "Roll back with: git checkout v<previous> && bun install",
  use: "Switch with: git checkout v<version> && bun install",
};

/** `blitzpi update | uninstall | versions | rollback | use <version>` → install.sh of the installed copy. */
export function selfServiceCommand(cmd: SelfServiceCommand, extra: string[] = []): Promise<number> {
  const paths = blitzPaths();
  if (!isInstalledCopy(REPO_ROOT, paths)) {
    console.error(`[BlitzPi] this is a source checkout (${REPO_ROOT}), not an installed copy.\n  ${SOURCE_HINT[cmd]}`);
    return Promise.resolve(1);
  }
  // The app-level installer is the newest one that ran (kept outside versions/ so it survives a rollback).
  // Missing = this copy was installed by an older installer: place ours there and rewrite the command first.
  const win = process.platform === "win32";
  const scriptName = win ? "install.ps1" : "install.sh";
  const runInstaller = (script: string, flags: string[], stdio: "inherit" = "inherit") =>
    win
      ? spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...flags], { stdio, env: { ...process.env, BLITZPI_HOME: paths.home } })
      : spawn("sh", [script, ...flags], { stdio, env: { ...process.env, BLITZPI_HOME: paths.home } });
  const appScript = join(paths.home, scriptName);
  const ownScript = join(REPO_ROOT, scriptName);
  if (!existsSync(appScript) && existsSync(ownScript)) {
    if (win) spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ownScript, "-Refresh"], { stdio: "inherit", env: { ...process.env, BLITZPI_HOME: paths.home } });
    else spawnSync("sh", [ownScript, "--refresh"], { stdio: "inherit", env: { ...process.env, BLITZPI_HOME: paths.home } });
  }
  const script = existsSync(appScript) ? appScript : join(paths.current, scriptName);
  if (!existsSync(script)) {
    console.error(`[BlitzPi] installer not found: ${script}`);
    return Promise.resolve(1);
  }
  const flag = win ? INSTALLER_FLAG_PS[cmd] : INSTALLER_FLAG[cmd];
  const child = runInstaller(script, [flag, ...extra]);
  return new Promise((done) => {
    child.on("error", (err) => {
      console.error("[BlitzPi] Failed to run installer:", err.message);
      done(1);
    });
    child.on("exit", (code, signal) => done(code ?? (signal ? 1 : 0)));
  });
}

export function bundledPackageArgs(): string[] {
  const args: string[] = [];
  for (const name of BUNDLED_PI_PACKAGES) {
    const dir = join(REPO_ROOT, "node_modules", name);
    if (existsSync(join(dir, "package.json"))) args.push("-e", dir);
    else console.error(`[BlitzPi] bundled package missing: ${name} (run bun install)`);
  }
  return args;
}

export function findPiCli(): string | null {
  const require = createRequire(join(REPO_ROOT, "package.json"));
  try {
    const pkgJson = require.resolve("@earendil-works/pi-coding-agent/package.json");
    const cli = join(dirname(pkgJson), "dist", "bundle", "cli.js");
    if (existsSync(cli)) return cli;
  } catch {
    /* fall through */
  }
  const local = join(REPO_ROOT, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js");
  return existsSync(local) ? local : null;
}

export function launchBlitzPi(args: string[]): Promise<number> {
  const cli = findPiCli();
  if (!cli) {
    console.error("[BlitzPi] Pi not found. Run `bun install` in " + REPO_ROOT);
    return Promise.resolve(1);
  }
  if (!existsSync(BLITZ_EXTENSION)) {
    console.error("[BlitzPi] Extension not found: " + BLITZ_EXTENSION);
    return Promise.resolve(1);
  }
  process.title = "blitzpi";
  // Pi subcommands (install, auth, list, …) must come first; extension flags go after them.
  // The repo is itself a pi package (package.json "pi": extension + themes + skills), loaded by path
  // so its resources are available without a project-trust prompt in whatever cwd the user is in.
  const extArgs = ["-e", REPO_ROOT, ...bundledPackageArgs()];
  const piArgs = PI_SUBCOMMANDS.has(args[0]) ? [...args, ...extArgs] : [...extArgs, ...args];
  // BlitzPi owns updates (`blitzpi update`); Pi's own "new version, npm install -g …" check would mislead users.
  const env = { ...process.env, PI_SKIP_VERSION_CHECK: process.env.PI_SKIP_VERSION_CHECK ?? "1" };
  const child = spawn(process.execPath, [cli, ...piArgs], { stdio: "inherit", env });
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => child.kill(sig));
  }
  return new Promise((done) => {
    child.on("error", (err) => {
      console.error("[BlitzPi] Failed to start Pi:", err.message);
      done(1);
    });
    child.on("exit", (code, signal) => done(code ?? (signal ? 1 : 0)));
  });
}
