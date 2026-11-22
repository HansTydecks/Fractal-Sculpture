import type { TopProfile } from './params';
import type { P2 } from './grid';

export type V3 = [number, number, number];

/** Everything that defines one piece's shape, in mm, in the piece's local frame. */
export interface PieceSpec {
  poly: P2[]; // footprint outline (subdivided, already inset for the gap), CCW
  corners: number; // corners of the underlying polygon
  baseH: number; // straight plinth
  height: number; // total height at the piece centre
  topScale: number;
  curve: number;
  twist: number; // radians over the shaft
  leanX: number;
  leanY: number;
  round: number;
  top: TopProfile;
  topDepth: number; // mm
  slant: number; // mm rise across the top
  slantDir: number; // radians
  layers: number;
}

/**
 * A closed surface described as a point, a sequence of equal-length loops, and a point.
 * Pieces and both mould types are all chains, which keeps every mesh watertight by construction.
 */
export interface Chain {
  start: V3;
  loops: V3[][];
  end: V3;
}

export interface Mesh {
  verts: V3[];
  tris: [number, number, number][];
}

/** Radius of the largest circle around the origin that fits inside a convex outline. */
function inradiusOf(poly: P2[]): number {
  let r = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const u = poly[i], v = poly[(i + 1) % poly.length];
    const len = Math.hypot(v[0] - u[0], v[1] - u[1]);
    if (len > 1e-9) r = Math.min(r, Math.abs(u[0] * v[1] - u[1] * v[0]) / len);
  }
  return r;
}

export function buildPieceChain(s: PieceSpec): Chain {
  const n = s.poly.length;
  const seg = n / s.corners;
  const radii = s.poly.map((p) => Math.hypot(p[0], p[1]));
  const rIn = inradiusOf(s.poly); // rounding pulls corners in, so the piece stays in its cell
  const rMax = Math.max(...radii);
  const zb = s.baseH;
  const zc = Math.max(zb + 1, s.height);
  const shaft = zc - zb;
  const dx = Math.cos(s.slantDir);
  const dy = Math.sin(s.slantDir);
  const crown = s.top === 'crown' ? s.topDepth * 0.5 : 0;

  // Height of the top edge above each outline vertex.
  const topZ = s.poly.map((p, i) => {
    let off = (s.slant * (p[0] * dx + p[1] * dy)) / rMax;
    if (crown) {
      const a = Math.floor(i / seg);
      const f = (i % seg) / seg;
      const sa = a % 2 ? -1 : 1;
      const sb = ((a + 1) % s.corners) % 2 ? -1 : 1;
      off += crown * (sa + (sb - sa) * f);
    }
    const lim = 0.85 * shaft;
    return zc + Math.max(-lim, Math.min(lim, off));
  });

  const power = Math.pow(2, s.curve * 1.6);
  /** Point at loft parameter t (0 base .. 1 top), radial fraction r, outline vertex i. */
  const P = (t: number, r: number, i: number, lift = 0): V3 => {
    const sc = (1 + (s.topScale - 1) * Math.pow(t, power)) * r;
    const p = s.poly[i];
    const k = 1 + s.round * t * (rIn / radii[i] - 1);
    const a = s.twist * t;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const x = p[0] * k * sc;
    const y = p[1] * k * sc;
    const e = Math.pow(t, 1.5);
    return [
      s.leanX * e + x * ca - y * sa,
      s.leanY * e + x * sa + y * ca,
      zb + t * (zc + r * (topZ[i] - zc) - zb) + lift,
    ];
  };
  const ring = (t: number, r: number, lift = 0): V3[] => s.poly.map((_, i) => P(t, r, i, lift));

  const loops: V3[][] = [];
  if (zb > 0) loops.push(s.poly.map((p) => [p[0], p[1], 0] as V3));
  const K = Math.max(1, s.layers);
  for (let k = 0; k <= K; k++) loops.push(ring(k / K, 1));

  let end: V3 = P(1, 0, 0);
  const D = s.topDepth;
  if (s.top === 'point') {
    end = P(1, 0, 0, D);
  } else if (s.top === 'dome') {
    const M = 5;
    for (let j = 1; j < M; j++) {
      const th = (j / M) * (Math.PI / 2);
      loops.push(ring(1, Math.cos(th), D * Math.sin(th)));
    }
    end = P(1, 0, 0, D);
  } else if (s.top === 'step') {
    loops.push(ring(1, 0.62));
    loops.push(ring(1, 0.62, D));
    end = P(1, 0, 0, D);
  } else if (s.top === 'bowl') {
    // The bowl follows the loft itself, so it always stays inside the outer wall.
    const depth = Math.min(D, 0.75 * shaft);
    const rim = 0.84;
    loops.push(ring(1, rim));
    const M = 6;
    for (let j = 1; j < M; j++) {
      const u = j / M;
      loops.push(ring(1 - (depth * (1 - (1 - u) ** 2)) / shaft, rim * (1 - u)));
    }
    end = P(1 - depth / shaft, 0, 0);
  }
  return { start: [0, 0, 0], loops, end };
}

