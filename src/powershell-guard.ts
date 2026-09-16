/**
 * PowerShell / cmd command inspection, the Windows counterpart of bash-guard.ts.
 *
 * Two surfaces need this, not one. Pi registers a separate `powershell` tool whose commands never reached the
 * gate at all; and on Windows the pinned backend runs the *bash* tool's commands through `powershell.exe`
 * (sandbox-backends.ts), so a command that looks POSIX-guarded is executed by a shell that reads a different
 * grammar. Both are parsed here.
 *
 * Shares BlitzPi's zone ladder and permission gate — only the verbs, the switch syntax, the download-to-execute
 * idiom and the path dialects differ. Paths are canonicalised to a POSIX-with-drive-prefix form so one zone
 * classifier serves `C:\x`, `C:/x` and Git Bash's `/c/x` alike.
 */
import type { CmdTarget } from "./bash-guard";

const DELETE_VERBS = new Set(["remove-item", "ri", "rd", "rmdir", "del", "erase", "rm"]);
const DOWNLOADERS = new Set(["invoke-webrequest", "iwr", "invoke-restmethod", "irm", "curl", "wget"]);
const EXECS = new Set(["iex", "invoke-expression"]);
const CD_VERBS = new Set(["cd", "chdir", "set-location", "sl", "pushd"]);
const WRITE_VERBS = new Set([
  ...DELETE_VERBS,
  "new-item", "ni", "set-content", "sc", "add-content", "ac", "out-file", "clear-content",
  "copy-item", "cpi", "copy", "cp", "move-item", "mi", "move", "mv", "mkdir", "md", "xcopy", "robocopy",
]);
/** The PowerShell reverse shell, counterpart of the bash `/dev/tcp` one-liner. */
const REVERSE_SHELL = /net\.sockets\.tcp(client|listener)/i;
/** `Invoke-Expression` fed from a download is the `curl | sh` of Windows; `-Verb RunAs` is its `sudo`. */
const URL_TOKEN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`;|&)<>]*/gi;

const WIN_DRIVE = /^([A-Za-z]):[\\/]/;
const WIN_DRIVE_BARE = /^([A-Za-z]):$/;
const UNC = /^\\\\[^\\]/;

/**
 * One directory, several spellings. `C:\x`, `C:/x` and Git Bash's `/c/x` all become `/c/x`, so a single zone
 * ladder covers both grammars. Conversion is conditional on the token actually looking Windows-shaped: a blanket
 * backslash swap would corrupt POSIX paths where `\` escapes (`/tmp/my\ dir`).
 */
export function toCanonicalPath(raw: string): string {
  if (typeof raw !== "string" || raw === "") return raw;
  const drive = WIN_DRIVE.exec(raw);
  if (drive) return "/" + drive[1].toLowerCase() + raw.slice(2).replace(/\\/g, "/");
  const bare = WIN_DRIVE_BARE.exec(raw);
  if (bare) return "/" + bare[1].toLowerCase();
  if (UNC.test(raw)) return raw.replace(/\\/g, "/");
  return raw;
}

/**
 * A cmd-style switch (`/s`, `/q`, `/f`) — NOT a path. Without this they read as absolute POSIX paths, and the
 * guard asks about "/f" while the command's real target walks past unexamined.
 */
export function isCmdSwitch(tok: string): boolean {
  return /^\/[A-Za-z?][A-Za-z0-9?:-]*$/.test(tok);
}

/**
 * Same length as `text`, with the INTERIOR of every quoted run replaced by "Q". Lets a shape be matched on the
 * parts of a command that are actually code: a commit message or a `Select-String` pattern quoting
 * `Net.Sockets.TCPClient` must no more read as a reverse shell than naming `docker` counts as running it
 * (bash-guard's invokedPrograms, audit 17 G17-1 — same lesson, second grammar).
 */
export function maskQuoted(text: string): string {
  let out = "", inS = false, inD = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inS) { out += c === "'" ? c : "Q"; if (c === "'") inS = false; continue; }
    if (inD) { out += c === '"' ? c : "Q"; if (c === '"') inD = false; continue; }
    if (c === "'") { inS = true; out += c; continue; }
    if (c === '"') { inD = true; out += c; continue; }
    if (c === "`" && i + 1 < text.length) { out += text[i] + text[i + 1]; i++; continue; }
    out += c;
  }
  return out;
}

