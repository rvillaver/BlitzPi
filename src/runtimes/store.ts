/**
 * The optional runtime store (EMBEDDED-PYTHON-RUNTIME P3 — gaps G1/G2).
 *
 * Deliberately the same shape as `src/feeds/store.ts`: `~/.blitz/runtimes/<name>/` holding `manifest.json` beside
 * the extracted tree, a `previous/` copy for rollback, and `opt-in` / `opt-out` markers. Same failure rule too —
 * **a download that fails, mismatches its checksum, or extracts to something that will not run leaves whatever was
 * already installed exactly where it was.** Staging first and renaming last is what makes that true rather than
 * merely intended.
 *
 * What this is NOT: part of the installer. `install.sh` ships Bun and nothing else. A runtime lands here only
 * because the user asked for it, and is reachable only from inside the agent's sandbox (see `sandboxRuntimeDirs`).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { realHome } from "../real-home";
import { PINNED_PYTHON, PYTHON_RELEASE, PYTHON_VERSION, pinnedPythonFor, type PinnedRuntime } from "./pinned";

export const runtimesDir = (home = realHome()) => process.env.BLITZ_RUNTIMES_DIR || path.join(home, ".blitz", "runtimes");

export interface RuntimeManifest {
  name: string;
  version: string;
  release: string;
  asset: string;
  url: string;
  sha256: string;
  bytes: number;
  installed_at: string;
  /** Relative path of the interpreter inside this runtime's directory. */
  bin: string;
}

export interface RuntimeEvent {
  type: "runtime_install" | "runtime_install_failed" | "runtime_rollback";
  name: string;
  version?: string;
  error?: string;
  changed?: boolean;
}

export type Progress = (received: number, total?: number) => void;

/** Known runtimes. Only Python today; the shape is the extension point. */
export const RUNTIMES = ["python"] as const;
export type RuntimeName = (typeof RUNTIMES)[number];

export class RuntimeStore {
  constructor(private dir: string = runtimesDir(), private fetchImpl: typeof fetch = fetch) {}

