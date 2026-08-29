/**
 * Bash under the permission gate. The tool_call hook classifies the command (dangerous shape, or the
 * most severe named path) and asks the gate. Approved in-project commands run under the OS backend
 * (bwrap/Seatbelt/pinned); an approved OUT-of-project command runs unconfined (the user allowed the
 * escape). Blocked commands don't run.
 */
import type { ExtensionAPI, ToolCallEvent, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { BlitzConfig } from "./config";
import type { AuditLogger } from "./audit";
import { dangerousShape, extractTargets } from "./bash-guard";
import { selectBackend, type SandboxBackend, type BackendPref } from "./sandbox-backends";
import type { PermissionGate } from "./permission-gate";
import { debug } from "./log";

export function setupSandboxedBash(pi: ExtensionAPI, config: BlitzConfig, audit: AuditLogger, gate: PermissionGate): void {
  if (!config.sandbox.enabled) { console.log("[Blitz:BashSandbox] disabled"); return; }
  const runDir = resolve(config.sandbox.run_dir);
  const backend: SandboxBackend | null = selectBackend((config.sandbox.backend ?? "auto") as BackendPref);
  const confinedByCommand = new Map<string, boolean>(); // command -> run under OS backend?

  pi.on("tool_call", async (event: ToolCallEvent, ctx: ExtensionContext) => {
    if ((event as any).toolName !== "bash") return;
    const command: string = (event as any).input?.command ?? "";

    const shape = dangerousShape(command);
    const res = shape
      ? await gate.resolveDangerousCommand(command, shape, ctx)
      : await (async () => { const w = gate.worst(extractTargets(command), command); return gate.resolve(w.action, w.zone, w.target, "bash command", ctx); })();

    if (!res.allow) return { block: true, reason: `[BLOCKED] ${res.reason} (${res.zone})` };
    confinedByCommand.set(command, res.confined); // out-of-project approved → run unconfined
  });

  const def = createBashToolDefinition(runDir, {
    exposeSessionEnvironment: true,
    operations: {
      exec: (command, _cwd, options) => {
        const confined = confinedByCommand.get(command) ?? true;
        confinedByCommand.delete(command);
        if (confined && backend) {
          audit.log({ type: "bash_exec", confined: true, backend: backend.name, command: command.slice(0, 200) });
          const t0 = Date.now();
          return backend.exec(command, runDir, options).then((r) => {
            audit.log({ type: "bash_exit", backend: backend.name, exit_code: r.exitCode, aborted: !!options.signal?.aborted, ms: Date.now() - t0, command: command.slice(0, 120) });
            return r;
          });
        }
        // unconfined: user approved an out-of-project command (or no backend). Run in the project cwd.
        audit.log({ type: "bash_exec", confined: false, command: command.slice(0, 200) });
        debug("bash (unconfined, approved) :", command);
        const child = spawn("/bin/bash", ["-c", command], { cwd: runDir, env: { ...process.env, ...options.env }, stdio: ["ignore", "pipe", "pipe"] });
        child.stdout.on("data", (d: Buffer) => options.onData(d));
        child.stderr.on("data", (d: Buffer) => options.onData(d));
        let timer: NodeJS.Timeout | undefined;
        if (options.timeout && options.timeout > 0) timer = setTimeout(() => child.kill("SIGKILL"), options.timeout);
        const onAbort = () => child.kill("SIGKILL");
        options.signal?.addEventListener("abort", onAbort, { once: true });
        return new Promise((r) => {
          child.on("error", (e) => { options.onData(Buffer.from(`[bash] ${e.message}\n`)); r({ exitCode: 126 }); });
          child.on("close", (code) => { if (timer) clearTimeout(timer); options.signal?.removeEventListener("abort", onAbort); r({ exitCode: code }); });
        });
      },
    },
  });
  pi.registerTool(def);
  console.log(`[Blitz:BashSandbox] gate active; backend=${backend ? backend.name : "none"}`);
}
