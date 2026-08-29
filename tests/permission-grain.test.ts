/** One "Always" on an out-of-project read must cover only that directory root — never the whole disk. */
import fs from "fs";
import os from "os";
import path from "path";
import { PermissionGate } from "../src/permission-gate";
import { PermissionMemory, permissionKey, rememberRoot } from "../src/permissions";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grain-"));
const home = path.join(tmp, "home", "u");
const proj = path.join(home, "work", "proj");
fs.mkdirSync(path.join(proj, ".git"), { recursive: true });
fs.mkdirSync(path.join(proj, "src"), { recursive: true });
fs.writeFileSync(path.join(proj, "src", "a.ts"), "x");
fs.mkdirSync(path.join(home, "docs"), { recursive: true });
fs.writeFileSync(path.join(home, "docs", "x.txt"), "x");

describe("rememberRoot", () => {
  test("file inside another project → that project's root", () => {
    expect(rememberRoot(path.join(proj, "src", "a.ts"), home)).toBe(proj);
    expect(rememberRoot(proj, home)).toBe(proj);
  });
  test("no project marker → the file's own directory", () => {
    expect(rememberRoot(path.join(home, "docs", "x.txt"), home)).toBe(path.join(home, "docs"));
  });
  test("too broad → null: /, home, ancestors of home, top-level dirs", () => {
    for (const p of ["/", home, path.dirname(home), "/Users", "/tmp", "/etc"]) expect(rememberRoot(p, home)).toBeNull();
    expect(rememberRoot(path.join(home, "file-in-home.txt"), home)).toBeNull(); // dirname is home itself
  });
  test("permissionKey: zone-wide except other", () => {
    expect(permissionKey("read", "system", "/etc/hosts", home)).toBe("read:system");
    expect(permissionKey("read", "other", path.join(proj, "src", "a.ts"), home)).toBe(`read:other:${proj}`);
    expect(permissionKey("read", "other", "/", home)).toBeNull();
  });
});

describe("PermissionMemory.isAllowedFor", () => {
  const store = path.join(tmp, "permissions.json");
  test("per-root key covers the root's subtree only; legacy read:other is ignored", () => {
    const m = new PermissionMemory(store);
    m.rememberAlways(`read:other:${proj}`);
    m.rememberAlways("read:other"); // legacy, disk-wide — must not count
    expect(m.isAllowedFor("read", "other", path.join(proj, "src", "b.ts"))).toBe(true);
    expect(m.isAllowedFor("read", "other", path.join(home, "docs", "x.txt"))).toBe(false);
    expect(m.isAllowedFor("read", "other", "/")).toBe(false);
    expect(m.isAllowedFor("read", "system", "/etc/hosts")).toBe(false);
    m.rememberSession("read:system");
    expect(m.isAllowedFor("read", "system", "/etc/hosts")).toBe(true);
  });
});

describe("PermissionGate (interactive) — Always is per directory root", () => {
  const project = path.join(home, "work", "mine");
  fs.mkdirSync(path.join(project, ".blitz"), { recursive: true });
  const audit: any = { log: () => {} };
  const asked: string[] = [];
  const ctx: any = { hasUI: true, ui: { notify: () => {}, select: async (q: string, opts: string[]) => { asked.push(q); return opts.find((o) => o.startsWith("Always this session")) ?? "Yes"; } } };
  // scratch: [] — this fake home lives under the OS temp dir, which is the scratch zone by default
  const gate = new PermissionGate({ project, install: path.join(tmp, "inst"), home, scratch: [] }, new PermissionMemory(path.join(project, ".blitz", "permissions.json")), audit);

  test("approve proj once → proj's other files silent; a different folder asks again; / asks every time with Yes/No", async () => {
    expect((await gate.resolvePath("read", path.join(proj, "src", "a.ts"), "read", ctx)).reason).toMatch(/approved/);
    expect(asked.length).toBe(1);
    expect((await gate.resolvePath("read", path.join(proj, "README.md"), "read", ctx)).reason).toBe("remembered");
    expect(asked.length).toBe(1);
    expect((await gate.resolvePath("read", path.join(home, "docs", "x.txt"), "read", ctx)).reason).toMatch(/approved/);
    expect(asked.length).toBe(2);
    await gate.resolvePath("read", "/", "read", ctx);
    await gate.resolvePath("read", "/", "read", ctx);
    expect(asked.length).toBe(4);
    expect(asked[3]).toMatch(/too broad to remember/);
  });
});