/**
 * Outline of the shaft's cross-section at loft parameter t (same maths as the loft above,
 * ignoring the slanted top). `leanScale` scales the lean; `stride` skips outline vertices.
 */
export function sectionPolygon(s: PieceSpec, t: number, leanScale = 1, stride = 1): P2[] {
  const n = s.poly.length;
  const rIn = inradiusOf(s.poly);
  const sc = 1 + (s.topScale - 1) * Math.pow(t, Math.pow(2, s.curve * 1.6));
  const a = s.twist * t;
  const ca = Math.cos(a), sa = Math.sin(a);
  const e = Math.pow(t, 1.5) * leanScale;
  const out: P2[] = [];
  for (let i = 0; i < n; i += stride) {
    const p = s.poly[i];
    const k = (1 + s.round * t * (rIn / Math.hypot(p[0], p[1]) - 1)) * sc;
    const x = p[0] * k, y = p[1] * k;
    out.push([s.leanX * e + x * ca - y * sa, s.leanY * e + x * sa + y * ca]);
  }
  return out;
}

/** Do two convex polygons overlap by more than `tol`? (separating-axis test) */
export function convexOverlap(A: P2[], B: P2[], tol: number): boolean {
  for (const [P, Q] of [[A, B], [B, A]]) {
    for (let i = 0; i < P.length; i++) {
      const u = P[i], v = P[(i + 1) % P.length];
      let nx = v[1] - u[1], ny = u[0] - v[0];
      const len = Math.hypot(nx, ny);
      if (len < 1e-9) continue;
      nx /= len; ny /= len;
      let maxP = -Infinity, minQ = Infinity;
      for (const p of P) maxP = Math.max(maxP, p[0] * nx + p[1] * ny);
      for (const q of Q) minQ = Math.min(minQ, q[0] * nx + q[1] * ny);
      if (minQ > maxP - tol) return false; // an edge of P separates them
    }
  }
  return true;
}

/** Triangulate a chain. The result is oriented outwards (positive volume). */
export function chainMesh(c: Chain): Mesh {
  const n = c.loops[0].length;
  const verts: V3[] = [c.start];
  for (const l of c.loops) for (const v of l) verts.push(v);
  verts.push(c.end);
  const tris: [number, number, number][] = [];
  const at = (l: number, i: number) => 1 + l * n + (i % n);
  for (let i = 0; i < n; i++) tris.push([0, at(0, i + 1), at(0, i)]);
  for (let l = 0; l + 1 < c.loops.length; l++)
    for (let i = 0; i < n; i++) {
      tris.push([at(l, i), at(l, i + 1), at(l + 1, i + 1)]);
      tris.push([at(l, i), at(l + 1, i + 1), at(l + 1, i)]);
    }
  const last = c.loops.length - 1;
  const e = verts.length - 1;
  for (let i = 0; i < n; i++) tris.push([e, at(last, i), at(last, i + 1)]);
  const m = { verts, tris };
  if (signedVolume(m) < 0) for (const t of tris) [t[1], t[2]] = [t[2], t[1]];
  return m;
}

export function signedVolume(m: Mesh): number {
  let v = 0;
  for (const [a, b, c] of m.tris) {
    const p = m.verts[a];
    const q = m.verts[b];
    const r = m.verts[c];
    v +=
      p[0] * (q[1] * r[2] - q[2] * r[1]) -
      p[1] * (q[0] * r[2] - q[2] * r[0]) +
      p[2] * (q[0] * r[1] - q[1] * r[0]);
  }
  return v / 6;
}

/** True when every edge is used exactly once in each direction (closed, consistently oriented). */
export function isManifold(m: Mesh): boolean {
  const edges = new Map<string, number>();
  for (const t of m.tris)
    for (let k = 0; k < 3; k++) {
      const key = t[k] + '>' + t[(k + 1) % 3];
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  for (const [key, count] of edges) {
    if (count !== 1) return false;
    const [a, b] = key.split('>');
    if (edges.get(b + '>' + a) !== 1) return false;
  }
  return true;
}

/**
 * Can the piece be pulled straight out of a rigid mould? True when no cross-section of the
 * shaft sticks out beyond the one below it. Otherwise the mould has to be flexible (silicone).
 */
export function rigidRelease(c: Chain): boolean {
  const n = c.loops[0].length;
  // only the shaft loops are convex outlines; cap loops shrink inwards and never undercut
  for (let l = 0; l + 1 < c.loops.length; l++) {
    const a = c.loops[l];
    const b = c.loops[l + 1];
    if (b[0][2] < a[0][2] - 1e-6) break; // bowl going down: stop at the rim
    for (const p of b) {
      for (let i = 0; i < n; i++) {
        const u = a[i];
        const v = a[(i + 1) % n];
        if ((v[0] - u[0]) * (p[1] - u[1]) - (v[1] - u[1]) * (p[0] - u[0]) < -0.02) return false;
      }
    }
  }
  return true;
}
