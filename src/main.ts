import './style.css';
import { DEFAULTS, PALETTES, PRESETS, randomise, type Design } from './params';
import { buildSculpture, prototypeLayout, EXPORT_BUDGET, type PrototypeOptions, type Sculpture } from './build';
import { Viewer } from './viewer';
import { buildKit, buildPrototype, wallStl } from './exporters';

type Key = keyof Design;
interface Ctl {
  key: Key;
  label: string;
  kind: 'range' | 'select' | 'seg' | 'color' | 'check';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: [string, string][];
  show?: (d: Design) => boolean;
  light?: boolean; // only affects lighting, no rebuild needed
}
interface Group {
  title: string;
  open?: boolean;
  hint?: (d: Design) => string;
  controls: Ctl[];
}

const field = (d: Design) => d.mode === 'field';
const repeat = (d: Design) => d.mode === 'repeat';
const usesField = (d: Design) => field(d) || d.rotRule === 'field';

const GROUPS: Group[] = [
  {
    title: 'Arrangement',
    open: true,
    hint: (d) =>
      field(d)
        ? 'Every piece is shaped by the fields. Limit the shapes to reuse moulds.'
        : 'A few identical modules, turned by a rule. One mould per module.',
    controls: [
      { key: 'mode', label: 'Mode', kind: 'seg', options: [['field', 'Field-driven'], ['repeat', 'Repeat modules']] },
      { key: 'levels', label: 'Shape limit', kind: 'range', min: 0, max: 12, step: 1, show: field },
      { key: 'modules', label: 'Modules', kind: 'range', min: 1, max: 4, step: 1, show: repeat },
      {
        key: 'rotRule', label: 'Turn rule', kind: 'select', show: repeat,
        options: [['field', 'Follow the flow'], ['radial', 'Point outwards'], ['tangent', 'Circle the centre'], ['checker', 'Checker'], ['rows', 'Row by row'], ['random', 'Random'], ['uniform', 'All the same']],
      },
    ],
  },
  {
    title: 'Wall',
    open: true,
    controls: [
      { key: 'wallShape', label: 'Outline', kind: 'select', options: [['rect', 'Rectangle'], ['circle', 'Circle'], ['hex', 'Hexagon'], ['ring', 'Ring']] },
      { key: 'wallW', label: 'Width', kind: 'range', min: 20, max: 150, step: 1, unit: 'cm' },
      { key: 'wallH', label: 'Height', kind: 'range', min: 20, max: 150, step: 1, unit: 'cm', show: (d) => d.wallShape === 'rect' },
      { key: 'ringInner', label: 'Ring hole', kind: 'range', min: 0.2, max: 0.8, step: 0.01, show: (d) => d.wallShape === 'ring' },
      { key: 'footprint', label: 'Cell shape', kind: 'select', options: [['hex', 'Hexagon'], ['square', 'Square'], ['triangle', 'Triangle'], ['rhombus', 'Rhombus']] },
      { key: 'cellSize', label: 'Cell size', kind: 'range', min: 15, max: 90, step: 1, unit: 'mm' },
      { key: 'gap', label: 'Gap', kind: 'range', min: 0, max: 4, step: 0.1, unit: 'mm' },
      { key: 'backplate', label: 'Back plate', kind: 'range', min: 0, max: 10, step: 0.5, unit: 'mm' },
    ],
  },
  {
    title: 'Piece',
    open: true,
    controls: [
      { key: 'minH', label: 'Shortest', kind: 'range', min: 3, max: 120, step: 1, unit: 'mm' },
      { key: 'maxH', label: 'Tallest', kind: 'range', min: 5, max: 200, step: 1, unit: 'mm' },
      { key: 'baseH', label: 'Plinth', kind: 'range', min: 0, max: 15, step: 0.5, unit: 'mm' },
      { key: 'taper', label: 'Taper', kind: 'range', min: 0.1, max: 1, step: 0.01 },
      { key: 'curve', label: 'Side curve', kind: 'range', min: -1, max: 1, step: 0.05 },
      { key: 'lean', label: 'Lean', kind: 'range', min: 0, max: 1, step: 0.01 },
      { key: 'fit', label: 'Avoid clashes', kind: 'check' },
      { key: 'slant', label: 'Slanted top', kind: 'range', min: 0, max: 1, step: 0.01 },
      { key: 'twist', label: 'Twist', kind: 'range', min: -180, max: 180, step: 5, unit: '°' },
      { key: 'twistVary', label: 'Twist varies', kind: 'range', min: 0, max: 1, step: 0.05, show: (d) => d.twist !== 0 },
      { key: 'round', label: 'Round off', kind: 'range', min: 0, max: 1, step: 0.01 },
      { key: 'top', label: 'Top', kind: 'select', options: [['flat', 'Flat'], ['point', 'Point'], ['dome', 'Dome'], ['bowl', 'Bowl'], ['crown', 'Folded crown'], ['step', 'Step']] },
      { key: 'topDepth', label: 'Top depth', kind: 'range', min: 0.05, max: 1, step: 0.01, show: (d) => d.top !== 'flat' },
    ],
  },
  {
    title: 'Fields',
    hint: () => 'Swirls and attractors set which way pieces lean; the height sources set how tall they grow.',
    controls: [
      { key: 'vortices', label: 'Swirls', kind: 'range', min: 0, max: 6, step: 1, show: usesField },
      { key: 'attractors', label: 'Attractors', kind: 'range', min: 0, max: 4, step: 1, show: usesField },
      { key: 'reach', label: 'Reach', kind: 'range', min: 0.15, max: 1.5, step: 0.01 },
      { key: 'heightRadial', label: 'Centre ↔ edge', kind: 'range', min: -1, max: 1, step: 0.05 },
      { key: 'heightCentres', label: 'Near swirls', kind: 'range', min: -1, max: 1, step: 0.05 },
      { key: 'heightWave', label: 'Wave', kind: 'range', min: 0, max: 1, step: 0.05 },
      { key: 'waveFreq', label: 'Wave count', kind: 'range', min: 0.5, max: 8, step: 0.5, show: (d) => d.heightWave > 0 },
      { key: 'waveAngle', label: 'Wave angle', kind: 'range', min: 0, max: 180, step: 5, unit: '°', show: (d) => d.heightWave > 0 },
      { key: 'heightNoise', label: 'Noise', kind: 'range', min: 0, max: 1, step: 0.05 },
      { key: 'noiseScale', label: 'Noise scale', kind: 'range', min: 0.5, max: 6, step: 0.5, show: (d) => d.heightNoise > 0 },
    ],
  },
  {
    title: 'Colour & light',
    controls: [
      { key: 'palette', label: 'Palette', kind: 'select', options: Object.keys(PALETTES).map((p) => [p, p[0].toUpperCase() + p.slice(1)] as [string, string]) },
      { key: 'colourA', label: 'From', kind: 'color', show: (d) => d.palette === 'custom' },
      { key: 'colourB', label: 'To', kind: 'color', show: (d) => d.palette === 'custom' },
      {
        key: 'colourBy', label: 'Colour by', kind: 'select',
        options: [['height', 'Piece height'], ['z', 'Height along piece'], ['radius', 'Distance from centre'], ['angle', 'Flow direction'], ['x', 'Left to right'], ['y', 'Bottom to top'], ['noise', 'Noise']],
      },
      { key: 'reverse', label: 'Reverse', kind: 'check' },
      { key: 'board', label: 'Back plate', kind: 'color' },
      { key: 'lightAngle', label: 'Light from', kind: 'range', min: 0, max: 360, step: 5, unit: '°', light: true },
      { key: 'lightElev', label: 'Light height', kind: 'range', min: 8, max: 80, step: 1, unit: '°', light: true },
    ],
  },
  {
    title: 'Moulds',
    controls: [{ key: 'mouldWall', label: 'Wall thickness', kind: 'range', min: 1.5, max: 8, step: 0.5, unit: 'mm' }],
  },
];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let design: Design = { ...DEFAULTS };
let sculpture: Sculpture;
let activePreset = PRESETS[0].name;
const viewer = new Viewer($<HTMLCanvasElement>('view'));
const refreshers: (() => void)[] = [];

