import type { Design, Footprint } from './params';

export type P2 = [number, number];

export interface Cell {
  id: number;
  i: number;
  j: number;
  x: number; // mm, wall centre is the origin
  y: number;
  rot: number; // rotation of the canonical footprint at this cell
}

export interface Grid {
  cells: Cell[];
  poly: P2[]; // canonical footprint, CCW, centred on its centroid, no gap
  sym: number; // rotational symmetry order of the footprint
  inradius: number;
  cellSize: number; // size actually used (may be raised to cap the piece count)
  halfW: number;
  halfH: number;
}

export const MAX_CELLS = 2500;
const S3 = Math.sqrt(3);

export const SYMMETRY: Record<Footprint, number> = { hex: 6, square: 4, triangle: 3, rhombus: 2 };

function insideMask(d: Design, x: number, y: number): boolean {
  const hw = (d.wallW * 10) / 2;
  const hh = (d.wallH * 10) / 2;
  const e = 1e-6;
  switch (d.wallShape) {
    case 'rect':
      return Math.abs(x) <= hw + e && Math.abs(y) <= hh + e;
    case 'circle':
      return Math.hypot(x, y) <= hw + e;
    case 'ring': {
      const r = Math.hypot(x, y);
      return r <= hw + e && r >= hw * d.ringInner - e;
    }
    case 'hex': {
      // flat-top hexagon with circumradius hw
      const a = (hw * S3) / 2;
      return Math.abs(y) <= a + e && Math.abs(y) * 0.5 + (Math.abs(x) * S3) / 2 <= a + e;
    }
  }
}

function layout(d: Design, size: number): Omit<Grid, 'cellSize' | 'halfW' | 'halfH'> {
  const cells: Cell[] = [];
  const hw = (d.wallW * 10) / 2;
  const hh = d.wallShape === 'rect' ? (d.wallH * 10) / 2 : hw;
  const add = (i: number, j: number, x: number, y: number, rot: number) => {
    if (insideMask(d, x, y)) cells.push({ id: cells.length, i, j, x, y, rot });
  };
  let poly: P2[];
  let inradius: number;
  const fp = d.footprint;
  if (fp === 'hex' || fp === 'rhombus') {
    const w = size;
    const R = w / S3;
    const nx = Math.ceil(hw / w) + 2;
    const ny = Math.ceil(hh / (1.5 * R)) + 2;
    if (fp === 'hex') {
      poly = [];
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + (k * Math.PI) / 3;
        poly.push([R * Math.cos(a), R * Math.sin(a)]);
      }
      inradius = w / 2;
      for (let j = -ny; j <= ny; j++)
        for (let i = -nx; i <= nx; i++) add(i, j, w * (i + 0.5 * (j & 1)), 1.5 * R * j, 0);
    } else {
      poly = [
        [-R / 2, 0],
        [0, (-R * S3) / 2],
        [R / 2, 0],
        [0, (R * S3) / 2],
      ];
      inradius = (R * S3) / 4;
      for (let j = -ny; j <= ny; j++)
        for (let i = -nx; i <= nx; i++) {
          const cx = w * (i + 0.5 * (j & 1));
          const cy = 1.5 * R * j;
          for (let k = 0; k < 3; k++) {
            const phi = Math.PI / 2 + (k * 2 * Math.PI) / 3;
            add(i * 3 + k, j, cx + (R / 2) * Math.cos(phi), cy + (R / 2) * Math.sin(phi), phi);
          }
        }
    }
  } else if (fp === 'square') {
    const h = size / 2;
    poly = [
      [-h, -h],
      [h, -h],
      [h, h],
      [-h, h],
    ];
    inradius = h;
    const nx = Math.ceil(hw / size) + 1;
    const ny = Math.ceil(hh / size) + 1;
    for (let j = -ny; j <= ny; j++) for (let i = -nx; i <= nx; i++) add(i, j, i * size, j * size, 0);
  } else {
    const s = size;
    const h = (s * S3) / 2;
    poly = [
      [-s / 2, -h / 3],
      [s / 2, -h / 3],
      [0, (2 * h) / 3],
    ];
    inradius = h / 3;
    const nx = Math.ceil(hw / (s / 2)) + 2;
    const ny = Math.ceil(hh / h) + 1;
    for (let j = -ny; j <= ny; j++)
      for (let i = -nx; i <= nx; i++) {
        const up = ((i + j) & 1) === 0;
        add(i, j, (i * s) / 2, j * h + (up ? -h / 6 : h / 6), up ? 0 : Math.PI);
      }
  }
  return { cells, poly, sym: SYMMETRY[fp], inradius };
}

export function makeGrid(d: Design): Grid {
  let size = Math.max(5, d.cellSize);
  let g = layout(d, size);
  // Keep the piece count workable: grow the cells until the wall has at most MAX_CELLS.
  while (g.cells.length > MAX_CELLS) {
    size *= 1.15;
    g = layout(d, size);
  }
  const hw = (d.wallW * 10) / 2;
  return { ...g, cellSize: size, halfW: hw, halfH: d.wallShape === 'rect' ? (d.wallH * 10) / 2 : hw };
}

/** Shrink a footprint towards its centroid so neighbours are `gap` apart, then subdivide its edges. */
export function footprintOutline(g: Grid, gap: number, seg: number): P2[] {
  const k = Math.max(0.3, (g.inradius - gap / 2) / g.inradius);
  const out: P2[] = [];
  const n = g.poly.length;
  for (let a = 0; a < n; a++) {
    const p = g.poly[a];
    const q = g.poly[(a + 1) % n];
    for (let s = 0; s < seg; s++) {
      const f = s / seg;
      out.push([k * (p[0] + (q[0] - p[0]) * f), k * (p[1] + (q[1] - p[1]) * f)]);
    }
  }
  return out;
}
