/**
 * Best-effort facts about a shell command for the audit trail: which paths it deletes and which URLs it
 * touches. Pi has no delete or fetch tool — both only ever happen through bash — so this is the only place
 * they can be recorded. It is a lexical scan of the command line, not an execution trace: `rm $f`, scripts,
 * and redirections are not resolved. Reports say "from the command line" for that reason.
 */

const URL_RE = /\bhttps?:\/\/[^\s'"`<>)\]]+/gi;
// Separators are space/tab only: a newline terminates the command in shell, exactly like `;` — matching `\s` made
// the parser swallow the next line's tokens as extra rm targets ("(DB_PATH=/tmp/…" showed up as a deleted file).
const DELETE_CMDS = /\b(?:rm|rmdir|unlink|shred)\b((?:[ \t]+(?:-\S+|--\S+))*)((?:[ \t]+(?:"[^"]*"|'[^']*'|[^\s;&|]+))*)/g;

export function extractUrls(command: string): string[] {
  return [...new Set((command.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:]+$/, "")))];
}

export function extractDeletes(command: string): string[] {
  const out = new Set<string>();
  for (const m of command.matchAll(DELETE_CMDS)) {
    const args = m[2] ?? "";
    for (const raw of args.match(/"[^"]*"|'[^']*'|[^\s;&|]+/g) ?? []) {
      const p = raw.replace(/^["']|["']$/g, "");
      if (p && !p.startsWith("-")) out.add(p);
    }
  }
  // `git rm`, `find … -delete`: record the targets so a report can show them
  for (const m of command.matchAll(/\bgit[ \t]+rm\b((?:[ \t]+-\S+)*)((?:[ \t]+[^\s;&|-][^\s;&|]*)+)/g)) for (const p of (m[2] ?? "").trim().split(/\s+/)) if (p) out.add(p);
  for (const m of command.matchAll(/\bfind[ \t]+((?:"[^"]*"|'[^']*'|[^\s;&|-][^\s;&|]*)+)[^;&|\n]*-delete\b/g)) out.add(`find:${m[1].trim().replace(/^["']|["']$/g, "")}`);
  return [...out];
}

export function bashFacts(command: string): { deletes: string[]; urls: string[] } {
  return { deletes: extractDeletes(command), urls: extractUrls(command) };
}
