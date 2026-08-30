import fs from "fs"; import os from "os"; import path from "path";
import { setupFeedsOnboarding, CHOICES, installFeeds } from "../src/feeds/onboard";
import { setupSecretsFeed } from "../src/feeds/secrets";
import { FeedStore } from "../src/feeds/store";
import { stats } from "../src/security-status";

const FIX = fs.readFileSync(path.join(__dirname, "fixtures", "gitleaks-sample.toml"), "utf-8");
const ZIP = fs.readFileSync(path.join(__dirname, "fixtures", "sigma-sample.zip"));
process.env.BLITZ_FEED_URLS_MIN = "1";
const fetchAll: any = async (url: string) => new Response(url.includes("zip") ? ZIP : url.includes("urlhaus") ? "http://203.0.113.9/x\n" : FIX, { status: 200 });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "blitz-onb-"));

function harness(store: FeedStore, answer: string | undefined, version = "1.2.102") {
  const handlers: Record<string, any> = {}; const pi: any = { on: (n: string, h: any) => { handlers[n] = h; } };
  const logged: any[] = []; const notes: string[] = []; let asked = 0;
  setupFeedsOnboarding(pi, { log: (e: any) => logged.push(e) } as any, store, version);
  const status: string[] = [];
  const ctx: any = { mode: "tui", hasUI: true, ui: { select: async () => { asked++; return answer; }, notify: (m: string) => notes.push(m), setStatus: (_k: string, t?: string) => status.push(t ?? "<clear>") } };
  return { start: () => handlers.session_start({}, ctx), startPrint: () => handlers.session_start({}, { ...ctx, mode: "print", hasUI: false }), logged, notes, status, asked: () => asked };
}

describe("in-app feeds onboarding (asks once per version while undecided)", () => {
  test("Yes: opts in, installs every feed in-process, feeds are live without a restart", async () => {
    const dir = tmp(); const store = new FeedStore(dir, fetchAll);
    // the secrets hook was registered BEFORE any feed existed
    const hooks: Record<string, any> = {}; const piS: any = { on: (n: string, h: any) => { hooks[n] = h; } };
    const audited: any[] = [];
    setupSecretsFeed(piS, { feeds: { secrets: "monitor" } } as any, { log: (e: any) => audited.push(e) } as any, store);
    expect(hooks.tool_call).toBeDefined();
    expect(await hooks.tool_call({ toolName: "bash", input: { command: "echo AKIAZZ7XQ2BR4TSTKEYA" } }, { hasUI: false })).toBeUndefined();
    expect(audited).toHaveLength(0); // nothing installed yet → silent
    const h = harness(store, CHOICES[0]);
    await h.start();
    expect(store.decision()).toBe("in");
    expect(store.list().every((f) => f.installed)).toBe(true);
    expect(h.logged[0]).toMatchObject({ type: "feeds_onboarding", decision: "in", version: "1.2.102" });
    expect(h.logged.filter((e) => e.type === "feed_update")).toHaveLength(3);
    expect(h.notes[h.notes.length - 1]).toMatch(/installed and active .* in ~\/.blitz\/feeds/);
    expect(h.notes.find((n) => n.includes("secrets installed"))).toMatch(/downloaded → .* stored/);
    expect(h.status.some((t) => t.startsWith("⬇ "))).toBe(true); expect(h.status[h.status.length - 1]).toBe("<clear>");
    // same hook, now live
    await hooks.tool_call({ toolName: "bash", input: { command: "echo AKIAZZ7XQ2BR4TSTKEYA" } }, { hasUI: false });
    expect(audited[0]).toMatchObject({ type: "feed_secret" });
    // decided → never asked again
    await h.start(); expect(h.asked()).toBe(1);
  });
  test("Not now: asks again only on a new version; No: records opt-out; print mode never asks", async () => {
    const dir = tmp(); const store = new FeedStore(dir, fetchAll);
    const later = harness(store, CHOICES[1]);
    await later.start(); await later.start();
    expect(later.asked()).toBe(1); expect(store.decision()).toBeUndefined();
    expect(later.logged[0]).toMatchObject({ type: "feeds_onboarding", decision: "later" });
    const next = harness(store, CHOICES[1], "1.2.103"); await next.start(); expect(next.asked()).toBe(1);
    const no = harness(store, CHOICES[2], "1.2.104"); await no.start();
    expect(store.decision()).toBe("out"); expect(no.logged[0]).toMatchObject({ decision: "out" });
    const again = harness(store, CHOICES[0], "1.2.105"); await again.start(); expect(again.asked()).toBe(0);
    store.optIn(); expect(store.decision()).toBe("in");
    const p = harness(new FeedStore(tmp(), fetchAll), CHOICES[0]); await p.startPrint(); expect(p.asked()).toBe(0);
  });
  test("installFeeds reports failures per feed and keeps going", async () => {
    const store = new FeedStore(tmp(), (async (url: string) => (url.includes("zip") ? new Response("nope", { status: 500 }) : fetchAll(url))) as any);
    const notes: string[] = [];
    expect(await installFeeds(store, undefined, "x", (m) => notes.push(m))).toEqual(["commands"]);
    expect(store.installed("secrets")).toBe(true); expect(store.installed("urls")).toBe(true);
  });
});
