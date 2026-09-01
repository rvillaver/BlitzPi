/**
 * SP-3: global config sets defaults for every project; a project's own config overrides individual fields
 * on top of it — it must not replace the global file wholesale. Regression for the bug found while researching
 * the security-profiles work: loadConfig() used to pick project XOR global, so a global-scope default silently
 * vanished the instant a project had its own .blitz/blitz.config.yaml (which workspace-init.ts writes for every
 * new project).
 */
import fs from "fs";
import os from "os";
import path from "path";

describe("config: global + project layering", () => {
  const origHome = process.env.HOME;
  const origCwd = process.cwd();
  let home: string;
  let project: string;

  beforeEach(() => {
    jest.resetModules();
    home = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-cfg-home-"));
    project = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-cfg-proj-"));
    process.env.HOME = home;
    process.chdir(project);
  });

  afterEach(() => {
    process.chdir(origCwd);
    process.env.HOME = origHome;
  });

  function writeGlobal(yaml: string) {
    fs.mkdirSync(path.join(home, ".blitz"), { recursive: true });
    fs.writeFileSync(path.join(home, ".blitz", "blitz.config.yaml"), yaml);
  }
  function writeProject(yaml: string) {
    fs.mkdirSync(path.join(project, ".blitz"), { recursive: true });
    fs.writeFileSync(path.join(project, ".blitz", "blitz.config.yaml"), yaml);
  }

  test("neither file exists -> built-in defaults", () => {
    const { loadConfig } = require("../src/config");
    expect(loadConfig().feeds.packages).toBe("enforce");
  });

  test("global-only: global values apply (no project config at all)", () => {
    writeGlobal("threat_detection:\n  tier: 4\n");
    const { loadConfig } = require("../src/config");
    expect(loadConfig().threat_detection.tier).toBe(4);
  });

  test("project-only: unaffected by absence of global (today's shipped behavior, unchanged)", () => {
    writeProject("governance:\n  mode: monitor\n");
    const { loadConfig } = require("../src/config");
    const cfg = loadConfig();
    expect(cfg.governance.mode).toBe("monitor");
    expect(cfg.threat_detection.tier).toBe(2); // untouched field falls to the built-in default
  });

  test("global sets a default, project overrides only what it names — the fixed bug", () => {
    writeGlobal("feeds:\n  commands: enforce\n  urls: monitor\n");
    writeProject("feeds:\n  urls: off\n"); // project names only `urls`
    const { loadConfig } = require("../src/config");
    const cfg = loadConfig();
    expect(cfg.feeds.commands).toBe("enforce"); // inherited from global — previously this vanished entirely
    expect(cfg.feeds.urls).toBe("off"); // project override wins over global
    expect(cfg.feeds.packages).toBe("enforce"); // neither file names it -> built-in default
  });

  test("project overrides a whole nested block; a sibling block still inherits from global", () => {
    writeGlobal("threat_detection:\n  tier: 4\n  content: off\ngovernance:\n  mode: monitor\n");
    writeProject("threat_detection:\n  tier: 1\n"); // project touches threat_detection only
    const { loadConfig } = require("../src/config");
    const cfg = loadConfig();
    expect(cfg.threat_detection.tier).toBe(1); // project wins
    expect(cfg.threat_detection.content).toBe("off"); // inherited from global (project didn't mention it)
    expect(cfg.governance.mode).toBe("monitor"); // untouched block, inherited from global entirely
  });
});

describe("SP-mon: 'monitored' loosens governance/secrets/urls to monitor mode, but only where nobody named it", () => {
  const origHome = process.env.HOME;
  const origCwd = process.cwd();
  let home: string;
  let project: string;

  beforeEach(() => {
    jest.resetModules();
    home = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-cfg-home-"));
    project = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-cfg-proj-"));
    process.env.HOME = home;
    process.chdir(project);
  });
  afterEach(() => {
    process.chdir(origCwd);
    process.env.HOME = origHome;
  });
  function writeProject(yaml: string) {
    fs.mkdirSync(path.join(project, ".blitz"), { recursive: true });
    fs.writeFileSync(path.join(project, ".blitz", "blitz.config.yaml"), yaml);
  }

  test("monitored + nothing named -> governance/secrets/urls default to monitor", () => {
    writeProject("security_level: monitored\n");
    const { loadConfig } = require("../src/config");
    const cfg = loadConfig();
    expect(cfg.governance.mode).toBe("monitor");
    expect(cfg.feeds.secrets).toBe("monitor");
    expect(cfg.feeds.urls).toBe("monitor");
    expect(cfg.feeds.packages).toBe("enforce"); // not part of this default — the malicious-package floor is untouched
    expect(cfg.feeds.commands).toBe("monitor"); // already monitor by built-in default, unaffected either way
  });

  test("an explicit project override still wins over the tier default", () => {
    writeProject("security_level: monitored\ngovernance:\n  mode: enforce\nfeeds:\n  urls: enforce\n");
    const { loadConfig } = require("../src/config");
    const cfg = loadConfig();
    expect(cfg.governance.mode).toBe("enforce"); // named explicitly -> tier does not override it
    expect(cfg.feeds.urls).toBe("enforce");
    expect(cfg.feeds.secrets).toBe("monitor"); // not named -> tier default still applies
  });

  test("guarded/strict never apply this default (unchanged built-in enforce)", () => {
    writeProject("security_level: strict\n");
    const { loadConfig } = require("../src/config");
    const cfg = loadConfig();
    expect(cfg.governance.mode).toBe("enforce");
    expect(cfg.feeds.secrets).toBe("enforce");
    expect(cfg.feeds.urls).toBe("enforce");
  });
});
