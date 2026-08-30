import fs from "fs"; import os from "os"; import path from "path";
import { parseInstalls } from "../src/feeds/packages";
import { OsvClient, maliciousOf } from "../src/feeds/osv";
import { setupFeeds, describeBlock } from "../src/feeds";
import { stats, layers, summaryLine } from "../src/security-status";
import { loadConfig } from "../src/config";

const P = (ecosystem: string, name: string) => ({ ecosystem, name });

describe("package-install parser (what a command would install)", () => {
  test("npm family: bun/npm/pnpm/yarn add|install, npx/bunx, scoped, versions, flags, non-registry sources dropped", () => {
    expect(parseInstalls("bun add lodash@^4 -D @types/node@20")).toEqual([P("npm", "lodash"), P("npm", "@types/node")]);
    expect(parseInstalls("npm i react react-dom@18 --save && npm install --registry https://r.x/ left-pad")).toEqual([P("npm", "react"), P("npm", "react-dom"), P("npm", "left-pad")]);
    expect(parseInstalls("pnpm add -w chalk; yarn add dayjs")).toEqual([P("npm", "chalk"), P("npm", "dayjs")]);
    expect(parseInstalls("npx create-vite my-app && bunx --bun cowsay hi")).toEqual([P("npm", "create-vite"), P("npm", "cowsay")]);
    expect(parseInstalls("bun add ./local ../up https://x.y/a.tgz git+https://g/h.git file:../p github:a/b")).toEqual([]);
    expect(parseInstalls("bun install")).toEqual([]); // lockfile install names nothing
    expect(parseInstalls("bun remove lodash; npm uninstall react; ls; echo add x")).toEqual([]);
  });
  test("pypi: pip/pip3/pipx/uv/poetry, PEP 503 names, extras and specifiers stripped, uninstall ignored", () => {
    expect(parseInstalls('pip install requests==2.31 "Flask[async]" Django>=4 ./local -r req.txt')).toEqual([P("PyPI", "requests"), P("PyPI", "flask"), P("PyPI", "django")]);
    expect(parseInstalls("pip3 install --index-url https://x/ Some_Pkg.Name && uv pip install httpx && poetry add rich && uv add typer")).toEqual([P("PyPI", "some-pkg-name"), P("PyPI", "httpx"), P("PyPI", "rich"), P("PyPI", "typer")]);
    expect(parseInstalls("pip uninstall requests; pip download flask")).toEqual([]);
  });
  test("cargo, gem, go", () => {
    expect(parseInstalls("cargo add serde@1 --features derive && cargo install ripgrep")).toEqual([P("crates.io", "serde"), P("crates.io", "ripgrep")]);
    expect(parseInstalls("gem install rails -v 7")).toEqual([P("RubyGems", "rails")]);
    expect(parseInstalls("go get github.com/gin-gonic/gin@v1.9 && go install golang.org/x/tools/gopls@latest")).toEqual([P("Go", "github.com/gin-gonic/gin"), P("Go", "golang.org/x/tools/gopls")]);
  });
});

function fakeOsv(answers: Record<string, string[]>, opts: { fail?: boolean; status?: number; summaries?: Record<string, any> } = {}) {
  const calls: any[] = [];
  const fetchImpl: any = async (url: string, init?: any) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    if (opts.fail) throw new Error("ECONNREFUSED");
    if (opts.status) return new Response("nope", { status: opts.status });
    const m = url.match(/\/v1\/vulns\/(.+)$/);
    if (m) return new Response(JSON.stringify(opts.summaries?.[m[1]] ?? { summary: `Malicious code in x (${m[1]})` }), { status: 200 });
    const q = JSON.parse(init.body).queries as { package: { name: string; ecosystem: string } }[];
    return new Response(JSON.stringify({ results: q.map((x) => ({ vulns: (answers[`${x.package.ecosystem}:${x.package.name}`] ?? []).map((id) => ({ id, modified: "2026-01-01" })) })) }), { status: 200 });
  };
  return { fetchImpl, calls };
}
const tmpCache = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "blitz-osv-")), "cache.json");

