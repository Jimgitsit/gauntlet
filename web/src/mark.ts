// The Gauntlet mark: an armored fist built from plates, on the dark tile.
// One shape list feeds both the sidebar SVG (App.tsx) and the PNG icon
// (tools/gen-icon.ts), so the two always match. Coordinates are in a 24-unit square.

export const TILE = "#15181D";

const STEEL = "#D7DCE4";
const STEEL_DARK = "#B4BCC8";
const CUFF = "#4F86E3";

export interface Plate {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Corner radius. */
  r: number;
  /** Degrees, clockwise about the plate's centre. */
  rot?: number;
  fill: string;
}

export const PLATES: Plate[] = [
  // Knuckles.
  { x: 4.4, y: 3.2, w: 3.4, h: 4.6, r: 1.3, fill: STEEL },
  { x: 8.2, y: 2.6, w: 3.4, h: 5.2, r: 1.3, fill: STEEL },
  { x: 12, y: 2.6, w: 3.4, h: 5.2, r: 1.3, fill: STEEL },
  { x: 15.8, y: 3.2, w: 3.4, h: 4.6, r: 1.3, fill: STEEL },
  // Second row of finger plates.
  { x: 4.4, y: 8.3, w: 3.4, h: 3.6, r: 1, fill: STEEL_DARK },
  { x: 8.2, y: 8.3, w: 3.4, h: 3.6, r: 1, fill: STEEL_DARK },
  { x: 12, y: 8.3, w: 3.4, h: 3.6, r: 1, fill: STEEL_DARK },
  { x: 15.8, y: 8.3, w: 3.4, h: 3.6, r: 1, fill: STEEL_DARK },
  // Back of the hand.
  { x: 4.4, y: 12.4, w: 14.8, h: 4.2, r: 1.4, fill: STEEL_DARK },
  // Thumb, laid over the right edge.
  { x: 17, y: 9.6, w: 3.6, h: 6.8, r: 1.6, rot: -18, fill: STEEL },
  // Cuff.
  { x: 3.6, y: 17.2, w: 16.8, h: 4.2, r: 1.3, fill: CUFF },
];
