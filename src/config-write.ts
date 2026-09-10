/**
 * Writing BlitzPi's own YAML config — parse, modify, serialise, and verify by parsing the result back.
 *
 * Both writers used to patch the raw text with a regex to preserve the file's commented examples. That produced
 * invalid YAML from an ordinary edit: a user who commented out their old profile and then chose a new one got two
 * `profile:` keys, `loadConfig()` threw `duplicated mapping key`, and — because a throw in `blitz()` makes Pi
 * discard every hook — the next session ran with no governance at all (audit 14, G14-7 → G14-1).
 *
 * `yaml`'s Document API keeps the comments, so the constraint that motivated the regex no longer costs anything.
 */
import fs from "node:fs";
import path from "node:path";
import { parseDocument, parse as parseYaml } from "yaml";

export type ConfigWriteResult =
  | { ok: true; created: boolean }
  | { ok: false; error: string; unchanged: true };

/**
 * Set one dotted key in a YAML file, creating the file if absent. The file on disk is replaced only after the new
 * text has been parsed back and the value confirmed — a write that would produce an unparseable config leaves the
 * previous file untouched and reports why.
 */
export function setConfigValue(filePath: string, keyPath: string[], value: unknown): ConfigWriteResult {
  let original = "";
  let created = false;
  try {
    original = fs.readFileSync(filePath, "utf-8");
  } catch {
    created = true;
  }

  let text: string;
  try {
    const doc = parseDocument(original);
    if (doc.errors.length) {
      // Refuse to rewrite a file we could not understand: serialising it would silently discard whatever the user
      // has in there. Fixing their file is their call, not ours.
      return { ok: false, error: `existing config is not valid YAML: ${doc.errors[0].message}`, unchanged: true };
    }
    doc.setIn(keyPath, value);
    text = String(doc);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), unchanged: true };
  }

  // Verify before replacing, not after: the old code wrote first and then checked with a regex that could not
  // match (it was built without the `m` flag, so it reported failure on every successful write — audit 12, G12-6).
  try {
    const roundTripped = parseYaml(text) as Record<string, unknown>;
    let cursor: unknown = roundTripped;
    for (const k of keyPath) cursor = (cursor as Record<string, unknown>)?.[k];
    if (cursor !== value) return { ok: false, error: `value did not survive serialisation (got ${JSON.stringify(cursor)})`, unchanged: true };
  } catch (e) {
    return { ok: false, error: `would have written unparseable YAML: ${e instanceof Error ? e.message : String(e)}`, unchanged: true };
  }

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, text);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), unchanged: true };
  }
  return { ok: true, created };
}