interface Statement { sep: string | null; text: string }

/** Quote-aware split into statements on `;` `|` `&&` `||` and newline, with `( … )` scoping a subexpression.
 *  The separator that PRECEDED each statement is kept: a download only continues a chain across a real pipe,
 *  so `iwr …; iex x` is a download and an execution in two statements, not the piped shape — the same boundary
 *  rule bash-guard applies to `curl … | sh`. */
function splitStatements(command: string): Statement[] {
  const out: Statement[] = [];
  let cur = "", sep: string | null = null, inS = false, inD = false;
  const push = (next: string | null) => { out.push({ sep, text: cur }); cur = ""; sep = next; };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (inS) { cur += c; if (c === "'") inS = false; continue; }
    if (inD) { cur += c; if (c === '"') inD = false; continue; }
    if (c === "'") { inS = true; cur += c; continue; }
    if (c === '"') { inD = true; cur += c; continue; }
    if (c === "`" && i + 1 < command.length) { cur += c + command[i + 1]; i++; continue; } // ` escapes in PowerShell
    if (c === "(" || c === ")") { push(null); continue; }
    if (c === "&" && command[i + 1] === "&") { push("&&"); i++; continue; }
    if (c === "|" && command[i + 1] === "|") { push("||"); i++; continue; }
    if (c === ";" || c === "|" || c === "\n") { push(c); continue; }
    cur += c;
  }
  push(null);
  return out;
}

function splitWords(text: string): string[] {
  const words: string[] = [];
  let cur = "", inS = false, inD = false;
  const flush = () => { if (cur !== "") { words.push(cur); cur = ""; } };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inS) { cur += c; if (c === "'") inS = false; continue; }
    if (inD) { cur += c; if (c === '"') inD = false; continue; }
    if (c === "'") { inS = true; cur += c; continue; }
    if (c === '"') { inD = true; cur += c; continue; }
    if (c === "`" && i + 1 < text.length) { cur += c + text[i + 1]; i++; continue; }
    if (/\s/.test(c)) { flush(); continue; }
    cur += c;
  }
  flush();
  return words;
}

