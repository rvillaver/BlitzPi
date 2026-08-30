/** File transfer between a conversation and a project — inside the workspace (the sandbox confines file tools to it):
 *  in:  <project>/.blitz/transfer/in/<msgId>-<name>   attachments the humans sent, named in the prompt
 *  out: <project>/.blitz/transfer/out/<name>          whatever the agent writes there is delivered to the thread */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const transferDir = (project: string) => path.join(project, ".blitz", "transfer");
export const inboundDir = (project: string) => path.join(transferDir(project), "in");
export const outboundDir = (project: string) => path.join(transferDir(project), "out");
export function ensureTransferDirs(project: string): void {
  fs.mkdirSync(inboundDir(project), { recursive: true }); fs.mkdirSync(outboundDir(project), { recursive: true });
  const gi = path.join(transferDir(project), ".gitignore"); if (!fs.existsSync(gi)) fs.writeFileSync(gi, "*\n"); // never committed
}
/** Base name only (no directories), dots collapsed, odd characters → `_`. */
export const safeName = (name: string) => (path.basename(name.replace(/\\/g, "/")).replace(/\.{2,}/g, ".").replace(/[^\w.+-]+/g, "_").replace(/^[._]+/, "").slice(0, 120) || "file");
export const inboundPath = (project: string, messageId: string, name: string) => path.join(inboundDir(project), `${messageId}-${safeName(name)}`);
/** The hint the agent gets with every bridge prompt. */
export const OUT_HINT = "Files you save under .blitz/transfer/out/ are delivered to the chat as attachments; anything the humans attached is under .blitz/transfer/in/.";

export type OutSnapshot = Map<string, string>; // path → mtimeMs:size
export function snapshotOut(project: string): OutSnapshot {
  const m: OutSnapshot = new Map();
  try { for (const f of walk(outboundDir(project))) { const st = fs.statSync(f); m.set(f, `${st.mtimeMs}:${st.size}`); } } catch { /* none */ }
  return m;
}
/** Files under out/ that are new or changed since the snapshot. */
export function changedOut(project: string, since: OutSnapshot): string[] {
  const now = snapshotOut(project);
  return [...now.entries()].filter(([p, sig]) => since.get(p) !== sig).map(([p]) => p);
}
export function fileHash(p: string): string { return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"); }
export function isUnderOut(project: string, p: string): boolean {
  const abs = path.isAbsolute(p) ? path.resolve(p) : path.resolve(project, p);
  const out = path.resolve(outboundDir(project));
  return abs === out || abs.startsWith(out + path.sep);
}
function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p); else if (e.isFile() && !e.name.startsWith(".")) yield p;
  }
}
