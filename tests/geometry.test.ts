import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { DEFAULTS, PRESETS, randomise, type Design, type Footprint, type TopProfile } from '../src/params';
import { makeGrid, MAX_CELLS } from '../src/grid';
import { buildSculpture, prototypeLayout, prototypeTriangles, wallTriangles, EXPORT_BUDGET, PREVIEW_BUDGET } from '../src/build';
import { isManifold, rigidRelease, signedVolume } from '../src/piece';
import { negativeMould, siliconeBox } from '../src/mould';
import { buildKit, stlFromMesh } from '../src/exporters';

const footprints: Footprint[] = ['hex', 'square', 'triangle', 'rhombus'];
const tops: TopProfile[] = ['flat', 'point', 'dome', 'bowl', 'crown', 'step'];
const small: Partial<Design> = { wallW: 30, wallH: 24 };

describe('grid', () => {
  it('fills a square wall with the expected number of square cells', () => {
    const g = makeGrid({ ...DEFAULTS, footprint: 'square', wallShape: 'rect', wallW: 40, wallH: 40, cellSize: 40 });
    expect(g.cells.length).toBe(11 * 11);
  });
  it('rhombus grid has three cells per hexagon', () => {
    const base = { ...DEFAULTS, wallShape: 'circle' as const, wallW: 60, cellSize: 40 };
    const hex = makeGrid({ ...base, footprint: 'hex' }).cells.length;
    const rh = makeGrid({ ...base, footprint: 'rhombus' }).cells.length;
    expect(Math.abs(rh - 3 * hex)).toBeLessThan(hex);
  });
  it('caps the piece count', () => {
    const g = makeGrid({ ...DEFAULTS, wallW: 150, wallH: 150, cellSize: 15 });
    expect(g.cells.length).toBeLessThanOrEqual(MAX_CELLS);
    expect(g.cellSize).toBeGreaterThan(15);
  });
  it('ring leaves the middle empty', () => {
    const g = makeGrid({ ...DEFAULTS, wallShape: 'ring', wallW: 60, ringInner: 0.5 });
    expect(g.cells.every((c) => Math.hypot(c.x, c.y) >= 149.9)).toBe(true);
  });
});

describe('pieces and moulds', () => {
  for (const footprint of footprints)
    for (const top of tops)
      it(`${footprint}/${top} is watertight`, () => {
        const sc = buildSculpture({
          ...DEFAULTS, ...small, footprint, top, twist: 70, twistVary: 1, round: 0.5, lean: 1, slant: 1,
          curve: 0.5, vortices: 2, attractors: 1, topDepth: 1,
        });
        expect(sc.pieces.length).toBeGreaterThan(3);
        // every piece must have volume; the (slow) edge check runs on a sample
        for (const p of sc.pieces) expect(p.volume).toBeGreaterThan(0);
        for (const p of sc.pieces.filter((_, k) => k % 8 === 0)) {
          expect(isManifold(p.mesh)).toBe(true);
          expect(p.volume).toBeGreaterThan(0);
          for (const v of p.mesh.verts) expect(v[2]).toBeGreaterThanOrEqual(-1e-9);
          for (const m of [negativeMould(p.chain, 3), siliconeBox(p.chain, 3)]) {
            expect(isManifold(m)).toBe(true);
            expect(signedVolume(m)).toBeGreaterThan(0);
          }
        }
      });
  it('negative mould volume = cylinder minus piece', () => {
    const sc = buildSculpture({ ...DEFAULTS, ...small, lean: 0, slant: 0, twist: 0, top: 'flat' });
    const p = sc.pieces[0];
    const m = negativeMould(p.chain, 4);
    let R = 0, H = 0;
    for (const v of m.verts) { R = Math.max(R, Math.hypot(v[0], v[1])); H = Math.max(H, v[2]); }
    const n = p.chain.loops[0].length;
    const prism = 0.5 * n * R * R * Math.sin((2 * Math.PI) / n) * H;
    // the outer wall is an n-gon whose vertices are not evenly spaced, so allow some slack
    expect(Math.abs(signedVolume(m) + p.volume - prism) / prism).toBeLessThan(0.08);
  });
  it('straight tapered pieces release from a rigid mould, twisted ones do not', () => {
    const a = buildSculpture({ ...DEFAULTS, ...small, lean: 0, slant: 0.5, twist: 0, taper: 0.6 });
    expect(a.pieces.every((p) => rigidRelease(p.chain))).toBe(true);
    const b = buildSculpture({ ...DEFAULTS, ...small, lean: 0, twist: 90, taper: 0.9 });
    expect(b.pieces.some((p) => !rigidRelease(p.chain))).toBe(true);
  });
});

