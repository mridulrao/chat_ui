// components/Bubble.jsx
import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function Bubble({ id, placed, x, y, color, children, registerRef, onMouseDown, onClick, onMouseEnter, onMouseLeave, showCopy = false, text }) {
  const [copied, setCopied] = useState(false);

  const rawText = typeof children === "string" ? children : (typeof text === "string" ? text : "");

  const handleCopy = async (e) => {
    e?.stopPropagation?.();
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(rawText || "");
      } else {
        const ta = document.createElement('textarea');
        ta.value = rawText || "";
        ta.style.position = 'fixed';
        ta.style.left = '-1000px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };

  return (
    <div
      key={id}
      ref={registerRef(id)}
      className="group absolute z-20 p-4 rounded-xl shadow-xl cursor-grab active:cursor-grabbing transform transition-transform duration-150 flex flex-col"
      style={{
        left: placed ? x : -10000,
        top: placed ? y : -10000,
        // Layer a translucent white gradient over the base pastel RGBA color for glassmorphism
        background: `linear-gradient(135deg, rgba(255,255,255,0.35), rgba(255,255,255,0.10)), ${color}`,
        color: "#111827", // gray-900
        backdropFilter: "saturate(140%) blur(14px)",
        WebkitBackdropFilter: "saturate(140%) blur(14px)",
        border: "1px solid rgba(255, 255, 255, 0.35)",
        boxShadow: "0 10px 30px rgba(2, 6, 23, 0.15), inset 0 1px 0 rgba(255,255,255,0.15)",
        backgroundClip: "padding-box",
        maxWidth: "20rem",
        minWidth: "10rem",
        overflow: "hidden",
        willChange: "transform, filter",
      }}
      onMouseDown={(e) => placed && onMouseDown?.(e, id)}
      onClick={(e) => onClick?.(e, id, placed)}
      onMouseEnter={(e) => onMouseEnter?.(e, id, placed)}
      onMouseLeave={(e) => onMouseLeave?.(e, id, placed)}
    >
      {showCopy && rawText ? (
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            aria-label="Copy response"
            title={copied ? "Copied" : "Copy"}
            className={`px-2 py-1 text-xs rounded border shadow-sm ${copied ? 'bg-green-100 border-green-300 text-green-800' : 'bg-white/80 hover:bg-white border-gray-300 text-gray-700'}`}
            onClick={handleCopy}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      ) : null}
      <div className="text-sm leading-6 break-words space-y-2">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ inline, className, children: codeChildren, ...props }) {
              const text = String(codeChildren).replace(/\n$/, "");
              if (inline) {
                return (
                  <code
                    className="px-1 py-0.5 rounded bg-black/10 text-[0.85em]"
                    {...props}
                  >
                    {text}
                  </code>
                );
              }
              return (
                <pre className="p-3 rounded bg-gray-900 text-gray-100 overflow-auto text-[0.85em]">
                  <code>{text}</code>
                </pre>
              );
            },
            a({ children: linkChildren, ...props }) {
              return (
                <a className="text-blue-600 underline" target="_blank" rel="noopener noreferrer" {...props}>
                  {linkChildren}
                </a>
              );
            },
            ul({ children: ulChildren, ...props }) {
              return (
                <ul className="list-disc pl-5 space-y-1" {...props}>{ulChildren}</ul>
              );
            },
            ol({ children: olChildren, ...props }) {
              return (
                <ol className="list-decimal pl-5 space-y-1" {...props}>{olChildren}</ol>
              );
            },
            blockquote({ children: bqChildren, ...props }) {
              return (
                <blockquote className="border-l-4 border-gray-300 pl-3 italic text-gray-700" {...props}>
                  {bqChildren}
                </blockquote>
              );
            },
            h1({ children: hChildren }) { return <h1 className="text-lg font-semibold">{hChildren}</h1>; },
            h2({ children: hChildren }) { return <h2 className="text-base font-semibold">{hChildren}</h2>; },
            h3({ children: hChildren }) { return <h3 className="text-base font-medium">{hChildren}</h3>; },
            p({ children: pChildren }) { return <p className="">{pChildren}</p>; },
          }}
        >
          {rawText}
        </ReactMarkdown>
      </div>
    </div>
  );
}