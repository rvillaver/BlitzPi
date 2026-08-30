/** Bun install policy (backlog #6b): minimumReleaseAge via a BlitzPi-owned bunfig, and post-install visibility. */
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { bunfigFor, ensureSandboxConfig, isBunInstall, parseAge, parseUntrusted, renderPolicy, summarizeAudit } from "../src/feeds/install-policy";

test("parseAge", () => {
  expect(parseAge(undefined)).toBe(3 * 86400); expect(parseAge("3d")).toBe(259200); expect(parseAge("12h")).toBe(43200);
  expect(parseAge("45m")).toBe(2700); expect(parseAge("90")).toBe(90); expect(parseAge("1w")).toBe(604800);
  expect(parseAge("off")).toBe(0); expect(parseAge("0")).toBe(0); expect(parseAge("nonsense")).toBe(3 * 86400); expect(parseAge(120)).toBe(120);
});
test("bunfig is written once and kept current; off → no config dir", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-bunfig-"));
  expect(ensureSandboxConfig(root, 0)).toBeNull();
  expect(ensureSandboxConfig(root, 259200)).toBe(root);
  expect(fs.readFileSync(path.join(root, ".bunfig.toml"), "utf-8")).toBe(bunfigFor(259200));
  expect(bunfigFor(259200)).toContain("minimumReleaseAge = 259200");
  ensureSandboxConfig(root, 60); expect(fs.readFileSync(path.join(root, ".bunfig.toml"), "utf-8")).toContain("= 60");
});
test("isBunInstall", () => {
  for (const c of ["bun add is-odd", "bun install", "cd apps/api && bun i", "TMPDIR=/x bun add -d vitest", "bun update", "bun remove x"]) expect(isBunInstall(c)).toBe(true);
  for (const c of ["bun run build", "bun test", "npm install", "bunx cowsay", "echo bun add"]) expect(isBunInstall(c)).toBe(false);
});
test("parseUntrusted reads bun 1.4 output", () => {
  const out = "bun pm untrusted v1.4.0 (34cbb9a40)\n\n./node_modules/protobufjs @7.2.6\n » [postinstall]: node scripts/postinstall\n\n./node_modules/@scope/pkg @1.0.0\n » [install]: x\n\nThese dependencies had their lifecycle scripts blocked during install.\n";
  expect(parseUntrusted(out)).toEqual(["protobufjs", "@scope/pkg"]);
  expect(parseUntrusted("bun pm untrusted v1.4.0\n\nFound 0 untrusted dependencies with scripts.\n")).toEqual([]);
});
test("summarizeAudit reads bun audit --json (npm bulk advisory format)", () => {
  const j = JSON.stringify({ esbuild: [{ id: 1102341, title: "x", severity: "moderate", vulnerable_versions: "<=0.24.2" }], lodash: [{ severity: "high" }, { severity: "critical" }], fine: [] });
  expect(summarizeAudit(j)).toEqual({ total: 3, bySeverity: { moderate: 1, high: 1, critical: 1 }, packages: ["esbuild", "lodash"] });
  expect(summarizeAudit("not json")).toBeNull(); expect(summarizeAudit("{}")).toEqual({ total: 0, bySeverity: {}, packages: [] });
});
test("renderPolicy", () => {
  expect(renderPolicy([], { total: 0, bySeverity: {}, packages: [] })).toBe("");
  const line = renderPolicy(["protobufjs"], { total: 2, bySeverity: { high: 1, moderate: 1 }, packages: ["esbuild"] });
  expect(line).toContain("protobufjs"); expect(line).toContain("bun pm trust"); expect(line).toContain("1 high, 1 moderate"); expect(line).toContain("esbuild");
});
