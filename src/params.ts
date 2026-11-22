// Every sculpture is fully determined by one flat `Design` object.

export type Mode = 'field' | 'repeat';
export type WallShape = 'rect' | 'circle' | 'hex' | 'ring';
export type Footprint = 'hex' | 'square' | 'triangle' | 'rhombus';
export type TopProfile = 'flat' | 'point' | 'dome' | 'bowl' | 'crown' | 'step';
export type RotRule = 'field' | 'radial' | 'tangent' | 'checker' | 'rows' | 'random' | 'uniform';
export type ColourBy = 'height' | 'radius' | 'angle' | 'x' | 'y' | 'z' | 'noise';

export interface Design {
  seed: number;
  mode: Mode;
  // base / wall
  wallShape: WallShape;
  wallW: number; // cm
  wallH: number; // cm (rect only)
  ringInner: number; // inner / outer radius ratio
  backplate: number; // mm, 0 = none
  // grid
  footprint: Footprint;
  cellSize: number; // mm
  gap: number; // mm
  // piece
  baseH: number; // mm straight plinth
  minH: number; // mm
  maxH: number; // mm
  taper: number; // top scale
  curve: number; // -1..1 side profile
  twist: number; // degrees
  twistVary: number; // 0..1 twist follows the height field
  lean: number; // 0..1
  fit: boolean; // reduce lean until no piece hits a neighbour
  slant: number; // 0..1 top cut
  round: number; // 0..1 morph to circle
  top: TopProfile;
  topDepth: number; // 0..1
  // fields
  vortices: number;
  attractors: number;
  reach: number;
  heightRadial: number; // -1..1
  heightCentres: number; // -1..1
  heightWave: number; // 0..1
  waveFreq: number;
  waveAngle: number; // degrees
  heightNoise: number; // 0..1
  noiseScale: number;
  // arrangement
  levels: number; // field mode: 0 = every piece unique
  modules: number; // repeat mode: distinct piece designs
  rotRule: RotRule;
  // colour
  palette: string;
  colourBy: ColourBy;
  reverse: boolean;
  colourA: string;
  colourB: string;
  board: string;
  // light
  lightAngle: number;
  lightElev: number;
  // fabrication
  mouldWall: number; // mm
}

export const DEFAULTS: Design = {
  seed: 7,
  mode: 'field',
  wallShape: 'rect',
  wallW: 70,
  wallH: 46,
  ringInner: 0.45,
  backplate: 3,
  footprint: 'hex',
  cellSize: 36,
  gap: 1,
  baseH: 4,
  minH: 12,
  maxH: 80,
  taper: 0.55,
  curve: 0.2,
  twist: 0,
  twistVary: 0,
  lean: 0.6,
  fit: true,
  slant: 0.3,
  round: 0,
  top: 'flat',
  topDepth: 0.5,
  vortices: 2,
  attractors: 0,
  reach: 0.6,
  heightRadial: 0,
  heightCentres: 0.8,
  heightWave: 0,
  waveFreq: 3,
  waveAngle: 30,
  heightNoise: 0.1,
  noiseScale: 2,
  levels: 0,
  modules: 2,
  rotRule: 'field',
  palette: 'ember',
  colourBy: 'height',
  reverse: false,
  colourA: '#1f3b73',
  colourB: '#f2c14e',
  board: '#1b1c20',
  lightAngle: 135,
  lightElev: 32,
  mouldWall: 3,
};

export const PALETTES: Record<string, string[]> = {
  ember: ['#2a0a12', '#8f1d21', '#e4572e', '#f9a03f', '#ffe9a8'],
  lagoon: ['#0b1d3a', '#0f4c75', '#1b9aaa', '#7fdbca', '#f1fff7'],
  moss: ['#10240f', '#2f5d2b', '#6a994e', '#a7c957', '#f2f6c8'],
  dusk: ['#1a1446', '#5b2a86', '#c2408f', '#f58a6c', '#ffd9a0'],
  glacier: ['#22303f', '#4f7a94', '#9cc5d3', '#e3f1f2', '#ffffff'],
  bone: ['#efeae0'],
  graphite: ['#3a3d44'],
  terracotta: ['#c8643c'],
  custom: [],
};

