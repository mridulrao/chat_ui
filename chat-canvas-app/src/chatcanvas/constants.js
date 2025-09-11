// constants.js
export const GRID = 20; // dot spacing & snap unit
export const GAP = 64; // visual gap between bubbles (px)
export const SIDE_GAP = 128; // horizontal gap between main and side branches (px)
export const PADDING = 28; // padding for overlap math (px)
export const EDGE_PADDING = 80; // keep content away from edges (px)
export const MAX_SCAN = 500; // horizontal scan radius in grid cells
export const MAX_RESOLVE_PASSES = 8; // safety resolver iterations


// Derived (keep close to the base constants so updates propagate)
export const gapCells = Math.max(1, Math.round(GAP / GRID));
export const padCells = Math.max(1, Math.round(PADDING / GRID));
export const leftEdgeCol = Math.ceil(EDGE_PADDING / GRID);
export const sideGapCells = Math.max(1, Math.round(SIDE_GAP / GRID));