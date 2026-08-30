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
      for (const w of ["Hello", " ", "world"]) out({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: w } });
      if (String(cmd.message).includes("ask")) { out({ type: "extension_ui_request", id: "ui-1", method: "select", title: "Pick", options: ["A", "B"] }); continue; }
      if (String(cmd.message).includes("crash")) { process.exit(3); }
      out({ type: "agent_end" }); out({ type: "agent_settled" }); continue;
    }
    if (cmd.type === "steer" || cmd.type === "follow_up") {
      out({ id: cmd.id, type: "response", command: cmd.type, success: true });
      for (const w of ["Hello", " ", "world"]) out({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: w } });
      out({ type: "agent_end" }); out({ type: "agent_settled" }); continue;
    }
    if (cmd.type === "abort") { out({ id: cmd.id, type: "response", command: "abort", success: true }); out({ type: "agent_settled" }); continue; }
    if (cmd.type === "get_last_assistant_text") { out({ id: cmd.id, type: "response", command: cmd.type, success: true, data: { text: "Hello world" } }); continue; }
    out({ id: cmd.id, type: "response", command: cmd.type, success: false, error: `unknown command ${cmd.type}` });
  }
});
process.stdin.on("end", () => process.exit(0));
