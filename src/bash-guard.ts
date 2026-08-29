/**
 * Shell command inspection for the permission gate: detect genuinely dangerous command SHAPES, and
 * extract the file paths a command names (and whether each is a write target). Zone/permission
 * decisions live in permissions.ts + permission-gate.ts.
 */
export function dangerousShape(command: string): string | null {
  const c = command.trim();
  if (/(^|[\s;|&(])sudo(\s|$)/.test(c)) return "sudo";
  if (/(^|[\s;|&(])doas(\s|$)/.test(c)) return "doas";
  if (/\b(?:curl|wget|fetch)\b[^\n|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|python\d?|node|perl|ruby)\b/i.test(c)) return "download piped into a shell";
  if (/\/dev\/tcp\//i.test(c) || /\|\s*nc\s+-?[a-z]*e/i.test(c)) return "reverse shell";
  if (/\brm\s+(-[a-z]*\s+)*(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b[^\n]*\s(\/|~|\$HOME)(\s|$|\/)/.test(c)) return "recursive delete of a system/home path";
  return null;
}

export interface CmdTarget { path: string; write: boolean; }

const WRITE_REDIR = /(^|[^0-9<>&])>>?\s*("?~?\/?[^\s"';|&]+)/g;
const WRITE_VERB = /(^|[\s;|&(])(rm|mv|cp|tee|dd|truncate|ln|touch|mkdir|rmdir|chmod|chown)\s+([^\n]*)/g;

/** URLs are not paths: `https://example.com` must not read as the path `//example.com` (zone other → the command
 *  would be approved as out-of-project and run UNCONFINED). Strip them before looking for paths. */
const URL_TOKEN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`;|&)<>]*/gi;

/** Absolute or ~ paths, plus relative paths containing a ".." escape. */
export function extractTargets(rawCommand: string): CmdTarget[] {
  const command = rawCommand.replace(URL_TOKEN, (u) => " ".repeat(u.length));
  const targets = new Map<string, boolean>(); // path -> write
  const add = (p: string, w: boolean) => { targets.set(p, (targets.get(p) ?? false) || w); };

  // write redirections
  let m: RegExpExecArray | null;
  const wr = new RegExp(WRITE_REDIR);
  while ((m = wr.exec(command))) add(m[2].replace(/^["']|["']$/g, ""), true);

  // write verbs: mark their path-like args as writes
  const wv = new RegExp(WRITE_VERB);
  while ((m = wv.exec(command))) {
    for (const tok of m[3].split(/\s+/)) if (/^(~|\/|\.\.\/)/.test(tok) || tok.includes("/..")) add(tok, true);
  }

  // any remaining absolute/home/.. paths → reads
  const re = /(?:^|[\s=:,"'`(><|&])((?:~|\/)[^\s"'`;|&)<>]*|(?:\.\.\/)[^\s"'`;|&)<>]*)/g;
  while ((m = re.exec(command))) { const p = m[1]; if (!targets.has(p)) add(p, false); }

  return [...targets.entries()].map(([path, write]) => ({ path, write }));
}
