// hooks/useBubbleMeasurements.js
import { useRef, useState } from "react";

export default function useBubbleMeasurements() {
  const [bubbleSizes, setBubbleSizes] = useState({}); // id -> {w,h}
  const bubbleSizesRef = useRef(bubbleSizes);
  const messageRefs = useRef({}); // id -> HTMLElement
  const roMapRef = useRef(new Map()); // id -> ResizeObserver

  const registerBubbleRef = (id) => (el) => {
    messageRefs.current[id] = el || undefined;
    const prev = roMapRef.current.get(id);
    if (prev) { prev.disconnect(); roMapRef.current.delete(id); }
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        setBubbleSizes((prev) => {
          const next = { ...prev, [id]: { w: Math.ceil(cr.width), h: Math.ceil(cr.height) } };
          bubbleSizesRef.current = next;
          return next;
        });
      }
    });
    ro.observe(el);
    roMapRef.current.set(id, ro);
  };

  const cleanupObservers = () => {
    roMapRef.current.forEach((ro) => ro.disconnect());
    roMapRef.current.clear();
  };

  return { bubbleSizes, bubbleSizesRef, messageRefs, registerBubbleRef, cleanupObservers };
}