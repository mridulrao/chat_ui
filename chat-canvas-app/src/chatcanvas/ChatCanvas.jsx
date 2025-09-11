// ChatCanvas.jsx
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { GRID, GAP, EDGE_PADDING, sideGapCells } from "./constants";
import { clamp, snap } from "./utils/grid";
import { getRootIdOf, getTailIdForRoot } from "./utils/thread";
import useBubbleMeasurements from "./hooks/useBubbleMeasurements";
import {
  buildOccupancy,
  findSlotBelow,
  findSlotBelowAtCenter,
  findSlotBelowAtX,
  choosePlacement
} from "./layout/placement";
import { resolveOverlaps as resolveOverlapsFn } from "./layout/resolveOverlaps";
import Bubble from "./components/Bubble";
import LinesSVG from "./components/LinesSVG";

import { loadState, saveState, clearState as clearSavedState } from "./utils/persistence";
import { generateLLMReplyStream } from "./utils/llm";

export default function ChatCanvas() {
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [stageSize, setStageSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const stageSizeRef = useRef(stageSize);

  const [messages, setMessages] = useState([]);
  const messagesRef = useRef([]);
  const [lines, setLines] = useState([]);

  const [isDragging, setIsDragging] = useState(false);
  const [draggedMessageId, setDraggedMessageId] = useState(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragStartRef = useRef({ id: null, startX: 0, startY: 0, offsetX: 0, offsetY: 0 });

  const [activeThreadId, setActiveThreadId] = useState(null);
  const [replyAnchor, setReplyAnchor] = useState(null);
  const [threadInputText, setThreadInputText] = useState("");
  const [newChatInput, setNewChatInput] = useState("");
  const replyInputRef = useRef(null);

  // Hover-only preview of the reply box (non-focused)
  const [hoverThreadId, setHoverThreadId] = useState(null);
  const [hoverReplyAnchor, setHoverReplyAnchor] = useState(null);
  const hoverClearTimeoutRef = useRef(null);

  const outerRef = useRef(null);
  const canvasRef = useRef(null);

  const { bubbleSizes, bubbleSizesRef, messageRefs, registerBubbleRef, cleanupObservers } =
    useBubbleMeasurements();
  const lastAddedIdRef = useRef(null);

  // Keep main-thread vertical position pinned (rootId -> centerX)
  const rootCentersRef = useRef(new Map());
  // Deterministic main-chain tail (rootId -> last main messageId)
  const mainTailByRootRef = useRef(new Map());

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { stageSizeRef.current = stageSize; }, [stageSize]);

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Load persisted state on mount
  useEffect(() => {
    const loaded = loadState?.();
    if (loaded?.messages) setMessages(loaded.messages);
    if (loaded?.stageSize) setStageSize(loaded.stageSize);
  }, []);

  const clampYNoBottom = (y) => snap(Math.max(EDGE_PADDING, y));
  const ensureHeightForRect = (y, h) => {
    const needed = Math.ceil(y + h + EDGE_PADDING);
    setStageSize((prev) =>
      needed > prev.height ? { ...prev, height: Math.max(needed, viewport.h) } : prev
    );
  };
  const ensureWidthForRect = (x, w) => {
    const needed = Math.ceil(x + w + EDGE_PADDING);
    setStageSize((prev) =>
      needed > prev.width ? { ...prev, width: Math.max(needed, viewport.w) } : prev
    );
  };

  const getRectFor = (m) => {
    const el = messageRefs.current[m.id];
    const size = bubbleSizesRef.current[m.id];
    const w = size?.w ?? el?.offsetWidth ?? 300;
    const h = size?.h ?? el?.offsetHeight ?? 100;
    if (el && canvasRef.current) {
      const mrect = el.getBoundingClientRect();
      const crect = canvasRef.current.getBoundingClientRect();
      return {
        x: (m.x ?? (mrect.left - crect.left)),
        y: (m.y ?? (mrect.top - crect.top)),
        w, h
      };
    }
    return { x: m.x ?? 0, y: m.y ?? 0, w, h };
  };
  const getRectById = (id) => {
    const msg = messagesRef.current.find((m) => m.id === id);
    return msg ? getRectFor(msg) : null;
  };

  // connector lines
  const drawLines = () => {
    if (!canvasRef.current) return;
    const stageRect = canvasRef.current.getBoundingClientRect();
    const newLines = [];
    messages.forEach((m) => {
      if (m.x == null || m.y == null) return;
      const p = messages.find((x) => x.id === m.parentId);
      if (!p || p.x == null || p.y == null) return;
      const me = messageRefs.current[m.id];
      const pe = messageRefs.current[p.id];
      if (!me || !pe) return;
      const mr = me.getBoundingClientRect();
      const pr = pe.getBoundingClientRect();
      const sx = pr.left + pr.width / 2 - stageRect.left;
      const sy = pr.top + pr.height / 2 - stageRect.top;
      const ex = mr.left + mr.width / 2 - stageRect.left;
      const ey = mr.top + mr.height / 2 - stageRect.top;
      const dx = ex - sx;
      const sign = dx >= 0 ? 1 : -1;
      const curvature = Math.min(300, Math.max(80, Math.abs(dx) * 0.35));
      const cp1x = sx + sign * curvature;
      const cp2x = ex - sign * curvature;
      const d = `M ${sx},${sy} C ${cp1x},${sy} ${cp2x},${ey} ${ex},${ey}`;
      newLines.push({ id: `line-${p.id}-${m.id}`, d });
    });
    setLines(newLines);
  };
  useEffect(() => {
    const id = requestAnimationFrame(() => drawLines());
    return () => cancelAnimationFrame(id);
  }, [messages, isDragging, bubbleSizes]);

  const updateStageSize = () => {
    let maxX = viewport.w, maxY = viewport.h;
    messagesRef.current.forEach((m) => {
      if (m.x == null || m.y == null) return;
      const { w, h } = getRectFor(m);
      maxX = Math.max(maxX, m.x + w + GAP * 2);
      maxY = Math.max(maxY, m.y + h + GAP * 2);
    });
    setStageSize({
      width: Math.ceil(Math.max(maxX, viewport.w)),
      height: Math.ceil(Math.max(maxY, viewport.h))
    });
  };
  useEffect(() => {
    const id = requestAnimationFrame(() => { updateStageSize(); drawLines(); });
    return () => cancelAnimationFrame(id);
  }, [messages, viewport, bubbleSizes]);

  // Persist messages and layout
  useEffect(() => {
    saveState?.(messages, stageSize);
  }, [messages, stageSize]);

  // auto-scroll to last added
  useEffect(() => {
    const targetId = lastAddedIdRef.current;
    if (!targetId) return;
    const t = setTimeout(() => {
      const container = outerRef.current;
      if (!container) return;

      const msg = messagesRef.current.find((m) => m.id === targetId);
      if (!msg) return;

      // Wait until placement has happened to avoid computing a bogus rect (off-screen -10000, -10000)
      if (msg.x == null || msg.y == null) return;

      const size = bubbleSizesRef.current[targetId] || { w: 300, h: 100 };
      const rect = { x: msg.x, y: msg.y, w: size.w, h: size.h };

      scrollRectIntoView(rect);
      // Clear only after a successful scroll to avoid premature resets that cause jumps
      lastAddedIdRef.current = null;
    }, 0);
    return () => clearTimeout(t);
  }, [messages, stageSize]);

  const scrollRectIntoView = (rect) => {
    if (!outerRef.current || !canvasRef.current) return;
    const container = outerRef.current;

    // Vertical
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;
    const wantTop = rect.y - EDGE_PADDING;
    const wantBottom = rect.y + rect.h + EDGE_PADDING;
    let nextTop = viewTop;
    if (wantBottom > viewBottom) nextTop = wantBottom - container.clientHeight;
    else if (wantTop < viewTop) nextTop = wantTop;
    const maxTop = Math.max(0, canvasRef.current.scrollHeight - container.clientHeight);
    nextTop = Math.max(0, Math.min(nextTop, maxTop));

    // Horizontal
    const viewLeft = container.scrollLeft;
    const viewRight = viewLeft + container.clientWidth;
    const wantLeft = rect.x - EDGE_PADDING;
    const wantRight = rect.x + rect.w + EDGE_PADDING;
    let nextLeft = viewLeft;
    if (wantRight > viewRight) nextLeft = wantRight - container.clientWidth;
    else if (wantLeft < viewLeft) nextLeft = wantLeft;
    const maxLeft = Math.max(0, canvasRef.current.scrollWidth - container.clientWidth);
    nextLeft = Math.max(0, Math.min(nextLeft, maxLeft));

    container.scrollTo({ top: nextTop, left: nextLeft, behavior: "smooth" });
  };

  // placement
  useLayoutEffect(() => {
    const sizes = bubbleSizesRef.current;
    const cur = messagesRef.current;
    let changed = false;
    const next = cur.map((m) => ({ ...m }));
    
    // Helper: get up-to-date rect for a message id. Prefer 'next' (in-pass positions) over stale refs.
    const getPlacedRectById = (id) => {
      const candidate = next.find((x) => x.id === id);
      if (candidate && candidate.x != null && candidate.y != null) {
        const size = sizes[id] || { w: 300, h: 100 };
        return { x: candidate.x, y: candidate.y, w: size.w, h: size.h };
      }
      return getRectById(id);
    };

    // Simple pixel-overlap checker
    const rectsOverlapPx = (a, b) => !(
      a.x + a.w <= b.x ||
      b.x + b.w <= a.x ||
      a.y + a.h <= b.y ||
      b.y + b.h <= a.y
    );

    // Build placed rects using in-pass 'next' so far (excluding a given id)
    const buildPlacedRectsExcluding = (excludeId) => {
      const list = [];
      for (const m of next) {
        if (m.id === excludeId) continue;
        if (m.x == null || m.y == null) continue;
        const sz = sizes[m.id] || { w: 300, h: 100 };
        list.push({ id: m.id, x: m.x, y: m.y, w: sz.w, h: sz.h });
      }
      return list;
    };

    // Stack directly below a parent at fixed x, avoiding overlaps against placed rects
    const stackBelowAtX = (targetLeftX, parentRect, sizeWH, excludeId) => {
      let y = snap(parentRect.y + parentRect.h + GAP);
      const placed = buildPlacedRectsExcluding(excludeId);
      const candidate = { x: snap(targetLeftX), y, w: sizeWH.w, h: sizeWH.h };
      let changed = true;
      let guard = 0;
      while (changed && guard++ < 200) {
        changed = false;
        for (const r of placed) {
          if (rectsOverlapPx(candidate, r)) {
            candidate.y = snap(r.y + r.h + GAP);
            changed = true;
          }
        }
      }
      return { x: candidate.x, y: candidate.y };
    };

    // Use a local copy of main tails to avoid mutating during a single pass (StrictMode safe)
    const localMainTail = new Map(mainTailByRootRef.current);

    for (let i = 0; i < next.length; i++) {
      const m = next[i];
      if (m.x != null && m.y != null) continue;
      console.log(`[ChatCanvas] Placing message ${m.id} (parentId: ${m.parentId})`);
      const size = sizes[m.id];
      if (!size) continue;

      if (m.parentId) {
        const pr = getPlacedRectById(m.parentId);
        if (!pr || messagesRef.current.find((x) => x.id === m.parentId)?.x == null) continue;

        console.log(`[ChatCanvas] Placing CHILD message ${m.id}`);
        const isUserMsg = m.senderId === "local-user";
        const rootId = getRootIdOf(messagesRef, m.parentId);
        const isThread = !!m.isThread;

        let pos;

        if (isThread) {
          console.log(`[ChatCanvas] -> Thread message ${m.id}`);
          // THREAD LOGIC
          const parentMsg = messagesRef.current.find((x) => x.id === m.parentId);
          const parentIsThread = !!parentMsg?.isThread;
          if (isUserMsg) {
            if (parentIsThread) {
              // continuation inside an existing thread → stack below at same x (pixel-based)
              pos = stackBelowAtX(pr.x, pr, { w: size.w, h: size.h }, m.id);
            } else {
              // user starts a new thread off main: choose left/right on parent's row (balanced)
              const parentCenterX = pr.x + pr.w / 2;
              const siblings = messagesRef.current.filter(
                (x) => x.parentId === m.parentId && x.x != null && x.y != null && x.id !== m.id
              );
              let leftCount = 0, rightCount = 0;
              for (const s of siblings) {
                const sr = getRectFor(s);
                const sc = sr.x + sr.w / 2;
                if (sc < parentCenterX) leftCount++; else rightCount++;
              }
              const preferSide = (leftCount <= rightCount) ? "left" : "right";
              pos = choosePlacement(messagesRef, getRectFor, pr, size.w, size.h, [m.id], preferSide);
              // If we couldn't place on the same row (pos.side === 'below'), anchor to the chosen side
              // and stack downward at a fixed x so the thread never drops under the main chain.
              if (!pos || pos.side === 'below') {
                const occ = buildOccupancy(messagesRef, getRectFor, [m.id]);
                const sideGapPx = sideGapCells * GRID;
                const targetLeftX = preferSide === 'left'
                  ? Math.max(EDGE_PADDING, pr.x - sideGapPx - size.w)
                  : pr.x + pr.w + sideGapPx;
                pos = findSlotBelowAtX(occ, targetLeftX, pr, size.w, size.h);
              }
            }
          } else {
            // LLM reply inside a thread: stack below at same x (respecting occupancy)
            pos = stackBelowAtX(pr.x, pr, { w: size.w, h: size.h }, m.id);
          }
          // NOTE: never advance main tail for thread messages
        } else {
          // MAIN-CHAIN (non-thread): always keep vertical under pinned root center
          console.log(`[ChatCanvas] -> Main chain (non-thread) for ${m.id}`);
          let rootCenter = rootCentersRef.current.get(rootId);
          if (rootCenter == null) {
            const rootRectNow = getRectById(rootId);
            rootCenter = rootRectNow
              ? rootRectNow.x + rootRectNow.w / 2
              : stageSizeRef.current.width / 2;
            rootCentersRef.current.set(rootId, rootCenter);
          }
          const occ = buildOccupancy(messagesRef, getRectFor, [m.id]);
          pos = findSlotBelowAtCenter(occ, rootCenter, pr, size.w, size.h);
          // Do not rely on mainTail for placement anymore; it's only metadata if needed
          localMainTail.set(rootId, m.id);
        }

        console.log(`[ChatCanvas] Calculated position for ${m.id}:`, pos);
        m.x = pos.x;
        m.y = clampYNoBottom(pos.y);
        ensureWidthForRect(m.x, size.w);
        ensureHeightForRect(m.y, size.h);
        changed = true;
      } else {
        // ROOT message
        const placedRoots = next.filter((t) => !t.parentId && t.x != null && t.y != null);
        console.log(`[ChatCanvas] Placing ROOT message ${m.id}`);
        if (!placedRoots.length) {
          // First root message is centered
          const rectW = size.w;
          m.x = snap(Math.round((stageSizeRef.current.width - rectW) / 2));
          m.y = snap(EDGE_PADDING);
        } else {
          // Subsequent root messages are placed below the lowest existing root
          const lowest = placedRoots.reduce((a, b) => (getRectFor(a).y > getRectFor(b).y ? a : b));
          const lr = getRectFor(lowest);
          const rectW = size.w;
          // Center it horizontally like the first one
          m.x = snap(Math.round((stageSizeRef.current.width - rectW) / 2));
          m.y = clampYNoBottom(lr.y + lr.h + GAP);
        }
        ensureWidthForRect(m.x, size.w);
        ensureHeightForRect(m.y, size.h);

        // init pins for this root
        const rootCenter = (m.x ?? 0) + (size?.w ?? 300) / 2;
        rootCentersRef.current.set(m.id, rootCenter);
        mainTailByRootRef.current.set(m.id, m.id);

        changed = true;
      }
    }

    if (changed) setMessages(next);

    // Commit updated tails after positions are computed
    if (changed) {
      mainTailByRootRef.current = localMainTail;
    }
  });

  // Calculate reply box anchor for a given bubble id
  const getReplyAnchorFor = (id) => {
    const el = messageRefs.current[id];
    const canvasEl = canvasRef.current;
    if (!el || !canvasEl) return null;
    const erect = el.getBoundingClientRect();
    const crect = canvasEl.getBoundingClientRect();
    return {
      x: erect.left - crect.left,
      y: erect.top - crect.top,
      w: erect.width,
      h: erect.height,
    };
  };

  const openReplyFor = (id) => {
    const anchor = getReplyAnchorFor(id);
    if (!anchor) return;
    setActiveThreadId(id);
    setReplyAnchor(anchor);
    // Clear any hover preview when activating
    setHoverThreadId(null);
    setHoverReplyAnchor(null);
  };

  // Hover handlers: show reply box on hover (no focus)
  const handleBubbleMouseEnter = (e, id, placed) => {
    if (!placed) return;
    // Cancel any pending hover clear when re-entering a bubble
    if (hoverClearTimeoutRef.current) {
      clearTimeout(hoverClearTimeoutRef.current);
      hoverClearTimeoutRef.current = null;
    }
    const anchor = getReplyAnchorFor(id);
    if (!anchor) return;
    setHoverThreadId(id);
    setHoverReplyAnchor(anchor);
  };
  const handleBubbleMouseLeave = () => {
    // Small grace period so users can move pointer into the reply box area without it disappearing
    if (hoverClearTimeoutRef.current) clearTimeout(hoverClearTimeoutRef.current);
    hoverClearTimeoutRef.current = setTimeout(() => {
      setHoverThreadId(null);
      setHoverReplyAnchor(null);
      hoverClearTimeoutRef.current = null;
    }, 160);
  };

  // Ensure reply input focuses automatically when opening
  useEffect(() => {
    if (activeThreadId && replyInputRef.current) {
      // Defer to next tick to allow element to mount
      const t = setTimeout(() => {
        replyInputRef.current?.focus();
        // Place caret at end if text exists
        try {
          const len = replyInputText?.length ?? 0;
          replyInputRef.current?.setSelectionRange?.(len, len);
        } catch {}
      }, 0);
      return () => clearTimeout(t);
    }
  }, [activeThreadId, replyAnchor]);

  const addMessage = (data) => {
    const userId = "local-user";
    const id = Math.random().toString(36).substring(2, 9);
    // Determine threadId based on new semantics:
    // - If explicit threadId provided, honor it.
    // - If message has a parent:
    //    - If this is a thread message (branch):
    //        - If parent is already a thread, inherit parent's threadId (continuation).
    //        - Else (starting a new branch), set threadId to parent.id (anchor-as-thread-id).
    //    - Else (main-chain), set threadId to root id of the parent chain.
    // - If no parent, this is a new root; use its own id as threadId.
    let threadId;
    if (data.threadId) {
      threadId = data.threadId;
    } else if (data.parentId) {
      const parent = messagesRef.current.find((m) => m.id === data.parentId);
      if (data.isThread) {
        if (parent?.isThread) {
          threadId = parent.threadId ?? parent.id;
        } else {
          // Starting a new branch off a non-thread parent; anchor becomes thread id
          threadId = parent?.id ?? id;
        }
      } else {
        // Main chain message
        threadId = getRootIdOf(messagesRef, data.parentId);
      }
    } else {
      threadId = id;
    }

    const msg = {
      ...data,
      id,
      threadId,
      timestamp: new Date().toISOString(),
      senderId: data.senderId || userId
    };
    console.log('[addMessage]', { id, parentId: msg.parentId, senderId: msg.senderId, isThread: msg.isThread, threadId: msg.threadId });
    setMessages((prev) => [...prev, msg]);
    lastAddedIdRef.current = id;
    return id;
  };

  // new chat (MAIN)
  const handleNewChatSubmit = async (e) => {
    e.preventDefault();
    if (!newChatInput.trim()) return;
    const userText = newChatInput;
    const parentId = addMessage({ text: userText, senderId: "local-user", parentId: null, isThread: false });
    setNewChatInput("");
    setActiveThreadId(null);
    setReplyAnchor(null);

    // Create a placeholder assistant message and stream tokens into it
    const assistantId = addMessage({
      text: "",
      senderId: "llm-assistant",
      parentId,
      isThread: false,
    });

    let acc = "";
    await generateLLMReplyStream({
      allMessages: messagesRef.current,
      parentId,
      replyToId: parentId,
      userText,
      branching: false,
      onToken: (tok) => {
        acc += tok;
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: acc } : m)));
      },
      onDone: () => {
        lastAddedIdRef.current = assistantId;
      },
      onError: () => {
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: "(LLM error)" } : m)));
      },
    });
  };

  // reply box (THREAD)
  const handleReplyInThread = async (e) => {
    e.preventDefault();
    if (!threadInputText.trim() || !activeThreadId) return;
    // Decide whether this reply continues the main chain or starts a branch
    const rootId = getRootIdOf(messagesRef, activeThreadId);
    // Use computed tail based on timestamps to avoid race with layout updates
    const currentMainTail = getTailIdForRoot(messagesRef, rootId);
    const continueMain = activeThreadId === currentMainTail; // continue straight down

    const userText = threadInputText;
    const userMsgId = addMessage({
      text: threadInputText,
      senderId: "local-user",
      parentId: activeThreadId,
      isThread: !continueMain,
    });
    setThreadInputText("");
    setActiveThreadId(null);
    setReplyAnchor(null);

    // LLM continues in the same chain (main or thread) with streaming
    const assistantId = addMessage({
      text: "",
      senderId: "llm-assistant",
      parentId: userMsgId,
      isThread: !continueMain,
    });

    let acc = "";
    await generateLLMReplyStream({
      allMessages: messagesRef.current,
      parentId: userMsgId,
      replyToId: activeThreadId,
      userText,
      branching: !continueMain,
      onToken: (tok) => {
        acc += tok;
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: acc } : m)));
      },
      onDone: () => {
        lastAddedIdRef.current = assistantId;
      },
      onError: () => {
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: "(LLM error)" } : m)));
      },
    });
  };

  // dragging
  const handleMouseDown = (e, id) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "BUTTON") return;
    const msg = messagesRef.current.find((m) => m.id === id);
    if (!msg) return;
    const rect = getRectFor(msg);
    // Do not start dragging yet; wait for threshold in mousemove
    dragStartRef.current = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.x,
      offsetY: e.clientY - rect.y,
    };
  };
  const handleMouseMove = (e) => {
    const threshold = 4; // pixels
    const ds = dragStartRef.current;
    if (!isDragging && ds.id) {
      const dx = Math.abs(e.clientX - ds.startX);
      const dy = Math.abs(e.clientY - ds.startY);
      if (dx > threshold || dy > threshold) {
        setIsDragging(true);
        setDraggedMessageId(ds.id);
        setOffset({ x: ds.offsetX, y: ds.offsetY });
      }
    }

    if (!isDragging || draggedMessageId == null) return;
    const nx = e.clientX - offset.x;
    const ny = e.clientY - offset.y;
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
    setMessages((prev) =>
      prev.map((m) => (m.id === draggedMessageId ? { ...m, x: nx, y: ny } : m))
    );
  };
  const handleMouseUp = () => {
    // Clear any pending drag candidate
    const justDroppedId = draggedMessageId;
    dragStartRef.current = { id: null, startX: 0, startY: 0, offsetX: 0, offsetY: 0 };
    if (!isDragging) return;
    setIsDragging(false);
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== justDroppedId) return m;
        const size = bubbleSizesRef.current[m.id] || { w: 300, h: 100 };
        const nx = snap(Math.max(m.x, EDGE_PADDING));
        const ny = clampYNoBottom(m.y);
        ensureWidthForRect(nx, size.w);
        ensureHeightForRect(ny, size.h);
        return { ...m, x: nx, y: ny };
      })
    );
    setDraggedMessageId(null);

    requestAnimationFrame(() => {
      const dragged = messagesRef.current.find((m) => m.id === justDroppedId);
      if (dragged && !dragged.parentId) {
        const sz = bubbleSizesRef.current[dragged.id] || { w: 300, h: 100 };
        rootCentersRef.current.set(dragged.id, (dragged.x ?? 0) + sz.w / 2);
      }
      requestAnimationFrame(() => {
        setMessages((prev) =>
          resolveOverlapsFn({
            messages: prev,
            getRectFor,
            ensureWidthForRect,
            ensureHeightForRect,
            clampYNoBottom,
            stageSizeRef
          })
        );
      });
    });
  };

  // actions
  const clearCanvas = () => {
    cleanupObservers();
    clearSavedState();
    setMessages([]);
    messagesRef.current = [];
    setLines([]);
    setActiveThreadId(null);
    setReplyAnchor(null);
    setThreadInputText("");
    setNewChatInput("");
    setStageSize({ width: window.innerWidth, height: window.innerHeight });
    rootCentersRef.current.clear();
    mainTailByRootRef.current.clear();
  };
  

  const getBubbleColor = (sid) => {
    // Pastel, semi-transparent backgrounds for glass effect
    if (sid === "local-user") return "rgba(147, 197, 253, 0.65)"; // sky-300 @ 65%
    if (sid === "llm-assistant") return "rgba(167, 243, 208, 0.65)"; // emerald-200 @ 65%
    return "rgba(229, 231, 235, 0.60)"; // gray-200 @ 60%
  };
  const hasStarted = messages.length > 0;

  return (
    <div ref={outerRef} className="w-full h-screen overflow-auto" style={{ backgroundColor: "#fff" }}>
      <div
        ref={canvasRef}
        className="relative touch-none"
        style={{
          width: stageSize.width,
          height: stageSize.height,
          backgroundColor: "#ffffff",
          backgroundImage: "radial-gradient(#1f2937 1px, transparent 1px)",
          backgroundSize: `${GRID}px ${GRID}px`,
          backgroundRepeat: "repeat",
          backgroundPosition: "0 0",
          backgroundAttachment: "local"
        }}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={() => {
          setActiveThreadId(null);
          setReplyAnchor(null);
          setHoverThreadId(null);
          setHoverReplyAnchor(null);
        }}
      >
        {hasStarted && (
          <div className="fixed top-4 right-4 z-40 flex gap-2">
            <button
              onClick={clearCanvas}
              className="px-4 py-2 bg-gray-800 text-white rounded-full shadow-md hover:bg-gray-700 transition-colors"
            >
              Clear
            </button>
          </div>
        )}

        <LinesSVG lines={lines} />

        {messages.map((m) => (
          <Bubble
            key={m.id}
            id={m.id}
            placed={m.x != null && m.y != null}
            x={m.x}
            y={m.y}
            color={getBubbleColor(m.senderId)}
            registerRef={registerBubbleRef}
            onMouseDown={handleMouseDown}
            onMouseEnter={handleBubbleMouseEnter}
            onMouseLeave={handleBubbleMouseLeave}
            onClick={(e, id, placed) => {
              e.stopPropagation();
              if (!placed) return;
              // Always activate and focus on click
              openReplyFor(id);
            }}
          >
            {m.text}
          </Bubble>
        ))}

        {(() => {
          // Show reply box for active (clicked) bubble, otherwise for hovered bubble
          const threadId = activeThreadId ?? hoverThreadId;
          const anchor = activeThreadId ? replyAnchor : hoverReplyAnchor;
          if (!threadId || !anchor) return null;

          const INPUT_W = 360, INPUT_H = 44;
          const parentRect = getRectById(threadId) || {
            x: anchor.x, y: anchor.y, w: anchor.w, h: anchor.h
          };

          const clampX = (x) => snap(Math.max(EDGE_PADDING, Math.min(x, stageSize.width - EDGE_PADDING - INPUT_W)));
          const centerX = (parentRect.x ?? 0) + (parentRect.w ?? 0) / 2 - INPUT_W / 2;
          const x = clampX(centerX);
          const y = clampYNoBottom(snap((parentRect.y ?? 0) + (parentRect.h ?? 0) + GAP));
          const placedRect = { x, y, w: INPUT_W, h: INPUT_H };
          const interactive = !!activeThreadId && threadId === activeThreadId;

          return (
            <form
              onSubmit={handleReplyInThread}
              className="absolute z-50"
              style={{
                left: placedRect.x,
                top: placedRect.y,
                width: INPUT_W,
                height: INPUT_H,
              }}
              onClick={(e) => e.stopPropagation()}
              onMouseEnter={() => {
                // Keeping hover active while pointer is over reply area
                if (!interactive && threadId) {
                  if (hoverClearTimeoutRef.current) {
                    clearTimeout(hoverClearTimeoutRef.current);
                    hoverClearTimeoutRef.current = null;
                  }
                  // Ensure hover state is consistent
                  setHoverThreadId(threadId);
                  const a = getReplyAnchorFor(threadId);
                  if (a) setHoverReplyAnchor(a);
                }
              }}
              onMouseLeave={() => {
                // Gracefully clear after leaving the reply area too
                if (!interactive) {
                  if (hoverClearTimeoutRef.current) clearTimeout(hoverClearTimeoutRef.current);
                  hoverClearTimeoutRef.current = setTimeout(() => {
                    setHoverThreadId(null);
                    setHoverReplyAnchor(null);
                    hoverClearTimeoutRef.current = null;
                  }, 120);
                }
              }}
              onMouseDownCapture={(e) => {
                // Activate on any mousedown in the reply container when in preview mode
                if (!interactive && threadId) {
                  e.preventDefault();
                  e.stopPropagation();
                  openReplyFor(threadId);
                }
              }}
            >
              <input
                ref={replyInputRef}
                type="text"
                value={threadInputText}
                onChange={(e) => setThreadInputText(e.target.value)}
                placeholder={interactive ? "Reply here..." : "Click bubble to reply"}
                className="w-full h-full px-4 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                style={{
                  // Glass input styling to match bubble aesthetic
                  background: "linear-gradient(135deg, rgba(255,255,255,0.45), rgba(255,255,255,0.15))",
                  color: "#111827",
                  backdropFilter: "saturate(140%) blur(12px)",
                  WebkitBackdropFilter: "saturate(140%) blur(12px)",
                  border: "1px solid rgba(255,255,255,0.5)",
                  boxShadow: "0 6px 18px rgba(2,6,23,0.12), inset 0 1px 0 rgba(255,255,255,0.2)",
                  opacity: interactive ? 1 : 0.9,
                }}
                onMouseDown={(e) => e.stopPropagation()}
                readOnly={!interactive}
                onFocus={(e) => {
                  // If user focuses via keyboard while preview is visible, activate
                  if (!interactive && hoverThreadId) {
                    openReplyFor(hoverThreadId);
                  }
                }}
                onMouseDownCapture={(e) => {
                  // If user clicks the preview input, activate and prevent default so caret appears after activation
                  if (!interactive && hoverThreadId) {
                    e.preventDefault();
                    e.stopPropagation();
                    openReplyFor(hoverThreadId);
                  }
                }}
              />
            </form>
          );
        })()}

        {!hasStarted && (
          <form onSubmit={handleNewChatSubmit} className="fixed left-1/2 -translate-x-1/2 bottom-4 z-30 flex gap-2">
            <input
              type="text"
              value={newChatInput}
              onChange={(e) => setNewChatInput(e.target.value)}
              placeholder="Start a new chat..."
              className="p-3 w-80 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-100 text-black border border-gray-300"
            />
            <button
              type="submit"
              className="px-6 py-2 bg-blue-500 text-white rounded-full shadow-md hover:bg-blue-600 transition-colors"
            >
              Start
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
