/**
 * Shell command inspection for the permission gate: detect genuinely dangerous command SHAPES, and
 * extract the file paths a command names (and whether each is a write target). Zone/permission
 * decisions live in permissions.ts + permission-gate.ts.
 */
export function dangerousShape(command: string): string | null {
  const c = command.trim();
  if (/(^|[\s;|&(])sudo(\s|$)/.test(c)) return "sudo";
  if (/(^|[\s;|&(])doas(\s|$)/.test(c)) return "doas";
  // The span may not cross a statement boundary (`;`, `&&`, `||`, `)`, newline): `x=$(curl …); printf "$x" | perl`
  // is a curl and a pipe in different statements, not a download piped into an interpreter.
  if (/\b(?:curl|wget|fetch)\b[^\n|;&)]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|python\d?|node|perl|ruby)\b/i.test(c)) return "download piped into a shell";
  if (/\/dev\/tcp\//i.test(c) || /\|\s*nc\s+-?[a-z]*e/i.test(c)) return "reverse shell";
  if (/\brm\s+(-[a-z]*\s+)*(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b[^\n]*\s(\/|~|\$HOME)(\s|$|\/)/.test(c)) return "recursive delete of a system/home path";
  return null;
}

export interface CmdTarget { path: string; write: boolean; }

const WRITE_REDIR = /(^|[^0-9<>&])>>?\s*("?~?\/?[^\s"';|&)]+)/g;
const WRITE_VERB = /(^|[\s;|&(])(rm|mv|cp|tee|dd|truncate|ln|touch|mkdir|rmdir|chmod|chown)\s+([^\n]*)/g;
/** A download's output file is a write: `curl -o F` / `--output F`, `wget -O F` / `-o F` (log) / `--output-document F`.
 *  (curl's `-O` takes no argument — it writes the remote name into the cwd — and `-o -` is stdout.) */
const DL_OUT = /\b(curl|wget)\b([^\n|;&]*)/g;
const DL_OUT_ARG = /(?:^|\s)(?:(-o|-O|--output|--output-document|--output-file)(?:=|\s+))("?[^\s"';|&)]+)/g;

/** URLs are not paths: `https://example.com` must not read as the path `//example.com` (zone other → the command
 *  would be approved as out-of-project and run UNCONFINED). Strip them before looking for paths. */
const URL_TOKEN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`;|&)<>]*/gi;

export interface Segment { start: number; end: number; cwd: string | null }

/** Working-directory tracking: split a command into simple statements (`;`, `&&`, `||`, `|`, newline; `( … )` scopes a
 *  subshell) and record the directory each statement runs in after any preceding `cd`. `cwd` is null at the project
 *  root, else a project-relative or absolute path. `~` is the project (the sandbox pins HOME to it); an unknowable
 *  target (`cd "$dir"`) leaves cwd unchanged. */
export function segmentsWithCwd(command: string): Segment[] {
  const segs: Segment[] = [];
  const stack: (string | null)[] = [];
  let cwd: string | null = null;
  let start = 0;
  const applyCd = (text: string) => {
    const m = /^\s*(?:builtin\s+)?cd(?:\s+(?:--\s+)?([^\s;&|]+))?/.exec(text);
    if (!m) return;
    const t = (m[1] ?? "~").replace(/^["']|["']$/g, "");
    if (t === "-" || /[$`]/.test(t)) return;
    if (t === "~" || t === "~/") { cwd = null; return; }
    if (t.startsWith("~/")) { cwd = normalizeRel(t.slice(2)); return; }
    if (t.startsWith("/")) { cwd = require("node:path").posix.normalize(t); return; }
    cwd = cwd && cwd.startsWith("/") ? require("node:path").posix.normalize(`${cwd}/${t}`) : normalizeRel(`${cwd ?? ""}/${t}`);
  };
  const flush = (end: number) => {
    const text = command.slice(start, end);
    if (text.trim()) { segs.push({ start, end, cwd }); applyCd(text); }
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === "(") { flush(i); stack.push(cwd); start = i + 1; }
    else if (c === ")") { flush(i); cwd = stack.length ? stack.pop()! : cwd; start = i + 1; }
    else if (c === "\n" || c === ";" || c === "|" || c === "&") { flush(i); while (i + 1 < command.length && (command[i + 1] === "|" || command[i + 1] === "&")) i++; start = i + 1; }
  }
  flush(command.length);
  return segs;
}
function normalizeRel(p: string): string | null {
  const n = require("node:path").posix.normalize(p.replace(/^\/+/, ""));
  return n === "." || n === "" ? null : n;
}
/** cwd is outside the project root (absolute, or escaped through `..`). */
const outside = (cwd: string | null) => !!cwd && (cwd.startsWith("/") || cwd === ".." || cwd.startsWith("../"));

/** Absolute or ~ paths, plus relative paths containing a ".." escape — each resolved against the directory the
 *  statement actually runs in (see segmentsWithCwd), so `(cd apps/api && … > ../../.tmp/x.log)` is `.tmp/x.log`. */
export function extractTargets(rawCommand: string): CmdTarget[] {
  const command = rawCommand.replace(URL_TOKEN, (u) => " ".repeat(u.length));
  const segs = segmentsWithCwd(command);
  const cwdAt = (idx: number) => segs.find((s) => idx >= s.start && idx < s.end)?.cwd ?? null;
  const targets = new Map<string, boolean>(); // path -> write
  const add = (raw: string, w: boolean, idx: number) => {
    const p = resolveAgainst(raw, cwdAt(idx));
    targets.set(p, (targets.get(p) ?? false) || w);
  };

  // write redirections
  let m: RegExpExecArray | null;
  const wr = new RegExp(WRITE_REDIR);
  while ((m = wr.exec(command))) add(m[2].replace(/^["']|["']$/g, ""), true, m.index);

  // write verbs: mark their path-like args as writes (any relative arg counts once the statement runs outside)
  const wv = new RegExp(WRITE_VERB);
  while ((m = wv.exec(command))) {
    const out = outside(cwdAt(m.index));
    for (const tok of m[3].split(/\s+/)) {
      if (!tok || tok.startsWith("-")) continue;
      if (/^(~|\/|\.\.\/)/.test(tok) || tok.includes("/..") || out) add(tok, true, m.index);
    }
  }

  // download output files → writes
  const dl = new RegExp(DL_OUT);
  while ((m = dl.exec(command))) {
    const tool = m[1], args = m[2], base = m.index + m[0].length - args.length;
    const a = new RegExp(DL_OUT_ARG);
    let am: RegExpExecArray | null;
    while ((am = a.exec(args))) {
      if (tool === "curl" && am[1] === "-O") continue;
      const file = am[2].replace(/^["']|["']$/g, "");
      if (file === "-" || file.startsWith("-")) continue;
      add(file, true, base + am.index);
    }
  }

  // any remaining absolute/home/.. paths → reads
  const re = /(?:^|[\s=:,"'`(><|&])((?:~|\/)[^\s"'`;|&)<>]*|(?:\.\.\/)[^\s"'`;|&)<>]*)/g;
  while ((m = re.exec(command))) { const p = resolveAgainst(m[1], cwdAt(m.index)); if (!targets.has(p)) targets.set(p, false); }

  return [...targets.entries()].map(([path, write]) => ({ path, write }));
}

/** A target as the statement's cwd sees it: absolute and `~` paths stand; relative ones join the cwd. */
function resolveAgainst(target: string, cwd: string | null): string {
  if (!cwd || target.startsWith("/") || target.startsWith("~")) return target;
  const posix = require("node:path").posix;
  const joined = posix.normalize(`${cwd}/${target}`);
  return joined;
}
