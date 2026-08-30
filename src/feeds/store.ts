/**
 * The feed store: pulled detection dictionaries, compiled into one native rule shape and kept per user in
 * ~/.blitz/feeds/<name>/ — outside the platform's versions/, because feeds are an OPT-IN component with their
 * own lifecycle (`blitzpi feeds update | list | rollback | opt-in | opt-out`). Platform updates never touch them.
 *
 *   <feeds>/opt-in                   present = the user chose to install security feeds (ISO date inside)
 *   <feeds>/<name>/manifest.json     source, ref (ETag), sha256 of the raw download, fetched_at, rule counts
 *   <feeds>/<name>/rules.json        compiled rules (what the runtime loads)
 *   <feeds>/<name>/previous/         the previous manifest + rules, for rollback
 *
 * A feed is an input to the enforcer: the raw download is hashed, every update/rollback is returned as an event
 * for the audit trail, and a download that fails to compile leaves the previous feed in place.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileGitleaks } from "./adapters/gitleaks";
import { compileSigma, type SigmaRule } from "./adapters/sigma";

export type RuleCategory = "secret" | "command" | "url";
export interface CompiledRule {
  id: string;
  category: RuleCategory;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  /** JS regex source + flags (already converted from the source dialect) — secret/url rules. */
  regex?: string;
  flags?: string;
  /** Sigma-style command-shape rule (command rules). */
  sigma?: SigmaRule;
  /** Attribution and hints from the source (never used for matching). */
  meta?: { file?: string; tags?: string[]; falsepositives?: string[]; author?: string; license?: string };
  /** Cheap case-insensitive prefilter: the text must contain one of these before the regex runs. */
  keywords?: string[];
  /** Matches that must be ignored (source allowlists). */
  allow?: { regex: string; flags: string }[];
}
export interface CompiledFeed { rules: CompiledRule[]; skipped: { id: string; reason: string }[]; sourceVersion?: string }
export interface FeedManifest {
  name: string; source: string; fetched_at: string; sha256: string; etag?: string; bytes: number;
  rules: number; skipped: number; source_version?: string; blitzpi_version?: string;
}
export interface FeedDef { name: string; category: RuleCategory; description: string; source: string; license: string; binary?: boolean; compile: (raw: any) => CompiledFeed; defaultMode: "enforce" | "monitor" }
export interface FeedStatus { name: string; description: string; category: RuleCategory; installed: boolean; manifest?: FeedManifest; previous?: FeedManifest }
export type FeedEvent = { type: "feed_update"; feed: string; changed: boolean; from?: string; to: string; rules: number; skipped: number; bytes: number } | { type: "feed_rollback"; feed: string; from?: string; to: string } | { type: "feed_update_failed"; feed: string; error: string; kept?: string };

export const FEEDS: FeedDef[] = [
  {
    name: "secrets", category: "secret", defaultMode: "monitor",
    description: "gitleaks rules — credentials and tokens in commands (222 rules, updated with each gitleaks release)",
    source: process.env.BLITZ_FEED_SECRETS_URL || "https://raw.githubusercontent.com/gitleaks/gitleaks/master/config/gitleaks.toml",
    license: "MIT (gitleaks)",
    compile: compileGitleaks,
  },
  {
    name: "commands", category: "command", defaultMode: "monitor",
    description: "Sigma rules — Linux/macOS process-creation shapes: reverse shells, download-and-execute, persistence, discovery (monthly release)",
    source: process.env.BLITZ_FEED_COMMANDS_URL || "https://github.com/SigmaHQ/sigma/releases/latest/download/sigma_all_rules.zip",
    license: "Detection Rule License 1.1 (SigmaHQ)",
    binary: true,
    compile: compileSigma,
  },
];
export const feedDef = (name: string): FeedDef | undefined => FEEDS.find((f) => f.name === name);

export const feedsDir = (home = process.env.HOME || os.homedir()) => process.env.BLITZ_FEEDS_DIR || path.join(home, ".blitz", "feeds");

export class FeedStore {
  constructor(private dir: string = feedsDir(), private fetchImpl: typeof fetch = fetch) {}
  private feedDir(name: string) { return path.join(this.dir, name); }
  private readJson<T>(file: string): T | undefined { try { return JSON.parse(fs.readFileSync(file, "utf-8")) as T; } catch { return undefined; } }
  private writeJson(file: string, data: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
    fs.renameSync(tmp, file);
  }

  // ---- opt-in ---------------------------------------------------------------------------------------------
  optedIn(): boolean { return fs.existsSync(path.join(this.dir, "opt-in")); }
  optIn(): void { fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(path.join(this.dir, "opt-in"), new Date().toISOString() + "\n"); }
  optOut(removeFeeds = false): string[] {
    try { fs.unlinkSync(path.join(this.dir, "opt-in")); } catch { /* not opted in */ }
    const removed: string[] = [];
    if (removeFeeds) for (const f of FEEDS) if (fs.existsSync(this.feedDir(f.name))) { fs.rmSync(this.feedDir(f.name), { recursive: true, force: true }); removed.push(f.name); }
    return removed;
  }

