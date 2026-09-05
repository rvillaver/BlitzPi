/**
 * P2 — the pinned Python table. These tests guard the *shape* of the pin, not the network: they catch a
 * half-finished bump (one platform re-hashed, four left stale) and a URL that stops matching its release tag.
 * The live check — download, verify against the published SHA256SUMS, extract, run — is recorded as evidence in
 * `.claude/docs/plans/EMBEDDED-PYTHON-RUNTIME.md` and is not repeated here; it moves 32 MB.
 */
import { PINNED_PYTHON, PYTHON_RELEASE, PYTHON_VERSION, pinnedPythonFor } from "../src/runtimes/pinned";

describe("pinned python", () => {
  test("covers every platform BlitzPi supports", () => {
    const got = PINNED_PYTHON.map((p) => `${p.os}-${p.arch}`).sort();
    expect(got).toEqual(["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64"]);
  });

  test("every entry carries a full sha256 — a bump that misses one is the failure mode", () => {
    for (const p of PINNED_PYTHON) {
      expect(p.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(p.bytes).toBeGreaterThan(1_000_000);
    }
  });

  test("no two platforms share a hash (a copy-paste bump would)", () => {
    expect(new Set(PINNED_PYTHON.map((p) => p.sha256)).size).toBe(PINNED_PYTHON.length);
  });

  test("urls and asset names agree with the pinned release and version", () => {
    for (const p of PINNED_PYTHON) {
      expect(p.asset).toContain(`cpython-${PYTHON_VERSION}+${PYTHON_RELEASE}-${p.triple}`);
      // The full build, by the user's decision: a real complete interpreter, not the size-optimised one.
      expect(p.asset).toContain("install_only");
      expect(p.asset).not.toContain("stripped");
      expect(p.url).toContain(`/releases/download/${PYTHON_RELEASE}/`);
      expect(p.url.endsWith(p.asset)).toBe(true);
    }
  });

  test("resolves this machine, and admits when a platform is not pinned", () => {
    expect(pinnedPythonFor("linux", "x64")?.triple).toBe("x86_64-unknown-linux-gnu");
    expect(pinnedPythonFor("win32", "arm64")).toBeUndefined(); // no asset upstream: say so, don't substitute
  });
});
