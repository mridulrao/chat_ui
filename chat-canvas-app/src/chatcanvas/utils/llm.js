// utils/llm.js
// Centralized LLM client with a proxy-friendly design.
// IMPORTANT: Do not put API keys in the frontend. Instead, set VITE_LLM_PROXY_URL
// to your backend endpoint that calls the provider (OpenAI, Anthropic, etc.).

import { buildExportJSON } from "./persistence";

const sortByTime = (a, b) => new Date(a.timestamp) - new Date(b.timestamp);

const toChatRole = (senderId) => {
  if (senderId === "local-user") return "user";
  if (senderId === "llm-assistant") return "assistant";
  return "system";
};

// Build the ancestry chain from root -> target bubble (inclusive)
// This ensures:
// - If replying on main tail: includes all main-chain history
// - If replying on an intermediary bubble: includes only messages up to that bubble
const buildAncestryChain = (allMessages, targetId) => {
  const byId = new Map((allMessages || []).map((m) => [m.id, m]));
  let cur = byId.get(targetId);
  const chain = [];
  // Walk upwards via parentId pointers
  while (cur) {
    chain.push(cur);
    if (!cur.parentId) break;
    cur = byId.get(cur.parentId);
    if (!cur) break;
  }
  // Now chain is [target, ..., root]; reverse to [root ... target]
  chain.reverse();
  return chain;
};

// Build a context chain for the LLM request.
// Rules:
// - Anchor context to the "targetId" (the message being replied to).
// - Include ancestry root->target for the exact path being replied to (so side-threads only see their own branch).
// - Include ONLY main-chain (non-thread) history of the root UP TO AND INCLUDING the anchor timestamp.
//   This ensures new side-threads get context only up to the branching point.
const buildContextChain = (allMessages, targetId) => {
  const ancestry = buildAncestryChain(allMessages, targetId);
  if (!ancestry.length) return [];

  const rootThreadId = ancestry[0]?.threadId ?? ancestry[0]?.id ?? null;
  const target = ancestry[ancestry.length - 1];

  // Detect if target path is inside a side-thread
  const iFirstThread = ancestry.findIndex((m) => !!m.isThread);

  let cutoffTs;
  let ancestryForContext;
  if (iFirstThread === -1) {
    // On main chain: allow all main messages up to target timestamp
    cutoffTs = new Date(target.timestamp || 0).getTime();
    ancestryForContext = ancestry;
  } else {
    // In a side thread: freeze main history at the branch anchor
    const anchor = ancestry[Math.max(iFirstThread - 1, 0)] || ancestry[0];
    cutoffTs = new Date(anchor.timestamp || 0).getTime();
    // Include anchor + the thread portion of ancestry
    ancestryForContext = [anchor, ...ancestry.slice(iFirstThread)];
  }

  // All non-thread messages for this root, sorted
  const mainHistory = (allMessages || [])
    .filter((m) => m.threadId === rootThreadId && !m.isThread)
    .sort(sortByTime);

  // Restrict main-chain context to messages at or before the cutoff
  const mainUpTo = mainHistory.filter((m) => new Date(m.timestamp || 0).getTime() <= cutoffTs);

  // Merge and dedupe by id, then sort by time
  const byId = new Map();
  for (const m of mainUpTo) byId.set(m.id, m);
  for (const m of ancestryForContext) byId.set(m.id, m);
  const combined = Array.from(byId.values()).sort(sortByTime);
  return combined;
};

// Build a minimal chat array for LLMs
const toChatMessages = (threadMessages) => {
  return threadMessages.map((m) => ({ role: toChatRole(m.senderId), content: m.text || "" }));
};

