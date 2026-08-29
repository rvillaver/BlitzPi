/**
 * File-tool gating via zones. Non-interactive (no ctx.hasUI): silent/ask auto-allow, dangerous refused.
 */
import { setupSandbox } from "../src/sandbox";
import { PermissionGate } from "../src/permission-gate";
import { PermissionMemory } from "../src/permissions";
import os from "os";
import path from "path";
import fs from "fs";

describe("file-tool gate (non-interactive)", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "gate-proj-"));
  const install = fs.mkdtempSync(path.join(os.tmpdir(), "gate-inst-"));
  const store = path.join(project, ".blitz", "permissions.json");

  function run(tool: string, input: any) {
    let handler: any = null;
    const pi: any = { on: (n: string, h: any) => { if (n === "tool_call") handler = h; } };
    const audit: any = { log: () => {}, getPath: () => "." };
    const gate = new PermissionGate({ project, install, home: os.homedir() }, new PermissionMemory(store), audit);
    setupSandbox({ ...pi } as any, { sandbox: { enabled: true } } as any, audit, gate);
    // ctx with no UI (non-interactive)
    return handler({ toolName: tool, input, toolCallId: "t" }, { hasUI: false });
  }

  test("write inside project → allowed (auto)", async () => {
    expect(await run("write", { path: path.join(project, "a.txt"), content: "x" })).toBeUndefined();
  });
  test("read /etc/hosts → allowed (auto, ask-level)", async () => {
    expect(await run("read", { path: "/etc/hosts" })).toBeUndefined();
  });
  test("read /dev/null → allowed (silent)", async () => {
    expect(await run("read", { path: "/dev/null" })).toBeUndefined();
  });
  test("write outside project (/etc) → BLOCKED (dangerous, non-interactive)", async () => {
    const r = await run("write", { path: "/etc/evil", content: "x" });
    expect(r?.block).toBe(true);
  });
  test("write to global ~/.blitz → BLOCKED (dangerous)", async () => {
    const r = await run("write", { path: path.join(os.homedir(), ".blitz", "audit", "x") , content: "x" });
    expect(r?.block).toBe(true);
  });
});
