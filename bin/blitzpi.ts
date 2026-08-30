#!/usr/bin/env bun
/** BlitzPi — the one command. `audit`, `report`, `projects`, `feeds`, `demo`, `update`, `versions`, `rollback`, `use`, `uninstall` and `--version` are handled
 *  here; everything else (including Pi's own subcommands) passes through to Pi. */
import { launchBlitzPi, REPO_ROOT, selfServiceCommand } from "../src/launcher";

const args = process.argv.slice(2);
const sub = args[0];

if (sub === "audit") {
  const { handleAuditCommand } = await import("../src/cli");
  await handleAuditCommand(args.slice(1));
  process.exit(0);
}
if (sub === "report" || sub === "projects" || sub === "feeds") {
  const cli = await import("../src/cli");
  await (sub === "report" ? cli.handleReportCommand : sub === "projects" ? cli.handleProjectsCommand : cli.handleFeedsCommand)(args.slice(1));
  process.exit(process.exitCode ?? 0);
}
if (sub === "demo") {
  const { handleDemoCommand } = await import("../src/cli-demo");
  await handleDemoCommand();
  process.exit(0);
}
if (sub === "update" || sub === "uninstall" || sub === "versions" || sub === "rollback" || sub === "use") {
  if (sub === "use" && !args[1]) { console.error("Usage: blitzpi use <version>   (blitzpi versions lists what is installed)"); process.exit(2); }
  process.exit(await selfServiceCommand(sub, args.slice(1)));
}
if (sub === "--version" || sub === "-v") {
  const own = require(`${REPO_ROOT}/package.json`).version;
  const pi = require("@earendil-works/pi-coding-agent/package.json").version;
  console.log(`blitzpi ${own} (pi ${pi}, bun ${Bun.version})`);
  process.exit(0);
}
process.exit(await launchBlitzPi(args));
