import type { Design } from './params';
import { PALETTES, mulberry32 } from './params';
import { makeGrid, footprintOutline, type Cell, type Grid, type P2 } from './grid';
import { sampleFields } from './fields';
import {
  buildPieceChain,
  chainMesh,
  convexOverlap,
  sectionPolygon,
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
  box: [number, number, number, number]; // x0, y0, x1, y1 in the piece's own frame
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
  // Corners are enough unless the outline is being rounded off; then a few points per edge.
  const section = (d: Draft, z: number): P2[] => {
    const sp = d.spec;
    const perEdge = sp.poly.length / sp.corners;
    const stride = sp.round > 0 ? Math.max(1, Math.floor(perEdge / 4)) : perEdge;
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

/** Triangle budgets (whole wall) for the live preview and for exported files. */
export const PREVIEW_BUDGET = 1_200_000;
export const EXPORT_BUDGET = 2_500_000;

const capRings = (top: string) => (top === 'dome' || top === 'bowl' ? 10 : top === 'step' ? 2 : 0);

export function buildSculpture(d: Design, budget = PREVIEW_BUDGET): Sculpture {
  const grid = makeGrid(d);
  const fields = sampleFields(d, grid);
  const rnd = mulberry32(d.seed * 31 + 5);
  // Curved surfaces need points along each edge; flat faces do not.
  let seg = d.round > 0 ? 12 : d.twist !== 0 ? 8 : 1;
  let outline = footprintOutline(grid, d.gap, seg);
  const step = TAU / grid.sym;
  const minH = Math.min(d.minH, d.maxH);
  const maxH = Math.max(d.minH, d.maxH);
  const repeat = d.mode === 'repeat';
  const straight = d.twist === 0 && d.lean === 0 && d.round === 0 && Math.abs(d.curve) < 0.01;

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
      layers: 1,
    };
    // about 3 degrees of twist and 4 mm of height per layer
    if (!straight)
      spec.layers = Math.max(2, Math.min(96, Math.ceil(Math.max((Math.abs(spec.twist) * 180) / Math.PI / 3, shaft / 4))));
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

  // Stay inside the triangle budget: first fewer points per edge, then fewer layers.
  const cost = () => {
    let n = 0;
    for (const dr of drafts) n += 2 * dr.spec.poly.length * (dr.spec.layers + capRings(d.top) + 2);
    return n;
  };
  while (seg > 2 && cost() > budget * 1.5) {
    seg = Math.max(2, Math.floor(seg / 2));
    outline = footprintOutline(grid, d.gap, seg);
    for (const dr of drafts) dr.spec.poly = outline;
  }
  const over = cost() / budget;
  if (over > 1) for (const dr of drafts) dr.spec.layers = Math.max(dr.spec.layers > 1 ? 2 : 1, Math.round(dr.spec.layers / over));

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
      const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const v of mesh.verts) {
        maxZ = Math.max(maxZ, v[2]);
        box[0] = Math.min(box[0], v[0]); box[1] = Math.min(box[1], v[1]);
        box[2] = Math.max(box[2], v[0]); box[3] = Math.max(box[3], v[1]);
      }
      piece = {
        index: pieces.length,
        spec,
        chain,
        mesh,
        count: 0,
        volume: signedVolume(mesh),
        maxZ,
        box,
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

export interface SoupOptions {
  backplate: number; // thickness of the base under the cells, 0 = none
  only?: (p: Placed) => boolean; // subset of cells
  sink?: number; // push the pieces this far into the base so slicers fuse them into one solid
  grow?: number; // widen each base cell by this much so neighbouring cells overlap
}

/** Flat triangle soup (9 numbers per triangle) of the wall or a part of it, in mm. */
export function wallTriangles(sc: Sculpture, o: SoupOptions | number): Float32Array {
  const opt: SoupOptions = typeof o === 'number' ? { backplate: o } : o;
  const backplate = opt.backplate;
  const sink = backplate > 0 ? Math.min(opt.sink ?? 0, backplate / 2) : 0;
  const placed = opt.only ? sc.placed.filter(opt.only) : sc.placed;
  let count = 0;
  for (const p of placed) count += sc.pieces[p.piece].mesh.tris.length;
  const n = sc.grid.poly.length;
  const plateTris = backplate > 0 ? placed.length * (4 * n - 4) : 0;
  const out = new Float32Array((count + plateTris) * 9);
  let o9 = 0;
  const put = (x: number, y: number, z: number) => {
    out[o9++] = x; out[o9++] = y; out[o9++] = z;
  };
  for (const p of placed) {
    const m = sc.pieces[p.piece].mesh;
    const c = Math.cos(p.rot);
    const s = Math.sin(p.rot);
    for (const t of m.tris)
      for (const i of t) {
        const v = m.verts[i];
        put(p.cell.x + v[0] * c - v[1] * s, p.cell.y + v[0] * s + v[1] * c, v[2] - sink);
      }
  }
  if (backplate > 0) {
    // One prism per cell under the full (un-gapped) footprint; together they form the base.
    const k = 1 + (opt.grow ?? 0) / sc.grid.inradius;
    for (const p of placed) {
      const c = Math.cos(p.cell.rot);
      const s = Math.sin(p.cell.rot);
      const pts = sc.grid.poly.map((v) => [p.cell.x + k * (v[0] * c - v[1] * s), p.cell.y + k * (v[0] * s + v[1] * c)]);
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

export interface PrototypeOptions {
  buildX: number; // printer build volume, mm
  buildY: number;
  buildZ: number;
  across: number; // panels
  down: number;
  base: number; // printed base thickness, mm
}

export interface PrototypeLayout {
  scale: number;
  panels: { cells: Set<number>; x0: number; y0: number; w: number; h: number; rotated: boolean }[]; // model mm
  size: [number, number, number]; // printed size of the largest panel, mm
  warnings: string[];
}

/** Printed overlap between pieces and base, and between neighbouring base cells. */
const FUSE = 0.3;

/**
 * Work out how the wall is cut into panels and the largest scale at which every panel fits
 * the printer. Panels are cut along cell boundaries: a cell belongs to the panel its centre is in.
 */
export function prototypeLayout(sc: Sculpture, d: Design, o: PrototypeOptions): PrototypeLayout {
  const g = sc.grid;
  const circ = Math.hypot(g.poly[0][0], g.poly[0][1]);
  let X0 = Infinity, X1 = -Infinity, Y0 = Infinity, Y1 = -Infinity;
  for (const p of sc.placed) {
    X0 = Math.min(X0, p.cell.x); X1 = Math.max(X1, p.cell.x);
    Y0 = Math.min(Y0, p.cell.y); Y1 = Math.max(Y1, p.cell.y);
  }
  const nx = Math.max(1, Math.round(o.across));
  const ny = Math.max(1, Math.round(o.down));
  const boxes = Array.from({ length: nx * ny }, () => ({
    cells: new Set<number>(), x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity,
  }));
  for (const p of sc.placed) {
    const ix = Math.min(nx - 1, Math.floor(((p.cell.x - X0) / Math.max(1e-9, X1 - X0)) * nx));
    const iy = Math.min(ny - 1, Math.floor(((p.cell.y - Y0) / Math.max(1e-9, Y1 - Y0)) * ny));
    const b = boxes[iy * nx + ix];
    b.cells.add(p.cell.id);
    // the cell's base, and the piece's own bounding box turned into place
    b.x0 = Math.min(b.x0, p.cell.x - circ); b.x1 = Math.max(b.x1, p.cell.x + circ);
    b.y0 = Math.min(b.y0, p.cell.y - circ); b.y1 = Math.max(b.y1, p.cell.y + circ);
    const bx = sc.pieces[p.piece].box;
    const c = Math.cos(p.rot), s = Math.sin(p.rot);
    for (const [x, y] of [[bx[0], bx[1]], [bx[2], bx[1]], [bx[2], bx[3]], [bx[0], bx[3]]]) {
      const wx = p.cell.x + x * c - y * s, wy = p.cell.y + x * s + y * c;
      b.x0 = Math.min(b.x0, wx); b.x1 = Math.max(b.x1, wx);
      b.y0 = Math.min(b.y0, wy); b.y1 = Math.max(b.y1, wy);
    }
  }
  const used = boxes.filter((b) => b.cells.size > 0);
  const zScale = (o.buildZ - o.base) / Math.max(1e-9, sc.depth);
  let scale = Math.min(1, zScale);
  const panels = used.map((b) => {
    const w = b.x1 - b.x0, h = b.y1 - b.y0;
    const straight = Math.min(o.buildX / w, o.buildY / h);
    const turned = Math.min(o.buildX / h, o.buildY / w);
    scale = Math.min(scale, Math.max(straight, turned));
    return { cells: b.cells, x0: b.x0, y0: b.y0, w, h, rotated: turned > straight };
  });
  scale = Math.max(0, scale * 0.995);
  let pw = 0, ph = 0;
  for (const p of panels) {
    pw = Math.max(pw, (p.rotated ? p.h : p.w) * scale);
    ph = Math.max(ph, (p.rotated ? p.w : p.h) * scale);
  }
  const warnings: string[] = [];
  if (scale <= 0) warnings.push('The base is thicker than the build height.');
  const gap = d.gap * scale;
  if (d.gap > 0 && gap < 0.3)
    warnings.push(`Gaps print at ${gap.toFixed(2)} mm and will fuse; set Gap to 0 for clean joins, or use more panels.`);
  const inset = Math.max(0.3, (g.inradius - d.gap / 2) / g.inradius);
  const tip = 2 * g.inradius * inset * d.taper * scale;
  if (tip < 0.6) warnings.push(`Piece tops print only ${tip.toFixed(2)} mm wide; use larger cells, less taper or more panels.`);
  return { scale, panels, size: [pw, ph, sc.depth * scale + o.base], warnings };
}

/** One printable solid per panel: scaled, laid flat on z = 0 and centred on the origin. */
export function prototypeTriangles(sc: Sculpture, o: PrototypeOptions, layout: PrototypeLayout): Float32Array[] {
  const k = layout.scale;
  return layout.panels.map((panel) => {
    const base = o.base / k;
    const t = wallTriangles(sc, {
      backplate: base,
      only: (p) => panel.cells.has(p.cell.id),
      sink: FUSE / k,
      grow: FUSE / 2 / k,
    });
    const cx = panel.x0 + panel.w / 2, cy = panel.y0 + panel.h / 2;
    for (let i = 0; i < t.length; i += 3) {
      const x = (t[i] - cx) * k, y = (t[i + 1] - cy) * k;
      // quarter turn (a proper rotation, so nothing is mirrored) when that fits the plate better
      t[i] = panel.rotated ? -y : x;
      t[i + 1] = panel.rotated ? x : y;
      t[i + 2] = (t[i + 2] + base) * k;
    }
    return t;
  });
}
