/**
 * Which packages a shell command installs — `{ecosystem, name}` in OSV's vocabulary. Lexical, best-effort
 * (like bash-facts): `bun add $PKG` or a script that installs is not resolved. Version specifiers, flags,
 * paths, URLs and tarballs are dropped; only registry names are returned.
 */
export interface PackageRef { ecosystem: "npm" | "PyPI" | "crates.io" | "RubyGems" | "Go"; name: string }

type Rule = { re: RegExp; ecosystem: PackageRef["ecosystem"]; normalize: (tok: string) => string | null };

const npmName = (tok: string): string | null => {
  if (/^(\.|\/|~|https?:|git\+|file:|github:|gitlab:|bitbucket:)/i.test(tok) || /\.(tgz|tar\.gz|zip)$/i.test(tok)) return null;
  const m = tok.match(/^(@[^/@\s]+\/[^@\s]+|[^@\s][^@\s]*)(?:@.*)?$/);
  if (!m) return null;
  const name = m[1];
  return /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name) ? name : null;
};
const pipName = (tok: string): string | null => {
  if (/^(\.|\/|~|https?:|git\+|-)/i.test(tok) || /\.(whl|tar\.gz|zip)$/i.test(tok)) return null;
  const m = tok.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)/);
  return m ? m[1].toLowerCase().replace(/[._]+/g, "-") : null; // PEP 503 normalisation
};
const plainName = (tok: string): string | null => { const n = tok.replace(/@.*$/, ""); return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(n) ? n : null; };
const goName = (tok: string): string | null => (/^[a-z0-9.-]+\.[a-z]+\/[A-Za-z0-9._\/-]+/.test(tok) ? tok.replace(/@.*$/, "") : null);

// Each rule: the installer verb, then the argument list up to a shell separator.
const ARGS = String.raw`((?:\s+(?:"[^"]*"|'[^']*'|[^\s;&|<>]+))*)`;
const RULES: Rule[] = [
  { re: new RegExp(String.raw`(?:^|[\s;&|(])(?:bun|pnpm|yarn)\s+(?:add|install|i|a)\b${ARGS}`, "g"), ecosystem: "npm", normalize: npmName },
  { re: new RegExp(String.raw`(?:^|[\s;&|(])npm\s+(?:install|i|add|isntall|in|ins|inst|insta|instal|isnt|isnta|isntal)\b${ARGS}`, "g"), ecosystem: "npm", normalize: npmName },
  { re: new RegExp(String.raw`(?:^|[\s;&|(])(?:npx|bunx|pnpm\s+dlx|yarn\s+dlx)\s+(?:-[^\s]+\s+)*("[^"]*"|'[^']*'|[^\s;&|<>]+)`, "g"), ecosystem: "npm", normalize: npmName },
  { re: new RegExp(String.raw`(?:^|[\s;&|(])(?:pip3?|pipx|uv\s+pip)\s+install\b${ARGS}`, "g"), ecosystem: "PyPI", normalize: pipName },
  { re: new RegExp(String.raw`(?:^|[\s;&|(])(?:poetry|uv)\s+add\b${ARGS}`, "g"), ecosystem: "PyPI", normalize: pipName },
  { re: new RegExp(String.raw`(?:^|[\s;&|(])cargo\s+(?:add|install)\b${ARGS}`, "g"), ecosystem: "crates.io", normalize: plainName },
  { re: new RegExp(String.raw`(?:^|[\s;&|(])gem\s+install\b${ARGS}`, "g"), ecosystem: "RubyGems", normalize: plainName },
  { re: new RegExp(String.raw`(?:^|[\s;&|(])go\s+(?:get|install)\b${ARGS}`, "g"), ecosystem: "Go", normalize: goName },
];

const FLAG_WITH_VALUE = new Set(["--registry", "--cwd", "--filter", "-r", "--index-url", "-i", "--extra-index-url", "--target", "-t", "--python", "-p", "--prefix", "--features", "-F", "--version", "-v", "--git", "--path", "--branch", "--tag", "--rev", "--package", "--source", "--root", "--tag-name"]);

function tokens(args: string): string[] {
  const out: string[] = [];
  let skip = false;
  for (const raw of args.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? []) {
    const tok = raw.replace(/^["']|["']$/g, "");
    if (skip) { skip = false; continue; }
    if (tok.startsWith("-")) { if (FLAG_WITH_VALUE.has(tok)) skip = true; continue; }
    if (tok === "install" || tok === "add" || tok === "i") continue; // `pip install`, `poetry add` verb inside the args
    out.push(tok);
  }
  return out;
}

export function parseInstalls(command: string): PackageRef[] {
  const seen = new Map<string, PackageRef>();
  for (const rule of RULES) {
    for (const m of command.matchAll(rule.re)) {
      for (const tok of tokens(m[1] ?? "")) {
        const name = rule.normalize(tok);
        if (name) seen.set(`${rule.ecosystem}:${name}`, { ecosystem: rule.ecosystem, name });
      }
    }
  }
  return [...seen.values()];
}
