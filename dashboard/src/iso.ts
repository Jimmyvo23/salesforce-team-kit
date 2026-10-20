/** Isometric maths for the office scene. Pure: no DOM, no React. Units are floor tiles. */

export type Pt = [number, number];

/** Pixels per floor tile. */
export const U = 22;
/** Floor width in tiles (desks on the left, the approver office on the right). */
export const FLOOR_W = 11;

const COS = 0.866;
const PER_ROW = 3;
const ROW_DEPTH = 3;
const DESK_X = [1.6, 3.8, 6.0];
const TOP = 96;
const LEFT_PAD = 30;
const RIGHT_PAD = 8;
const BOTTOM_PAD = 25;

export interface IsoLayout {
  width: number;
  height: number;
  depth: number;
  rows: number;
  origin: { x: number; y: number };
  desks: { id: string; x: number; y: number }[];
  approver: { x0: number; y0: number; x1: number; y1: number; desk: { x: number; y: number } };
  /** Screen position of the sandbox cloud (top right). */
  sandbox: Pt;
  /** Screen position of the production vault cloud (bottom right). */
  vault: Pt;
}

/** Screen point of floor tile (x, y) at height z. */
export function project(l: Pick<IsoLayout, 'origin'>, x: number, y: number, z = 0): Pt {
  return [l.origin.x + (x - y) * U * COS, l.origin.y + (x + y) * U * 0.5 - z * U];
}

/** One desk per member, three per row, in the order given. */
export function layout(memberIds: string[]): IsoLayout {
  const rows = Math.max(1, Math.ceil(memberIds.length / PER_ROW));
  const depth = 2 + rows * ROW_DEPTH;
  const origin = { x: LEFT_PAD + depth * U * COS, y: TOP };
  const width = Math.round(origin.x + FLOOR_W * U * COS + RIGHT_PAD);
  const height = Math.round(project({ origin }, FLOOR_W, depth)[1] + BOTTOM_PAD);
  const desks = memberIds.map((id, i) => ({ id, x: DESK_X[i % PER_ROW], y: 2 + Math.floor(i / PER_ROW) * ROW_DEPTH }));
  const y0 = Math.round((depth - 3.4) * 10) / 10;
  return {
    width, height, depth, rows, origin, desks,
    approver: { x0: 8.3, y0, x1: 10.7, y1: depth - 0.3, desk: { x: 9, y: Math.round((y0 + 0.8) * 10) / 10 } },
    sandbox: [width - 48, 52],
    vault: [width - 44, height - 78],
  };
}

/** Polygon `points` attribute from screen points. */
export function pts(points: Pt[]): string {
  return points.map(([x, y]) => `${x},${y}`).join(' ');
}

/** The three visible faces of a box at (x, y, z) sized w × d × h. */
export function boxFaces(l: Pick<IsoLayout, 'origin'>, x: number, y: number, z: number, w: number, d: number, h: number) {
  const P = (a: number, b: number, c: number) => project(l, a, b, c);
  return {
    top: pts([P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)]),
    left: pts([P(x, y + d, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x, y + d, z + h)]),
    right: pts([P(x + w, y, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x + w, y, z + h)]),
  };
}

/** A quadratic arc from `from` to `to`, its control point `lift` px above the higher end. */
export function arcPath(from: Pt, to: Pt, lift = 35): string {
  const cx = (from[0] + to[0]) / 2;
  const cy = Math.min(from[1], to[1]) - lift;
  return `M${from[0]} ${from[1]} Q${cx} ${cy} ${to[0]} ${to[1]}`;
}
