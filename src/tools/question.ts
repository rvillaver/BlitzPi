/**
 * `question` — the agent asks the user to pick (or type) an answer. Built on `ctx.ui.select` / `ctx.ui.input`, so
 * it works in the TUI and, over `--mode rpc`, as an `extension_ui_request` a bridge renders as buttons (CHAT-BRIDGE B3).
 * Not `ctx.ui.custom` (TUI-only). In print/json mode there is no one to ask: the tool says so instead of guessing.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const OTHER = "Other — type an answer";

export function setupQuestionTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "question",
    label: "Question",
    description: "Ask the user a question with a short list of options and wait for the pick (or a typed answer). Use when you need a decision to proceed; keep options to 2–5 short labels.",
    parameters: Type.Object({
      question: Type.String({ description: "The question, one sentence" }),
      options: Type.Array(Type.Object({ label: Type.String({ description: "Short option label" }), description: Type.Optional(Type.String()) }), { description: "2–5 options", minItems: 1, maxItems: 8 }),
      allowOther: Type.Optional(Type.Boolean({ description: "Offer a free-text answer (default true)" })),
    }),
    executionMode: "sequential",
    async execute(_id, params, _signal, _update, ctx) {
      if (!ctx.hasUI) return { content: [{ type: "text", text: "No user is available to answer (non-interactive run). Decide yourself and state the assumption." }], details: { question: params.question, answer: null } };
      const labels = params.options.map((o) => (o.description ? `${o.label} — ${o.description}` : o.label));
      const choices = params.allowOther === false ? labels : [...labels, OTHER];
      const picked = await ctx.ui.select(params.question, choices);
      if (picked === undefined) return { content: [{ type: "text", text: "The user dismissed the question without answering." }], details: { question: params.question, answer: null } };
      if (picked === OTHER) {
        const typed = (await ctx.ui.input("Your answer", "")) ?? "";
        return { content: [{ type: "text", text: typed.trim() ? `User answered: ${typed.trim()}` : "The user gave no answer." }], details: { question: params.question, answer: typed.trim() || null, typed: true } };
      }
      const idx = labels.indexOf(picked);
      const label = idx >= 0 ? params.options[idx].label : picked;
      return { content: [{ type: "text", text: `User selected: ${label}` }], details: { question: params.question, answer: label, index: idx + 1 } };
    },
  });
}
