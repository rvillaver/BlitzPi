/** A scripted `pi --mode rpc` stand-in for RpcHost tests: strict JSONL in/out. */
let buf = "";
const out = (o: unknown) => process.stdout.write(JSON.stringify(o) + "\n");
process.stdin.on("data", (d) => {
  buf += d.toString();
  let i: number;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const cmd = JSON.parse(line);
    if (cmd.type === "get_state") { out({ id: cmd.id, type: "response", command: "get_state", success: true, data: { sessionId: "fake-session", isStreaming: false } }); continue; }
    if (cmd.type === "extension_ui_response") { out({ type: "tool_execution_end", toolName: "question", result: { content: [{ type: "text", text: `User selected: ${cmd.value ?? cmd.confirmed ?? "cancelled"}` }] } }); out({ type: "agent_end" }); out({ type: "agent_settled" }); continue; }
    if (cmd.type === "prompt") {
      if (String(cmd.message).includes("ghost")) { out({ id: cmd.id, type: "response", command: "prompt", success: false, error: "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message." }); continue; }
      out({ id: cmd.id, type: "response", command: "prompt", success: true });
      out({ type: "agent_start" });
      if (String(cmd.message).includes("think")) { out({ type: "message_update", assistantMessageEvent: { type: "thinking_start" } }); out({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "pondering deeply" } }); out({ type: "message_update", assistantMessageEvent: { type: "thinking_end" } }); }
      if (String(cmd.message).includes("compact")) { out({ type: "compaction_start", reason: "threshold" }); out({ type: "compaction_end", reason: "threshold", aborted: false }); }
      for (const w of ["Hello", " ", "world"]) out({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: w } });
      if (String(cmd.message).includes("ask")) { out({ type: "extension_ui_request", id: "ui-1", method: "select", title: "Pick", options: ["A", "B"] }); continue; }
      if (String(cmd.message).includes("crash")) { process.exit(3); }
      if (String(cmd.message).includes("flaky")) { out({ type: "agent_end", messages: [{ role: "assistant", stopReason: "error", errorMessage: "429 rate_limit_error: free tier is shedding traffic, please retry" }] }); out({ type: "agent_settled" }); continue; }
      if (String(cmd.message).includes("llmfail")) { out({ type: "agent_end", messages: [{ role: "assistant", stopReason: "error", errorMessage: "401 authentication_error" }] }); out({ type: "agent_settled" }); continue; }
      out({ type: "agent_end" }); out({ type: "agent_settled" }); continue;
    }
    if (cmd.type === "steer" || cmd.type === "follow_up") {
      out({ id: cmd.id, type: "response", command: cmd.type, success: true });
      for (const w of ["Hello", " ", "world"]) out({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: w } });
      out({ type: "agent_end" }); out({ type: "agent_settled" }); continue;
    }
    if (cmd.type === "set_model") { out({ id: cmd.id, type: "response", command: "set_model", success: true, data: { provider: cmd.provider, id: cmd.modelId } }); continue; }
    if (cmd.type === "get_available_models") { out({ id: cmd.id, type: "response", command: "get_available_models", success: true, data: { models: [{ provider: "fake", id: "model-1" }] } }); continue; }
    if (cmd.type === "abort") { out({ id: cmd.id, type: "response", command: "abort", success: true }); out({ type: "agent_settled" }); continue; }
    if (cmd.type === "get_last_assistant_text") { out({ id: cmd.id, type: "response", command: cmd.type, success: true, data: { text: "Hello world" } }); continue; }
    out({ id: cmd.id, type: "response", command: cmd.type, success: false, error: `unknown command ${cmd.type}` });
  }
});
process.stdin.on("end", () => process.exit(0));
