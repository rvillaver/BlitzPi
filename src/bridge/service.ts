/**
 * B11 — installing the bridge daemon as a real service, so it survives a reboot instead of living in whichever
 * terminal happened to start it.
 *
 * User-scoped on purpose: a systemd **user** unit / a launchd **LaunchAgent**, never a system-wide daemon. The
 * bridge runs the agent as you, against your projects, with your credentials; running it as root or as a shared
 * system service would silently widen who that agent is.
 *
 * The unit only ever runs `blitzpi bridge start` — no tokens, no secrets. Credentials stay in
 * `~/.blitz/bridge/` where the adapters already read them, and this file never copies or prints them.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export type ServiceAction = "install" | "uninstall" | "status";

export const SERVICE_NAME = "blitzpi-bridge";

/** The command the service runs. Resolved once at install time so a shim on PATH cannot change underneath it. */
export function serviceCommand(argv0 = process.argv[1]): string {
  const shim = spawnSync("sh", ["-c", "command -v blitzpi"], { encoding: "utf-8" });
  const resolved = shim.status === 0 ? shim.stdout.trim() : "";
  return resolved || argv0 || "blitzpi";
}

export const systemdUnitPath = (home = os.homedir()) => path.join(home, ".config", "systemd", "user", `${SERVICE_NAME}.service`);
export const launchdPlistPath = (home = os.homedir()) => path.join(home, "Library", "LaunchAgents", `com.blitzpi.bridge.plist`);

export function systemdUnit(cmd: string): string {
  return `[Unit]
Description=BlitzPi chat bridge
After=network-online.target

[Service]
Type=simple
ExecStart=${cmd} bridge start
Restart=on-failure
RestartSec=5
# The bridge is the user's agent: never run it as anyone else.

[Install]
WantedBy=default.target
`;
}

export function launchdPlist(cmd: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.blitzpi.bridge</string>
  <key>ProgramArguments</key>
  <array><string>${cmd}</string><string>bridge</string><string>start</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
</dict>
</plist>
`;
}

export interface ServiceResult { ok: boolean; message: string; path?: string }

export function installService(home = os.homedir(), platform = process.platform): ServiceResult {
  const cmd = serviceCommand();
  if (platform === "linux") {
    const unit = systemdUnitPath(home);
    fs.mkdirSync(path.dirname(unit), { recursive: true });
    fs.writeFileSync(unit, systemdUnit(cmd));
    const enable = spawnSync("systemctl", ["--user", "enable", "--now", `${SERVICE_NAME}.service`], { encoding: "utf-8" });
    if (enable.status !== 0) {
      return { ok: false, path: unit, message: `unit written to ${unit}, but "systemctl --user enable --now ${SERVICE_NAME}" failed: ${(enable.stderr || "").trim() || "unknown error"}\nIf this is a headless box, you may need: loginctl enable-linger ${os.userInfo().username}` };
    }
    return { ok: true, path: unit, message: `installed and started (systemd user unit: ${unit})\n  logs:   journalctl --user -u ${SERVICE_NAME} -f\n  stop:   systemctl --user stop ${SERVICE_NAME}` };
  }
  if (platform === "darwin") {
    const plist = launchdPlistPath(home);
    fs.mkdirSync(path.dirname(plist), { recursive: true });
    fs.writeFileSync(plist, launchdPlist(cmd));
    const load = spawnSync("launchctl", ["load", "-w", plist], { encoding: "utf-8" });
    if (load.status !== 0) return { ok: false, path: plist, message: `plist written to ${plist}, but "launchctl load -w" failed: ${(load.stderr || "").trim() || "unknown error"}` };
    return { ok: true, path: plist, message: `installed and started (LaunchAgent: ${plist})\n  logs:   log show --predicate 'process == "blitzpi"' --last 10m\n  stop:   launchctl unload -w ${plist}` };
  }
  return { ok: false, message: `no service integration for ${platform} yet — run "blitzpi bridge start" yourself, or keep it under your own supervisor.` };
}

export function uninstallService(home = os.homedir(), platform = process.platform): ServiceResult {
  if (platform === "linux") {
    const unit = systemdUnitPath(home);
    spawnSync("systemctl", ["--user", "disable", "--now", `${SERVICE_NAME}.service`], { encoding: "utf-8" });
    const existed = fs.existsSync(unit);
    fs.rmSync(unit, { force: true });
    spawnSync("systemctl", ["--user", "daemon-reload"], { encoding: "utf-8" });
    return { ok: true, path: unit, message: existed ? `removed ${unit}` : "nothing installed" };
  }
  if (platform === "darwin") {
    const plist = launchdPlistPath(home);
    spawnSync("launchctl", ["unload", "-w", plist], { encoding: "utf-8" });
    const existed = fs.existsSync(plist);
    fs.rmSync(plist, { force: true });
    return { ok: true, path: plist, message: existed ? `removed ${plist}` : "nothing installed" };
  }
  return { ok: false, message: `no service integration for ${platform}` };
}

export function serviceStatus(home = os.homedir(), platform = process.platform): ServiceResult {
  if (platform === "linux") {
    const unit = systemdUnitPath(home);
    if (!fs.existsSync(unit)) return { ok: false, message: "not installed as a service (blitzpi bridge install-service)" };
    const st = spawnSync("systemctl", ["--user", "is-active", `${SERVICE_NAME}.service`], { encoding: "utf-8" });
    return { ok: st.stdout.trim() === "active", path: unit, message: `service: ${st.stdout.trim() || "unknown"} (${unit})` };
  }
  if (platform === "darwin") {
    const plist = launchdPlistPath(home);
    if (!fs.existsSync(plist)) return { ok: false, message: "not installed as a service (blitzpi bridge install-service)" };
    const st = spawnSync("launchctl", ["list", "com.blitzpi.bridge"], { encoding: "utf-8" });
    return { ok: st.status === 0, path: plist, message: `service: ${st.status === 0 ? "loaded" : "not loaded"} (${plist})` };
  }
  return { ok: false, message: `no service integration for ${platform}` };
}