const PROTO_KEY = 'fractal-sculpture-printer';
let proto: PrototypeOptions = { buildX: 218, buildY: 123, buildZ: 250, across: 1, down: 1, base: 2 };
try {
  // the printer's build volume is worth remembering between visits
  const saved = JSON.parse(localStorage.getItem(PROTO_KEY) ?? '{}');
  for (const k of ['buildX', 'buildY', 'buildZ', 'base'] as const)
    if (typeof saved[k] === 'number' && saved[k] > 0) proto[k] = saved[k];
} catch {
  /* storage unavailable: defaults are fine */
}

function protoInfo() {
  const l = prototypeLayout(sculpture, design, proto);
  const n = l.panels.length;
  const el = $('protoInfo');
  el.textContent =
    l.scale <= 0
      ? 'Does not fit this build volume.'
      : `Scale ${(l.scale * 100).toFixed(l.scale < 0.1 ? 1 : 0)}% → ${n > 1 ? `${n} panels, largest ` : ''}${l.size[0].toFixed(0)} × ${l.size[1].toFixed(0)} × ${l.size[2].toFixed(0)} mm`;
  for (const w of l.warnings) {
    const span = document.createElement('span');
    span.className = 'warn';
    span.textContent = w;
    el.append(span);
  }
}

function fmt(v: number, step = 1) {
  return step >= 1 ? String(Math.round(v)) : v.toFixed(step >= 0.1 ? 1 : 2);
}