describe('sculpture', () => {
  it('is deterministic', () => {
    const a = wallTriangles(buildSculpture(DEFAULTS), 3);
    const b = wallTriangles(buildSculpture({ ...DEFAULTS }), 3);
    expect(a.length).toBe(b.length);
    expect(Array.from(a.slice(0, 3000))).toEqual(Array.from(b.slice(0, 3000)));
  });
  it('seed changes the result', () => {
    const a = buildSculpture(DEFAULTS).pieces.map((p) => p.spec.height);
    const b = buildSculpture({ ...DEFAULTS, seed: 8 }).pieces.map((p) => p.spec.height);
    expect(a).not.toEqual(b);
  });
  it('piece counts add up', () => {
    for (const pr of PRESETS) {
      const sc = buildSculpture({ ...DEFAULTS, ...pr.design });
      expect(sc.placed.length).toBeGreaterThan(20);
      expect(sc.pieces.reduce((n, p) => n + p.count, 0)).toBe(sc.placed.length);
    }
  });
  it('repeat mode yields exactly the requested modules', () => {
    for (const modules of [1, 2, 3, 4]) {
      const sc = buildSculpture({ ...DEFAULTS, mode: 'repeat', modules, rotRule: 'field' });
      expect(sc.pieces.length).toBe(modules);
    }
  });
  it('level limit reduces unique pieces', () => {
    const free = buildSculpture(DEFAULTS).pieces.length;
    const lim = buildSculpture({ ...DEFAULTS, levels: 4 }).pieces.length;
    expect(lim).toBeLessThan(free / 2);
  });
  it('lean is held back until neighbours clear each other', () => {
    const wild: Design = { ...DEFAULTS, footprint: 'triangle', mode: 'repeat', modules: 1, rotRule: 'random', lean: 1, taper: 0.5, cellSize: 60 };
    const loose = buildSculpture({ ...wild, fit: false });
    expect(loose.clashes).toBeGreaterThan(0);
    const fitted = buildSculpture(wild);
    expect(fitted.clashes).toBe(0);
    expect(fitted.leanFactor).toBeLessThan(1);
    expect(fitted.leanFactor).toBeGreaterThan(0);
  });
  it('random designs always build', () => {
    let d = DEFAULTS;
    for (let k = 0; k < 20; k++) {
      d = randomise({ ...d, wallW: 40, wallH: 30 });
      const sc = buildSculpture(d);
      expect(sc.placed.length).toBeGreaterThan(0);
      expect(sc.pieces.every((p, k) => p.volume > 0 && (k % 10 !== 0 || isManifold(p.mesh)))).toBe(true);
      expect(sc.clashes).toBe(0);
    }
  });
});

describe('smoothness', () => {
  it('more twist means more layers, and edges are subdivided', () => {
    const base = { ...DEFAULTS, ...small, lean: 0, round: 1, taper: 0.5 };
    const mild = buildSculpture({ ...base, twist: 30 }, EXPORT_BUDGET).pieces[0].spec;
    const strong = buildSculpture({ ...base, twist: 180 }, EXPORT_BUDGET).pieces[0].spec;
    expect(strong.layers).toBeGreaterThanOrEqual(60);
    expect(strong.layers).toBeGreaterThan(mild.layers);
    expect(strong.poly.length).toBeGreaterThanOrEqual(6 * 8);
  });
  it('straight prisms stay minimal', () => {
    const sc = buildSculpture({ ...DEFAULTS, ...small, lean: 0, twist: 0, curve: 0, round: 0 });
    expect(sc.pieces[0].spec.layers).toBe(1);
    expect(sc.pieces[0].spec.poly.length).toBe(6);
  });
  it('preview stays within its triangle budget and remains watertight', () => {
    const d: Design = { ...DEFAULTS, wallW: 150, wallH: 150, cellSize: 30, twist: 180, round: 1, lean: 0, top: 'dome' };
    const sc = buildSculpture(d);
    expect(sc.placed.length).toBeGreaterThan(2000);
    expect(wallTriangles(sc, 0).length / 9).toBeLessThanOrEqual(PREVIEW_BUDGET * 1.6);
    expect(isManifold(sc.pieces[0].mesh)).toBe(true);
    expect(isManifold(sc.pieces[sc.pieces.length - 1].mesh)).toBe(true);
  });
});

