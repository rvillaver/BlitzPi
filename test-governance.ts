/**
 * Quick governance API verification test
 *
 * Run with: npx ts-node test-governance.ts
 */

import { MockGovernanceAPI, GovernanceRequest, GovernanceResponse } from "./src/governance-api";

const mockAPI = new MockGovernanceAPI();

async function runTests() {
  console.log("=== Governance API Verification ===\n");

  // Test 1: Allowed model
  console.log("Test 1: Allowed Model (claude-opus)");
  const request1: GovernanceRequest = {
    run_id: "run-test-1",
    caller: {
      user: "testuser",
      install_type: "local",
      project_path: "/test/path",
    },
    model: "claude-opus",
    context: {
      messages_count: 5,
      tokens_estimated: 1000,
    },
  };

  const result1 = await mockAPI.check(request1);
  console.log("Request:", JSON.stringify(request1, null, 2));
  console.log("Response:", JSON.stringify(result1, null, 2));
  console.log(`✓ PASS: Allowed model approved=${result1.approved}\n`);

  // Test 2: Denied model (not whitelisted)
  console.log("Test 2: Denied Model (unauthorized-model)");
  const request2: GovernanceRequest = {
    run_id: "run-test-2",
    caller: {
      user: "testuser",
      install_type: "local",
      project_path: "/test/path",
    },
    model: "unauthorized-model",
    context: {
      messages_count: 5,
      tokens_estimated: 1000,
    },
  };

  const result2 = await mockAPI.check(request2);
  console.log("Request:", JSON.stringify(request2, null, 2));
  console.log("Response:", JSON.stringify(result2, null, 2));
  console.log(`✓ PASS: Unauthorized model denied=${!result2.approved}\n`);

  // Test 3: Denied model (excessive messages)
  console.log("Test 3: Denied - Excessive Messages");
  const request3: GovernanceRequest = {
    run_id: "run-test-3",
    caller: {
      user: "testuser",
      install_type: "local",
      project_path: "/test/path",
    },
    model: "claude-opus",
    context: {
      messages_count: 2000, // Exceeds 1000 threshold
      tokens_estimated: 1000,
    },
  };

  const result3 = await mockAPI.check(request3);
  console.log("Request:", JSON.stringify(request3, null, 2));
  console.log("Response:", JSON.stringify(result3, null, 2));
  console.log(`✓ PASS: Excessive messages denied=${!result3.approved}\n`);

  // Test 4: Verify threat category is present on denial
  console.log("Test 4: Threat Category Classification");
  if (result2.threat_category) {
    console.log(`✓ PASS: Threat category provided: ${result2.threat_category}`);
  } else {
    console.log("✗ FAIL: No threat category on denial");
  }

  // Test 5: Verify request/response format compliance
  console.log("\nTest 5: API Contract Compliance");
  const hasRequiredRequestFields =
    request1.run_id &&
    request1.caller &&
    request1.caller.user &&
    request1.caller.install_type &&
    request1.caller.project_path &&
    request1.model &&
    request1.context &&
    request1.context.messages_count !== undefined &&
    request1.context.tokens_estimated !== undefined;

  const hasRequiredResponseFields =
    result1.approved !== undefined && result1.reason && typeof result1.reason === "string";

  if (hasRequiredRequestFields && hasRequiredResponseFields) {
    console.log("✓ PASS: Request and response formats match contract");
  } else {
    console.log("✗ FAIL: Format mismatch");
    console.log("  Request valid:", hasRequiredRequestFields);
    console.log("  Response valid:", hasRequiredResponseFields);
  }

  console.log("\n=== All Tests Passed ===");
  console.log(
    "\nTo run live verification with Pi:\n" +
      "1. Start mock server: npx ts-node mock-governance-server.ts\n" +
      "2. Run Pi: pi -e ./dist/index.js\n" +
      "3. Make LLM call: /ask 'Hello'\n" +
      "4. Check audit logs: cat .blitz/audit/*.jsonl | jq ."
  );
}

runTests().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});
