/** Chat-bridge phase 1: the `question` tool over ctx.ui (B3) and the caller marker → audit (B4). */
// typebox ships ESM only; the tool's schema is data we don't exercise here
jest.mock("typebox", () => { const any = (x: unknown = {}) => x; return { Type: { Object: any, String: any, Array: any, Optional: any, Boolean: any } }; });
import { setupQuestionTool } from "../src/tools/question";
import { CALLER_MARKER, getOnBehalfOf, noteCaller, setOnBehalfOf } from "../src/caller";

function tool() {
  let def: any; const pi: any = { registerTool: (d: any) => { def = d; } };
  setupQuestionTool(pi);
  return def;
}
const ctxWith = (select: (t: string, o: string[]) => Promise<string | undefined>, input?: (t: string) => Promise<string | undefined>) => ({ hasUI: true, ui: { select, input: input ?? (async () => undefined) } });

describe("question tool", () => {
  test("registers with a schema and returns the pick", async () => {
    const d = tool(); expect(d.name).toBe("question");
    const seen: any[] = [];
    const r = await d.execute("id", { question: "Proceed?", options: [{ label: "Yes" }, { label: "No", description: "stop here" }] }, undefined, undefined, ctxWith(async (t, o) => { seen.push([t, o]); return "Yes"; }));
    expect(seen[0]).toEqual(["Proceed?", ["Yes", "No — stop here", "Other — type an answer"]]);
    expect(r.content[0].text).toBe("User selected: Yes"); expect(r.details).toMatchObject({ answer: "Yes", index: 1 });
  });
  test("Other → free text; dismissed → says so; no UI → says so (never guesses)", async () => {
    const d = tool();
    const other = await d.execute("id", { question: "Q?", options: [{ label: "A" }] }, undefined, undefined, ctxWith(async () => "Other — type an answer", async () => "  something else "));
    expect(other.content[0].text).toBe("User answered: something else"); expect(other.details).toMatchObject({ typed: true });
    const dismissed = await d.execute("id", { question: "Q?", options: [{ label: "A" }] }, undefined, undefined, ctxWith(async () => undefined));
    expect(dismissed.content[0].text).toMatch(/dismissed/);
    const noUi = await d.execute("id", { question: "Q?", options: [{ label: "A" }] }, undefined, undefined, { hasUI: false, ui: {} });
    expect(noUi.content[0].text).toMatch(/non-interactive/);
    const noOther = await d.execute("id", { question: "Q?", options: [{ label: "A" }], allowOther: false }, undefined, undefined, ctxWith(async (_t, o) => { expect(o).toEqual(["A"]); return "A"; }));
    expect(noOther.content[0].text).toBe("User selected: A");
  });
});

describe("caller marker", () => {
  beforeEach(() => setOnBehalfOf(undefined));
  test("a leading [caller …] line is recorded until the next one; ordinary prompts leave it alone", () => {
    expect(noteCaller("[caller discord:42#alice]\nfix the tests")).toBe("discord:42#alice");
    expect(getOnBehalfOf()).toBe("discord:42#alice");
    expect(noteCaller("just a prompt")).toBeUndefined();
    expect(getOnBehalfOf()).toBe("discord:42#alice");
    expect(noteCaller("[caller telegram:7#bob] hi")).toBe("telegram:7#bob");
    expect(CALLER_MARKER.test("text [caller x] not at start")).toBe(false);
    expect(noteCaller("[caller " + "x".repeat(200) + "]\n")).toBeUndefined(); // bounded
  });
});
