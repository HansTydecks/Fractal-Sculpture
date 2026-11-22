import type { Design } from './params';
import { PALETTES, mulberry32 } from './params';
import { makeGrid, footprintOutline, type Cell, type Grid, type P2 } from './grid';
import { sampleFields } from './fields';
import {
  buildPieceChain,
  chainMesh,
  convexOverlap,
  sectionPolygon,
  rigidRelease,
  signedVolume,
  type Chain,
  type Mesh,
  type PieceSpec,
} from './piece';

export interface UniquePiece {
  index: number; // 0-based; exported as P001, P002, ...
  spec: PieceSpec;
  chain: Chain;
  mesh: Mesh;
  count: number;
  volume: number; // mm^3
  maxZ: number;
  rigid: boolean;
}

export interface Placed {
  cell: Cell;
  rot: number;
  piece: number;
  colour: [number, number, number]; // sRGB 0..1
}

export interface Sculpture {
  grid: Grid;
  placed: Placed[];
  pieces: UniquePiece[];
  width: number; // mm, extent of the tiled footprints
  height: number;
  depth: number; // mm, tallest piece
  volume: number; // mm^3, all pieces
  leanFactor: number; // < 1 when lean was reduced so neighbours do not collide
  twistFactor: number; // likewise for twist
  clashes: number; // pieces that still intersect a neighbour
}

interface Draft {
  cell: Cell;
  rot: number;
  spec: PieceSpec;
  leanX: number; // unscaled
  leanY: number;
  colour: [number, number, number];
}

/**
 * Count pieces that run into a neighbour, comparing their cross-sections at a series of
 * heights. `f` scales every piece's lean and `ft` its twist.
 */
function countClashes(drafts: Draft[], grid: Grid, f: number, ft: number): number {
  const size = grid.inradius * 2.3;
  const buckets = new Map<string, number[]>();
  drafts.forEach((d, n) => {
    const key = Math.floor(d.cell.x / size) + ',' + Math.floor(d.cell.y / size);
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = []));
    b.push(n);
  });
  // Exact corners are enough unless the outline is being rounded off.
  const section = (d: Draft, z: number): P2[] => {
    const sp = d.spec;
    const stride = sp.round > 0 ? 1 : sp.poly.length / sp.corners;
    const c = Math.cos(d.rot), s = Math.sin(d.rot);
    return sectionPolygon({ ...sp, leanX: d.leanX, leanY: d.leanY, twist: sp.twist * ft }, Math.min(1, z / (sp.height - sp.baseH)), f, stride).map(
      (p) => [d.cell.x + p[0] * c - p[1] * s, d.cell.y + p[0] * s + p[1] * c] as P2,
    );
  };
  const bad = new Set<number>();
  drafts.forEach((a, n) => {
    const bx = Math.floor(a.cell.x / size), by = Math.floor(a.cell.y / size);
    for (let ix = bx - 1; ix <= bx + 1; ix++)
      for (let iy = by - 1; iy <= by + 1; iy++)
        for (const m of buckets.get(ix + ',' + iy) ?? []) {
          if (m <= n) continue;
          const b = drafts[m];
          if (Math.hypot(a.cell.x - b.cell.x, a.cell.y - b.cell.y) > size) continue;
          const top = Math.min(a.spec.height - a.spec.baseH, b.spec.height - b.spec.baseH);
          for (let k = 1; k <= 6; k++) {
            if (convexOverlap(section(a, (top * k) / 6), section(b, (top * k) / 6), 0.05)) {
              bad.add(n); bad.add(m);
              break;
            }
          }
        }
  });
  return bad.size;
}

const TAU = Math.PI * 2;
const wrap = (a: number) => a - TAU * Math.round(a / TAU);
const q = (x: number, step = 0.01) => Math.round(x / step) * step;

