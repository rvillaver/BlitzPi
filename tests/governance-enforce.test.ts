/** Per-call governance: a denied model call is STOPPED (ctx.abort) in enforce mode and only shown in monitor mode. */
import { setupGovernance } from "../src/governance";

function harness(mode: "enforce" | "monitor", approved: boolean) {
  const handlers: Record<string, any> = {};
  const messages: any[] = [];
  const pi: any = { on: (n: string, h: any) => { handlers[n] = h; }, sendMessage: (m: any) => { throw new Error("must not send to the model: " + JSON.stringify(m)); }, appendEntry: (_t: string, d: any) => messages.push({ content: d.text }), registerEntryRenderer: () => {} };
  const entries: any[] = [];
  const audit: any = { log: (e: any) => entries.push(e), getPath: () => "/tmp" };
  const config: any = {
    threat_detection: { enabled: true, tier: 2 }, audit: { enabled: true, path: "/tmp" }, profiles: { default: "user" },
    sandbox: { enabled: true, run_dir: ".", backend: "auto" }, threat_api: { enabled: false }, goodbehavior: { profile: "development" },
    governance: { enabled: true, mode, provider: "custom", api_endpoint: "http://governance.test/check", model_whitelist: [] },
  };
  (global as any).fetch = async () => new Response(JSON.stringify({ approved, reason: approved ? "ok" : "test policy: denied", threat_category: approved ? undefined : "policy" }), { status: 200 });
  setupGovernance(pi, config, audit, { user: "u", install_type: "local", project_path: "/p" } as any);
  const ctx: any = { hasUI: false, abort: jest.fn(), ui: { setStatus: () => {}, notify: () => {} }, model: { id: "m" } };
  return { fire: () => handlers["before_provider_request"]({ payload: { model: "m", messages: [1, 2, 3] } }, ctx), ctx, entries, messages };
}

test("enforce: denial aborts the run, audits enforced:true, posts a 'stopped' message", async () => {
  const h = harness("enforce", false);
  await h.fire();
  expect(h.ctx.abort).toHaveBeenCalledTimes(1);
  const e = h.entries.find((x) => x.type === "governance_check" && x.stage === "provider_request");
  expect(e.approved).toBe(false); expect(e.enforced).toBe(true);
  expect(h.messages[0].content).toMatch(/stopped a model call/);
});
test("monitor: denial is shown and audited, run continues", async () => {
  const h = harness("monitor", false);
  await h.fire();
  expect(h.ctx.abort).not.toHaveBeenCalled();
  expect(h.entries.find((x) => x.stage === "provider_request").enforced).toBe(false);
  expect(h.messages[0].content).toMatch(/Mode is monitor/);
});
test("approved: nothing is aborted or posted", async () => {
  const h = harness("enforce", true);
  await h.fire();
  expect(h.ctx.abort).not.toHaveBeenCalled(); expect(h.messages.length).toBe(0);
});
