import { GRID } from "../constants";


export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export const snap = (n, grid = GRID) => Math.round(n / grid) * grid;
export const toCol = (x) => Math.floor(x / GRID);
export const toRow = (y) => Math.floor(y / GRID);
export const fromCol = (c) => c * GRID;
export const fromRow = (r) => r * GRID;