/**
 * Compaction is where a session's memory of what it did gets summarised away. Pi already extracts the files
 * read / modified from the messages it is about to drop (preparation.fileOps); we put that in the audit trail
 * as a `compaction` entry so `blitzpi report` still knows what was touched after the context is gone.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AuditLogger } from "./audit";

export function setupCompaction(pi: ExtensionAPI, audit: AuditLogger): void {
  let pending: { reason: string; read: string[]; modified: string[]; tokens_before: number } | null = null;

  pi.on("session_before_compact", async (event) => {
    const ops = (event as any).preparation?.fileOps;
    const set = (s: unknown) => (s instanceof Set ? [...s] : Array.isArray(s) ? s : []) as string[];
    const modified = new Set([...set(ops?.edited), ...set(ops?.written)]);
    pending = {
      reason: String((event as any).reason ?? "manual"),
      read: set(ops?.read).filter((p) => !modified.has(p)).sort(),
      modified: [...modified].sort(),
      tokens_before: Number((event as any).preparation?.tokensBefore ?? 0),
    };
    return undefined; // never cancel or replace Pi's summary
  });

  pi.on("session_compact", async (event, ctx) => {
    const p = pending ?? { reason: String((event as any).reason ?? "manual"), read: [], modified: [], tokens_before: 0 };
    pending = null;
    audit.log({ type: "compaction", reason: p.reason, tokens_before: p.tokens_before, read_files: p.read, modified_files: p.modified, from_extension: !!(event as any).compactionEntry?.fromHook });
    if (ctx.hasUI) ctx.ui.notify(`Context compacted (${p.reason}) — ${p.read.length} files read, ${p.modified.length} modified recorded in the audit trail`, "info");
  });

  pi.on("session_compact_failed", async (event) => {
    pending = null;
    audit.log({ type: "compaction_failed", reason: String((event as any).reason ?? ""), error: String((event as any).error ?? ""), aborted: !!(event as any).aborted });
  });
}
