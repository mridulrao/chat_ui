// utils/persistence.js
// Lightweight persistence and export helpers for ChatCanvas

const STORAGE_KEY = "chatcanvas.state.v1";
const HISTORY_KEY = "chatcanvas.history.v1";
const PENDING_LOAD_KEY = "chatcanvas.pendingLoad.v1";

// Map ChatCanvas senderId -> conventional chat role
const roleFromSender = (senderId) => {
  if (senderId === "local-user") return "user";
  if (senderId === "llm-assistant") return "assistant";
  return "system"; // default/fallback
};

// Derive the root/thread id for a message given the entire message list
const deriveThreadId = (messages, msg) => {
  if (!msg || !messages?.length) return msg?.threadId ?? msg?.id ?? null;
  const byId = new Map(messages.map((m) => [m.id, m]));
  let cur = msg;
  while (cur?.parentId) cur = byId.get(cur.parentId);
  return cur?.id ?? msg.threadId ?? msg.id ?? null;
};

// Create a minimal, LLM-friendly JSON for export
export const buildExportJSON = (messages) => {
  const msgs = Array.isArray(messages) ? messages : [];
  // Ensure every message has a threadId
  const withThread = msgs.map((m) => ({
    ...m,
    threadId: m.threadId ?? deriveThreadId(msgs, m),
  }));

  // Group by threadId (root id)
  const threadsMap = new Map();
  const byId = new Map(withThread.map((m) => [m.id, m]));
  for (const m of withThread) {
    const tId = m.threadId || m.id;
    if (!threadsMap.has(tId)) {
      threadsMap.set(tId, []);
    }
    threadsMap.get(tId).push(m);
  }

  const threads = [];
  for (const [threadId, items] of threadsMap.entries()) {
    // If this is a branch thread (threadId exists as a message id but isn't in the group),
    // inject a copy of the anchor as the root item of this thread for export purposes.
    const group = items.slice();
    if (!group.find((x) => x.id === threadId)) {
      const anchor = byId.get(threadId);
      if (anchor) {
        group.push({
          ...anchor,
          threadId, // ensure it belongs to this thread in the export view
          parentId: null, // root of this thread's view
        });
      }
    }

    const sorted = group.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const root = sorted.find((x) => x.id === threadId) || sorted[0];

    threads.push({
      threadId,
      createdAt: root?.timestamp ?? null,
      title: root?.text?.slice(0, 80) ?? "",
      messages: sorted.map((m) => ({
        id: m.id,
        parentId: m.parentId ?? null,
        threadId: m.threadId ?? threadId,
        role: roleFromSender(m.senderId),
        text: m.text,
        timestamp: m.timestamp,
      })),
    });
  }

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    threads,
  };
};

// Serialize full UI state for localStorage (includes x,y so layout is preserved)
const serializeForStorage = (messages, stageSize) => ({
  version: 1,
  stageSize: stageSize ? { width: stageSize.width, height: stageSize.height } : null,
  messages: (Array.isArray(messages) ? messages : []).map((m) => ({
    id: m.id,
    text: m.text,
    senderId: m.senderId,
    parentId: m.parentId ?? null,
    isThread: !!m.isThread,
    timestamp: m.timestamp,
    threadId: m.threadId ?? null,
    // UI placement (optional)
    x: Number.isFinite(m.x) ? m.x : null,
    y: Number.isFinite(m.y) ? m.y : null,
  })),
});

export const saveState = (messages, stageSize) => {
  try {
    const data = serializeForStorage(messages, stageSize);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn("[persistence] Failed to save state:", e);
  }
};

export const loadState = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    const stageSize = parsed.stageSize && typeof parsed.stageSize === "object"
      ? { width: Number(parsed.stageSize.width) || window.innerWidth, height: Number(parsed.stageSize.height) || window.innerHeight }
      : null;

    // Backfill missing threadId for older saves
    const withThreads = messages.map((m) => ({
      ...m,
      threadId: m.threadId ?? deriveThreadId(messages, m),
    }));

    return { messages: withThreads, stageSize };
  } catch (e) {
    console.warn("[persistence] Failed to load state:", e);
    return null;
  }
};

export const clearState = () => {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
};

// Trigger a browser download of the JSON object
export const triggerDownload = (filename, jsonObj) => {
  try {
    const blob = new Blob([JSON.stringify(jsonObj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch (e) {
    console.warn("[persistence] Failed to trigger download:", e);
  }
};

// --- Multi-conversation history helpers ---
const safeParse = (raw, fallback) => {
  try { return JSON.parse(raw); } catch { return fallback; }
};

export const loadHistory = () => {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const arr = safeParse(raw, []);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.warn('[persistence] Failed to load history:', e);
    return [];
  }
};

export const saveHistory = (items) => {
  try {
    const arr = Array.isArray(items) ? items : [];
    localStorage.setItem(HISTORY_KEY, JSON.stringify(arr));
  } catch (e) {
    console.warn('[persistence] Failed to save history:', e);
  }
};

export const pushHistory = (item) => {
  try {
    const arr = loadHistory();
    arr.unshift(item);
    saveHistory(arr);
  } catch (e) {
    console.warn('[persistence] Failed to push history:', e);
  }
};

export const setPendingLoad = (session) => {
  try {
    localStorage.setItem(PENDING_LOAD_KEY, JSON.stringify(session || null));
  } catch (e) {
    console.warn('[persistence] Failed to set pending load:', e);
  }
};

export const takePendingLoad = () => {
  try {
    const raw = localStorage.getItem(PENDING_LOAD_KEY);
    if (raw == null) return null;
    localStorage.removeItem(PENDING_LOAD_KEY);
    return safeParse(raw, null);
  } catch (e) {
    console.warn('[persistence] Failed to take pending load:', e);
    return null;
  }
};
