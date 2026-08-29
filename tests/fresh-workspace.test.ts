/**
 * Regression: BlitzPi must be usable in a workspace with no access profile on disk. The bug this guards
 * against: a missing/unknown profile made the matcher deny EVERY tool ("Profile not found"), bricking
 * read/write/bash. The built-in default profile (allow all tools; sandbox + guard confine the rest)
 * must take over so tools are allowed.
 */
import { setupAccessProfiles } from "../src/access-profiles";
import { loadConfig } from "../src/config";

describe("fresh workspace / missing profile falls back to a usable default", () => {
  function harness(defaultProfile: string) {
    const config: any = loadConfig();
    config.profiles.default = defaultProfile;
    const decisions: any[] = [];
    let handler: any = null;
    const pi: any = { on: (n: string, h: any) => { if (n === "tool_call") handler = h; } };
    const audit: any = { log: () => {}, getPath: () => ".blitz/audit" };
    setupAccessProfiles(pi, config, audit);
    return async (toolName: string, input: any) => {
      const r = await handler({ toolName, input, toolCallId: "t" });
      decisions.push(r);
      return r;
    };
  }

  test("unknown profile name -> tools ALLOWED via built-in default (not blocked)", async () => {
    const call = harness("__does_not_exist__");
    expect(await call("write", { path: "test.txt", content: "x" })).toBeUndefined();
    expect(await call("read", { path: "./existing.txt" })).toBeUndefined();
    expect(await call("bash", { command: "ls -la" })).toBeUndefined();
  });

  test("explicit strict profile is still honored (bash denied)", async () => {
    const call = harness("strict");
    const r = await call("bash", { command: "ls" });
    expect(r?.block).toBe(true);
  });
});
