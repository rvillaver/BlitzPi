/**
 * The single first-run flow (ONBOARDING-SETUP S4b-S4f): intro → trust → profile → runtimes → security.
 *
 * Two behaviours here are the ones that bite if they regress, and both did during the build:
 *  - **Order.** The dialogs this replaces fired in *registration* order, which asked about machine-wide security
 *    feeds before the user had agreed to set the folder up at all.
 *  - **"Not now" has to stick.** The standalone dialogs each kept a per-version defer marker; a flow without one
 *    re-asks every session and becomes the nag it replaced.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { currentAnswers, introText, isDeferred, recordDeferral, runSteps, type SetupStep, type StepContext } from "../src/setup/steps";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "blitz-flow-"));
const V = "9.9.9";

function step(id: string, over: Partial<SetupStep> = {}): SetupStep {
  return {
    id,
    preview: `ask about ${id}`,
    done: () => false,
    current: () => null,
    run: async () => "ok",
    ...over,
  };
}

const ctx = (cwd: string): StepContext => ({ cwd, ui: {} as any, interactive: true });

describe("order", () => {
  test("steps run in the order given, not the order they were registered anywhere else", async () => {
    const seen: string[] = [];
    const steps = ["intro", "trust", "profile", "runtimes", "level", "feeds"].map((id) =>
      step(id, { run: async () => { seen.push(id); return "ok"; } }),
    );
    await runSteps(steps, ctx(tmp()), { version: V });
    expect(seen).toEqual(["intro", "trust", "profile", "runtimes", "level", "feeds"]);
  });

  test("an abort stops everything after it — declining the folder must not continue into other questions", async () => {
    const seen: string[] = [];
    const steps = [
      step("trust", { run: async () => { seen.push("trust"); return "abort"; } }),
      step("profile", { run: async () => { seen.push("profile"); return "ok"; } }),
    ];
    const r = await runSteps(steps, ctx(tmp()), { version: V });
    expect(r.aborted).toBe(true);
    expect(seen).toEqual(["trust"]);
  });
});

describe("already answered", () => {
  test("a step reporting done() is skipped, so an established project is not re-asked", async () => {
    let ran = false;
    const s = step("level", { done: () => true, run: async () => { ran = true; return "ok"; } });
    const r = await runSteps([s], ctx(tmp()), { version: V });
    expect(ran).toBe(false);
    expect(r.skipped).toEqual(["level"]);
  });
});

describe('"not now" sticks', () => {
  test("deferring records a marker and the step does not run again next session", async () => {
    const cwd = tmp();
    let runs = 0;
    const s = step("profile", { run: async () => { runs++; return "later"; } });

    const first = await runSteps([s], ctx(cwd), { version: V });
    expect(runs).toBe(1);
    expect(first.deferred).toEqual(["profile"]);
    expect(isDeferred(cwd, s, V)).toBe(true);

    const second = await runSteps([s], ctx(cwd), { version: V });
    expect(runs).toBe(1); // the whole point
    expect(second.deferred).toEqual(["profile"]);
  });

  test("a new BlitzPi version is a fair reason to ask once more", async () => {
    const cwd = tmp();
    const s = step("profile", { run: async () => "later" });
    await runSteps([s], ctx(cwd), { version: "1.0.0" });
    expect(isDeferred(cwd, s, "1.0.0")).toBe(true);
    expect(isDeferred(cwd, s, "1.0.1")).toBe(false);
  });

  test("a machine-scoped step defers machine-wide, not per project", () => {
    const s = step("feeds", { scope: "machine" });
    const a = tmp(), b = tmp();
    recordDeferral(a, s, V);
    expect(isDeferred(a, s, V)).toBe(true);
    expect(isDeferred(b, s, V)).toBe(true); // same machine -> same answer
    fs.rmSync(path.join(os.homedir(), ".blitz", `.setup-feeds-deferred-${V}`), { force: true });
  });

  test("a project-scoped step defers only for that project", () => {
    const s = step("level");
    const a = tmp(), b = tmp();
    recordDeferral(a, s, V);
    expect(isDeferred(a, s, V)).toBe(true);
    expect(isDeferred(b, s, V)).toBe(false);
  });

  test("force re-asks something already answered or deferred — that is what a re-run is for", async () => {
    const cwd = tmp();
    let runs = 0;
    const s = step("level", { done: () => true, run: async () => { runs++; return "ok"; } });
    await runSteps([s], ctx(cwd), { version: V });
    expect(runs).toBe(0);
    await runSteps([s], ctx(cwd), { version: V, force: true, only: ["level"] });
    expect(runs).toBe(1);
  });
});

describe("intro", () => {
  test("previews every question the user will actually be asked, in order", () => {
    const steps = [step("trust"), step("profile"), step("level")];
    const text = introText("/some/project", steps);
    expect(text).toContain("Welcome to BlitzPi");
    expect(text).toContain("/some/project");
    for (const [i, s] of steps.entries()) expect(text).toContain(`${i + 1}. ${s.preview}`);
    // The closing promise points at step 1, so step 1 must be the consent step.
    expect(text).toContain("until you say yes to step 1");
    expect(text.indexOf("1. ask about trust")).toBeGreaterThan(-1);
  });
});

describe("re-run listing", () => {
  test("shows current answers, and never lists the welcome as one", () => {
    const steps = [
      step("intro", { informational: true }),
      step("level", { current: () => "guarded (project)" }),
      step("feeds", { current: () => null }),
    ];
    const rows = currentAnswers(steps, tmp());
    expect(rows.map((r) => r.id)).toEqual(["level", "feeds"]);
    expect(rows[0].answer).toBe("guarded (project)");
    expect(rows[1].answer).toBe("not set");
  });
});
