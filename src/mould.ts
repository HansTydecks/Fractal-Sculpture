import { chainMesh, type Chain, type Mesh, type V3 } from './piece';

function extent(c: Chain): { maxR: number; maxZ: number } {
  let maxR = 0;
  let maxZ = c.end[2];
  for (const l of c.loops)
    for (const v of l) {
      maxR = Math.max(maxR, Math.hypot(v[0], v[1]));
      maxZ = Math.max(maxZ, v[2]);
    }
  return { maxR, maxZ };
}

/** A circle with one vertex at the bearing of each footprint vertex, so it stitches to the piece. */
function circle(c: Chain, radius: number, z: number): V3[] {
  return c.loops[0].map((v) => {
    const a = Math.atan2(v[1], v[0]);
    return [radius * Math.cos(a), radius * Math.sin(a), z] as V3;
  });
}

/**
 * Negative mould: a solid cylinder with the piece as a cavity. Returned with the opening
 * facing up, ready to print (in flexible filament unless the piece releases from a rigid mould)
 * and to pour resin into.
 */
export function negativeMould(c: Chain, wall: number): Mesh {
  const { maxR, maxZ } = extent(c);
  const R = maxR + wall;
  const H = maxZ + wall;
  const m = chainMesh({
    start: [0, 0, H],
    loops: [circle(c, R, H), circle(c, R, 0), ...c.loops],
    end: c.end,
  });
  // half-turn about the x axis: a proper rotation, so the cavity is not mirrored
  m.verts = m.verts.map((v) => [v[0], -v[1], H - v[2]] as V3);
  return m;
}

/**
 * Silicone box: the piece standing on a floor inside a walled cup. Print it, pour silicone
 * around the piece, and the cured silicone is a reusable flexible mould for resin.
 */
export function siliconeBox(c: Chain, wall: number): Mesh {
  const { maxR, maxZ } = extent(c);
  const Ri = maxR + Math.max(6, wall * 2); // silicone thickness around the piece
  const Ro = Ri + wall;
  const H = maxZ + Math.max(6, wall * 2);
  return chainMesh({
    start: [0, 0, -wall],
    loops: [circle(c, Ro, -wall), circle(c, Ro, H), circle(c, Ri, H), circle(c, Ri, 0), ...c.loops],
    end: c.end,
  });
}
