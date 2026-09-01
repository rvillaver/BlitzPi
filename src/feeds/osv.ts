/**
 * OSV (osv.dev) as the package feed. Why an API and not a pulled dictionary: npm alone has >100,000 malicious
 * entries (`ossf/malicious-packages`; OSV's npm bundle is 221 MB), so the "dictionary" is OSV itself — current,
 * free, no auth, one POST per install command. Only `MAL-*` (malicious) ids block; GHSA/CVE advisories are
 * vulnerabilities in legitimate packages and are never blocked here (that needs the resolved version).
 * Answers are cached per package (default 24 h) in ~/.blitz/feeds/osv-cache.json.
 */
import fs from "node:fs";
import path from "node:path";
import type { PackageRef } from "./packages";
import { realHome } from "../real-home";

export interface PackageVerdict extends PackageRef { malicious: string[]; summary?: string; cached: boolean }
export interface CheckResult { verdicts: PackageVerdict[]; unreachable: boolean; error?: string }

interface CacheEntry { malicious: string[]; summary?: string; checked_at: number }
type Cache = Record<string, CacheEntry>;

export const DEFAULT_OSV_API = "https://api.osv.dev";
export const defaultCachePath = (home = realHome()) => path.join(home, ".blitz", "feeds", "osv-cache.json");

export class OsvClient {
  private cache: Cache | null = null;
  constructor(
    private opts: { api?: string; cachePath?: string; ttlHours?: number; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
  ) {}

  private get api() { return (this.opts.api ?? process.env.BLITZ_OSV_API ?? DEFAULT_OSV_API).replace(/\/$/, ""); }
  private get cachePath() { return this.opts.cachePath ?? defaultCachePath(); }
  private get ttlMs() { return (this.opts.ttlHours ?? 24) * 3600 * 1000; }
  private get f() { return this.opts.fetchImpl ?? fetch; }

  private load(): Cache {
    if (this.cache) return this.cache;
    try { this.cache = JSON.parse(fs.readFileSync(this.cachePath, "utf-8")) as Cache; } catch { this.cache = {}; }
    return this.cache!;
  }
  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
      const tmp = `${this.cachePath}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.cache ?? {}));
      fs.renameSync(tmp, this.cachePath);
    } catch { /* cache is best-effort */ }
  }

  cacheStats(): { entries: number; malicious: number; oldest?: string; path: string } {
    const c = this.load();
    const vals = Object.values(c);
    const oldest = vals.length ? new Date(Math.min(...vals.map((v) => v.checked_at))).toISOString() : undefined;
    return { entries: vals.length, malicious: vals.filter((v) => v.malicious.length).length, oldest, path: this.cachePath };
  }
  clearCache(): void { this.cache = {}; try { fs.unlinkSync(this.cachePath); } catch { /* none */ } }

  /** One request for every package not freshly cached. Never throws: an outage is reported as `unreachable`. */
  async check(pkgs: PackageRef[]): Promise<CheckResult> {
    const cache = this.load();
    const now = Date.now();
    const verdicts: PackageVerdict[] = [];
    const todo: PackageRef[] = [];
    for (const p of pkgs) {
      const hit = cache[`${p.ecosystem}:${p.name}`];
      if (hit && now - hit.checked_at < this.ttlMs) verdicts.push({ ...p, malicious: hit.malicious, summary: hit.summary, cached: true });
      else todo.push(p);
    }
    if (!todo.length) return { verdicts, unreachable: false };
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 8000);
      const res = await this.f(`${this.api}/v1/querybatch`, {
        method: "POST", headers: { "content-type": "application/json" }, signal: ctrl.signal,
        body: JSON.stringify({ queries: todo.map((p) => ({ package: { name: p.name, ecosystem: p.ecosystem } })) }),
      }).finally(() => clearTimeout(t));
      if (!res.ok) return { verdicts, unreachable: true, error: `OSV HTTP ${res.status}` };
      const data = (await res.json()) as { results?: { vulns?: { id: string }[] }[] };
      const results = data.results ?? [];
      for (let i = 0; i < todo.length; i++) {
        const p = todo[i];
        const malicious = (results[i]?.vulns ?? []).map((v) => v.id).filter((id) => id.startsWith("MAL-")).sort();
        const summary = malicious.length ? await this.summary(malicious[0]) : undefined;
        cache[`${p.ecosystem}:${p.name}`] = { malicious, summary, checked_at: now };
        verdicts.push({ ...p, malicious, summary, cached: false });
      }
      this.save();
      return { verdicts, unreachable: false };
    } catch (e) {
      return { verdicts, unreachable: true, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Human reason for a block (best-effort; the id alone is enough to act). Withdrawn entries do not count. */
  private async summary(id: string): Promise<string | undefined> {
    try {
      const res = await this.f(`${this.api}/v1/vulns/${id}`);
      if (!res.ok) return undefined;
      const d = (await res.json()) as { summary?: string; withdrawn?: string };
      return d.withdrawn ? `withdrawn:${d.summary ?? ""}` : d.summary;
    } catch { return undefined; }
  }
}

/** The packages that must not be installed (withdrawn OSV entries are ignored). */
export function maliciousOf(r: CheckResult): PackageVerdict[] {
  return r.verdicts.filter((v) => v.malicious.length && !(v.summary ?? "").startsWith("withdrawn:"));
}
