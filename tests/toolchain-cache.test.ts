/** G3: package-manager caches are routed into a BlitzPi-owned root that the sandbox opens and the guard treats as scratch. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CACHE_ENV, cacheEnv, cacheRoot } from "../src/toolchain-cache";
import { classifyZone, defaultScratchDirs } from "../src/zones";

describe("cacheRoot", () => {
  test("shared → ~/.blitz/cache, project → <project>/.blitz/cache, off → null", () => {
    expect(cacheRoot("shared", "/p", "/home/u")).toBe("/home/u/.blitz/cache");
    expect(cacheRoot("project", "/p", "/home/u")).toBe("/p/.blitz/cache");
    expect(cacheRoot("off", "/p", "/home/u")).toBeNull();
  });
});

describe("cacheEnv", () => {
  test("routes every known package manager into the root and creates the directories", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-cache-"));
    const env = cacheEnv(root);
    for (const [name, sub] of Object.entries(CACHE_ENV)) {
      expect(env[name]).toBe(path.join(root, sub));
      expect(fs.statSync(path.join(root, sub)).isDirectory()).toBe(true);
    }
    expect(env.BUN_INSTALL_CACHE_DIR).toBe(path.join(root, "bun"));
    expect(env).not.toHaveProperty("BUN_INSTALL"); // never a tool's home/bin dir
    expect(env).not.toHaveProperty("CARGO_HOME");
  });
});

describe("the cache root is scratch for the guard", () => {
  test("a write under ~/.blitz/cache is silent (scratch), the rest of ~/.blitz stays global", () => {
    const home = "/home/u";
    const cache = cacheRoot("shared", "/p", home)!;
    const roots = { project: "/p", install: "/i", home, scratch: [...defaultScratchDirs(), cache] };
    expect(classifyZone(path.join(cache, "bun", "x"), roots)).toBe("scratch");
    expect(classifyZone("/home/u/.blitz/audit/x.jsonl", roots)).toBe("global");
  });
});