export interface Preset {
  name: string;
  note: string;
  design: Partial<Design>;
}

export const PRESETS: Preset[] = [
  {
    name: 'Twin Eddies',
    note: 'Two counter-rotating swirls push leaning columns',
    design: {},
  },
  {
    name: 'Tide Ring',
    note: 'A loop of twisting sprouts, tallest mid-band',
    design: {
      seed: 21, wallShape: 'ring', wallW: 90, ringInner: 0.5, cellSize: 34, vortices: 1, attractors: 0,
      heightRadial: 1, heightCentres: 0, heightNoise: 0, minH: 15, maxH: 110, taper: 0.4, twist: 60,
      lean: 0.8, slant: 0.5, round: 0.6, palette: 'lagoon', colourBy: 'z', lightAngle: 60,
    },
  },
  {
    name: 'Basalt Bloom',
    note: 'Radial burst of faceted columns, short at the rim',
    design: {
      seed: 4, wallShape: 'hex', wallW: 80, cellSize: 40, vortices: 0, attractors: 0, heightRadial: 1,
      heightCentres: 0, heightNoise: 0.15, minH: 10, maxH: 130, taper: 0.7, curve: -0.3, lean: 0.5,
      slant: 0.7, top: 'flat', palette: 'dusk', colourBy: 'radius', reverse: true,
    },
  },
  {
    name: 'Honeycomb Wells',
    note: 'Bowls whose rims rise and fall with a wave',
    design: {
      seed: 12, wallShape: 'rect', wallW: 70, wallH: 46, cellSize: 44, gap: 0.6, vortices: 0, attractors: 2,
      heightRadial: 0, heightCentres: -0.9, heightWave: 0.3, minH: 14, maxH: 60, taper: 0.9, curve: 0,
      lean: 0.15, slant: 0.5, top: 'bowl', topDepth: 0.9, palette: 'moss', colourBy: 'height',
    },
  },
  {
    name: 'Paper Crown',
    note: 'Folded-paper facets in a single bone white',
    design: {
      seed: 33, wallShape: 'circle', wallW: 80, footprint: 'square', cellSize: 46, gap: 0.4, vortices: 3,
      attractors: 0, reach: 0.9, heightCentres: 0.5, heightNoise: 0.3, minH: 10, maxH: 55, taper: 0.8,
      twist: 25, twistVary: 1, lean: 0.4, slant: 0.6, top: 'crown', topDepth: 0.7, palette: 'bone',
      lightAngle: 160, lightElev: 20,
    },
  },
  {
    name: 'Tumbling Blocks',
    note: 'Three rhombus modules, one mould each',
    design: {
      seed: 5, mode: 'repeat', wallShape: 'hex', wallW: 70, footprint: 'rhombus', cellSize: 60, gap: 0.8,
      modules: 3, rotRule: 'uniform', vortices: 0, attractors: 0, heightRadial: 0, heightCentres: 0,
      heightWave: 1, waveFreq: 2.5, heightNoise: 0, minH: 12, maxH: 40, taper: 0.85, curve: 0, lean: 0,
      slant: 0.9, top: 'flat', palette: 'glacier', colourBy: 'height', lightAngle: 120,
    },
  },
  {
    name: 'Pinwheel Tiles',
    note: 'One triangle module turned by a swirl',
    design: {
      seed: 9, mode: 'repeat', wallShape: 'rect', wallW: 64, wallH: 64, footprint: 'triangle', cellSize: 64,
      gap: 0.8, modules: 1, rotRule: 'field', vortices: 2, attractors: 1, reach: 1, minH: 10, maxH: 34,
      taper: 0.5, curve: 0.4, lean: 0.9, slant: 0.8, top: 'point', topDepth: 0.2, palette: 'terracotta',
      lightAngle: 200, lightElev: 24,
    },
  },
  {
    name: 'Dune Field',
    note: 'Square tiles, four heights, wave-sorted',
    design: {
      seed: 14, mode: 'repeat', wallShape: 'rect', wallW: 100, wallH: 50, footprint: 'square', cellSize: 42,
      gap: 0.6, modules: 4, rotRule: 'checker', vortices: 0, attractors: 0, heightWave: 1, waveFreq: 2,
      waveAngle: 20, heightNoise: 0.35, heightCentres: 0, minH: 8, maxH: 50, taper: 0.6, curve: 0.6,
      lean: 0.3, slant: 0.6, round: 0.5, top: 'dome', topDepth: 0.35, palette: 'ember', colourBy: 'x',
    },
  },
];

