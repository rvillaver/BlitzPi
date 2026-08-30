/** W3: zones resolve Windows paths (drive letters, backslashes, case) when the roots say win32 — testable on Linux. */
import { classifyZone } from "../src/zones";
const roots = { platform: "win32", project: "C:\\Users\\rv\\work\\app", install: "C:\\Users\\rv\\AppData\\Local\\BlitzPi\\versions\\1.2.108", home: "C:\\Users\\rv", scratch: ["C:\\Users\\rv\\AppData\\Local\\Temp"] };
test.each([
  ["src\\index.ts", "project"], ["src/index.ts", "project"], ["C:\\Users\\rv\\work\\app\\README.md", "project"], ["c:\\users\\RV\\Work\\App\\x.txt", "project"],
  [".blitz\\blitz.config.yaml", "project-config"], [".blitz\\goodbehavior\\memory\\x.md", "goodbehavior"], [".pi\\skills\\x\\SKILL.md", "goodbehavior"],
  ["C:\\Users\\rv\\AppData\\Local\\Temp\\out.log", "scratch"], ["~\\.blitz\\audit\\x.jsonl", "global"], ["C:\\Users\\rv\\.blitz\\cache\\bun", "global"],
  ["C:\\Users\\rv\\AppData\\Local\\BlitzPi\\versions\\1.2.108\\src\\index.ts", "install"],
  ["C:\\Windows\\System32\\drivers\\etc\\hosts", "system"], ["c:\\program files\\Git\\bin\\bash.exe", "system"], ["C:\\Program Files (x86)\\x", "system"], ["C:\\ProgramData\\x", "system"],
  ["C:\\Users\\rv\\Documents\\secret.txt", "other"], ["D:\\other\\project\\x", "other"], ["..\\sibling\\x", "other"], ["\\\\.\\nul", "plumbing"],
])("%s → %s", (target, zone) => expect(classifyZone(target, roots)).toBe(zone));
test("posix roots are untouched", () => {
  const r = { project: "/home/u/app", install: "/opt/blitz", home: "/home/u" };
  expect(classifyZone("src/x", r)).toBe("project"); expect(classifyZone("/etc/hosts", r)).toBe("system"); expect(classifyZone("/dev/null", r)).toBe("plumbing"); expect(classifyZone("~/.blitz/x", r)).toBe("global");
});
