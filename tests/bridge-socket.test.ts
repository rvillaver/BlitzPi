/** The unix-socket control surface round-trips ops and reports errors. */
import os from "node:os"; import path from "node:path"; import fs from "node:fs";
import { bridgeCall, serveSocket } from "../src/bridge/socket";
test("serveSocket/bridgeCall", async () => {
  const sock = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "blitz-sock-")), "b.sock");
  const server = serveSocket(sock, async (op, payload) => { if (op === "boom") throw new Error("nope"); return { op, got: payload.text }; });
  await new Promise((r) => setTimeout(r, 100));
  expect(await bridgeCall(sock, "post", { text: "x" })).toEqual({ op: "post", got: "x" });
  await expect(bridgeCall(sock, "boom")).rejects.toThrow("nope");
  expect((fs.statSync(sock).mode & 0o777).toString(8)).toBe("600");
  server.close();
  await expect(bridgeCall(path.join(os.tmpdir(), "no-such.sock"), "status")).rejects.toThrow(/not reachable/);
});
