/**
 * BLITZ_REAL_HOME lets BlitzPi's own global-state paths (~/.blitz/…) survive a confined bash command whose
 * HOME the sandbox pins to the project workspace. See src/sandbox-backends.ts and docs at the top of real-home.ts.
 */
import os from "node:os";

describe("realHome()", () => {
  const orig = { BLITZ_REAL_HOME: process.env.BLITZ_REAL_HOME, HOME: process.env.HOME };
  afterEach(() => {
    if (orig.BLITZ_REAL_HOME === undefined) delete process.env.BLITZ_REAL_HOME; else process.env.BLITZ_REAL_HOME = orig.BLITZ_REAL_HOME;
    if (orig.HOME === undefined) delete process.env.HOME; else process.env.HOME = orig.HOME;
  });

  test("BLITZ_REAL_HOME wins when set (the confined-bash case)", () => {
    process.env.BLITZ_REAL_HOME = "/real/home";
    process.env.HOME = "/tmp/pinned-workspace";
    const { realHome } = require("../src/real-home");
    expect(realHome()).toBe("/real/home");
  });

  test("falls back to HOME when BLITZ_REAL_HOME is unset (the normal, unconfined case)", () => {
    delete process.env.BLITZ_REAL_HOME;
    process.env.HOME = "/home/normal";
    const { realHome } = require("../src/real-home");
    expect(realHome()).toBe("/home/normal");
  });

  test("falls back to os.homedir() when neither is set", () => {
    delete process.env.BLITZ_REAL_HOME;
    delete process.env.HOME;
    const { realHome } = require("../src/real-home");
    expect(realHome()).toBe(os.homedir());
  });
});