/** Small fast deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh random design. Wall dimensions and fabrication settings are kept. */
export function randomise(current: Design): Design {
  const seed = Math.floor(Math.random() * 1e6);
  const r = mulberry32(seed);
  const pick = <T,>(a: T[]): T => a[Math.floor(r() * a.length)];
  const range = (lo: number, hi: number, step = 0.01) => Math.round((lo + r() * (hi - lo)) / step) * step;
  const mode: Mode = r() < 0.65 ? 'field' : 'repeat';
  const footprint = pick<Footprint>(['hex', 'hex', 'hex', 'square', 'triangle', 'rhombus']);
  const size = Math.min(current.wallW, current.wallShape === 'rect' ? current.wallH : current.wallW) * 10;
  const heightSources = [r() < 0.5, r() < 0.5, r() < 0.3, r() < 0.4];
  if (!heightSources.some(Boolean)) heightSources[0] = true;
  const maxH = range(30, 130, 1);
  const palettes = Object.keys(PALETTES).filter((p) => p !== 'custom');
  return {
    ...current,
    seed,
    mode,
    footprint,
    cellSize: Math.round(Math.max(18, Math.min(70, size / range(8, 18))) * (footprint === 'hex' ? 1 : 1.3)),
    gap: range(0.4, 1.6, 0.2),
    minH: range(6, 20, 1),
    maxH,
    taper: range(0.3, 1),
    curve: range(-0.5, 0.7),
    twist: r() < 0.35 ? range(-90, 90, 5) : 0,
    twistVary: r() < 0.3 ? 1 : 0,
    lean: r() < 0.8 ? range(0.2, 1) : 0,
    slant: r() < 0.7 ? range(0.2, 0.9) : 0,
    round: r() < 0.3 ? range(0.3, 1) : 0,
    top: pick<TopProfile>(['flat', 'flat', 'point', 'dome', 'bowl', 'crown', 'step']),
    topDepth: range(0.2, 0.9),
    vortices: Math.floor(r() * 5),
    attractors: Math.floor(r() * 3),
    reach: range(0.3, 1.2),
    heightRadial: heightSources[0] ? range(-1, 1) : 0,
    heightCentres: heightSources[1] ? range(-1, 1) : 0,
    heightWave: heightSources[2] ? range(0.3, 1) : 0,
    waveFreq: range(1, 5, 0.5),
    waveAngle: range(0, 180, 5),
    heightNoise: heightSources[3] ? range(0.2, 0.8) : 0,
    noiseScale: range(1, 4, 0.5),
    levels: 0,
    modules: 1 + Math.floor(r() * 4),
    rotRule: pick<RotRule>(['field', 'radial', 'tangent', 'checker', 'rows', 'random']),
    palette: pick(palettes),
    colourBy: pick<ColourBy>(['height', 'height', 'radius', 'angle', 'x', 'y', 'z']),
    reverse: r() < 0.5,
    lightAngle: range(0, 360, 5),
  };
}
