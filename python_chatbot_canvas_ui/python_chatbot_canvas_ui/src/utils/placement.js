// layout/placement.js
import {
  GRID, GAP, PADDING, EDGE_PADDING,
  MAX_SCAN, gapCells, padCells, leftEdgeCol, sideGapCells
} from "./constants";
import { toCol, toRow, fromCol, fromRow, snap } from "./grid";

export const rectsOverlap = (a, b) => !(
  a.col + a.spanX <= b.col ||
  b.col + b.spanX <= a.col ||
  a.row + a.spanY <= b.row ||
  b.row + b.spanY <= a.row
);

export const getMsgGridRect = (m, getRectFor) => {
  const r = getRectFor(m);
  const col = Math.max(leftEdgeCol, toCol(r.x) - padCells);
  const row = Math.max(leftEdgeCol, toRow(r.y));
  const spanX = Math.max(1, Math.ceil((r.w + PADDING) / GRID)) + padCells * 2;
  const spanY = Math.max(1, Math.ceil((r.h + PADDING) / GRID)) + padCells * 2;
  return { id: m.id, col, row, spanX, spanY };
 };

export const buildOccupancy = (messagesRef, getRectFor, excludeIds = []) => {
  const exclude = new Set(excludeIds);
  return messagesRef.current
    .filter(m => m.x != null && m.y != null && !exclude.has(m.id))
    .map((m) => getMsgGridRect(m, getRectFor));
};

export const isFreeRect = (occRects, col, row, spanX, spanY) => {
  if (col < leftEdgeCol) return false;
  const probe = { col: col - padCells, row, spanX: spanX + padCells * 2, spanY: spanY + padCells * 2 };
  return !occRects.some(r => rectsOverlap(r, probe));
};

// Prefer same-row left/right placement for user-started threads.
// preferSide: "left" | "right" | null
export const findSideSlotOnRow = (occRects, parentRect, w, h, preferSide = null) => {
  const spanX = Math.max(1, Math.ceil((w + PADDING) / GRID));
  const spanY = Math.max(1, Math.ceil((h + PADDING) / GRID));

  const row = toRow(parentRect.y); // align tops
  const parentLeftCol = toCol(parentRect.x);
  const parentRightCol = toCol(parentRect.x + parentRect.w);

  const startRightCol = parentRightCol + sideGapCells;
  const startLeftCol  = parentLeftCol  - sideGapCells - spanX;

  const MAX_WIDE = Math.max(MAX_SCAN, 200);

  const tryOrder = (r) => {
    const right = startRightCol + r;
    const left  = startLeftCol  - r;

    if (preferSide === "left") {
      if (left >= leftEdgeCol && isFreeRect(occRects, left, row, spanX, spanY)) {
        return { x: snap(fromCol(left)),  y: snap(fromRow(row)), side: "left" };
      }
      if (isFreeRect(occRects, right, row, spanX, spanY)) {
        return { x: snap(fromCol(right)), y: snap(fromRow(row)), side: "right" };
      }
    } else if (preferSide === "right") {
      if (isFreeRect(occRects, right, row, spanX, spanY)) {
        return { x: snap(fromCol(right)), y: snap(fromRow(row)), side: "right" };
      }
      if (left >= leftEdgeCol && isFreeRect(occRects, left, row, spanX, spanY)) {
        return { x: snap(fromCol(left)),  y: snap(fromRow(row)), side: "left" };
      }
    } else {
      if (isFreeRect(occRects, right, row, spanX, spanY)) {
        return { x: snap(fromCol(right)), y: snap(fromRow(row)), side: "right" };
      }
      if (left >= leftEdgeCol && isFreeRect(occRects, left, row, spanX, spanY)) {
        return { x: snap(fromCol(left)),  y: snap(fromRow(row)), side: "left" };
      }
    }
    return null;
  };

  for (let r = 0; r <= MAX_WIDE; r++) {
    const placed = tryOrder(r);
    if (placed) return placed;
  }
  return null;
};

