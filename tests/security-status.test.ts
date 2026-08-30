import { layers, summaryLine, panel, governanceStatus, stats } from "../src/security-status";
import { stripInstallDocs } from "../src/prompt-hygiene";
import { pinPackageManager } from "../src/workspace-init";
import fs from "fs"; import os from "os"; import path from "path";
process.env.BLITZ_FEEDS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-nofeeds-")); // status must not depend on this machine's opt-in

const cfg: any = {
  threat_detection: { enabled: true, tier: 2 }, audit: { enabled: true, path: "/h/.blitz/audit" }, profiles: { default: "user" },
  sandbox: { enabled: true, run_dir: ".", backend: "auto" }, governance: { enabled: true, mode: "enforce", provider: "local", model_whitelist: [] }, goodbehavior: { profile: "development" }, threat_api: { enabled: false }, feeds: { packages: "enforce", secrets: "monitor", commands: "monitor", cache_ttl_hours: 24 },
};

describe("security status model", () => {
  test("one vocabulary: per-call governance is monitor, gates are enforce, pinned bash is monitor", () => {
    const L = Object.fromEntries(layers(cfg, "bwrap").map((l) => [l.key, l.mode]));
    expect(L).toEqual({ input: "enforce", governance: "enforce", profiles: "enforce", sandbox: "enforce", bash: "enforce", threat: "enforce", feeds: "enforce", secrets: "off", commands: "off", audit: "enforce" });
    expect(layers({ ...cfg, governance: { ...cfg.governance, mode: "monitor" } }, "bwrap").find((l) => l.key === "governance")!.mode).toBe("monitor");
    expect(layers(cfg, "pinned").find((l) => l.key === "bash")!.mode).toBe("monitor");
    expect(layers({ ...cfg, governance: { ...cfg.governance, enabled: false } }, "bwrap").find((l) => l.key === "governance")!.mode).toBe("off");
  });
  test("summary line names provider, backend, profile, tier with modes", () => {
    expect(summaryLine(cfg, "bwrap")).toBe("governance local (enforce) · profile user (enforce) · files (enforce) · bash bwrap (enforce) · threat tier 2 (enforce) · packages osv (enforce) · secrets gitleaks (off) · commands sigma (off) · audit (enforce)");
  });
  test("status bar is steady when fine and loud on a denial", () => {
    stats.governance.lastDenial = "";
    expect(governanceStatus(cfg)).toBe("🛡 local · enforce");
    stats.governance.lastDenial = "model not whitelisted";
    expect(governanceStatus(cfg)).toBe("🛡 STOPPED — model not whitelisted");
    expect(governanceStatus({ ...cfg, governance: { ...cfg.governance, mode: "monitor" } })).toBe("🛡 DENIED — model not whitelisted");
    stats.governance.lastDenial = "";
  });
  test("panel explains the legend, every layer, counters and where each is configured", () => {
    const p = panel(cfg, "bwrap", ['{"timestamp":"2026-08-30T00:00:01.000Z","type":"file_operation","tool":"read","zone":"project","allowed":true}']);
    for (const s of ["enforce = the runtime blocks", "Per-call governance", "the run is aborted", ".blitz/profiles/<name>.yaml", "Model calls checked:", "Blocked:", "Last decisions:"]) expect(p).toContain(s);
  });
});

describe("prompt hygiene", () => {
  const prompt = `Guidelines:\n- Be concise\n\nPi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):\n- Main documentation: /x/node_modules/@earendil-works/pi-coding-agent/README.md\n- Additional docs: /x/node_modules/@earendil-works/pi-coding-agent/docs\n- Examples: /x/node_modules/@earendil-works/pi-coding-agent/examples (extensions, custom tools, SDK)\n- Always read pi .md files completely\n\nThe following skills provide specialized instructions for specific tasks.\n<available_skills>\n</available_skills>\n\nCurrent working directory: /w`;
  test("removes the install-dir docs block and nothing else", () => {
    const out = stripInstallDocs(prompt);
    expect(out).not.toContain("Pi documentation");
    expect(out).not.toContain("node_modules/@earendil-works");
    expect(out).toContain("Guidelines:\n- Be concise");
    expect(out).toContain("The following skills provide");
    expect(out).toContain("Current working directory: /w");
  });
  test("is a no-op on a prompt without the block", () => { expect(stripInstallDocs("hello\n\nworld")).toBe("hello\n\nworld"); });
});

describe("pinPackageManager", () => {
  test("writes npmCommand = the running runtime into the project's .pi/settings.json, merging and never overriding", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "pin-"));
    pinPackageManager(d);
    const f = path.join(d, ".pi", "settings.json");
    expect(JSON.parse(fs.readFileSync(f, "utf-8")).npmCommand).toEqual([process.execPath]);
    fs.writeFileSync(f, JSON.stringify({ npmCommand: ["npm"], theme: "x" }));
    pinPackageManager(d);
    expect(JSON.parse(fs.readFileSync(f, "utf-8"))).toEqual({ npmCommand: ["npm"], theme: "x" });
    fs.rmSync(d, { recursive: true, force: true });
  });
});
