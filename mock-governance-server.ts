/**
 * Mock Governance API Server
 *
 * Standalone server that accepts governance check requests and returns
 * approval/denial decisions based on model whitelist and safety rules.
 *
 * Run with: npx ts-node mock-governance-server.ts
 * Then point Blitz at: BLITZ_GOVERNANCE_API=http://localhost:9000/governance/check
 */

import http from "http";

interface GovernanceRequest {
  run_id: string;
  caller: {
    user: string;
    install_type: "global" | "local";
    project_path: string;
  };
  model: string;
  context: {
    messages_count: number;
    tokens_estimated: number;
  };
}

interface GovernanceResponse {
  approved: boolean;
  reason: string;
  threat_category?: string;
}

const ALLOWED_MODELS = new Set([
  "claude-opus-4-1",
  "claude-opus-4-0",
  "claude-opus",
  "claude-3-5-sonnet",
  "claude-3-sonnet",
  "claude-sonnet",
  "gpt-4",
  "gpt-4o",
  "gpt-3.5-turbo",
]);

function checkGovernance(request: GovernanceRequest): GovernanceResponse {
  console.log(`[MockAPI] Checking model: ${request.model} for user: ${request.caller.user}`);

  // Check if model is in whitelist
  const modelBase = request.model.split("/").pop() || request.model;
  const isAllowed = Array.from(ALLOWED_MODELS).some(
    (allowed) => modelBase.includes(allowed) || allowed.includes(modelBase)
  );

  if (!isAllowed) {
    const response: GovernanceResponse = {
      approved: false,
      reason: `Model "${request.model}" is not whitelisted for governance`,
      threat_category: "A03:2021 - Injection",
    };
    console.log(`[MockAPI] DENIED: ${response.reason}`);
    return response;
  }

  // Check for unusual message counts
  if (request.context.messages_count > 1000) {
    const response: GovernanceResponse = {
      approved: false,
      reason: "Excessive message count detected - possible infinite loop",
      threat_category: "A06:2021 - Vulnerable and Outdated Components",
    };
    console.log(`[MockAPI] DENIED: ${response.reason}`);
    return response;
  }

  // Check for suspicious token estimates
  if (request.context.tokens_estimated > 10000000) {
    const response: GovernanceResponse = {
      approved: false,
      reason: "Token estimate exceeds safety threshold",
      threat_category: "A01:2021 - Broken Access Control",
    };
    console.log(`[MockAPI] DENIED: ${response.reason}`);
    return response;
  }

  // Approved
  const response: GovernanceResponse = {
    approved: true,
    reason: `Model "${request.model}" approved for execution by caller ${request.caller.user}`,
  };
  console.log(`[MockAPI] APPROVED: ${response.reason}`);
  return response;
}

const server = http.createServer((req, res) => {
  // Enable CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === "POST" && req.url === "/governance/check") {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      try {
        const request = JSON.parse(body) as GovernanceRequest;
        const decision = checkGovernance(request);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(decision));
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            approved: false,
            reason: `Invalid request: ${error instanceof Error ? error.message : String(error)}`,
          })
        );
      }
    });
  } else {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }
});

const PORT = 9000;
server.listen(PORT, "127.0.0.1", () => {
  console.log(`[MockAPI] Governance API server listening on http://127.0.0.1:${PORT}`);
  console.log(`[MockAPI] Endpoint: POST http://127.0.0.1:${PORT}/governance/check`);
  console.log(
    `[MockAPI] Allowed models: ${Array.from(ALLOWED_MODELS).join(", ")}`
  );
});