export const findSlotBelow = (occRects, parentRect, w, h) => {
  const spanX = Math.max(1, Math.ceil((w + PADDING) / GRID));
  const spanY = Math.max(1, Math.ceil((h + PADDING) / GRID));
  const row = toRow(parentRect.y + parentRect.h) + gapCells;

  const parentCenterCol = toCol(parentRect.x + parentRect.w / 2);
  const maxSpread = 500;
  console.log('[placement.findSlotBelow] parentRect', parentRect, 'spanX', spanX, 'row', row, 'parentCenterCol', parentCenterCol);
  for (let d = 0; d < maxSpread; d++) {
    const leftCol = parentCenterCol - Math.floor(spanX / 2) - d;
    const rightCol = parentCenterCol - Math.floor(spanX / 2) + d;
    if (rightCol >= leftEdgeCol && isFreeRect(occRects, rightCol, row, spanX, spanY)) {
      const res = { x: snap(fromCol(rightCol)), y: snap(fromRow(row)), side: 'below' };
      console.log('[placement.findSlotBelow] chose rightCol', rightCol, '->', res);
      return res;
    }
    if (leftCol >= leftEdgeCol && isFreeRect(occRects, leftCol, row, spanX, spanY)) {
      const res = { x: snap(fromCol(leftCol)), y: snap(fromRow(row)), side: 'below' };
      console.log('[placement.findSlotBelow] chose leftCol', leftCol, '->', res);
      return res;
    }
  }
  const fallback = { x: snap(parentRect.x), y: snap(parentRect.y + GAP + parentRect.h), side: 'below' };
  console.log('[placement.findSlotBelow] fallback to parent x', fallback);
  return fallback;
};

// Keep x-center fixed (main-thread stacking)
export const findSlotBelowAtCenter = (occRects, targetCenterX, parentRect, w, h) => {
  const spanX = Math.max(1, Math.ceil((w + PADDING) / GRID));
  const spanY = Math.max(1, Math.ceil((h + PADDING) / GRID));
  let row = toRow(parentRect.y + parentRect.h) + gapCells;
  const startCol = Math.max(leftEdgeCol, toCol(targetCenterX - w / 2));
  const MAX_DROP = 1000;
  console.log('[placement.findSlotBelowAtCenter] targetCenterX', targetCenterX, 'startCol', startCol, 'row', row, 'spanX', spanX);

  for (let i = 0; i < MAX_DROP; i++) {
    if (isFreeRect(occRects, startCol, row, spanX, spanY)) {
      const res = { x: snap(fromCol(startCol)), y: snap(fromRow(row)), side: 'below' };
      console.log('[placement.findSlotBelowAtCenter] placed at startCol', startCol, '->', res);
      return res;
    }
    row += 1;
  }
  console.log('[placement.findSlotBelowAtCenter] could not place at center, fallback to findSlotBelow');
  return findSlotBelow(occRects, parentRect, w, h);
};

// Keep left edge fixed at a specific x (thread continuation stacking)
export const findSlotBelowAtX = (occRects, targetLeftX, parentRect, w, h) => {
  const spanX = Math.max(1, Math.ceil((w + PADDING) / GRID));
  const spanY = Math.max(1, Math.ceil((h + PADDING) / GRID));
  let row = toRow(parentRect.y + parentRect.h) + gapCells;
  const startCol = Math.max(leftEdgeCol, toCol(targetLeftX));
  const MAX_DROP = 1000;
  // console.log('[placement.findSlotBelowAtX] targetLeftX', targetLeftX, 'startCol', startCol, 'row', row, 'spanX', spanX);
  for (let i = 0; i < MAX_DROP; i++) {
    if (isFreeRect(occRects, startCol, row, spanX, spanY)) {
      const res = { x: snap(fromCol(startCol)), y: snap(fromRow(row)), side: 'below' };
      // console.log('[placement.findSlotBelowAtX] placed at startCol', startCol, '->', res);
      return res;
    }
    row += 1;
  }
  return findSlotBelow(occRects, parentRect, w, h);
};

// preferSide optional: "left" | "right" | null
export const choosePlacement = (
  messagesRef,
  getRectFor,
  parentRect,
  w,
  h,
  excludeIds = [],
  preferSide = null
) => {
  const occ = buildOccupancy(messagesRef, getRectFor, excludeIds);
  const side = findSideSlotOnRow(occ, parentRect, w, h, preferSide);
  if (side) return side;
  return findSlotBelow(occ, parentRect, w, h);
};
