import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classifyZone } from "../src/zones";
import { decide } from "../src/permissions";

/**
 * A synthetic home that exists on NO platform, deliberately.
 *
 * `classifyZone` canonicalizes both sides, so every ancestor of these paths that happens to exist is
 * resolved. `/home` was the old root and is a real symlink to `/System/Volumes/Data/home` on macOS, so
 * `/home/u/other-project` canonicalized into `/System/...` and classified `system` instead of `other`.
 * That resolution is correct — it is the same place — so the root, not the classifier, is what moves:
 * nothing along this path resolves, on any host, and `canonical()` returns it lexically unchanged.
 */
const HOME = "/zones-test-root/u";
const roots = { project: `${HOME}/app-stack`, install: `${HOME}/BlitzPi`, home: HOME, scratch: ["/tmp", "/private/tmp"] };
const z = (p: string) => classifyZone(p, roots);

describe("zone classification", () => {
  test("project + subpaths", () => {
    expect(z(`${HOME}/app-stack/src/main.ts`)).toBe("project");
    expect(z(`${HOME}/app-stack`)).toBe("project");
  });
  test("project-config vs goodbehavior", () => {
    expect(z(`${HOME}/app-stack/.blitz/profiles/user.yaml`)).toBe("project-config");
    expect(z(`${HOME}/app-stack/.blitz/goodbehavior/memory/x.md`)).toBe("goodbehavior");
    expect(z(`${HOME}/app-stack/.pi/skills/audit-goodbehavior/SKILL.md`)).toBe("goodbehavior");
  });
  test("install / global / system / plumbing / other", () => {
    expect(z(`${HOME}/BlitzPi/src/index.ts`)).toBe("install");
    expect(z(`${HOME}/.blitz/audit/log.jsonl`)).toBe("global");
    expect(z("/etc/hosts")).toBe("system");
    expect(z("/usr/lib/x.so")).toBe("system");
    expect(z("/dev/null")).toBe("plumbing");
    expect(z("/dev/stderr")).toBe("plumbing");
    expect(z("/tmp/build.log")).toBe("scratch");
    expect(z("/private/tmp/x")).toBe("scratch");
    expect(decide("read", "scratch")).toBe("silent");
    expect(decide("write", "scratch")).toBe("silent");
    expect(z(`${HOME}/other-project/secret`)).toBe("other");
    expect(z(`${HOME}/.ssh/id_rsa`)).toBe("other");
  });
});

// Needs a real filesystem: the escape is a symlink, and the fix is realpath resolution.
describe("symlinks cannot smuggle a target out of the project", () => {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "zones-proj-")));
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "zones-out-")));
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "zones-home-")));
  const r = { project, install: path.join(outside, "install"), home, scratch: ["/nonexistent-scratch"] };

  beforeAll(() => {
    fs.writeFileSync(path.join(project, "real.txt"), "x");
    fs.mkdirSync(path.join(home, ".ssh"), { recursive: true });
    fs.symlinkSync(path.join(home, ".ssh"), path.join(project, "sshlink"));
  });

  test("a link inside the project pointing out of it is NOT project zone", () => {
    // Before realpath resolution this returned "project" — the silent rung — so it was never asked about.
    expect(classifyZone(path.join(project, "sshlink"), r)).not.toBe("project");
    expect(classifyZone(path.join(project, "sshlink", "id_rsa"), r)).not.toBe("project");
    expect(decide("read", classifyZone(path.join(project, "sshlink", "id_rsa"), r))).not.toBe("silent");
  });

  test("ordinary in-project paths still classify as project, created or not", () => {
    expect(classifyZone(path.join(project, "real.txt"), r)).toBe("project");
    expect(classifyZone(path.join(project, "does/not/exist/yet.txt"), r)).toBe("project");
  });

  test("I/O stream names are matched before resolution, so redirection is not a system touch", () => {
    // /dev/stderr is a symlink to /proc/self/fd/2 on Linux; resolving it first made `2>/dev/stderr` system-zone.
    expect(classifyZone("/dev/stderr", r)).toBe("plumbing");
    expect(classifyZone("/dev/null", r)).toBe("plumbing");
  });
});

describe("permission ladder", () => {
  test("reads", () => {
    expect(decide("read", "project")).toBe("silent");
    expect(decide("read", "goodbehavior")).toBe("silent");
    expect(decide("read", "plumbing")).toBe("silent");
    expect(decide("read", "system")).toBe("ask");
    expect(decide("read", "other")).toBe("ask");
    expect(decide("read", "install")).toBe("ask");
  });
  test("writes", () => {
    expect(decide("write", "project")).toBe("ask");
    expect(decide("write", "goodbehavior")).toBe("ask");
    expect(decide("write", "project-config")).toBe("ask-noalways");
    expect(decide("write", "plumbing")).toBe("silent");
    expect(decide("write", "system")).toBe("dangerous");
    expect(decide("write", "global")).toBe("dangerous");
    expect(decide("write", "other")).toBe("dangerous");
  });
});

describe("permission ladder: security tiers (SP-2)", () => {
  test("no tier given / 'guarded' — byte-identical to the untiered ladder (regression safety)", () => {
    expect(decide("write", "project", "guarded")).toBe("ask");
    expect(decide("read", "other", "guarded")).toBe("ask");
    expect(decide("write", "other", "guarded")).toBe("dangerous");
    expect(decide("write", "project-config", "guarded")).toBe("ask-noalways");
  });
  test("'strict' — unchanged from 'guarded' on this zone ladder (its extra restriction is the install-ask, outside decide())", () => {
    for (const [action, zone] of [["write", "project"], ["read", "other"], ["write", "other"], ["write", "project-config"]] as const) {
      expect(decide(action, zone, "strict")).toBe(decide(action, zone, "guarded"));
    }
  });
  test("'monitored' — project writes and outside-project reads go silent", () => {
    expect(decide("write", "project", "monitored")).toBe("silent");
    expect(decide("write", "goodbehavior", "monitored")).toBe("silent");
    expect(decide("read", "system", "monitored")).toBe("silent");
    expect(decide("read", "other", "monitored")).toBe("silent");
  });
  test("'monitored' never loosens what leaves the sandbox: project-config write and every dangerous write stay put", () => {
    expect(decide("write", "project-config", "monitored")).toBe("ask-noalways");
    expect(decide("write", "system", "monitored")).toBe("dangerous");
    expect(decide("write", "global", "monitored")).toBe("dangerous");
    expect(decide("write", "other", "monitored")).toBe("dangerous");
  });
  test("plumbing/scratch stay silent regardless of tier", () => {
    for (const level of ["strict", "guarded", "monitored"] as const) {
      expect(decide("read", "scratch", level)).toBe("silent");
      expect(decide("write", "plumbing", level)).toBe("silent");
    }
  });
});