function rebuild() {
  sculpture = buildSculpture(design);
  viewer.setSculpture(sculpture, design);
  const s = sculpture;
  const cellNote = s.grid.cellSize > design.cellSize + 0.5 ? ` (cells enlarged to ${s.grid.cellSize.toFixed(0)} mm)` : '';
  $('stats').innerHTML =
    `<span><b>${s.placed.length}</b> pieces${cellNote}</span>` +
    `<span><b>${s.pieces.length}</b> unique shape${s.pieces.length === 1 ? '' : 's'}</span>` +
    `<span><b>${(s.width / 10).toFixed(0)} × ${(s.height / 10).toFixed(0)}</b> cm</span>` +
    `<span><b>${s.depth.toFixed(0)}</b> mm deep</span>` +
    `<span><b>${(s.volume / 1e6).toFixed(1)}</b> L solid</span>` +
    (s.twistFactor < 0.995 ? `<span class="note">twist held to ${Math.round(s.twistFactor * 100)}% so pieces clear each other</span>` : '') +
    (s.leanFactor < 0.995 ? `<span class="note">lean held to ${Math.round(s.leanFactor * 100)}% so pieces clear each other</span>` : '') +
    (s.clashes > 0 ? `<span class="warn"><b>${s.clashes}</b> pieces touch a neighbour — ${design.fit ? 'add gap or taper' : 'turn on “Avoid clashes”'}</span>` : '');
  protoInfo();
}

let timer = 0;
function schedule(lightOnly = false) {
  if (lightOnly) return viewer.setLight(design, sculpture.depth);
  clearTimeout(timer);
  timer = window.setTimeout(rebuild, 40);
}

function set<K extends Key>(key: K, value: Design[K], lightOnly = false) {
  design = { ...design, [key]: value };
  activePreset = '';
  refresh();
  schedule(lightOnly);
}

function refresh() {
  for (const r of refreshers) r();
  $<HTMLInputElement>('seed').value = String(design.seed);
  document.querySelectorAll<HTMLButtonElement>('#presets button').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.name === activePreset)),
  );
}

