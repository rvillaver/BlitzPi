import { classifyZone } from "../src/zones";
import { decide } from "../src/permissions";

const roots = { project: "/home/u/app-stack", install: "/home/u/BlitzPi", home: "/home/u", scratch: ["/tmp", "/private/tmp"] };
const z = (p: string) => classifyZone(p, roots);

describe("zone classification", () => {
  test("project + subpaths", () => {
    expect(z("/home/u/app-stack/src/main.ts")).toBe("project");
    expect(z("/home/u/app-stack")).toBe("project");
  });
  test("project-config vs goodbehavior", () => {
    expect(z("/home/u/app-stack/.blitz/profiles/user.yaml")).toBe("project-config");
    expect(z("/home/u/app-stack/.blitz/goodbehavior/memory/x.md")).toBe("goodbehavior");
    expect(z("/home/u/app-stack/.pi/skills/audit-goodbehavior/SKILL.md")).toBe("goodbehavior");
  });
  test("install / global / system / plumbing / other", () => {
    expect(z("/home/u/BlitzPi/src/index.ts")).toBe("install");
    expect(z("/home/u/.blitz/audit/log.jsonl")).toBe("global");
    expect(z("/etc/hosts")).toBe("system");
    expect(z("/usr/lib/x.so")).toBe("system");
    expect(z("/dev/null")).toBe("plumbing");
    expect(z("/dev/stderr")).toBe("plumbing");
    expect(z("/tmp/build.log")).toBe("scratch");
    expect(z("/private/tmp/x")).toBe("scratch");
    expect(decide("read", "scratch")).toBe("silent");
    expect(decide("write", "scratch")).toBe("silent");
    expect(z("/home/u/other-project/secret")).toBe("other");
    expect(z("/home/u/.ssh/id_rsa")).toBe("other");
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