describe("OSV client: MAL blocks, advisories do not, cache, outages", () => {
  test("only MAL-* ids count; GHSA advisories on legit packages are not malicious", async () => {
    const { fetchImpl, calls } = fakeOsv({ "npm:evil-pkg": ["MAL-2024-1", "GHSA-x"], "npm:lodash": ["GHSA-1", "GHSA-2"] });
    const c = new OsvClient({ fetchImpl, cachePath: tmpCache() });
    const r = await c.check([P("npm", "evil-pkg") as any, P("npm", "lodash") as any, P("PyPI", "requests") as any]);
    expect(r.unreachable).toBe(false);
    expect(r.verdicts.map((v) => [v.name, v.malicious, v.cached])).toEqual([["evil-pkg", ["MAL-2024-1"], false], ["lodash", [], false], ["requests", [], false]]);
    expect(r.verdicts[0].summary).toBe("Malicious code in x (MAL-2024-1)");
    expect(maliciousOf(r).map((v) => v.name)).toEqual(["evil-pkg"]);
    expect(calls[0].body.queries).toHaveLength(3);
    // second check is served from cache — no request
    const r2 = await c.check([P("npm", "evil-pkg") as any]);
    expect(r2.verdicts[0].cached).toBe(true);
    expect(calls.filter((x) => x.url.endsWith("/querybatch"))).toHaveLength(1);
    expect(c.cacheStats()).toMatchObject({ entries: 3, malicious: 1 });
  });
  test("withdrawn OSV entries do not block", async () => {
    const { fetchImpl } = fakeOsv({ "npm:was-bad": ["MAL-2023-9"] }, { summaries: { "MAL-2023-9": { summary: "old", withdrawn: "2024-01-01" } } });
    const r = await new OsvClient({ fetchImpl, cachePath: tmpCache() }).check([P("npm", "was-bad") as any]);
    expect(r.verdicts[0].malicious).toEqual(["MAL-2023-9"]);
    expect(maliciousOf(r)).toEqual([]);
  });
  test("network failure and HTTP errors are reported as unreachable, never thrown", async () => {
    const r1 = await new OsvClient({ fetchImpl: fakeOsv({}, { fail: true }).fetchImpl, cachePath: tmpCache() }).check([P("npm", "x") as any]);
    expect(r1).toMatchObject({ unreachable: true, verdicts: [] });
    expect(r1.error).toContain("ECONNREFUSED");
    const r2 = await new OsvClient({ fetchImpl: fakeOsv({}, { status: 503 }).fetchImpl, cachePath: tmpCache() }).check([P("npm", "x") as any]);
    expect(r2).toMatchObject({ unreachable: true, error: "OSV HTTP 503" });
  });
  test("expired cache entries are re-queried", async () => {
    const { fetchImpl, calls } = fakeOsv({});
    const c = new OsvClient({ fetchImpl, cachePath: tmpCache(), ttlHours: 0 });
    await c.check([P("npm", "a") as any]); await c.check([P("npm", "a") as any]);
    expect(calls.filter((x) => x.url.endsWith("/querybatch"))).toHaveLength(2);
  });
});

function harness(mode: "enforce" | "monitor" | "off", answers: Record<string, string[]>, opts: any = {}) {
  const handlers: Record<string, any> = {};
  const pi: any = { on: (n: string, h: any) => { handlers[n] = h; } };
  const logged: any[] = []; const notes: string[] = [];
  const audit: any = { log: (e: any) => logged.push(e) };
  const cfg: any = { feeds: { packages: mode, cache_ttl_hours: 24 } };
  setupFeeds(pi, cfg, audit, new OsvClient({ fetchImpl: fakeOsv(answers, opts).fetchImpl, cachePath: tmpCache() }));
  const ctx: any = { hasUI: true, ui: { notify: (m: string) => notes.push(m) } };
  return { fire: (command: string, tool = "bash") => handlers.tool_call?.({ toolName: tool, input: { command } }, ctx), logged, notes, registered: !!handlers.tool_call };
}

