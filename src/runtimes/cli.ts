/**
 * `blitzpi runtimes …` — the user-facing half of P3, in the shape of `blitzpi feeds`.
 *
 * Everything here is explicit. Nothing installs a 350 MB interpreter as a side effect of another command, and
 * every message states the real size rather than borrowing the feeds' "≈ 4.5 MB" framing.
 */
import { PINNED_PYTHON, PYTHON_VERSION, pinnedPythonFor } from "./pinned";
import { RUNTIMES, RuntimeStore, type RuntimeName } from "./store";

const MB = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

const USAGE = `Usage: blitzpi runtimes <command> [python]

  list                 what is installed, opted in/out, and what a install would fetch
  install [python]     download the pinned runtime (verifies sha256 before installing)
  update [python]      re-install if the pin moved; --force re-downloads the same version
  rollback [python]    go back to the previously installed version
  opt-in [python]      record that you want it (does not download)
  opt-out [python]     record that you do not; --remove also deletes the files

A runtime is optional and is NOT part of the installer. It is reachable only from the agent's sandboxed shell —
never added to your own PATH.`;

function progressBar(name: string): (received: number, total?: number) => void {
  let last = 0;
  return (received, total) => {
    const now = Date.now();
    if (now - last < 250 && received !== total) return; // don't spam a terminal
    last = now;
    const pct = total ? ` (${Math.round((received / total) * 100)}%)` : "";
    process.stdout.write(`\r  downloading ${name}: ${MB(received)}${total ? ` / ${MB(total)}` : ""}${pct}   `);
  };
}

export async function handleRuntimesCommand(args: string[], store = new RuntimeStore()): Promise<void> {
  const sub = args[0];
  const name = (args.find((a) => (RUNTIMES as readonly string[]).includes(a)) ?? "python") as RuntimeName;
  const force = args.includes("--force");
  const remove = args.includes("--remove");

  if (!sub || sub === "--help" || sub === "-h") { console.log(USAGE); return; }

  if (sub === "list") {
    const pin = pinnedPythonFor();
    for (const r of store.list()) {
      const bits = [
        `${r.name.padEnd(8)} ${r.installed ? `installed ${r.version}` : "not installed"}`,
        `decision: ${r.decision}`,
        r.previous ? `rollback to: ${r.previous}` : "",
      ].filter(Boolean);
      console.log(`  ${bits.join("  ·  ")}`);
    }
    console.log(
      pin
        ? `\n  pinned: python ${PYTHON_VERSION} for ${pin.os}-${pin.arch} — ${MB(pin.bytes)} download, about 350 MB on disk`
        : `\n  pinned: no build for ${process.platform}-${process.arch} (have: ${PINNED_PYTHON.map((p) => `${p.os}-${p.arch}`).join(", ")})`,
    );
    const dir = store.binDir(name);
    console.log(dir ? `  the agent's sandbox gets: ${dir}` : "  nothing is exposed to the agent's sandbox");
    return;
  }

  if (sub === "opt-in") { store.optIn(name); console.log(`[Blitz] ${name}: opted in — run "blitzpi runtimes install ${name}" to download it.`); return; }
  if (sub === "opt-out") {
    const gone = store.optOut(name, remove);
    console.log(`[Blitz] ${name}: opted out${gone ? " and removed from disk" : store.installed(name) ? " (files kept — add --remove to delete them)" : ""}.`);
    return;
  }

  if (sub === "rollback") {
    const r = store.rollback(name);
    if (r.type === "runtime_install_failed") { console.error(`[Blitz] ${name}: ${r.error}`); process.exitCode = 1; return; }
    console.log(`[Blitz] ${name}: rolled back to ${r.version}`);
    return;
  }

  if (sub === "install" || sub === "update") {
    const pin = pinnedPythonFor();
    if (!pin) { console.error(`[Blitz] no pinned ${name} build for ${process.platform}-${process.arch}.`); process.exitCode = 1; return; }
    console.log(`[Blitz] ${name} ${PYTHON_VERSION}: ${MB(pin.bytes)} to download, about 350 MB once unpacked.`);
    const r = await store.install(name, { force, onProgress: progressBar(name) });
    process.stdout.write("\r".padEnd(72) + "\r");
    if (r.type === "runtime_install_failed") {
      console.error(`[Blitz] ${name}: install failed — ${r.error}`);
      console.error(`[Blitz] nothing was changed; whatever was installed before is still in place.`);
      process.exitCode = 1;
      return;
    }
    if (r.changed === false) { console.log(`[Blitz] ${name} ${r.version}: already current (--force re-downloads).`); return; }
    console.log(`[Blitz] ${name} ${r.version}: installed. The agent's sandboxed shell can now run it; your own shell is unchanged.`);
    return;
  }

  console.error(`[Blitz] unknown runtimes command "${sub}"\n\n${USAGE}`);
  process.exitCode = 2;
}
