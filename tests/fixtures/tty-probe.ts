/** Probe helper for sandbox-terminal.test.ts: run one command through a backend and report what it saw.
 *  Launched under a pty (`script`) so the parent really has a controlling terminal to steal. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { selectBackend, type BackendPref } from "../../src/sandbox-backends";

const pref = (process.argv[2] || "auto") as BackendPref;
const backend = selectBackend(pref);
if (!backend) { console.log("SKIP"); process.exit(0); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blitz-tty-"));
let out = "";
backend.exec(': > /dev/tty 2>/dev/null && echo STOLE_TTY || echo NO_TTY', dir, {
  onData: (d) => { out += d.toString(); },
  timeout: 20_000,
}).then(() => { console.log(out.trim()); process.exit(0); });
