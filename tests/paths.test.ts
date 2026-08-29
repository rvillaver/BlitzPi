import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { blitzPaths, isInstalledCopy } from "../src/paths";

const ROOT = path.resolve(__dirname, "..");
const H = "/h";

describe("blitzPaths — OS → directory mapping", () => {
  test("macOS: Application Support + ~/.local/bin", () => {
    const p = blitzPaths("darwin", {}, H);
    expect(p.home).toBe("/h/Library/Application Support/BlitzPi");
    expect(p.bun).toBe("/h/Library/Application Support/BlitzPi/bun/bin/bun");
    expect(p.current).toBe("/h/Library/Application Support/BlitzPi/current");
    expect(p.shim).toBe("/h/.local/bin/blitzpi");
  });
  test("Linux: XDG data dir (default ~/.local/share) + ~/.local/bin", () => {
    expect(blitzPaths("linux", {}, H).home).toBe("/h/.local/share/blitzpi");
    expect(blitzPaths("linux", { XDG_DATA_HOME: "/xdg" }, H).home).toBe("/xdg/blitzpi");
    expect(blitzPaths("linux", {}, H).shim).toBe("/h/.local/bin/blitzpi");
  });
  test("Windows: %LOCALAPPDATA%\\BlitzPi, command inside the app dir", () => {
    const p = blitzPaths("win32", { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" }, "C:\\Users\\u");
    expect(p.home).toBe("C:\\Users\\u\\AppData\\Local\\BlitzPi");
    expect(p.bun).toBe("C:\\Users\\u\\AppData\\Local\\BlitzPi\\bun\\bin\\bun.exe");
    expect(p.shim).toBe("C:\\Users\\u\\AppData\\Local\\BlitzPi\\bin\\blitzpi.cmd");
    expect(blitzPaths("win32", {}, "C:\\Users\\u").home).toBe("C:\\Users\\u\\AppData\\Local\\BlitzPi");
  });
  test("BLITZPI_HOME overrides the app dir on every OS", () => {
    for (const os of ["darwin", "linux", "win32"]) expect(blitzPaths(os, { BLITZPI_HOME: "/custom" }, H).home).toBe("/custom");
  });
  test("a source checkout is not an installed copy", () => {
    expect(isInstalledCopy(ROOT, blitzPaths("linux", { BLITZPI_HOME: "/nonexistent" }, H))).toBe(false);
  });
});

describe("install.sh mirrors src/paths.ts", () => {
  function shPaths(os: "Darwin" | "Linux", env: Record<string, string>): Record<string, string> {
    const fake = mkdtempSync(path.join(tmpdir(), "blitz-uname-"));
    writeFileSync(path.join(fake, "uname"), `#!/bin/sh\ncase "$1" in -s) echo ${os};; -m) echo x86_64;; esac\n`);
    chmodSync(path.join(fake, "uname"), 0o755);
    const out = execFileSync("sh", [path.join(ROOT, "install.sh"), "--print-paths"], {
      env: { PATH: `${fake}:${process.env.PATH}`, HOME: H, ...env },
      encoding: "utf8",
    });
    return Object.fromEntries(out.trim().split("\n").map((l) => l.split(/=(.*)/s).slice(0, 2)));
  }
  const cases: Array<["Darwin" | "Linux", "darwin" | "linux", Record<string, string>]> = [
    ["Darwin", "darwin", {}],
    ["Linux", "linux", {}],
    ["Linux", "linux", { XDG_DATA_HOME: "/xdg" }],
    ["Linux", "linux", { BLITZPI_HOME: "/opt/blitz dir" }],
  ];
  test.each(cases)("%s %s %j", (os, platform, env) => {
    const ts = blitzPaths(platform, env, H);
    const sh = shPaths(os, env);
    for (const k of ["home", "versions", "current", "bun", "binDir", "shim"] as const) expect(sh[k]).toBe(ts[k]);
  });
});