function hexToRgb(h: string): [number, number, number] {
  const v = parseInt(h.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

export function paletteColour(d: Design, t: number): [number, number, number] {
  const stops = (d.palette === 'custom' ? [d.colourA, d.colourB] : PALETTES[d.palette] ?? PALETTES.ember).map(
    hexToRgb,
  );
  if (stops.length === 1) return stops[0];
  let u = Math.max(0, Math.min(1, t));
  if (d.reverse) u = 1 - u;
  const x = u * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

const SEGMENTS = { hex: 3, square: 4, triangle: 5, rhombus: 4 } as const;

export function buildSculpture(d: Design): Sculpture {
  const grid = makeGrid(d);
  const fields = sampleFields(d, grid);
  const rnd = mulberry32(d.seed * 31 + 5);
  const many = grid.cells.length > 700;
  const outline = footprintOutline(grid, d.gap, many ? 2 : SEGMENTS[d.footprint]);
  const step = TAU / grid.sym;
  const minH = Math.min(d.minH, d.maxH);
  const maxH = Math.max(d.minH, d.maxH);
  const repeat = d.mode === 'repeat';
  const straight = d.twist === 0 && d.lean === 0 && d.round === 0 && Math.abs(d.curve) < 0.01;
  const layers = straight ? 1 : many ? 5 : 9;

  const drafts: Draft[] = [];

  grid.cells.forEach((cell, n) => {
    const f = fields[n];
    let s = f.s;
    let mag = Math.hypot(f.vx, f.vy);
    const fieldAngle = Math.atan2(f.vy, f.vx);

    // Which way the piece "points".
    let target = fieldAngle;
    if (repeat) {
      const radial = Math.atan2(cell.y, cell.x);
      switch (d.rotRule) {
        case 'field':
          break;
        case 'radial':
          target = radial;
          break;
        case 'tangent':
          target = radial + Math.PI / 2;
          break;
        case 'checker':
          target = cell.rot + (((cell.i + cell.j) % grid.sym) + grid.sym) * step;
          break;
        case 'rows':
          target = cell.rot + ((cell.j % grid.sym) + grid.sym) * step;
          break;
        case 'random':
          target = cell.rot + Math.floor(rnd() * grid.sym) * step;
          break;
        case 'uniform':
          target = 0;
          break;
      }
    }
    // Turn the footprint by a symmetry step so it points as close to the target as possible;
    // what is left over becomes the lean direction in the piece's own frame.
    const k = Math.round(wrap(target - cell.rot) / step);
    const rot = cell.rot + k * step;
    let local = wrap(target - rot);

    if (repeat) {
      const m = Math.max(1, Math.round(d.modules));
      s = m === 1 ? 1 : Math.min(m - 1, Math.floor(s * m)) / (m - 1);
      mag = 1;
      local = 0;
    } else if (d.levels >= 2) {
      const L = Math.round(d.levels);
      s = Math.round(s * (L - 1)) / (L - 1);
      mag = Math.round(mag * 2) / 2;
      local = Math.round(local / (step / 4)) * (step / 4);
    }

    const shaft = minH + (maxH - minH) * s;
    // Lean depends on height above the base only, so neighbours of different heights bend
    // along the same curve. The 0.6 keeps overhangs under about 45 degrees.
    const lean = (d.lean * mag * 0.6 * Math.pow(shaft, 1.5)) / Math.sqrt(maxH);
    const spec: PieceSpec = {
      poly: outline,
      corners: grid.poly.length,
      baseH: d.baseH,
      height: q(d.baseH + shaft),
      topScale: d.taper,
      curve: d.curve,
      twist: q(((d.twist * Math.PI) / 180) * (1 + d.twistVary * (2 * s - 2)), 0.001),
      leanX: 0,
      leanY: 0,
      round: d.round,
      top: d.top,
      topDepth: q(d.topDepth * grid.cellSize * 0.5),
      slant: q(d.slant * mag * shaft * 0.5),
      slantDir: q(local, 0.001),
      layers,
    };
    let t = s;
    switch (d.colourBy) {
      case 'radius':
        t = f.r;
        break;
      case 'angle':
        t = (fieldAngle + Math.PI) / TAU;
        t = 1 - Math.abs(2 * t - 1); // wrap smoothly
        break;
      case 'x':
        t = (cell.x / grid.halfW + 1) / 2;
        break;
      case 'y':
        t = (cell.y / grid.halfH + 1) / 2;
        break;
      case 'noise':
        t = f.noise;
        break;
    }
    drafts.push({ cell, rot, spec, leanX: lean * Math.cos(local), leanY: lean * Math.sin(local), colour: paletteColour(d, t) });
  });

  // Find the largest share of the requested twist, then of the lean, at which no piece
  // hits a neighbour.
  const largest = (clashesAt: (x: number) => number) => {
    if (clashesAt(1) === 0) return 1;
    let lo = 0, hi = 1;
    for (let k = 0; k < 7; k++) {
      const mid = (lo + hi) / 2;
      if (clashesAt(mid) === 0) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  let leanFactor = 1;
  let twistFactor = 1;
  if (d.fit) {
    if (d.twist !== 0) twistFactor = largest((x) => countClashes(drafts, grid, 0, x));
    if (d.lean > 0) leanFactor = largest((x) => countClashes(drafts, grid, x, twistFactor));
  }
  const clashes = countClashes(drafts, grid, leanFactor, twistFactor);

  const byKey = new Map<string, UniquePiece>();
  const pieces: UniquePiece[] = [];
  const placed: Placed[] = [];
  for (const dr of drafts) {
    const spec = dr.spec;
    spec.leanX = q(dr.leanX * leanFactor);
    spec.leanY = q(dr.leanY * leanFactor);
    spec.twist = q(spec.twist * twistFactor, 0.001);
    const key = [spec.height, spec.twist, spec.leanX, spec.leanY, spec.slant, spec.slantDir]
      .map((v) => v.toFixed(3))
      .join('|');
    let piece = byKey.get(key);
    if (!piece) {
      const chain = buildPieceChain(spec);
      const mesh = chainMesh(chain);
      let maxZ = 0;
      for (const v of mesh.verts) maxZ = Math.max(maxZ, v[2]);
      piece = {
        index: pieces.length,
        spec,
        chain,
        mesh,
        count: 0,
        volume: signedVolume(mesh),
        maxZ,
        rigid: rigidRelease(chain),
      };
      byKey.set(key, piece);
      pieces.push(piece);
    }
    piece.count++;
    placed.push({ cell: dr.cell, rot: dr.rot, piece: piece.index, colour: dr.colour });
  }


  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, depth = 0, volume = 0;
  for (const p of placed) {
    const c = Math.cos(p.cell.rot);
    const s = Math.sin(p.cell.rot);
    for (const v of grid.poly) {
      const x = p.cell.x + v[0] * c - v[1] * s;
      const y = p.cell.y + v[0] * s + v[1] * c;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  for (const p of pieces) {
    depth = Math.max(depth, p.maxZ);
    volume += p.volume * p.count;
  }
  return {
    grid,
    placed,
    pieces,
    width: placed.length ? x1 - x0 : 0,
    height: placed.length ? y1 - y0 : 0,
    depth,
    volume,
    leanFactor,
    twistFactor,
    clashes,
  };
}

/** Flat triangle soup (9 numbers per triangle) of the whole wall, in mm. */
export function wallTriangles(sc: Sculpture, backplate: number): Float32Array {
  let count = 0;
  for (const p of sc.placed) count += sc.pieces[p.piece].mesh.tris.length;
  const n = sc.grid.poly.length;
  const plateTris = backplate > 0 ? sc.placed.length * (4 * n - 4) : 0;
  const out = new Float32Array((count + plateTris) * 9);
  let o = 0;
  const put = (x: number, y: number, z: number) => {
    out[o++] = x; out[o++] = y; out[o++] = z;
  };
  for (const p of sc.placed) {
    const m = sc.pieces[p.piece].mesh;
    const c = Math.cos(p.rot);
    const s = Math.sin(p.rot);
    for (const t of m.tris)
      for (const i of t) {
        const v = m.verts[i];
        put(p.cell.x + v[0] * c - v[1] * s, p.cell.y + v[0] * s + v[1] * c, v[2]);
      }
  }
  if (backplate > 0) {
    // One prism per cell under the full (un-gapped) footprint; together they form the back plate.
    for (const p of sc.placed) {
      const c = Math.cos(p.cell.rot);
      const s = Math.sin(p.cell.rot);
      const pts = sc.grid.poly.map((v) => [p.cell.x + v[0] * c - v[1] * s, p.cell.y + v[0] * s + v[1] * c]);
      for (let i = 1; i + 1 < n; i++) {
        put(pts[0][0], pts[0][1], 0); put(pts[i][0], pts[i][1], 0); put(pts[i + 1][0], pts[i + 1][1], 0);
        put(pts[0][0], pts[0][1], -backplate); put(pts[i + 1][0], pts[i + 1][1], -backplate); put(pts[i][0], pts[i][1], -backplate);
      }
      for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % n];
        put(a[0], a[1], -backplate); put(b[0], b[1], -backplate); put(b[0], b[1], 0);
        put(a[0], a[1], -backplate); put(b[0], b[1], 0); put(a[0], a[1], 0);
      }
    }
  }
  return out;
}