function buildControls() {
  const root = $('controls');
  for (const g of GROUPS) {
    const det = document.createElement('details');
    det.open = !!g.open;
    const sum = document.createElement('summary');
    sum.textContent = g.title;
    det.append(sum);
    if (g.hint) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      det.append(hint);
      refreshers.push(() => (hint.textContent = g.hint!(design)));
    }
    for (const c of g.controls) {
      const row = document.createElement('div');
      row.className = 'ctl' + (c.kind === 'range' ? '' : ' wide');
      const id = 'c-' + c.key;
      const label = document.createElement('label');
      label.htmlFor = id;
      label.textContent = c.label;
      row.append(label);
      if (c.kind === 'range') {
        const input = document.createElement('input');
        input.type = 'range';
        input.id = id;
        input.min = String(c.min);
        input.max = String(c.max);
        input.step = String(c.step);
        const out = document.createElement('output');
        input.addEventListener('input', () => set(c.key, Number(input.value) as never, c.light));
        row.append(input, out);
        refreshers.push(() => {
          const v = design[c.key] as number;
          input.value = String(v);
          out.textContent =
            c.key === 'levels' && v < 2 ? 'off' : fmt(v, c.step) + (c.unit === '°' ? '°' : '');
          if (c.unit && c.unit !== '°') label.textContent = `${c.label} (${c.unit})`;
        });
      } else if (c.kind === 'select') {
        const sel = document.createElement('select');
        sel.id = id;
        for (const [v, t] of c.options!) sel.add(new Option(t, v));
        sel.addEventListener('change', () => set(c.key, sel.value as never));
        row.append(sel);
        refreshers.push(() => (sel.value = String(design[c.key])));
      } else if (c.kind === 'seg') {
        const seg = document.createElement('div');
        seg.className = 'seg';
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', c.label);
        label.removeAttribute('for');
        for (const [v, t] of c.options!) {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = t;
          b.addEventListener('click', () => set(c.key, v as never));
          seg.append(b);
          refreshers.push(() => b.setAttribute('aria-pressed', String(design[c.key] === v)));
        }
        row.append(seg);
      } else {
        const input = document.createElement('input');
        input.id = id;
        input.type = c.kind === 'color' ? 'color' : 'checkbox';
        input.addEventListener('input', () =>
          set(c.key, (c.kind === 'color' ? input.value : input.checked) as never),
        );
        row.append(input);
        refreshers.push(() => {
          if (c.kind === 'color') input.value = String(design[c.key]);
          else input.checked = Boolean(design[c.key]);
        });
      }
      if (c.show) refreshers.push(() => (row.hidden = !c.show!(design)));
      det.append(row);
    }
    root.append(det);
  }
}

function buildPresets() {
  const root = $('presets');
  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = p.name;
    b.title = p.note;
    b.dataset.name = p.name;
    b.addEventListener('click', () => {
      design = { ...DEFAULTS, ...p.design };
      activePreset = p.name;
      refresh();
      rebuild();
    });
    root.append(b);
  }
}

