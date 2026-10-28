---
name: tests-that-hardcode-the-host
description: Five of this suite's tests passed only on linux/x64 — each had baked a fact about the developer's machine into an assertion, and all five failed on macOS without a line of product code being wrong
metadata: { type: gotcha }
---
`bun run test` was 480 pass / 5 fail on macOS and green on Linux. **No product defect:** all five
were the harness asserting something true only of its author's host. The three shapes, because each
will recur:

1. **A synthetic path whose ancestors exist.** `zones.test.ts` built fake roots under `/home/u`.
   `classifyZone` canonicalizes, and `/home` is a real symlink to `/System/Volumes/Data/home` on
   macOS, so the path resolved into `/System/...` and matched the `/System` system prefix. Pick a
   root that resolves on **no** platform when the intent is lexical classification.
2. **A GNU flag on a BSD tool.** `script -c CMD FILE` is GNU; BSD takes the command as positional
   words after the file. Separately, BSD `script` calls `tcgetattr` on its own stdin, and a jest
   worker's stdin is a socket, so it fails before running anything — pass `stdio[0]` explicitly
   rather than inheriting.
3. **Mutating a different object than the code reads.** The runtime-store tampering tests set
   `pinnedPythonFor("linux","x64").sha256`, but `store.ts:143` calls `pinnedPythonFor()`, which
   resolves for the host. Same object on linux/x64, a different one anywhere else — so the mutation
   silently missed and the install met the real pin's checksum.

**How to apply:** a test that passes on your machine and fails on another is a claim about the
machine until proven otherwise — diff the two hosts before touching `src/`. When a test needs a
platform-specific fact, derive it (`process.platform`, a lookup with no arguments) rather than
writing the one you are standing on. And when a fix makes a skipped-or-failing test pass, confirm it
now **asserts** rather than skipping: `sandbox-terminal` had a `return null` path that would have
turned every one of these into a silent green.