  private rtDir(name: string) { return path.join(this.dir, name); }
  private readJson<T>(f: string): T | undefined { try { return JSON.parse(fs.readFileSync(f, "utf-8")) as T; } catch { return undefined; } }
  private writeJson(f: string, d: unknown): void {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(d, null, 1));
    fs.renameSync(tmp, f);
  }

  // ---- opt-in (same vocabulary as the feed store) ---------------------------------------------------------
  optedIn(name: RuntimeName): boolean { return fs.existsSync(path.join(this.rtDir(name), "opt-in")); }
  decision(name: RuntimeName): "in" | "out" | undefined {
    return this.optedIn(name) ? "in" : fs.existsSync(path.join(this.rtDir(name), "opt-out")) ? "out" : undefined;
  }
  optIn(name: RuntimeName): void {
    fs.mkdirSync(this.rtDir(name), { recursive: true });
    fs.writeFileSync(path.join(this.rtDir(name), "opt-in"), new Date().toISOString() + "\n");
    try { fs.unlinkSync(path.join(this.rtDir(name), "opt-out")); } catch { /* none */ }
  }
  /** Opting out records the choice; `remove` also reclaims the disk (a full Python is ~350 MB). */
  optOut(name: RuntimeName, remove = false): boolean {
    fs.mkdirSync(this.rtDir(name), { recursive: true });
    fs.writeFileSync(path.join(this.rtDir(name), "opt-out"), new Date().toISOString() + "\n");
    try { fs.unlinkSync(path.join(this.rtDir(name), "opt-in")); } catch { /* not opted in */ }
    if (!remove) return false;
    let removed = false;
    for (const sub of ["current", "previous"]) {
      const p = path.join(this.rtDir(name), sub);
      if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); removed = true; }
    }
    fs.rmSync(path.join(this.rtDir(name), "manifest.json"), { force: true });
    return removed;
  }

  // ---- read ----------------------------------------------------------------------------------------------
  manifest(name: RuntimeName): RuntimeManifest | undefined { return this.readJson<RuntimeManifest>(path.join(this.rtDir(name), "manifest.json")); }
  previousManifest(name: RuntimeName): RuntimeManifest | undefined { return this.readJson<RuntimeManifest>(path.join(this.rtDir(name), "previous", "manifest.json")); }
  installed(name: RuntimeName): boolean { return !!this.manifest(name) && fs.existsSync(this.binPath(name) ?? ""); }

  /** Absolute path of the installed interpreter, or undefined when nothing usable is installed. */
  binPath(name: RuntimeName): string | undefined {
    const m = this.manifest(name);
    if (!m) return undefined;
    const p = path.join(this.rtDir(name), "current", m.bin);
    return fs.existsSync(p) ? p : undefined;
  }

  /** Directory to put on PATH inside the sandbox (the interpreter's own `bin/`). */
  binDir(name: RuntimeName): string | undefined {
    const p = this.binPath(name);
    return p ? path.dirname(p) : undefined;
  }

  list(): { name: RuntimeName; decision: string; version?: string; installed: boolean; bytes?: number; previous?: string }[] {
    return RUNTIMES.map((name) => {
      const m = this.manifest(name);
      return {
        name,
        decision: this.decision(name) ?? "not asked",
        version: m?.version,
        installed: this.installed(name),
        bytes: m?.bytes,
        previous: this.previousManifest(name)?.version,
      };
    });
  }

  // ---- install -------------------------------------------------------------------------------------------
  private async download(res: Response, onProgress?: Progress): Promise<Buffer> {
    const total = Number(res.headers.get("content-length")) || undefined;
    if (!res.body) return Buffer.from(await res.arrayBuffer());
    const chunks: Buffer[] = [];
    let received = 0;
    for await (const c of res.body as any) {
      const b = Buffer.from(c);
      chunks.push(b);
      received += b.length;
      onProgress?.(received, total);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Install (or re-install) the pinned runtime.
   *
   * Order matters and is the whole safety story: download → verify sha256 against the pin → extract to `staged/`
   * → prove the interpreter actually runs → only then rotate `current` to `previous` and move `staged` into place.
   * Any failure before the rotation returns an error with the existing install untouched.
   */
  async install(name: RuntimeName, opts: { force?: boolean; onProgress?: Progress } = {}): Promise<RuntimeEvent> {
    if (name !== "python") return { type: "runtime_install_failed", name, error: `unknown runtime "${name}" (known: ${RUNTIMES.join(", ")})` };
    const pin: PinnedRuntime | undefined = pinnedPythonFor();
    if (!pin) {
      return { type: "runtime_install_failed", name, error: `no pinned build for ${process.platform}-${process.arch}. Pinned: ${PINNED_PYTHON.map((p) => `${p.os}-${p.arch}`).join(", ")}` };
    }
    const current = this.manifest(name);
    if (current?.sha256 === pin.sha256 && this.installed(name) && !opts.force) {
      return { type: "runtime_install", name, version: current.version, changed: false };
    }

    const dir = this.rtDir(name);
    const staged = path.join(dir, "staged");
    try {
      const res = await this.fetchImpl(pin.url);
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${pin.url}`);
      const bytes = await this.download(res, opts.onProgress);
      const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      // The pin is the authority. A mismatch is a supply-chain event, not a retryable blip: stop.
      if (sha256 !== pin.sha256) throw new Error(`checksum mismatch — expected ${pin.sha256}, got ${sha256}. Refusing to install.`);

      fs.rmSync(staged, { recursive: true, force: true });
      fs.mkdirSync(staged, { recursive: true });
      const archive = path.join(dir, `download-${process.pid}.tar.gz`);
      fs.writeFileSync(archive, bytes);
      try {
        const r = spawnSync("tar", ["xzf", archive, "-C", staged], { stdio: "ignore" });
        if (r.status !== 0) throw new Error(`extraction failed (tar exit ${r.status})`);
      } finally { fs.rmSync(archive, { force: true }); }

      const binRel = PYTHON_BIN_REL;
      const staged_bin = path.join(staged, binRel);
      if (!fs.existsSync(staged_bin)) throw new Error(`extracted archive has no interpreter at ${binRel}`);
      // Prove it runs BEFORE replacing a working install. An archive that extracts but cannot execute is the
      // failure the feed store's "compiled to zero rules" check exists for.
      const probe = spawnSync(staged_bin, ["--version"], { encoding: "utf-8" });
      if (probe.status !== 0) throw new Error(`extracted interpreter does not run: ${(probe.stderr || probe.stdout || "").trim().slice(0, 120)}`);

      const manifest: RuntimeManifest = {
        name, version: PYTHON_VERSION, release: PYTHON_RELEASE, asset: pin.asset, url: pin.url,
        sha256, bytes: bytes.length, installed_at: new Date().toISOString(), bin: binRel,
      };
      this.writeJson(path.join(staged, "manifest.json"), manifest);

      // Rotate only when the content actually changed, so a forced re-install of identical bytes does not
      // overwrite the rollback target with a copy of itself (the feed store learned this the same way).
      if (this.installed(name) && current && current.sha256 !== sha256) {
        fs.rmSync(path.join(dir, "previous"), { recursive: true, force: true });
        fs.mkdirSync(path.join(dir, "previous"), { recursive: true });
        fs.renameSync(path.join(dir, "current"), path.join(dir, "previous", "current"));
        if (fs.existsSync(path.join(dir, "manifest.json"))) fs.renameSync(path.join(dir, "manifest.json"), path.join(dir, "previous", "manifest.json"));
      } else if (this.installed(name)) {
        fs.rmSync(path.join(dir, "current"), { recursive: true, force: true });
      }
      fs.renameSync(staged, path.join(dir, "current"));
      fs.renameSync(path.join(dir, "current", "manifest.json"), path.join(dir, "manifest.json"));
      this.optIn(name);
      return { type: "runtime_install", name, version: manifest.version, changed: true };
    } catch (e) {
      fs.rmSync(staged, { recursive: true, force: true }); // never leave a half-extracted tree behind
      return { type: "runtime_install_failed", name, error: (e as Error).message };
    }
  }

  /** Swap `previous` back into `current`. Returns an error string when there is nothing to roll back to. */
  rollback(name: RuntimeName): RuntimeEvent {
    const dir = this.rtDir(name);
    const prev = this.previousManifest(name);
    if (!prev || !fs.existsSync(path.join(dir, "previous", "current"))) {
      return { type: "runtime_install_failed", name, error: "no previous version to roll back to" };
    }
    // Capture what we are about to replace BEFORE moving anything: it becomes the new rollback target, and
    // without it `previous/` ends up holding a tree with no manifest — which reads as "nothing to roll back to",
    // so a second rollback silently does nothing instead of returning where you came from.
    const replaced = this.manifest(name);
    const holding = path.join(dir, `rollback-${process.pid}`);
    fs.renameSync(path.join(dir, "current"), holding);
    fs.renameSync(path.join(dir, "previous", "current"), path.join(dir, "current"));
    fs.renameSync(path.join(dir, "previous", "manifest.json"), path.join(dir, "manifest.json"));
    fs.mkdirSync(path.join(dir, "previous"), { recursive: true });
    fs.renameSync(holding, path.join(dir, "previous", "current"));
    if (replaced) this.writeJson(path.join(dir, "previous", "manifest.json"), replaced);
    return { type: "runtime_rollback", name, version: prev.version };
  }
}

/** Where the interpreter sits inside the extracted archive. Upstream packs everything under `python/`. */
export const PYTHON_BIN_REL = process.platform === "win32" ? path.join("python", "python.exe") : path.join("python", "bin", "python3");

/**
 * Directories to mount and prepend to PATH **inside the sandbox**. Empty unless the user opted in and the install
 * is intact — an opted-out or half-installed runtime must simply not appear, never appear and fail on use.
 *
 * This is the only route by which a stored runtime becomes reachable, and it is scoped to the agent's sandbox:
 * the user's own shell is untouched, exactly as with the private Bun.
 */
export function sandboxRuntimeDirs(store = new RuntimeStore()): string[] {
  const dirs: string[] = [];
  for (const name of RUNTIMES) {
    if (store.decision(name) !== "in") continue;
    const d = store.binDir(name);
    if (d) dirs.push(d);
  }
  return dirs;
}