describe("feeds hook on bash tool calls", () => {
  beforeEach(() => { Object.assign(stats.feeds, { checked: 0, malicious: 0, unreachable: 0, last: "" }); stats.blocked.feed = 0; });
  test("enforce: a known-malicious install is blocked with the OSV id; a clean install passes silently", async () => {
    const h = harness("enforce", { "npm:@0xengine/xmlrpc": ["MAL-2024-11182"] });
    const blocked = await h.fire("bun add @0xengine/xmlrpc lodash");
    expect(blocked).toEqual({ block: true, reason: expect.stringContaining('npm "@0xengine/xmlrpc" is a known malicious package (MAL-2024-11182') });
    expect(h.logged[0]).toMatchObject({ type: "feed_check", feed: "osv", mode: "enforce", allowed: false, malicious: ["npm:@0xengine/xmlrpc"] });
    expect(stats.blocked.feed).toBe(1); expect(stats.feeds.malicious).toBe(1); expect(stats.feeds.checked).toBe(2);
    expect(await h.fire("bun add is-odd")).toBeUndefined();
    expect(h.logged[1]).toMatchObject({ type: "feed_check", allowed: true, malicious: [] });
    expect(await h.fire("ls -la && bun test")).toBeUndefined();
    expect(h.logged).toHaveLength(2); // nothing to check → nothing logged
  });
  test("monitor: recorded and shown, not blocked", async () => {
    const h = harness("monitor", { "npm:evil": ["MAL-1"] });
    expect(await h.fire("npm i evil")).toBeUndefined();
    expect(h.logged[0]).toMatchObject({ type: "feed_check", mode: "monitor", allowed: true, malicious: ["npm:evil"] });
    expect(h.notes[0]).toContain("Package feed (monitor)");
    expect(stats.blocked.feed).toBe(0);
  });
  test("unreachable feed: install allowed, outage audited and shown", async () => {
    const h = harness("enforce", {}, { fail: true });
    expect(await h.fire("pip install requests")).toBeUndefined();
    expect(h.logged[0]).toMatchObject({ type: "feed_unreachable", feed: "osv", packages: ["PyPI:requests"] });
    expect(h.logged[1]).toMatchObject({ type: "feed_check", allowed: true });
    expect(h.notes[0]).toContain("unreachable");
    expect(stats.feeds.unreachable).toBe(1);
  });
  test("off: no hook registered; powershell is covered like bash", async () => {
    expect(harness("off", {}).registered).toBe(false);
    const h = harness("enforce", { "npm:evil": ["MAL-1"] });
    expect(await h.fire("npm i evil", "powershell")).toMatchObject({ block: true });
    expect(await h.fire("npm i evil", "read")).toBeUndefined();
  });
  test("layer, summary line and config default", () => {
    const cfg: any = { threat_detection: { enabled: true, tier: 2 }, audit: { enabled: true, path: "/a" }, profiles: { default: "user" }, sandbox: { enabled: true, run_dir: ".", backend: "auto" }, governance: { enabled: true, mode: "enforce", provider: "local" }, goodbehavior: { profile: "development" }, threat_api: { enabled: false }, feeds: { packages: "monitor", cache_ttl_hours: 24 } };
    expect(layers(cfg, "bwrap").find((l) => l.key === "feeds")).toMatchObject({ name: "Package feed (OSV)", mode: "monitor" });
    expect(summaryLine(cfg, "bwrap")).toContain("packages osv (monitor)");
    expect(loadConfig().feeds).toEqual({ packages: "enforce", cache_ttl_hours: 24 });
    expect(describeBlock({ unreachable: false, verdicts: [{ ecosystem: "npm", name: "e", malicious: ["MAL-1"], summary: "Malicious code in e (npm)", cached: false }] })).toBe('npm "e" is a known malicious package (MAL-1: Malicious code in e (npm))');
  });
});
