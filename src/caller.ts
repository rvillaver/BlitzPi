import os from "os";
import path from "path";
import { execSync } from "child_process";
import fs from "fs";

export interface Caller {
  user: string;
  install_type: "global" | "local";
  project_path: string;
}

export function initializeCaller(): Caller {
  const user = process.env.USER || process.env.USERNAME || os.userInfo().username;
  const project_path = process.cwd();
  const install_type = detectInstallType();

  return {
    user,
    install_type,
    project_path,
  };
}

function detectInstallType(): "global" | "local" {
  // Check if Blitz is in node_modules of current project
  const localNodeModules = path.join(process.cwd(), "node_modules");
  const blitzInLocal = path.join(localNodeModules, "@blitz", "cli");

  if (fs.existsSync(blitzInLocal)) {
    return "local";
  }

  // Check if Blitz is in global node_modules (npm root -g)
  try {
    const globalRoot = execSync("npm root -g", { encoding: "utf-8" }).trim();
    const blitzInGlobal = path.join(globalRoot, "@blitz", "cli");

    if (fs.existsSync(blitzInGlobal)) {
      return "global";
    }
  } catch {
    // npm root -g failed, assume local
  }

  // Default based on __dirname
  const scriptDir = __dirname;
  if (scriptDir.includes("node_modules")) {
    return scriptDir.includes("/usr/") || scriptDir.includes("/.npm/") ? "global" : "local";
  }

  return "local";
}
