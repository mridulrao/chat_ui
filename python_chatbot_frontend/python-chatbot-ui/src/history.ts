// ───────────────────────────────────────────────────────────────
// Centralized message store (no React dependency)
// ───────────────────────────────────────────────────────────────

export type Role = "user" | "assistant";

export interface Msg {
  id: string;       // message_id
  role: Role;
  content: string;
  ts: number;       // timestamp
}

type Listener = (msgs: Msg[]) => void;

let _messages: Msg[] = [];
const _listeners = new Set<Listener>();

export function getHistory(): Msg[] {
  return _messages;
}

export function subscribe(listener: Listener): () => void {
  _listeners.add(listener);
  listener(_messages); // immediately sync
  return () => _listeners.delete(listener);
}

function _emit() {
  for (const l of _listeners) l(_messages);
}

export function addMessage(msg: Msg) {
  _messages = [..._messages, msg];
  _emit();
}

export function clearHistory() {
  _messages = [];
  _emit();
}

export function newId(): string {
  try {
    // @ts-ignore
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {}
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function toOpenAIMessages(msgs: Msg[]): Array<{ role: Role; content: string }> {
  return msgs.map(({ role, content }) => ({ role, content }));
}
