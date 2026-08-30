/**
 * URLhaus (abuse.ch, CC0) `text_online` → the URL feed. Two sets: exact URLs (every entry), and hosts — but only
 * hosts that are not shared platforms. Measured 2026-08-30: 34% of the list lives on raw.githubusercontent.com /
 * github.com, plus Drive, Docs, OneDrive, Dropbox, archive.org; blocking those hosts would block normal work, so
 * on a shared platform only the exact listed URL matches. IPs and dedicated domains (the bulk) match by host.
 */
import crypto from "node:crypto";
import type { CompiledFeed } from "../store";

/** Listed URLs are never stored or shown in clear: antivirus engines consume URLhaus too and quarantine any file
 *  carrying a listed URL (seen on macOS with a docs file). Sets hold 128-bit hashes; output is defanged. */
export const urlHash = (key: string) => crypto.createHash("sha256").update(key).digest("hex").slice(0, 32);
export function defangUrl(u: string): string {
  return u.replace(/^http(s?):\/\//i, "hxxp$1://").replace(/^([a-z]+:\/\/)([^/?#]+)/i, (_m, sch: string, host: string) => sch + host.replace(/\./g, "[.]"));
}
export const defangHost = (h: string) => h.replace(/\./g, "[.]");

export const SHARED_PLATFORMS = [
  "github.com", "raw.githubusercontent.com", "objects.githubusercontent.com", "codeload.github.com", "gist.github.com", "github.io",
  "gitlab.com", "bitbucket.org", "sourceforge.net",
  "drive.google.com", "docs.google.com", "storage.googleapis.com", "firebasestorage.googleapis.com", "sites.google.com", "googleusercontent.com",
  "dropbox.com", "dl.dropboxusercontent.com", "onedrive.live.com", "1drv.ms", "sharepoint.com", "blob.core.windows.net",
  "cdn.discordapp.com", "discord.com", "discordapp.com", "t.me", "telegram.org",
  "s3.amazonaws.com", "amazonaws.com", "cloudfront.net", "web.archive.org", "archive.org",
  "pastebin.com", "paste.ee", "mediafire.com", "transfer.sh", "img1.wsimg.com", "wsimg.com",
  "cdn.jsdelivr.net", "unpkg.com", "npmjs.com", "pypi.org", "files.pythonhosted.org",
];

export function isSharedPlatform(host: string): boolean {
  const h = host.toLowerCase();
  return SHARED_PLATFORMS.some((p) => h === p || h.endsWith("." + p));
}

/** scheme stripped, host lowercased, port kept, trailing slash dropped — the same for the feed and for what we see. */
export function normalizeUrl(u: string): { key: string; host: string } | null {
  const m = u.trim().match(/^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)([^#]*)?/i);
  if (!m) return null;
  const hostport = m[2].toLowerCase().replace(/^.*@/, ""); // drop userinfo
  const host = hostport.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  const rest = (m[3] ?? "").replace(/\/+$/, "");
  return { key: `${hostport}${rest}`, host };
}

export function compileUrlhaus(raw: Buffer | string): CompiledFeed {
  const text = Buffer.isBuffer(raw) ? raw.toString("utf-8") : raw;
  const urls = new Set<string>();
  const hostCounts = new Map<string, number>();
  let lines = 0, parsed = 0;
  for (const line of text.split("\n")) {
    const l = line.trim();
    if (!l || l.startsWith("#")) continue;
    lines++;
    const n = /^https?:\/\//i.test(l) ? normalizeUrl(l) : null;
    if (!n) continue;
    parsed++;
    urls.add(n.key);
    hostCounts.set(n.host, (hostCounts.get(n.host) ?? 0) + 1);
  }
  // The list carries no header (one URL per line). Validate by shape: a real list is large and almost all URLs.
  if (!lines || !urls.size) throw new Error("not a URLhaus list (no URLs)");
  if (lines < (process.env.BLITZ_FEED_URLS_MIN ? Number(process.env.BLITZ_FEED_URLS_MIN) : 100)) throw new Error(`only ${lines} entries — refusing a list this small (a real URLhaus list has thousands)`);
  if (parsed / lines < 0.9) throw new Error(`only ${Math.round((parsed / lines) * 100)}% of lines are http(s) URLs — refusing an unrecognised list`);
  const hosts: Record<string, number> = {};
  for (const [h, n] of hostCounts) if (!isSharedPlatform(h)) hosts[urlHash(h)] = n;
  return {
    rules: [{ id: "urlhaus-online", category: "url", severity: "high", description: "URL listed as malware distribution by URLhaus (abuse.ch) — stored as hashes", set: { urls: [...urls].map(urlHash).sort(), hosts } }],
    skipped: [], count: urls.size,
    sourceVersion: `URLhaus online (${urls.size} URLs, ${Object.keys(hosts).length} hosts, ${hostCounts.size - Object.keys(hosts).length} shared-platform hosts matched by exact URL only)`,
  };
}
