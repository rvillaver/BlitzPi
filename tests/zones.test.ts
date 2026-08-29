import { classifyZone } from "../src/zones";
import { decide } from "../src/permissions";

const roots = { project: "/home/u/app-stack", install: "/home/u/BlitzPi", home: "/home/u" };
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
