import { zip, strToU8 } from 'fflate';
import type { Design } from './params';
import { prototypeLayout, prototypeTriangles, wallTriangles, type PrototypeOptions, type Sculpture } from './build';
import { negativeMould, siliconeBox } from './mould';
import { rigidRelease, type Mesh } from './piece';

/** Binary STL from a flat triangle soup (9 floats per triangle, mm). */
export function stlFromTriangles(tris: Float32Array): Uint8Array {
  const n = tris.length / 9;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, n, true);
  let o = 84;
  for (let t = 0; t < n; t++) {
    const p = t * 9;
    const ux = tris[p + 3] - tris[p], uy = tris[p + 4] - tris[p + 1], uz = tris[p + 5] - tris[p + 2];
    const vx = tris[p + 6] - tris[p], vy = tris[p + 7] - tris[p + 1], vz = tris[p + 8] - tris[p + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
    for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, tris[p + k], true);
    o += 50;
  }
  return new Uint8Array(buf);
}

export function stlFromMesh(m: Mesh): Uint8Array {
  const tris = new Float32Array(m.tris.length * 9);
  let o = 0;
  for (const t of m.tris)
    for (const i of t) {
      const v = m.verts[i];
      tris[o++] = v[0]; tris[o++] = v[1]; tris[o++] = v[2];
    }
  return stlFromTriangles(tris);
}

export function wallStl(sc: Sculpture, d: Design): Uint8Array {
  // sink the pieces slightly into the back plate so slicers fuse them into one solid
  return stlFromTriangles(wallTriangles(sc, { backplate: d.backplate, sink: 0.3 }));
}

const label = (i: number) => 'P' + String(i + 1).padStart(3, '0');
const hex2 = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');

/** Numbered plan of the wall: which piece goes where, and which way it is turned. */
export function assemblyMapSvg(sc: Sculpture): string {
  const g = sc.grid;
  const pad = g.cellSize;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of sc.placed) {
    x0 = Math.min(x0, p.cell.x); x1 = Math.max(x1, p.cell.x);
    y0 = Math.min(y0, p.cell.y); y1 = Math.max(y1, p.cell.y);
  }
  x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
  const fs = (g.inradius * 0.5).toFixed(1);
  const parts: string[] = [];
  for (const p of sc.placed) {
    const c = Math.cos(p.cell.rot), s = Math.sin(p.cell.rot);
    // y is flipped so the map reads the same way up as the wall
    const pts = g.poly
      .map((v) => `${(p.cell.x + v[0] * c - v[1] * s - x0).toFixed(1)},${(y1 - (p.cell.y + v[0] * s + v[1] * c)).toFixed(1)}`)
      .join(' ');
    const fill = '#' + p.colour.map(hex2).join('');
    const cx = p.cell.x - x0, cy = y1 - p.cell.y;
    const lum = 0.3 * p.colour[0] + 0.6 * p.colour[1] + 0.1 * p.colour[2];
    const ink = lum > 0.55 ? '#111' : '#fff';
    const r = g.inradius * 0.8;
    parts.push(
      `<polygon points="${pts}" fill="${fill}" stroke="#222" stroke-width="0.4"/>`,
      `<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${(cx + r * Math.cos(p.rot)).toFixed(1)}" y2="${(cy - r * Math.sin(p.rot)).toFixed(1)}" stroke="${ink}" stroke-width="0.6"/>`,
      `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" fill="${ink}" font-size="${fs}" text-anchor="middle" dominant-baseline="central" font-family="sans-serif">${p.piece + 1}</text>`,
    );
  }
  const w = x1 - x0, h = y1 - y0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(1)} ${h.toFixed(1)}" width="${w.toFixed(0)}mm" height="${h.toFixed(0)}mm">\n<rect width="100%" height="100%" fill="#fff"/>\n${parts.join('\n')}\n</svg>\n`;
}

