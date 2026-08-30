/** Platform-neutral bridge contracts (CHAT-BRIDGE "ChatAdapter — the seam"). Adapters translate; the core never imports a platform SDK. */
import type { UiRequest, UiResponse } from "./rpc-host";

export interface ConvRef { platform: string; id: string }
export interface ThreadRef extends ConvRef { conv: ConvRef }
export interface UserRef { id: string; name?: string }
export interface Attachment { name: string; url: string; bytes?: number }
export interface Message { id: string; author: UserRef; text: string; time: number; attachments?: Attachment[] }
/** `message` = a plain message in a bound conversation — only a trigger under `trigger: all`. */
export type TriggerKind = "mention" | "reply" | "thread" | "command" | "message";
export interface Trigger { kind: TriggerKind; conv: ConvRef; thread?: ThreadRef; message: Message; text: string }

export interface AdapterCapabilities {
  threads: boolean; buttons: number; selectMenu: number; modal: boolean;
  messageChars: number; paceWindowMs: number; attachmentBytes: number; seesAllMessages: boolean;
}
export interface ChatAdapter {
  readonly platform: string;
  readonly capabilities: AdapterCapabilities;
  start(): Promise<void>;
  stop(): Promise<void>;
  onTrigger(cb: (t: Trigger) => void): void;
  /** Open the run thread off the triggering message; adapters without threads return the conversation itself. */
  openThread(conv: ConvRef, seed: Message, name: string): Promise<ThreadRef | ConvRef>;
  post(target: ConvRef | ThreadRef, text: string): Promise<void>;
  /** Render a dialog request (select/confirm/input/editor) and resolve with the answer of a user `canAnswer` accepts. */
  ask(target: ConvRef | ThreadRef, req: UiRequest, canAnswer: (u: UserRef) => boolean): Promise<UiResponse | undefined>;
  /** The last `n` messages in the conversation after `sinceId` (for the context window); [] where not permitted. */
  recent(conv: ConvRef, n: number, sinceId?: string): Promise<Message[]>;
  identity(u: UserRef): string;
  /** Fetch an attachment to a local path (size-capped by the adapter). Optional. */
  download?(file: Attachment, to: string): Promise<string>;
  /** Post local files (with an optional caption) into a conversation or thread. Optional. */
  postFiles?(target: ConvRef | ThreadRef, files: { path: string; name: string }[], text?: string): Promise<void>;
  /** Resolve a human channel name (`#general`) to a conversation; create it when `create` and permitted. Optional. */
  resolveConversation?(name: string, create: boolean): Promise<{ conv: ConvRef; created: boolean; owner?: UserRef } | undefined>;
}

export type TriggerMode = "mentions" | "all" | "operators";
export type ActivityLevel = "full" | "tools" | "quiet";
export interface Binding {
  project: string; sessionId?: string; name?: string;
  trigger: TriggerMode; activity: ActivityLevel; operators: string[]; context_window: number; announce_done: boolean;
}
export const convKey = (c: ConvRef) => `${c.platform}:${c.id}`;
export const defaultBinding = (project: string, partial: Partial<Binding> = {}): Binding => ({ project, trigger: "mentions", activity: "full", operators: [], context_window: 5, announce_done: true, ...partial });
