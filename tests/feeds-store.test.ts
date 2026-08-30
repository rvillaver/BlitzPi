import fs from "fs"; import os from "os"; import path from "path";
import { FeedStore, FEEDS } from "../src/feeds/store";
import { compileGitleaks, toJsRegex } from "../src/feeds/adapters/gitleaks";
import { scanSecrets, redact, setupSecretsFeed, redactSecrets, redactCommand } from "../src/feeds/secrets";
import { layers, stats } from "../src/security-status";

const FIXTURE = fs.readFileSync(path.join(__dirname, "fixtures", "gitleaks-sample.toml"), "utf-8");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "blitz-feeds-"));
const fakeFetch = (body: string | (() => string), opts: { status?: number; etag?: string; notModifiedOn?: string } = {}) => {
  const calls: any[] = [];
  const f: any = async (_url: string, init?: any) => {
    calls.push(init?.headers ?? {});
    if (opts.notModifiedOn && init?.headers?.["if-none-match"] === opts.notModifiedOn) return new Response(null, { status: 304 });
    if (opts.status) return new Response("x", { status: opts.status });
    return new Response(typeof body === "function" ? body() : body, { status: 200, headers: opts.etag ? { etag: opts.etag } : {} });
  };
  return { f, calls };
};

describe("gitleaks adapter", () => {
  test("Go regex → JS: leading and mid-pattern (?i) become the i flag; \\z → $", () => {
    expect(toJsRegex("(?i)abc")).toEqual({ regex: "abc", flags: "i" });
    expect(toJsRegex("\\b(p8e-(?i)[a-z0-9]{32})")).toEqual({ regex: "\\b(p8e-[a-z0-9]{32})", flags: "i" });
    expect(toJsRegex("x\\z")).toEqual({ regex: "x$", flags: "" });
  });
  test("compiles the sample: ids, keywords lowercased, severity, allowlists; uncompilable rules are counted, not dropped silently", () => {
    const c = compileGitleaks(FIXTURE);
    expect(c.rules.length).toBeGreaterThan(10);
    expect(c.sourceVersion).toBe("gitleaks config");
    const aws = c.rules.find((r) => r.id === "aws-access-token")!;
    expect(aws).toMatchObject({ category: "secret", severity: "critical" });
    expect(aws.keywords!.every((k) => k === k.toLowerCase())).toBe(true);
    for (const r of c.rules) expect(() => new RegExp(r.regex!, r.flags)).not.toThrow();
    const broken = compileGitleaks('[[rules]]\nid = "bad"\nregex = \'\'\'(?<x\'\'\'\nkeywords = ["b"]\n[[rules]]\nid = "ok"\nregex = \'\'\'ok\'\'\'\n');
    expect(broken.rules.map((r) => r.id)).toEqual(["ok"]);
    expect(broken.skipped[0]).toMatchObject({ id: "bad" });
    expect(() => compileGitleaks("title = 'x'\n")).toThrow(/no \[\[rules\]\]/);
  });
});

