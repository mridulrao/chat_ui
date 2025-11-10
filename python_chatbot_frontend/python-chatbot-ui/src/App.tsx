import React, { useEffect, useRef, useState } from "react";
import {
  type Msg,
  addMessage,
  clearHistory,
  getHistory,
  newId,
  subscribe,
} from "./history";
import { chatComplete } from "./qwenClient";

function timeString(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function App() {
  const [messages, setMessages] = useState<Msg[]>(getHistory());
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => subscribe(setMessages), []);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function handleSubmit(raw: string) {
    const content = raw.trim();
    if (!content) return;
    setError(null);

    const userMsg: Msg = { id: newId(), role: "user", content, ts: Date.now() };
    addMessage(userMsg);
    setText("");

    try {
      setLoading(true);
      const result = await chatComplete(getHistory());
      const assistantMsg: Msg = {
        id: newId(),
        role: "assistant",
        content: result.text || "",
        ts: Date.now(),
      };
      addMessage(assistantMsg);
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && text.trim()) {
      e.preventDefault();
      void handleSubmit(text);
    }
  };

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#f9fafb",
        fontFamily:
          "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        color: "#111827",
      }}
    >
      <header
        style={{
          padding: "0.75rem 1rem",
          borderBottom: "1px solid #e5e7eb",
          background: "#ffffff",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>My Qwen Chat</h1>
        <button
          onClick={() => clearHistory()}
          style={{
            padding: "0.4rem 0.7rem",
            borderRadius: 8,
            border: "1px solid #d1d5db",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          Clear
        </button>
      </header>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "1rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
        }}
      >
        {messages.map((m) => {
          const isUser = m.role === "user";
          return (
            <div
              key={m.id}
              style={{
                alignSelf: isUser ? "flex-end" : "flex-start",
                background: isUser ? "#dbeafe" : "#f3f4f6",
                border: "1px solid #e5e7eb",
                padding: "0.75rem 1rem",
                borderRadius: 12,
                maxWidth: "75ch",
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
              }}
            >
              <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>
                {isUser ? "You" : "Assistant"}
              </div>
              <div>{m.content}</div>
              <div
                style={{
                  fontSize: 11,
                  opacity: 0.55,
                  marginTop: 6,
                  textAlign: isUser ? "right" : "left",
                }}
              >
                {timeString(m.ts)}
              </div>
            </div>
          );
        })}

        {loading && (
          <div style={{ alignSelf: "flex-start", fontSize: 13, opacity: 0.65 }}>
            Assistant is typing…
          </div>
        )}

        {error && (
          <div
            style={{
              alignSelf: "stretch",
              background: "#fef2f2",
              color: "#991b1b",
              border: "1px solid #fecaca",
              borderRadius: 8,
              padding: "0.6rem 0.8rem",
            }}
          >
            {error}
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          padding: "0.75rem",
          borderTop: "1px solid #e5e7eb",
          background: "#ffffff",
        }}
      >
        <input
          type="text"
          placeholder="Type a message and press Enter…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          style={{
            flex: 1,
            padding: "0.9rem 1rem",
            borderRadius: 12,
            border: "1px solid #d1d5db",
            fontSize: "1rem",
            outline: "none",
          }}
        />
        <button
          onClick={() => text.trim() && handleSubmit(text)}
          style={{
            padding: "0.9rem 1.1rem",
            borderRadius: 12,
            border: "1px solid #d1d5db",
            background: "#111827",
            color: "white",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