const unquote = (t: string) => (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'"))) ? t.slice(1, -1) : t);

/** The cmdlet a statement invokes, lower-cased and stripped of `.exe`, plus its arguments. */
function parseCommand(text: string): { cmd: string; args: string[] } | null {
  const words = splitWords(text).map(unquote).filter(Boolean);
  if (!words.length) return null;
  const head = words[0].split(/[\\/]/).pop() || words[0];
  return { cmd: head.toLowerCase().replace(/\.exe$/, ""), args: words.slice(1) };
}

/** Recursive+forced delete in either Windows grammar: PowerShell's `-Recurse -Force` (accepting the unambiguous
 *  prefixes PowerShell itself accepts, so `-r -f` counts), or cmd's `/s`, which recurses and suppresses the
 *  prompt in one switch. */
function isRecursiveForceDelete(args: string[]): { recurse: boolean; force: boolean; targets: string[] } {
  let recurse = false, force = false;
  const targets: string[] = [];
  for (const a of args) {
    if (a.startsWith("-")) {
      if (/^-r(e(c(u(r(s(e)?)?)?)?)?)?$/i.test(a)) recurse = true;
      else if (/^-f(o(r(c(e)?)?)?)?$/i.test(a)) force = true;
      continue;
    }
    if (isCmdSwitch(a)) { if (/^\/s$/i.test(a)) { recurse = true; force = true; } continue; }
    targets.push(a);
  }
  return { recurse, force, targets };
}

/** Does this token name a protected root — a drive, a profile directory, or a Windows system directory? */
function isProtectedRoot(tok: string): boolean {
  const p = toCanonicalPath(tok).replace(/\/+$/, "") || "/";
  if (p === "/" || p === "~") return true;
  if (/^\/[a-z]$/i.test(p)) return true;                                   // a whole drive: /c
  if (/^\/[a-z]\/users(\/[^/]+)?$/i.test(p)) return true;                  // the profiles dir, or one profile
  if (/^\/[a-z]\/(windows|program files( \(x86\))?|programdata)$/i.test(p)) return true;
  if (/^(?:%USERPROFILE%|\$env:USERPROFILE|\$HOME|\$\{HOME\})$/i.test(tok)) return true;
  return false;
}

/**
 * A genuinely dangerous command SHAPE in the Windows grammars, or null. Mirrors bash-guard's `dangerousShape`
 * and returns the same kind of human-readable label, so the permission gate treats both lanes identically.
 */
export function dangerousShapePowerShell(command: string): string | null {
  if (!command || typeof command !== "string") return null;
  if (REVERSE_SHELL.test(maskQuoted(command))) return "reverse shell";
  let chainHasDownload = false;
  for (const { sep, text: rawText } of splitStatements(command)) {
    const text = rawText.trim();
    if (!text) continue;
    if (sep !== "|") chainHasDownload = false; // a chain only continues across a real pipe
    const parsed = parseCommand(text);
    if (!parsed) continue;
    const { cmd, args } = parsed;
    if (cmd === "sudo" || cmd === "doas") return "sudo";
    // Start-Process -Verb RunAs is the UAC elevation prompt: the Windows counterpart of sudo.
    if (cmd === "start-process" && args.some((a, i) => /^-verb$/i.test(a) && /^runas$/i.test(args[i + 1] ?? ""))) {
      return "elevated execution (UAC)";
    }
    if (DELETE_VERBS.has(cmd)) {
      const { recurse, force, targets } = isRecursiveForceDelete(args);
      if (recurse && force && targets.some(isProtectedRoot)) return "recursive delete of a system/home path";
    }
    if (cmd === "format-volume" || (cmd === "format" && args.some((a) => WIN_DRIVE_BARE.test(a)))) return "format volume";
    if (DOWNLOADERS.has(cmd)) chainHasDownload = true;
    else if (EXECS.has(cmd) && chainHasDownload) return "download piped into a shell";
  }
  return null;
}

/** Does this token name a place on disk, in the Windows grammars? Switches are what must be excluded: cmd's begin
 *  with `/` and would otherwise read as absolute POSIX paths, PowerShell's begin with `-`. */
function looksLikePath(tok: string): boolean {
  if (!tok || tok.startsWith("-") || isCmdSwitch(tok)) return false;
  if (WIN_DRIVE.test(tok) || WIN_DRIVE_BARE.test(tok) || UNC.test(tok)) return true;
  if (tok.startsWith("~") || tok.startsWith("/")) return true;
  if (tok.includes("../") || tok.includes("..\\")) return true;
  return /^(?:\$\{?HOME\}?|%USERPROFILE%|\$env:USERPROFILE)/i.test(tok);
}

/**
 * The paths a PowerShell/cmd command names, and whether each is a write target. Write detection covers the
 * redirection operators, the write-verb list and the downloaders' `-OutFile`; any other path-shaped token is a
 * read. URLs are blanked first so `https://host/path` never reads as the path `//host/path`.
 */
export function extractTargetsPowerShell(rawCommand: string): CmdTarget[] {
  const command = rawCommand.replace(URL_TOKEN, (u) => " ".repeat(u.length));
  const targets = new Map<string, boolean>();
  const add = (raw: string, write: boolean) => {
    const p = toCanonicalPath(unquote(raw));
    if (!p) return;
    targets.set(p, (targets.get(p) ?? false) || write);
  };

  for (const { text: rawText } of splitStatements(command)) {
    const text = rawText.trim();
    if (!text) continue;

    // redirections: > and >> name a write target in both grammars
    const redir = /(^|[^0-9<>&])>>?\s*("[^"]+"|'[^']+'|[^\s"';|&)]+)/g;
    let m: RegExpExecArray | null;
    while ((m = redir.exec(text))) add(m[2], true);

    const parsed = parseCommand(text);
    if (!parsed) continue;
    const { cmd, args } = parsed;
    if (CD_VERBS.has(cmd)) continue; // navigation is not a touch — same rule the POSIX lane applies to `cd`

    const write = WRITE_VERBS.has(cmd);
    for (let i = 0; i < args.length; i++) {
      const tok = args[i];
      // `-OutFile <path>` / `-FilePath <path>` / `-Destination <path>` name writes explicitly.
      if (/^-(outfile|filepath|destination|literalpath)$/i.test(tok) && args[i + 1]) { add(args[i + 1], true); i++; continue; }
      if (tok.startsWith("-") || isCmdSwitch(tok)) continue;
      if (looksLikePath(tok)) add(tok, write);
    }
  }
  return [...targets.entries()].map(([path, write]) => ({ path, write }));
}
