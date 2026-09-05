/**
 * The pinned Python runtime (EMBEDDED-PYTHON-RUNTIME P2 — gap G7).
 *
 * A table, deliberately: no download logic here. P3 owns the store; this file is only *what* is trusted, so that
 * changing the pin is a reviewable diff of URLs and hashes rather than a change to code that fetches things.
 *
 * ## Source — verified, not assumed
 * `astral-sh/python-build-standalone`. The plan flagged this as "referenced in discussion but not yet verified
 * against a real release manifest"; it now is: release `20260901` was fetched from the GitHub API (871 assets),
 * it publishes a `SHA256SUMS` file covering every asset, and the linux-x64 asset below was downloaded, checksum-
 * verified against that file, extracted and executed on this machine.
 *
 * ## Version — 3.12.14
 * The newest 3.12 in that release. 3.12 rather than the newest available (3.14.7): the point of a bundled runtime
 * is that a user's scripts and dependencies work, and the ecosystem lags new minors by a long way. Bumping is a
 * one-line change here once the ecosystem catches up.
 *
 * ## Variant — `install_only`, the full build (user's call, 2026-09-05)
 * Both were downloaded and run:
 *
 *   install_only            106.2 MB download →  350 MB on disk   ← pinned
 *   install_only_stripped    32.6 MB download →  103 MB on disk
 *
 * Stripped is 3.4x smaller and the stdlib imports fine from it, so it was pinned first on size alone. The user
 * chose the full build: *"i prefer it being installed in full as that's kind of the intent"*. The intent being a
 * real, complete interpreter — a deliberate opt-in download, not something squeezed to look small. Stripped drops
 * debug symbols and static libs, which is exactly the sort of thing that is fine until someone needs to build a
 * native extension or debug one.
 *
 * **This is ~350 MB on disk, ~106 MB downloaded** (linux-x64; smaller elsewhere, see the table). Roughly 80x the
 * security feeds, whose prompt says "≈ 4.5 MB" — anything offering this install must state its real size rather
 * than borrowing that framing.
 *
 * ## What this is, and is not
 * - **Not packaged into the installer.** `install.sh` bundles Bun and nothing else; it contains no reference to
 *   Python. This is an optional download the user asks for, at runtime.
 * - **Reachable by the agent's shell only.** It is mounted into the sandbox and prepended to the PATH *inside*
 *   it — the same treatment the private Bun already gets via `RUNTIME_DIR` (`--ro-bind-try` in
 *   `sandbox-backends.ts`). The user's own shell never sees it, matching BlitzPi's existing policy for the
 *   bundled Bun: on PATH for the agent inside a session, never for your own shell.
 * - A bind-mount alone is not enough; the PATH prepend is required (gap G4). P3 owns both.
 *
 * ## Tracking updates
 * Upstream ships dated releases (`YYYYMMDD`), each carrying every supported Python version. Updating means:
 * bump `RELEASE` and `VERSION`, re-fetch `SHA256SUMS` from the same tag, and replace every `sha256` below — all
 * five, together, so no platform is left on a stale hash. `blitzpi runtimes` (P3) verifies against these values at
 * install time; a mismatch must fail the install and keep whatever was already there.
 */

export const PYTHON_RELEASE = "20260901";
export const PYTHON_VERSION = "3.12.14";
const BASE = `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_RELEASE}`;

export interface PinnedRuntime {
  /** `process.platform` */
  os: NodeJS.Platform;
  /** `process.arch` */
  arch: string;
  /** Upstream target triple, part of the asset name. */
  triple: string;
  asset: string;
  url: string;
  sha256: string;
  /** Compressed download size in bytes, for an honest "this will download N MB" prompt. */
  bytes: number;
}

const entry = (os: NodeJS.Platform, arch: string, triple: string, sha256: string, bytes: number): PinnedRuntime => {
  const asset = `cpython-${PYTHON_VERSION}+${PYTHON_RELEASE}-${triple}-install_only.tar.gz`;
  return { os, arch, triple, asset, url: `${BASE}/${asset}`, sha256, bytes };
};

/** Every platform BlitzPi supports has an asset in this release — checked against the manifest, not assumed. */
export const PINNED_PYTHON: PinnedRuntime[] = [
  entry("linux", "x64", "x86_64-unknown-linux-gnu", "936c246dfdbbfa7cb22dd01814a21f582a892689fae96b06071a5e433baffa22", 111368545),
  entry("linux", "arm64", "aarch64-unknown-linux-gnu", "b61b856c3e1a4fc65b8f6e6b0495ef975dd0924f90c59f3ea61b38a079173b84", 83541077),
  entry("darwin", "arm64", "aarch64-apple-darwin", "3ee3ee547cedfeb7c2b16b2b7156039f7b470bb8f857e226fd3d2eb11db83c76", 25135464),
  entry("darwin", "x64", "x86_64-apple-darwin", "2e31b23f3f1319f707d0e620b48847a0046577541d357276821f9f1b5492e0ba", 24826296),
  entry("win32", "x64", "x86_64-pc-windows-msvc", "e90c1b6419da3bd812dd73bb3de40287a21abf153438147639ec5e20375ea93f", 46184075),
];

/** The pin for this machine, or undefined when the platform has no pinned asset (say so; never guess one). */
export function pinnedPythonFor(os: NodeJS.Platform = process.platform, arch: string = process.arch): PinnedRuntime | undefined {
  return PINNED_PYTHON.find((p) => p.os === os && p.arch === arch);
}

/** Where the interpreter lands inside the extracted archive (upstream packs everything under `python/`). */
export const PYTHON_REL_BIN = process.platform === "win32" ? "python/python.exe" : "python/bin/python3";