  // ---- read -----------------------------------------------------------------------------------------------
  manifest(name: string): FeedManifest | undefined { return this.readJson<FeedManifest>(path.join(this.feedDir(name), "manifest.json")); }
  previousManifest(name: string): FeedManifest | undefined { return this.readJson<FeedManifest>(path.join(this.feedDir(name), "previous", "manifest.json")); }
  rules(name: string): CompiledRule[] | undefined { return this.readJson<{ rules: CompiledRule[] }>(path.join(this.feedDir(name), "rules.json"))?.rules; }
  installed(name: string): boolean { return !!this.manifest(name) && fs.existsSync(path.join(this.feedDir(name), "rules.json")); }
  list(): FeedStatus[] {
    return FEEDS.map((f) => ({ name: f.name, description: f.description, category: f.category, installed: this.installed(f.name), manifest: this.manifest(f.name), previous: this.previousManifest(f.name) }));
  }

  // ---- update / rollback ----------------------------------------------------------------------------------
  /** Fetch, hash, compile, swap. Never leaves a half-written feed; a compile failure keeps the previous one. */
  async update(name: string, opts: { force?: boolean; version?: string } = {}): Promise<FeedEvent> {
    const def = feedDef(name);
    if (!def) return { type: "feed_update_failed", feed: name, error: `unknown feed "${name}" (known: ${FEEDS.map((f) => f.name).join(", ")})` };
    const current = this.manifest(name);
    try {
      const headers: Record<string, string> = {};
      if (current?.etag && !opts.force) headers["if-none-match"] = current.etag;
      const res = await this.fetchImpl(def.source, { headers });
      if (res.status === 304 && current) return { type: "feed_update", feed: name, changed: false, from: current.sha256, to: current.sha256, rules: current.rules, skipped: current.skipped, bytes: current.bytes };
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${def.source}`);
      const raw: Buffer | string = def.binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
      const sha256 = crypto.createHash("sha256").update(raw).digest("hex");
      if (current && current.sha256 === sha256 && !opts.force) return { type: "feed_update", feed: name, changed: false, from: sha256, to: sha256, rules: current.rules, skipped: current.skipped, bytes: current.bytes };
      const compiled = def.compile(raw); // throws on a broken source → previous feed kept
      if (!compiled.rules.length) throw new Error("compiled to zero rules — refusing to install an empty feed");
      const manifest: FeedManifest = {
        name, source: def.source, fetched_at: new Date().toISOString(), sha256, etag: res.headers.get("etag") ?? undefined, bytes: Buffer.isBuffer(raw) ? raw.length : Buffer.byteLength(raw),
        rules: compiled.rules.length, skipped: compiled.skipped.length, source_version: compiled.sourceVersion, blitzpi_version: opts.version,
      };
      const dir = this.feedDir(name);
      const staged = path.join(dir, "staged");
      fs.rmSync(staged, { recursive: true, force: true });
      this.writeJson(path.join(staged, "manifest.json"), manifest);
      this.writeJson(path.join(staged, "rules.json"), { rules: compiled.rules, skipped: compiled.skipped });
      fs.writeFileSync(path.join(staged, "source.raw"), raw); // kept for rollback + inspection
      if (this.installed(name)) {
        fs.rmSync(path.join(dir, "previous"), { recursive: true, force: true });
        fs.mkdirSync(path.join(dir, "previous"), { recursive: true });
        for (const f of ["manifest.json", "rules.json", "source.raw"]) if (fs.existsSync(path.join(dir, f))) fs.renameSync(path.join(dir, f), path.join(dir, "previous", f));
      }
      for (const f of ["manifest.json", "rules.json", "source.raw"]) fs.renameSync(path.join(staged, f), path.join(dir, f));
      fs.rmSync(staged, { recursive: true, force: true });
      return { type: "feed_update", feed: name, changed: true, from: current?.sha256, to: sha256, rules: manifest.rules, skipped: manifest.skipped, bytes: manifest.bytes };
    } catch (e) {
      return { type: "feed_update_failed", feed: name, error: e instanceof Error ? e.message : String(e), kept: current?.sha256 };
    }
  }

  rollback(name: string): FeedEvent {
    const dir = this.feedDir(name);
    const prev = this.previousManifest(name);
    const cur = this.manifest(name);
    if (!prev) return { type: "feed_update_failed", feed: name, error: "no previous version of this feed to roll back to" };
    const tmp = path.join(dir, "swap");
    fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
    for (const f of ["manifest.json", "rules.json", "source.raw"]) if (fs.existsSync(path.join(dir, f))) fs.renameSync(path.join(dir, f), path.join(tmp, f));
    for (const f of ["manifest.json", "rules.json", "source.raw"]) if (fs.existsSync(path.join(dir, "previous", f))) fs.renameSync(path.join(dir, "previous", f), path.join(dir, f));
    fs.rmSync(path.join(dir, "previous"), { recursive: true, force: true });
    fs.renameSync(tmp, path.join(dir, "previous"));
    return { type: "feed_rollback", feed: name, from: cur?.sha256, to: prev.sha256 };
  }
}