function download(data: Uint8Array | Blob | string, name: string, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

const status = (t: string) => ($('status').textContent = t);
const fileBase = () => `sculpture-${design.seed}`;

async function busy(btn: HTMLButtonElement, working: string, job: () => Promise<string> | string) {
  btn.disabled = true;
  status(working);
  await new Promise((r) => setTimeout(r, 30)); // let the status paint
  try {
    status(await job());
  } catch (e) {
    console.error(e);
    status('Export failed: ' + (e instanceof Error ? e.message : String(e)));
  }
  btn.disabled = false;
}

function wire() {
  $('randomise').addEventListener('click', () => {
    design = randomise(design);
    activePreset = '';
    refresh();
    rebuild();
  });
  $<HTMLInputElement>('seed').addEventListener('change', (e) => {
    const v = Math.max(0, Math.floor(Number((e.target as HTMLInputElement).value) || 0));
    set('seed', v);
  });
  $('reset').addEventListener('click', () => viewer.resetView());

  $('kit').addEventListener('click', (e) =>
    busy(e.currentTarget as HTMLButtonElement, 'Building kit…', async () => {
      const moulds = $<HTMLInputElement>('withMoulds').checked;
      // full-resolution meshes; a smaller budget with moulds keeps the ZIP a workable size
      const fine = buildSculpture(design, moulds ? EXPORT_BUDGET / 2.5 : EXPORT_BUDGET);
      const zip = await buildKit(fine, design, { moulds });
      download(zip, `${fileBase()}-kit.zip`, 'application/zip');
      return `Kit saved: ${sculpture.pieces.length} piece file${sculpture.pieces.length === 1 ? '' : 's'}${moulds ? ' with moulds' : ''}, ${(zip.length / 1e6).toFixed(1)} MB.`;
    }),
  );
  $('wallStl').addEventListener('click', (e) =>
    busy(e.currentTarget as HTMLButtonElement, 'Building STL…', () => {
      const stl = wallStl(buildSculpture(design, EXPORT_BUDGET), design);
      download(stl, `${fileBase()}-wall.stl`, 'model/stl');
      return `Wall STL saved (${(stl.length / 1e6).toFixed(1)} MB).`;
    }),
  );
  $('png').addEventListener('click', (e) =>
    busy(e.currentTarget as HTMLButtonElement, 'Rendering…', async () => {
      download(await viewer.png(), `${fileBase()}.png`);
      return 'Image saved.';
    }),
  );
  const fields: [string, keyof PrototypeOptions][] = [
    ['pvX', 'buildX'], ['pvY', 'buildY'], ['pvZ', 'buildZ'], ['pvAcross', 'across'], ['pvDown', 'down'], ['pvBase', 'base'],
  ];
  for (const [id, key] of fields) {
    const input = $<HTMLInputElement>(id);
    input.value = String(proto[key]);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (!(v > 0)) return;
      proto = { ...proto, [key]: Math.min(Number(input.max), Math.max(Number(input.min), v)) };
      try {
        localStorage.setItem(PROTO_KEY, JSON.stringify(proto));
      } catch {
        /* not essential */
      }
      protoInfo();
    });
  }
  $('proto').addEventListener('click', (e) =>
    busy(e.currentTarget as HTMLButtonElement, 'Building prototype…', async () => {
      const r = await buildPrototype(buildSculpture(design, EXPORT_BUDGET), design, proto);
      download(r.data, `${fileBase()}-prototype.${r.zipped ? 'zip' : 'stl'}`, r.zipped ? 'application/zip' : 'model/stl');
      return `Prototype saved: ${r.panels} panel${r.panels === 1 ? '' : 's'}, ${(r.data.length / 1e6).toFixed(1)} MB.`;
    }),
  );
  $('saveJson').addEventListener('click', () => {
    download(JSON.stringify(design, null, 2), `${fileBase()}.json`, 'application/json');
    status('Design saved.');
  });
  const file = $<HTMLInputElement>('file');
  $('loadJson').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text()) as Record<string, unknown>;
      const next: Record<string, unknown> = { ...DEFAULTS };
      // accept only known keys with the right type
      for (const k of Object.keys(DEFAULTS) as Key[])
        if (typeof data[k] === typeof DEFAULTS[k]) next[k] = data[k];
      design = next as unknown as Design;
      activePreset = '';
      refresh();
      rebuild();
      status(`Loaded ${f.name}.`);
    } catch {
      status('That file is not a design.json from this generator.');
    }
  });
}

buildPresets();
buildControls();
wire();
refresh();
rebuild();

// handy for debugging and automated checks
Object.assign(window, { __sculpture: () => sculpture, __design: () => design });