describe('prototype print', () => {
  const opts = { buildX: 218, buildY: 123, buildZ: 250, across: 1, down: 1, base: 2 };
  const bounds = (t: Float32Array) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < t.length; i++) {
      lo[i % 3] = Math.min(lo[i % 3], t[i]);
      hi[i % 3] = Math.max(hi[i % 3], t[i]);
    }
    return { lo, hi };
  };
  for (const [across, down] of [[1, 1], [2, 2], [3, 1]])
    it(`fits the build volume with ${across}x${down} panels`, () => {
      for (const pr of [PRESETS[0], PRESETS[1], PRESETS[5], PRESETS[6]]) {
        const d = { ...DEFAULTS, ...pr.design };
        const sc = buildSculpture(d);
        const o = { ...opts, across, down };
        const layout = prototypeLayout(sc, d, o);
        expect(layout.scale).toBeGreaterThan(0);
        const parts = prototypeTriangles(sc, o, layout);
        expect(parts.length).toBe(layout.panels.length);
        let cells = 0;
        const seen = new Set<number>();
        layout.panels.forEach((p) => p.cells.forEach((c) => (seen.add(c), cells++)));
        expect(cells).toBe(sc.placed.length); // every cell in exactly one panel
        expect(seen.size).toBe(sc.placed.length);
        for (const t of parts) {
          const { lo, hi } = bounds(t);
          expect(hi[0] - lo[0]).toBeLessThanOrEqual(o.buildX + 0.01);
          expect(hi[1] - lo[1]).toBeLessThanOrEqual(o.buildY + 0.01);
          expect(hi[2]).toBeLessThanOrEqual(o.buildZ + 0.01);
          expect(Math.abs(lo[2])).toBeLessThan(1e-3);
        }
      }
    });
  it('more panels print larger', () => {
    const sc = buildSculpture(DEFAULTS);
    const one = prototypeLayout(sc, DEFAULTS, opts).scale;
    const four = prototypeLayout(sc, DEFAULTS, { ...opts, across: 2, down: 2 }).scale;
    expect(four).toBeGreaterThan(one * 1.5);
  });
  it('pieces overlap the base and the base is the asked thickness', () => {
    const d = { ...DEFAULTS, ...small, lean: 0, twist: 0 };
    const sc = buildSculpture(d);
    const layout = prototypeLayout(sc, d, opts);
    const t = prototypeTriangles(sc, opts, layout)[0];
    const zs = new Set<string>();
    for (let i = 2; i < t.length; i += 3) zs.add(Math.abs(t[i]).toFixed(2));
    expect(zs.has('0.00')).toBe(true); // underside
    expect(zs.has('2.00')).toBe(true); // top of the base
    expect(zs.has('1.70')).toBe(true); // piece bottoms sunk 0.3 mm into it
  });
  it('warns when gaps would fuse', () => {
    const d = { ...DEFAULTS, gap: 1 };
    const l = prototypeLayout(buildSculpture(d), d, opts);
    expect(l.warnings.some((w) => w.includes('fuse'))).toBe(true);
  });
});

describe('export', () => {
  it('STL has the right size', () => {
    const p = buildSculpture({ ...DEFAULTS, ...small }).pieces[0];
    expect(stlFromMesh(p.mesh).length).toBe(84 + 50 * p.mesh.tris.length);
  });
  it('kit contains every file', async () => {
    const d: Design = { ...DEFAULTS, mode: 'repeat', modules: 3 };
    const sc = buildSculpture(d);
    const files = unzipSync(await buildKit(sc, d, { moulds: true }));
    const names = Object.keys(files).sort();
    expect(names.filter((n) => n.startsWith('pieces/')).length).toBe(3);
    expect(names.filter((n) => n.startsWith('moulds/')).length).toBe(6);
    for (const n of ['README.txt', 'design.json', 'assembly-map.svg', 'wall.stl']) expect(names).toContain(n);
    expect(JSON.parse(new TextDecoder().decode(files['design.json'])).modules).toBe(3);
  });
});
