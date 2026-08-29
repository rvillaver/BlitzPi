/** Session-start hook: a launch folder that carries `.blitz/` is a BlitzPi project — count the session. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";
import type { BlitzConfig } from "./config";
import { touchProject } from "./projects";

export function setupProjectRegistry(pi: ExtensionAPI, config: BlitzConfig): void {
  pi.on("session_start", async () => {
    const cwd = process.cwd();
    if (!fs.existsSync(path.join(cwd, ".blitz"))) return;
    try {
      const version = require(path.join(__dirname, "..", "package.json")).version as string;
      touchProject(cwd, { version, profile: config.goodbehavior.profile, session: true });
    } catch { /* never block a session over the registry */ }
  });
}
