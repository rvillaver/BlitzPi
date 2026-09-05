/**
 * B11 — the service unit itself. Installing for real starts a daemon at boot, so what is pinned here is the
 * content: that it is **user-scoped**, that it runs nothing but `blitzpi bridge start`, and that it never carries
 * a credential. The bridge runs the agent as you against your projects; a system-wide unit or a token baked into
 * the unit file would quietly change who that agent is.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { SERVICE_NAME, installService, launchdPlist, launchdPlistPath, serviceStatus, systemdUnit, systemdUnitPath, uninstallService } from "../src/bridge/service";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "blitz-svc-"));

describe("systemd unit", () => {
  const unit = systemdUnit("/usr/local/bin/blitzpi");

  test("runs the bridge and nothing else", () => {
    expect(unit).toContain("ExecStart=/usr/local/bin/blitzpi bridge start");
    expect(unit).toContain("Restart=on-failure");
  });

  test("is a USER unit — never system-wide, never another user", () => {
    expect(unit).toContain("WantedBy=default.target"); // user target, not multi-user.target
    expect(unit).not.toMatch(/^User=/m);
    expect(unit).not.toMatch(/multi-user\.target/);
    expect(systemdUnitPath("/home/x")).toBe("/home/x/.config/systemd/user/blitzpi-bridge.service");
  });

  test("carries no credentials — tokens stay in ~/.blitz/bridge", () => {
    expect(unit).not.toMatch(/token|TOKEN|secret|Environment=/);
  });
});

describe("launchd plist", () => {
  const plist = launchdPlist("/opt/homebrew/bin/blitzpi");

  test("is a LaunchAgent running the bridge, restarted on failure only", () => {
    expect(plist).toContain("<string>/opt/homebrew/bin/blitzpi</string>");
    expect(plist).toContain("<string>bridge</string>");
    expect(plist).toContain("<string>start</string>");
    expect(plist).toContain("SuccessfulExit");
    expect(launchdPlistPath("/Users/x")).toContain("/Users/x/Library/LaunchAgents/");
  });

  test("carries no credentials", () => {
    expect(plist).not.toMatch(/token|TOKEN|secret/);
  });
});

describe("install / status / uninstall", () => {
  test("writes the unit under the given home, and reports honestly when the enable step fails", () => {
    const home = tmp();
    const r = installService(home, "linux");
    // The unit is written even though systemctl cannot enable a unit in a temp home — and the result says so
    // rather than claiming success.
    expect(fs.existsSync(systemdUnitPath(home))).toBe(true);
    expect(fs.readFileSync(systemdUnitPath(home), "utf-8")).toContain("bridge start");
    if (!r.ok) expect(r.message).toMatch(/failed|linger/i);
  });

  test("status on a home with nothing installed says so, and points at the command", () => {
    const r = serviceStatus(tmp(), "linux");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("install-service");
  });

  test("uninstall removes the unit and is safe to run twice", () => {
    const home = tmp();
    installService(home, "linux");
    expect(uninstallService(home, "linux").message).toContain(SERVICE_NAME);
    expect(fs.existsSync(systemdUnitPath(home))).toBe(false);
    expect(uninstallService(home, "linux").message).toContain("nothing installed");
  });

  test("an unsupported platform is refused by name instead of writing something useless", () => {
    const r = installService(tmp(), "win32");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("win32");
  });
});
