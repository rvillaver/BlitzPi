/**
 * File-tool confinement via the permission gate (zones + ladder). read/grep/find/ls = read;
 * write/edit/delete = write. The gate classifies the target's zone and asks/allows/denies.
 */
import type { ExtensionAPI, ToolCallEvent, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { stats } from "./security-status";
import type { BlitzConfig } from "./config";
import type { AuditLogger } from "./audit";
import type { PermissionGate } from "./permission-gate";

const FILE_TOOLS = new Set(["read", "write", "edit", "delete", "ls", "find", "grep"]);
const WRITE_TOOLS = new Set(["write", "edit", "delete"]);

function targetPath(event: ToolCallEvent): string | null {
  const i = (event as any).input;
  if (!i) return null;
  return i.path || i.file_path || i.file || i.directory || null; // never `pattern` (grep's regex)
}

export function setupSandbox(pi: ExtensionAPI, config: BlitzConfig, audit: AuditLogger, gate: PermissionGate): void {
  if (!config.sandbox.enabled) { console.log("[Blitz:Sandbox] disabled"); return; }
  console.log("[Blitz:Sandbox] file tools gated by zones");

  pi.on("tool_call", async (event: ToolCallEvent, ctx: ExtensionContext) => {
    const tool = (event as any).toolName as string;
    if (!FILE_TOOLS.has(tool)) return;
    const target = targetPath(event);
    if (!target) return;
    const action = WRITE_TOOLS.has(tool) ? "write" : "read";
    const res = await gate.resolvePath(action, target, tool, ctx);
    audit.log({ type: "file_operation", tool, requested_path: target, zone: res.zone, allowed: res.allow, reason: res.reason });
    if (!res.allow) { stats.blocked.sandbox++; return { block: true, reason: `[BLOCKED] ${tool} ${res.zone}: ${res.reason}` }; }
  });
}
