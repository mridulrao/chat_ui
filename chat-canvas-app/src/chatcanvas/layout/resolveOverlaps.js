// layout/resolveOverlaps.js
import { GRID, PADDING, EDGE_PADDING, MAX_RESOLVE_PASSES } from "../constants";
import { snap } from "../utils/grid";

const overlapAmount = (getRectFor, a, b) => {
  const ar = getRectFor(a);
  const br = getRectFor(b);
  const ax2 = ar.x + ar.w, ay2 = ar.y + ar.h;
  const bx2 = br.x + br.w, by2 = br.y + br.h;
  return {
    x: Math.max(0, Math.min(ax2, bx2) - Math.max(ar.x, br.x)),
    y: Math.max(0, Math.min(ay2, by2) - Math.max(ar.y, br.y)),
  };
};

export function resolveOverlaps({ messages, getRectFor, ensureWidthForRect, ensureHeightForRect, clampYNoBottom, stageSizeRef }) {
  let updated = [...messages];
  for (let pass = 0; pass < MAX_RESOLVE_PASSES; pass++) {
    let changed = false;
    updated = [...updated].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
    for (let i = 0; i < updated.length; i++) {
      for (let j = i + 1; j < updated.length; j++) {
        const A = updated[i], B = updated[j];
        if (A.x == null || A.y == null || B.x == null || B.y == null) continue;
        const { x: ox, y: oy } = overlapAmount(getRectFor, A, B);
        if (ox > 0 && oy > 0) {
          const Ar = getRectFor(A);
          const Br = getRectFor(B);
          const rowTol = Math.max(GRID, Math.floor(Ar.h / 2));
          const isSiblings = A.parentId && A.parentId === B.parentId && Math.abs(Ar.y - Br.y) <= rowTol;

          const isMainA = !A.isThread;
          const isMainB = !B.isThread;
          // If either is a main-chain message, avoid horizontal shifting to preserve center column
          // Also keep siblings on the same row when possible
          let pushDown = oy >= ox || isMainA || isMainB;
          if (isSiblings) pushDown = false; // keep siblings on row when we can

          let nb;
          if (pushDown) {
            nb = { ...B, y: clampYNoBottom((B.y ?? 0) + oy + PADDING) };
            const h = getRectFor(nb).h; ensureHeightForRect(nb.y, h);
          } else {
            const sizeB = getRectFor(B);
            const tryRight = snap((B.x ?? 0) + ox + PADDING);
            const tryLeft  = snap((B.x ?? 0) - (ox + PADDING));
            const rightFits = tryRight + sizeB.w + EDGE_PADDING <= stageSizeRef.current.width;
            const leftFits  = tryLeft >= EDGE_PADDING;
            const preferRight = (B.x ?? 0) >= (A.x ?? 0);
            const finalX = (preferRight && rightFits) ? tryRight : (leftFits ? tryLeft : (rightFits ? tryRight : tryLeft));
            nb = { ...B, x: finalX };
            const w = getRectFor(nb).w; ensureWidthForRect(nb.x, w);
          }
          // Debug
          // console.log('[resolveOverlaps] Adjusting', { A, B, ox, oy, isMainA, isMainB, isSiblings, pushDown });
          updated[j] = nb; changed = true;
        }
      }
    }
    if (!changed) break;
  }
  // normalize to grid and ensure canvas size
  return updated.map((m) => {
    if (m.x == null || m.y == null) return m;
    const { w, h } = getRectFor(m);
    const nx = snap(Math.max(m.x, EDGE_PADDING));
    const ny = clampYNoBottom(m.y);
    ensureWidthForRect(nx, w); ensureHeightForRect(ny, h);
    return { ...m, x: nx, y: ny };
  });
}