/**
 * Blitz Pi — Access Profiles Live Test
 * Directly exercises the ProfileMatcher checkpoint against denied tool calls
 */

import path from "path";
import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";

// Import the setupAccessProfiles function to test the checkpoint directly
import { setupAccessProfiles } from "../src/access-profiles";
import type { AuditLogger } from "../src/audit";
import { setupAudit } from "../src/audit";
import { loadConfig } from "../src/config";

describe("Blitz Pi - Access Profiles Live Test", () => {
  let auditLogger: AuditLogger;
  let config: any;
  let piMock: any;
  let capturedDecisions: any[] = [];

  beforeEach(() => {
    // Setup
    const auditPath = path.join(process.cwd(), ".blitz/audit");

    // Load config and override to use strict profile for testing
    config = loadConfig();
    config.profiles.default = "strict";

    // Create a mock audit logger
    const auditEntries: any[] = [];
    auditLogger = {
      log: (entry: any) => {
        auditEntries.push(entry);
      },
      getPath: () => auditPath,
      close: async () => {},
      // Add a helper for tests to access entries
      getEntries: () => auditEntries,
    } as any;

    // Mock Pi extension API with event handler capture
    let toolCallHandler: ((event: any) => any) | null = null;

    piMock = {
      on: (eventName: string, handler: any) => {
        if (eventName === "tool_call") {
          toolCallHandler = handler;
        }
      },
      triggerToolCall: async (toolName: string, input: any) => {
        if (toolCallHandler) {
          const result = await toolCallHandler({
            toolName,
            input,
            toolCallId: `call-${Date.now()}`,
          });
          // Result might be undefined (allowed) or {block: true, reason: string} (denied)
          if (result === undefined) {
            capturedDecisions.push({
              blocked: false,
              reason: "allowed",
              toolName,
            });
          } else if (result && result.block) {
            capturedDecisions.push({
              blocked: true,
              reason: result.reason,
              toolName,
            });
          }
        }
      },
    };

    capturedDecisions = [];
  });

  test("should block bash tool when denied in strict profile", async () => {
    // Setup the checkpoint
    setupAccessProfiles(piMock, config, auditLogger);

    // Trigger a bash tool call
    await piMock.triggerToolCall("bash", { command: "echo test" });

    // Verify it was blocked
    expect(capturedDecisions.length).toBeGreaterThan(0);
    expect(capturedDecisions[0].blocked).toBe(true);
    expect(capturedDecisions[0].reason).toContain("denied");
    expect(capturedDecisions[0].toolName).toBe("bash");
  });

  test("should allow read tool for ./src/** path", async () => {
    // Setup the checkpoint
    setupAccessProfiles(piMock, config, auditLogger);

    // Trigger a read tool call within allowed path
    await piMock.triggerToolCall("read", { path: "./src/index.ts" });

    // Verify it was allowed (no block result captured, or result is empty)
    const blockedDecisions = capturedDecisions.filter((d) => d.blocked);
    expect(blockedDecisions.length).toBe(0);
  });


  test("should allow write tool for ./runs/** path", async () => {
    // Setup the checkpoint
    setupAccessProfiles(piMock, config, auditLogger);

    // Trigger a write tool call within allowed path
    await piMock.triggerToolCall("write", { path: "./runs/test.txt", content: "test" });

    // Verify it was allowed
    const blockedDecisions = capturedDecisions.filter((d) => d.blocked);
    expect(blockedDecisions.length).toBe(0);
  });


  test("audit logger should record denial", async () => {
    // Setup the checkpoint
    setupAccessProfiles(piMock, config, auditLogger);

    // Trigger a bash tool call
    await piMock.triggerToolCall("bash", { command: "echo test" });

    // Verify audit entry was recorded
    const auditEntries = (auditLogger as any).getEntries();
    expect(auditEntries.length).toBeGreaterThan(0);

    const blockEntry = auditEntries.find(
      (e: any) => e.type === "access_profile_check" && e.tool === "bash"
    );
    expect(blockEntry).toBeDefined();
    expect(blockEntry.allowed).toBe(false);
    expect(blockEntry.reason).toContain("denied");
  });

  test("access profiles govern tools, not paths (paths are the permission gate's job)", async () => {
    setupAccessProfiles(piMock, config, auditLogger);
    // strict profile denies bash at the tool level
    await piMock.triggerToolCall("bash", { command: "ls" });
    const bashDecision = capturedDecisions.find((d) => d.toolName === "bash");
    expect(bashDecision?.blocked).toBe(true);
  });

});