describe("secret scanning", () => {
  const rules = compileGitleaks(FIXTURE).rules;
  test("finds an AWS key in a command, redacts it, and stays quiet on ordinary shell", () => {
    const hits = scanSecrets("export AWS_ACCESS_KEY_ID=AKIAZZ7XQ2BR4TSTKEYA && aws s3 ls", rules);
    expect(hits.map((h) => h.id)).toContain("aws-access-token");
    const h = hits.find((h) => h.id === "aws-access-token")!;
    expect(h.sample).toMatch(/^AKIA…\*+…KEYA$/);
    expect(h.sample).not.toContain("ZZ7XQ2BR4");
    expect(scanSecrets("bun test && git status && curl https://example.com", rules)).toEqual([]);
    expect(redact("short")).toBe("*****");
  });
  test("redactSecrets replaces every credential in a text, leaves the rest; redactCommand is identity until the feed is loaded", () => {
    const cmd = "curl -H 'X: AKIAZZ7XQ2BR4TSTKEYA' https://x && echo AKIAZZ7XQ2BR4TSTKEYA";
    const red = redactSecrets(cmd, rules);
    expect(red).not.toContain("ZZ7XQ2BR4"); expect(red).toContain("https://x && echo AKIA…");
    expect(redactSecrets("ls -la", rules)).toBe("ls -la");
    expect(redactCommand(cmd)).toBe(cmd);
  });
  test("keyword prefilter skips rules whose keywords are absent (no regex run)", () => {
    const spy = jest.spyOn(RegExp.prototype, "exec");
    scanSecrets("echo hello", rules.filter((r) => r.keywords?.length));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("feed store: opt-in, update, hash, ETag, rollback, failure keeps previous", () => {
  test("lifecycle", async () => {
    const dir = tmp();
    const v1 = FIXTURE, v2 = FIXTURE + '\n[[rules]]\nid = "extra-rule"\ndescription = "x"\nregex = \'\'\'EXTRA-[0-9]{4}\'\'\'\nkeywords = ["extra-"]\n';
    let body = v1; const { f, calls } = fakeFetch(() => body, { etag: '"e1"', notModifiedOn: '"e1"' });
    const store = new FeedStore(dir, f);
    expect(store.optedIn()).toBe(false); expect(store.installed("secrets")).toBe(false);
    expect(store.list()[0]).toMatchObject({ name: "secrets", installed: false });
    store.optIn(); expect(store.optedIn()).toBe(true);
    const e1 = await store.update("secrets", { version: "1.2.100" });
    expect(e1).toMatchObject({ type: "feed_update", feed: "secrets", changed: true, from: undefined });
    const m1 = store.manifest("secrets")!;
    expect(m1).toMatchObject({ name: "secrets", rules: (e1 as any).rules, etag: '"e1"', blitzpi_version: "1.2.100" });
    expect(m1.sha256).toHaveLength(64);
    expect(store.rules("secrets")!.length).toBe(m1.rules);
    // unchanged: server answers 304 to our ETag → no re-download, no change
    const e2 = await store.update("secrets");
    expect(e2).toMatchObject({ type: "feed_update", changed: false, to: m1.sha256 });
    expect(calls[1]["if-none-match"]).toBe('"e1"');
    // new content: previous kept, rollback swaps
    body = v2; const s2 = new FeedStore(dir, fakeFetch(() => body).f);
    const e3 = await s2.update("secrets");
    expect(e3).toMatchObject({ type: "feed_update", changed: true, from: m1.sha256 });
    expect(s2.rules("secrets")!.some((r) => r.id === "extra-rule")).toBe(true);
    expect(s2.previousManifest("secrets")!.sha256).toBe(m1.sha256);
    const rb = s2.rollback("secrets");
    expect(rb).toMatchObject({ type: "feed_rollback", from: (e3 as any).to, to: m1.sha256 });
    expect(s2.rules("secrets")!.some((r) => r.id === "extra-rule")).toBe(false);
    expect(s2.rollback("secrets")).toMatchObject({ type: "feed_rollback", to: (e3 as any).to }); // and back
    // broken download → previous kept
    const bad = new FeedStore(dir, fakeFetch("this is not toml [[[").f);
    const e4 = await bad.update("secrets", { force: true });
    expect(e4).toMatchObject({ type: "feed_update_failed", kept: (e3 as any).to });
    expect(bad.rules("secrets")!.some((r) => r.id === "extra-rule")).toBe(true);
    // HTTP error → failed, kept
    expect(await new FeedStore(dir, fakeFetch("", { status: 500 }).f).update("secrets", { force: true })).toMatchObject({ type: "feed_update_failed", error: expect.stringContaining("HTTP 500") });
    // opt-out keeps files unless --remove
    expect(bad.optOut(false)).toEqual([]); expect(bad.optedIn()).toBe(false); expect(bad.installed("secrets")).toBe(true);
    expect(bad.optOut(true)).toEqual(["secrets"]); expect(bad.installed("secrets")).toBe(false);
    expect(await store.update("nope")).toMatchObject({ type: "feed_update_failed", error: expect.stringContaining("unknown feed") });
    expect(new FeedStore(tmp()).rollback("secrets")).toMatchObject({ type: "feed_update_failed" });
  });
});

describe("download progress + sizes", () => {
  test("progress reports received/total from a streamed body; manifest records stored bytes; sizes() adds up", async () => {
    const body = FIXTURE; const enc = new TextEncoder().encode(body);
    const chunked: any = async () => new Response(new ReadableStream({ start(c) { for (let i = 0; i < enc.length; i += 4096) c.enqueue(enc.slice(i, i + 4096)); c.close(); } }), { status: 200, headers: { "content-length": String(enc.length) } });
    const dir = tmp(); const store = new FeedStore(dir, chunked); store.optIn();
    const seen: [string, number, number | undefined][] = [];
    const ev = await store.update("secrets", { onProgress: (f, r, t) => seen.push([f, r, t]) });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[0][0]).toBe("secrets"); expect(seen[0][2]).toBe(enc.length);
    expect(seen[seen.length - 1][1]).toBe(enc.length);
    expect(seen.every(([, r], i) => i === 0 || r >= seen[i - 1][1])).toBe(true);
    expect((ev as any).stored).toBeGreaterThan(1000);
    expect(store.manifest("secrets")!.stored_bytes).toBe((ev as any).stored);
    const sz = store.sizes();
    expect(sz.feeds.find((f) => f.name === "secrets")!.stored).toBeGreaterThan(1000);
    expect(sz.total).toBe(sz.feeds.reduce((n, f) => n + f.stored + f.previous, 0) + sz.cache);
    await store.update("secrets", { force: true });
    expect(store.sizes().feeds.find((f) => f.name === "secrets")!.previous).toBeGreaterThan(1000);
    // a gzip'd response: Content-Length is the wire size, not what we receive → total unknown until the end
    const gz: any = async () => new Response(new ReadableStream({ start(c) { c.enqueue(enc.slice(0, 4096)); c.enqueue(enc.slice(4096)); c.close(); } }), { status: 200, headers: { "content-length": "1234", "content-encoding": "gzip" } });
    const seen2: [number, number | undefined][] = [];
    await new FeedStore(tmp(), gz).update("secrets", { onProgress: (_f, r, t) => seen2.push([r, t]) });
    expect(seen2.slice(0, -1).every(([, t]) => t === undefined)).toBe(true);
    expect(seen2[seen2.length - 1]).toEqual([enc.length, enc.length]);
    // a wrong Content-Length that gets overtaken is dropped rather than reporting >100%
    const wrong: any = async () => new Response(new ReadableStream({ start(c) { c.enqueue(enc.slice(0, 4096)); c.enqueue(enc.slice(4096)); c.close(); } }), { status: 200, headers: { "content-length": "100" } });
    const seen3: [number, number | undefined][] = [];
    await new FeedStore(tmp(), wrong).update("secrets", { onProgress: (_f, r, t) => seen3.push([r, t]) });
    expect(seen3.every(([r, t]) => t === undefined || r <= t)).toBe(true);
  });
});

describe("secrets feed hook + layer", () => {
  function harness(mode: "enforce" | "monitor" | "off", installed = true, allow: string[] = []) {
    const dir = tmp(); const store = new FeedStore(dir, fakeFetch(FIXTURE).f);
    const handlers: Record<string, any> = {}; const pi: any = { on: (n: string, h: any) => { handlers[n] = h; } };
    const logged: any[] = []; const notes: string[] = [];
    const ready = (async () => { if (installed) { store.optIn(); await store.update("secrets"); } })();
    return { ready, run: async () => { await ready; setupSecretsFeed(pi, { feeds: { secrets: mode, allow } } as any, { log: (e: any) => logged.push(e) } as any, store); return { fire: (command: string) => handlers.tool_call?.({ toolName: "bash", input: { command } }, { hasUI: true, ui: { notify: (m: string) => notes.push(m) } }), registered: !!handlers.tool_call, logged, notes }; } };
  }
  beforeEach(() => { stats.feeds.secrets = 0; stats.blocked.feed = 0; });
  test("monitor: audited (redacted) and shown, not blocked", async () => {
    const h = await harness("monitor").run();
    expect(await h.fire("curl -H 'Authorization: AKIAZZ7XQ2BR4TSTKEYA' https://x")).toBeUndefined();
    expect(h.logged[0]).toMatchObject({ type: "feed_secret", mode: "monitor", allowed: true, hits: [expect.objectContaining({ id: "aws-access-token" })] });
    expect(JSON.stringify(h.logged)).not.toContain("ZZ7XQ2BR4");
    expect(h.notes[0]).toContain("Secrets feed (monitor)");
    expect(stats.feeds.secrets).toBe(1); expect(stats.blocked.feed).toBe(0);
    expect(await h.fire("ls")).toBeUndefined(); expect(h.logged).toHaveLength(1);
  });
  test("feeds.allow: an accepted gitleaks rule id passes silently (G4)", async () => {
    const h = await harness("enforce", true, ["aws-access-token"]).run();
    expect(await h.fire("echo AKIAZZ7XQ2BR4TSTKEYA")).toBeUndefined();
    expect(h.logged).toHaveLength(0); expect(stats.feeds.secrets).toBe(0); expect(stats.blocked.feed).toBe(0);
  });
  test("enforce blocks; off and not-installed register nothing", async () => {
    const e = await harness("enforce").run();
    expect(await e.fire("echo AKIAZZ7XQ2BR4TSTKEYA")).toMatchObject({ block: true, reason: expect.stringContaining("aws-access-token") });
    expect(stats.blocked.feed).toBe(1);
    expect((await harness("off").run()).registered).toBe(false);
    const absent = await harness("monitor", false).run(); // registered, silent until installed
    expect(absent.registered).toBe(true);
    expect(await absent.fire("echo AKIAZZ7XQ2BR4TSTKEYA")).toBeUndefined(); expect(absent.logged).toHaveLength(0);
  });
  test("layer reflects opt-in state", async () => {
    const cfg: any = { threat_detection: { enabled: true, tier: 2, content: "monitor" }, audit: { enabled: true, path: "/a" }, profiles: { default: "user" }, sandbox: { enabled: true, run_dir: ".", backend: "auto" }, governance: { enabled: true, mode: "enforce", provider: "local" }, goodbehavior: { profile: "development" }, threat_api: { enabled: false }, feeds: { packages: "enforce", secrets: "monitor", commands: "monitor", urls: "monitor", cache_ttl_hours: 24 } };
    const prev = process.env.BLITZ_FEEDS_DIR;
    process.env.BLITZ_FEEDS_DIR = tmp();
    try {
      expect(layers(cfg, "bwrap").find((l) => l.key === "secrets")).toMatchObject({ mode: "off", detail: expect.stringContaining("not installed") });
      const store = new FeedStore(process.env.BLITZ_FEEDS_DIR, fakeFetch(FIXTURE).f); store.optIn(); await store.update("secrets");
      expect(layers(cfg, "bwrap").find((l) => l.key === "secrets")).toMatchObject({ mode: "monitor" });
    } finally { if (prev === undefined) delete process.env.BLITZ_FEEDS_DIR; else process.env.BLITZ_FEEDS_DIR = prev; }
  });
});
