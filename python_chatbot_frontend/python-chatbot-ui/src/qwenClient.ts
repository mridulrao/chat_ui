// ───────────────────────────────────────────────────────────────
// Qwen client — Non-streaming call (mirrors your Python example)
// ───────────────────────────────────────────────────────────────

import type { Msg } from "./history";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";
const API_KEY = import.meta.env.VITE_API_KEY as string | undefined;
const MODEL = (import.meta.env.VITE_MODEL as string | undefined) ?? "Qwen/Qwen3-4B-Instruct-2507";

export interface ChatCompletionOpts {
  model?: string;
  temperature?: number;
  max_tokens?: number;
}

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ChatCompletionResult {
  text: string;
  usage?: Usage;
  latencyMs?: number;
  raw: unknown;
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/$/, "");
  if (/\/v1$/.test(b)) return `${b}/${path}`;
  if (/\/v1\/$/.test(base)) return `${base}${path}`;
  return `${b}/v1/${path}`;
}

export async function chatComplete(
  history: Msg[],
  opts: ChatCompletionOpts = {}
): Promise<ChatCompletionResult> {

  const url = joinUrl(API_BASE, "chat/completions");
  const body = {
    model: opts.model ?? MODEL,
    messages: history.map(({ role, content }) => ({ role, content })),
    stream: false,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.max_tokens ?? 256,
  };

  const t0 = performance.now();
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const t1 = performance.now();

  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`;
    try {
      const err = await resp.json();
      if (err?.error?.message) msg += `: ${err.error.message}`;
      else msg += `: ${JSON.stringify(err)}`;
    } catch {
      msg += `: ${await resp.text().catch(() => "")}`;
    }
    throw new Error(msg);
  }

  const json = await resp.json();
  const text = json?.choices?.[0]?.message?.content ?? "";
  const usage: Usage | undefined = json?.usage
    ? {
        prompt_tokens: json.usage.prompt_tokens,
        completion_tokens: json.usage.completion_tokens,
        total_tokens: json.usage.total_tokens,
      }
    : undefined;

  return { text, usage, latencyMs: t1 - t0, raw: json };
}
