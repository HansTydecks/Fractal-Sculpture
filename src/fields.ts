import type { Design } from './params';
import { mulberry32 } from './params';
import type { Grid } from './grid';

export interface FieldSample {
  s: number; // height field, 0..1
  vx: number; // direction field, magnitude 0..1
  vy: number;
  r: number; // normalised distance from the wall centre (ring: from mid-band)
  noise: number; // 0..1
}

function makeNoise(seed: number): (x: number, y: number) => number {
  const hash = (ix: number, iy: number) => {
    let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const value = (x: number, y: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy);
    const b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1);
    const e = hash(ix + 1, iy + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + e) * u * v;
  };
  return (x, y) => (value(x, y) * 2 + value(x * 2.1 + 17, y * 2.1 - 9)) / 3;
}

interface Centre {
  x: number;
  y: number;
  spin: number; // vortex: +1/-1 rotation; attractor: +1 pull, -1 push
}

/** Sample the height and direction fields at every cell centre. */
export function sampleFields(d: Design, g: Grid): FieldSample[] {
  const rnd = mulberry32(d.seed * 7919 + 13);
  const noise = makeNoise(d.seed);
  const half = Math.max(g.halfW, g.halfH);
  const ax = g.halfW / half;
  const ay = g.halfH / half;
  const ring = d.wallShape === 'ring';
  const round = d.wallShape !== 'rect';

  const place = (first: boolean): [number, number] => {
    if (ring) {
      if (first) return [0, 0];
      const a = rnd() * Math.PI * 2;
      const rr = (1 + d.ringInner) / 2;
      return [rr * Math.cos(a), rr * Math.sin(a)];
    }
    if (round) {
      const a = rnd() * Math.PI * 2;
      const rr = 0.7 * Math.sqrt(rnd());
      return [rr * Math.cos(a), rr * Math.sin(a)];
    }
    return [(rnd() * 2 - 1) * 0.75 * ax, (rnd() * 2 - 1) * 0.75 * ay];
  };
  const vortices: Centre[] = [];
  for (let k = 0; k < d.vortices; k++) {
    const [x, y] = place(k === 0);
    vortices.push({ x, y, spin: k % 2 === 0 ? 1 : -1 });
    rnd();
  }
  const attractors: Centre[] = [];
  for (let k = 0; k < d.attractors; k++) {
    const [x, y] = place(false);
    attractors.push({ x, y, spin: rnd() < 0.5 ? 1 : -1 });
  }
  const reach = Math.max(0.05, d.reach);
  const wa = (d.waveAngle * Math.PI) / 180;
  const wphase = rnd() * Math.PI * 2;

  let maxR = 1e-9;
  for (const c of g.cells) maxR = Math.max(maxR, Math.hypot(c.x, c.y));
  const inner = ring ? g.halfW * d.ringInner : 0;

  const raw: number[] = [];
  const out: FieldSample[] = g.cells.map((c) => {
    const u = c.x / half;
    const v = c.y / half;
    const rad = Math.hypot(c.x, c.y);
    const r = ring
      ? Math.min(1, Math.abs((2 * (rad - inner)) / Math.max(1e-9, maxR - inner) - 1))
      : rad / maxR;
    let vx = 0;
    let vy = 0;
    let bump = 0;
    for (const list of [vortices, attractors]) {
      for (const k of list) {
        const dx = u - k.x;
        const dy = v - k.y;
        const dist = Math.hypot(dx, dy);
        const fall = 1 / (1 + (dist / reach) ** 2);
        const soft = dist / (dist + 0.04);
        const nx = dist > 1e-9 ? dx / dist : 0;
        const ny = dist > 1e-9 ? dy / dist : 0;
        if (list === vortices) {
          vx += -ny * k.spin * fall * soft * 1.6;
          vy += nx * k.spin * fall * soft * 1.6;
        } else {
          vx += -nx * k.spin * fall * soft * 1.6;
          vy += -ny * k.spin * fall * soft * 1.6;
        }
        bump += Math.exp(-((dist / (reach * 0.8)) ** 2));
      }
    }
    if (vortices.length + attractors.length === 0) {
      // No sources: pieces are pushed gently outwards from the wall centre.
      const k = rad / maxR;
      vx = rad > 1e-9 ? (c.x / rad) * k : 0;
      vy = rad > 1e-9 ? (c.y / rad) * k : 0;
    }
    const mag = Math.hypot(vx, vy);
    if (mag > 1) {
      vx /= mag;
      vy /= mag;
    }
    const n = noise(u * d.noiseScale + 31.7, v * d.noiseScale + 11.3);
    const wave = Math.sin((u * Math.cos(wa) + v * Math.sin(wa)) * d.waveFreq * Math.PI + wphase);
    raw.push(
      0.5 +
        d.heightRadial * (0.5 - r) +
        d.heightCentres * (Math.min(1, bump) - 0.4) +
        d.heightWave * 0.5 * wave +
        d.heightNoise * (n - 0.5),
    );
    return { s: 0, vx, vy, r, noise: n };
  });

  // Stretch the height field so the wall always uses the full height range.
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of raw) {
    lo = Math.min(lo, x);
    hi = Math.max(hi, x);
  }
  const span = hi - lo;
  out.forEach((o, k) => (o.s = span > 1e-6 ? (raw[k] - lo) / span : 1));
  return out;
}
