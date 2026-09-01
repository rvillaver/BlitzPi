/** `~/.blitz/bridge/bindings.json` — conversation → project + policy. Per user, never in a project. */
import fs from "node:fs";
import path from "node:path";
import { type Binding, type ConvRef, convKey, defaultBinding } from "./types";
import { realHome } from "../real-home";

export interface BindingsFile { version: 1; conversations: Record<string, Binding> }
export const bridgeDir = (home = realHome()) => path.join(home, ".blitz", "bridge");

export class BindingsStore {
  constructor(readonly file = path.join(bridgeDir(), "bindings.json")) {}
  load(): BindingsFile {
    try { const p = JSON.parse(fs.readFileSync(this.file, "utf-8")); if (p?.version === 1 && p.conversations) return p; } catch { /* fresh */ }
    return { version: 1, conversations: {} };
  }
  save(f: BindingsFile): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(f, null, 2) + "\n"); fs.renameSync(tmp, this.file);
  }
  get(conv: ConvRef): Binding | undefined { return this.load().conversations[convKey(conv)]; }
  bind(conv: ConvRef, project: string, partial: Partial<Binding> = {}): Binding {
    const f = this.load(); const prev = f.conversations[convKey(conv)];
    const b = { ...(prev ?? defaultBinding(project)), ...partial, project: path.resolve(project) };
    f.conversations[convKey(conv)] = b; this.save(f); return b;
  }
  update(conv: ConvRef, partial: Partial<Binding>): Binding | undefined {
    const f = this.load(); const b = f.conversations[convKey(conv)]; if (!b) return undefined;
    Object.assign(b, partial); this.save(f); return b;
  }
  unbind(conv: ConvRef): boolean { const f = this.load(); const k = convKey(conv); if (!(k in f.conversations)) return false; delete f.conversations[k]; this.save(f); return true; }
  list(): { conv: ConvRef; binding: Binding }[] {
    return Object.entries(this.load().conversations).map(([k, binding]) => { const i = k.indexOf(":"); return { conv: { platform: k.slice(0, i), id: k.slice(i + 1) }, binding }; });
  }
  /** The conversation bound to a project directory (realpath-compared), if any. */
  byProject(dir: string): { conv: ConvRef; binding: Binding } | undefined {
    const real = (p: string) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
    const want = real(dir);
    return this.list().find((e) => real(e.binding.project) === want);
  }
}
