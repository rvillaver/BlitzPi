/**
 * A bash command's extracted target (e.g. `/` from `find / -iname …`) doesn't explain itself the way a file
 * tool's target does. `resolve()`'s optional `context` (the full command) adds a parenthetical annotation —
 * target stays first (unchanged), the command is a secondary, capped, redacted clause.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { PermissionGate } from "../src/permission-gate";
import { PermissionMemory } from "../src/permissions";

function harness() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-ctx-"));
  const project = path.join(tmp, "proj");
  fs.mkdirSync(path.join(project, ".git"), { recursive: true }); // a project marker, irrelevant to zone "other" here
  const audit: any = { log: () => {} };
  const asked: string[] = [];
  const ctx: any = { hasUI: true, ui: { notify: () => {}, select: async (q: string) => { asked.push(q); return "Yes"; } } };
  const gate = new PermissionGate({ project, install: path.join(tmp, "inst"), home: path.join(tmp, "home"), scratch: [] }, new PermissionMemory(path.join(project, ".blitz", "permissions.json")), audit);
  return { gate, ctx, asked };
}

describe("resolve() context annotation (SP: friendlier bash-derived asks)", () => {
  test("the exact reported case: find / -iname … asks about / with the command shown, target still first", async () => {
    const { gate, ctx, asked } = harness();
    const command = 'find / -iname "*bridge*" -path "*blitz*"';
    const r = await gate.resolve("read", "other", "/", "bash command", ctx, command);
    expect(r.allow).toBe(true);
    expect(asked[0]).toBe('Allow read? /  (find / -iname "*bridge*" -path "*blitz*")');
    expect(asked[0].indexOf("/")).toBeLessThan(asked[0].indexOf("find")); // target reads first, left to right
  });

  test("no context (file-tool call) -> unchanged, no parenthetical", async () => {
    const { gate, ctx, asked } = harness();
    await gate.resolve("read", "other", "/etc/hosts", "read", ctx);
    expect(asked[0]).toBe("Allow read? /etc/hosts");
  });

  test("context identical to the target -> no redundant parenthetical", async () => {
    const { gate, ctx, asked } = harness();
    await gate.resolve("read", "other", "/some/path", "bash command", ctx, "/some/path");
    expect(asked[0]).toBe("Allow read? /some/path");
  });

  test("dangerous level also gets the annotation", async () => {
    const { gate, ctx, asked } = harness();
    await gate.resolve("write", "system", "/etc/hosts", "bash command", ctx, 'echo x | sudo tee -a /etc/hosts');
    expect(asked[0]).toBe('⚠ Allow DANGEROUS write? /etc/hosts  (echo x | sudo tee -a /etc/hosts)');
  });

  test("a long command is capped, same discipline as the target itself", async () => {
    const { gate, ctx, asked } = harness();
    const long = "find / -iname " + "x".repeat(200);
    await gate.resolve("read", "other", "/", "bash command", ctx, long);
    expect(asked[0].length).toBeLessThan(200); // "Allow read? / " + capped 100-char parenthetical, not the full 215-char command
  });
});