export async function generateLLMReply({ allMessages, parentId, replyToId, userText, model, branching }) {
  try {
    const anchorId = replyToId ?? parentId;
    const chain = buildContextChain(allMessages || [], anchorId);
    const reqThreadId = branching === true
      ? (anchorId || null)
      : (chain[0]?.threadId ?? chain[0]?.id ?? anchorId ?? null);
    const augmented = [
      ...chain,
      {
        // ephemeral synthetic user turn for the request body
        id: parentId,
        parentId: chain.length ? chain[chain.length - 1]?.id ?? null : null,
        threadId: reqThreadId,
        text: userText || "",
        senderId: "local-user",
        timestamp: new Date().toISOString(),
      },
    ];

    const chat = toChatMessages(augmented);
    const threadId = reqThreadId;

    const proxyUrl = import.meta.env.VITE_LLM_PROXY_URL;
    const chosenModel = model || import.meta.env.VITE_LLM_MODEL || "gpt40"; // server maps to gpt-4o-mini

    if (proxyUrl) {
      const res = await fetch(proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          model: chosenModel,
          messages: chat,
          // Also include a structured export for advanced servers that want full metadata
          export: buildExportJSON(allMessages || []),
        }),
      });
      if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
      const data = await res.json();
      // Expecting { text: string } from proxy
      return (data && (data.text || data.reply || data.output)) || "";
    }

    // Fallback: Simulated reply if no proxy is configured
    const lastUser = [...augmented].reverse().find((m) => toChatRole(m.senderId) === "user");
    const echo = lastUser?.content || lastUser?.text || userText || "";
    const promptSnippet = (echo || "").slice(0, 120);
    return `Simulated reply (set VITE_LLM_PROXY_URL to enable real LLM): ${promptSnippet ? `You said: "${promptSnippet}"` : "Hello!"}`;
  } catch (e) {
    console.warn("[llm] generateLLMReply failed:", e);
    return "(LLM error)";
  }
}

// Streaming version using the backend SSE endpoint
export async function generateLLMReplyStream({
  allMessages,
  parentId,
  replyToId,
  userText,
  model,
  onToken,
  onDone,
  onError,
  branching,
}) {
  try {
    const anchorId = replyToId ?? parentId;
    const chain = buildContextChain(allMessages || [], anchorId, { includeAnchor: branching !== true });
    const reqThreadId = branching === true
      ? (parentId || anchorId || null)
      : (chain[0]?.threadId ?? chain[0]?.id ?? anchorId ?? null);
    const augmented = [
      ...chain,
      {
        id: parentId,
        parentId: chain.length ? chain[chain.length - 1]?.id ?? null : null,
        threadId: reqThreadId,
        text: userText || "",
        senderId: "local-user",
        timestamp: new Date().toISOString(),
      },
    ];

    const chat = toChatMessages(augmented);
    const chosenModel = model || import.meta.env.VITE_LLM_MODEL || "gpt40-mini";
    const threadId = reqThreadId;

    // Prefer proxy path; vite proxy maps /api -> server in dev
    const url = import.meta.env.VITE_LLM_PROXY_URL || "/api/chat/stream";

    console.log("[llm] sending chat messages:", chat);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId, model: chosenModel, messages: chat }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`Bad response: ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const flush = () => {
      const parts = buffer.split(/\n\n/);
      // Keep last partial in buffer
      buffer = parts.pop() || "";
      for (const chunk of parts) {
        const lines = chunk.split(/\n/).map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try {
            const evt = JSON.parse(payload);
            if (evt.type === "token" && typeof evt.content === "string") {
              onToken?.(evt.content);
            } else if (evt.type === "done") {
              onDone?.();
            } else if (evt.type === "error") {
              onError?.(new Error(evt.message || "Streaming error"));
            }
          } catch (e) {
            // Non-JSON line; ignore
          }
        }
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      flush();
    }
    // flush any trailing
    flush();
    onDone?.();
  } catch (e) {
    console.warn("[llm] stream failed:", e);
    onError?.(e);
    // Fallback: simulate streaming if server unavailable
    try {
      const text = await generateLLMReply({ allMessages, parentId, replyToId, userText, model, branching });
      for (const ch of text) {
        onToken?.(ch);
        await new Promise((r) => setTimeout(r, 4));
      }
      onDone?.();
    } catch {}
  }
}
