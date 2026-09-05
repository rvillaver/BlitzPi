/**
 * P1 — the in-sandbox capability probe (gaps G3/G5/G6/G8).
 *
 * The point of this probe is that it must NOT answer from the host. On the dev machine `node` lives under mise
 * (`~/.local/share/mise/...`), which bwrap does not bind — so it is on the host's PATH and genuinely unreachable
 * inside the sandbox. A probe that shells out to the host would report it as available and be wrong; that mismatch
 * is gap G3. These tests pin the parsing and the reporting; the live check is in the roadmap's evidence section.
 */
import { PROBED_TOOLS, __parse, __probeCommand, __resetProbe, awaitCapabilities, capabilities, capabilityLine, startCapabilityProbe } from "../src/sandbox-probe";

const fakeBackend = (stdout: string, opts: { fail?: boolean } = {}) => ({
  name: "bwrap",
  hardened: true,
  describe: () => "fake",
  exec: (_c: string, _d: string, o: any) => {
    if (opts.fail) return Promise.reject(new Error("backend exploded"));
    o.onData(Buffer.from(stdout));
    return Promise.resolve({ exitCode: 0 });
  },
}) as any;

beforeEach(() => __resetProbe());

describe("probe command", () => {
  test("checks every probed tool with command -v, silently", () => {
    const cmd = __probeCommand();
    for (const t of PROBED_TOOLS) expect(cmd).toContain(t);
    expect(cmd).toContain("command -v");
    expect(cmd).toContain(">/dev/null 2>&1");
  });
});

describe("parse", () => {
  test("splits what the sandbox found from what it did not, preserving probe order", () => {
    const r = __parse("bash\npython3\ngit\n", "bwrap");
    expect(r.available).toEqual(["bash", "python3", "git"]);
    expect(r.missing).toContain("node");
    expect(r.missing).toContain("go");
    expect(r.available.length + r.missing.length).toBe(PROBED_TOOLS.length);
  });

  test("a tool the sandbox cannot see is missing, however the host is set up", () => {
    // `node` deliberately absent from the sandbox's output even though the host has it.
    const r = __parse("bash\nbun\npython3\n", "bwrap");
    expect(r.available).not.toContain("node");
    expect(r.missing).toContain("node");
  });

  test("empty output means nothing reachable, not a crash", () => {
    const r = __parse("", "bwrap");
    expect(r.available).toEqual([]);
    expect(r.missing.length).toBe(PROBED_TOOLS.length);
  });
});

describe("startCapabilityProbe", () => {
  test("runs through the backend and reports what it printed", async () => {
    const r = await startCapabilityProbe(fakeBackend("bash\nbun\n"), "/tmp", undefined);
    expect(r?.available).toEqual(["bash", "bun"]);
    expect(r?.backend).toBe("bwrap");
    expect(capabilities()?.available).toEqual(["bash", "bun"]);
  });

  test("no backend -> no probe, and the line stays silent rather than guessing", async () => {
    expect(await startCapabilityProbe(null, "/tmp", undefined)).toBeNull();
    expect(capabilities()).toBeNull();
    expect(capabilityLine()).toBeNull();
  });

  test("a backend failure degrades to silence, never to a wrong answer", async () => {
    expect(await startCapabilityProbe(fakeBackend("", { fail: true }), "/tmp", undefined)).toBeNull();
    expect(capabilityLine()).toBeNull();
  });

  test("concurrent callers share one probe — it must not spawn per caller", async () => {
    let calls = 0;
    const counting = {
      name: "bwrap", hardened: true, describe: () => "",
      exec: (_c: string, _d: string, o: any) => { calls++; o.onData(Buffer.from("bash\n")); return Promise.resolve({ exitCode: 0 }); },
    } as any;
    await Promise.all([
      startCapabilityProbe(counting, "/tmp", undefined),
      startCapabilityProbe(counting, "/tmp", undefined),
      startCapabilityProbe(counting, "/tmp", undefined),
    ]);
    expect(calls).toBe(1);
  });
});

describe("capabilityLine", () => {
  test("null until the probe has answered — an absent line never means 'nothing installed'", () => {
    expect(capabilityLine()).toBeNull();
  });

  test("names the backend, what is there, and what is not", async () => {
    await startCapabilityProbe(fakeBackend("bash\npython3\n"), "/tmp", undefined);
    const line = capabilityLine()!;
    expect(line).toContain("in the bwrap sandbox");
    expect(line).toContain("bash, python3");
    expect(line).toContain("not available:");
    expect(line).toContain("node");
  });

  test("says so plainly when there is no sandbox to speak of", async () => {
    const hostish = { name: null } as any;
    await startCapabilityProbe(
      { name: "x", hardened: false, describe: () => "", exec: (_c: string, _d: string, o: any) => { o.onData(Buffer.from("bash\n")); return Promise.resolve({ exitCode: 0 }); } } as any,
      "/tmp", undefined,
    );
    expect(capabilityLine()).toContain("sandbox");
    void hostish;
  });
});

describe("awaitCapabilities", () => {
  test("returns immediately once the result is in", async () => {
    await startCapabilityProbe(fakeBackend("bash\n"), "/tmp", undefined);
    const t0 = Date.now();
    expect((await awaitCapabilities(500))?.available).toEqual(["bash"]);
    expect(Date.now() - t0).toBeLessThan(50);
  });

  test("gives up at the cap rather than holding startup", async () => {
    const slow = {
      name: "bwrap", hardened: true, describe: () => "",
      exec: (_c: string, _d: string, o: any) => new Promise((r) => setTimeout(() => { o.onData(Buffer.from("bash\n")); r({ exitCode: 0 }); }, 400)),
    } as any;
    void startCapabilityProbe(slow, "/tmp", undefined);
    const t0 = Date.now();
    const r = await awaitCapabilities(60);
    expect(Date.now() - t0).toBeLessThan(300);
    expect(r).toBeNull(); // not yet known -> caller omits the line
  });
});