function readme(sc: Sculpture, d: Design, moulds: boolean): string {
  const lines = [
    'FRACTAL SCULPTURE - fabrication kit',
    '',
    `Wall: ${(sc.width / 10).toFixed(1)} x ${(sc.height / 10).toFixed(1)} cm, ${sc.depth.toFixed(0)} mm deep`,
    `Pieces: ${sc.placed.length} total, ${sc.pieces.length} unique shapes`,
    `Solid volume of all pieces: ${(sc.volume / 1e6).toFixed(2)} litres`,
    'All STL files are in millimetres.',
    '',
    'pieces/            one STL per unique shape; the file name ends with how many to make',
    'assembly-map.svg   each cell shows its piece number; the line marks the direction the',
    '                   piece\'s local +X axis points on the wall (view from the front)',
    'wall.stl           the whole sculpture as one file' + (d.backplate > 0 ? ' (with back plate)' : ''),
    'design.json        load this file in the generator to reopen the design',
  ];
  if (moulds)
    lines.push(
      'moulds/*_negative.stl      cavity mould, opening up. "rigid" pieces pull straight out of',
      '                           a hard print; the others need a flexible (TPU) print.',
      '                           Use mould release.',
      'moulds/*_silicone_box.stl  the piece standing in a cup: print, fill with silicone,',
      '                           and the cured silicone is a reusable mould for resin.',
    );
  lines.push('', 'piece  count  height_mm  volume_cm3  release');
  for (const p of sc.pieces)
    lines.push(
      `${label(p.index)}   ${String(p.count).padStart(5)}  ${p.maxZ.toFixed(1).padStart(9)}  ${(p.volume / 1000).toFixed(1).padStart(10)}  ${rigidRelease(p.chain) ? 'rigid' : 'flexible'}`,
    );
  return lines.join('\n') + '\n';
}

export interface KitOptions {
  moulds: boolean;
}

/** Everything needed to make the wall, as one ZIP. */
export function buildKit(sc: Sculpture, d: Design, opt: KitOptions): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {
    'README.txt': strToU8(readme(sc, d, opt.moulds)),
    'design.json': strToU8(JSON.stringify(d, null, 2)),
    'assembly-map.svg': strToU8(assemblyMapSvg(sc)),
    'wall.stl': wallStl(sc, d),
  };
  for (const p of sc.pieces) {
    const name = label(p.index);
    files[`pieces/${name}_x${p.count}.stl`] = stlFromMesh(p.mesh);
    if (opt.moulds) {
      files[`moulds/${name}_negative.stl`] = stlFromMesh(negativeMould(p.chain, d.mouldWall));
      files[`moulds/${name}_silicone_box.stl`] = stlFromMesh(siliconeBox(p.chain, d.mouldWall));
    }
  }
  return new Promise((resolve, reject) =>
    zip(files, { level: 6 }, (err, data) => (err ? reject(err) : resolve(data))),
  );
}

/** Scaled-down print of the whole wall: one STL, or a ZIP of panel STLs with a plan. */
export async function buildPrototype(
  sc: Sculpture,
  d: Design,
  o: PrototypeOptions,
): Promise<{ data: Uint8Array; zipped: boolean; panels: number }> {
  const layout = prototypeLayout(sc, d, o);
  if (layout.scale <= 0) throw new Error('the wall does not fit this build volume');
  const parts = prototypeTriangles(sc, o, layout).map(stlFromTriangles);
  if (parts.length === 1) return { data: parts[0], zipped: false, panels: 1 };
  const files: Record<string, Uint8Array> = { 'assembly-map.svg': strToU8(assemblyMapSvg(sc)) };
  const lines = [
    `Prototype at ${(layout.scale * 100).toFixed(1)}% scale, ${parts.length} panels.`,
    'Panels are numbered left to right, bottom row first, as seen from the front.',
    'Panels marked "turned" were rotated a quarter turn anticlockwise to fit the plate.',
    '',
  ];
  layout.panels.forEach((p, i) => {
    const name = `panel-${String(i + 1).padStart(2, '0')}.stl`;
    files[name] = parts[i];
    lines.push(`${name}  ${(p.w * layout.scale).toFixed(0)} x ${(p.h * layout.scale).toFixed(0)} mm${p.rotated ? '  turned' : ''}`);
  });
  files['README.txt'] = strToU8(lines.join('\n') + '\n');
  const data = await new Promise<Uint8Array>((resolve, reject) =>
    zip(files, { level: 6 }, (err, out) => (err ? reject(err) : resolve(out))),
  );
  return { data, zipped: true, panels: parts.length };
}
