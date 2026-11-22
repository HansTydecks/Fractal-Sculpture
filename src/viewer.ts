import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Design } from './params';
import { paletteColour, wallTriangles, type Sculpture } from './build';
import type { Mesh } from './piece';

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** Per-corner positions and normals; faces meeting at more than `crease` degrees stay sharp. */
function shaded(m: Mesh, crease: number): { pos: Float32Array; nrm: Float32Array } {
  const nt = m.tris.length;
  const fn = new Float32Array(nt * 3); // area-weighted
  const fu = new Float32Array(nt * 3); // unit
  const faces: number[][] = m.verts.map(() => []);
  m.tris.forEach((t, k) => {
    const a = m.verts[t[0]], b = m.verts[t[1]], c = m.verts[t[2]];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    const len = Math.hypot(x, y, z) || 1;
    fn.set([x, y, z], k * 3);
    fu.set([x / len, y / len, z / len], k * 3);
    for (const i of t) faces[i].push(k);
  });
  const cos = Math.cos((crease * Math.PI) / 180);
  const pos = new Float32Array(nt * 9);
  const nrm = new Float32Array(nt * 9);
  m.tris.forEach((t, k) => {
    for (let c = 0; c < 3; c++) {
      const v = m.verts[t[c]];
      let x = 0, y = 0, z = 0;
      for (const f of faces[t[c]]) {
        if (fu[f * 3] * fu[k * 3] + fu[f * 3 + 1] * fu[k * 3 + 1] + fu[f * 3 + 2] * fu[k * 3 + 2] >= cos) {
          x += fn[f * 3]; y += fn[f * 3 + 1]; z += fn[f * 3 + 2];
        }
      }
      const len = Math.hypot(x, y, z) || 1;
      pos.set(v, k * 9 + c * 3);
      nrm.set([x / len, y / len, z / len], k * 9 + c * 3);
    }
  });
  return { pos, nrm };
}

export class Viewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(22, 1, 10, 40000);
  private controls: OrbitControls;
  private sun = new THREE.DirectionalLight(0xffffff, 2.6);
  private pieces: THREE.Mesh;
  private plate: THREE.Mesh;
  private wall: THREE.Mesh;
  private size = 500;
  private framed = '';
  private dirty = true;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.background = new THREE.Color(0xd9d5ce);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8478, 1.1));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target);

    this.pieces = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.02 }),
    );
    this.pieces.castShadow = this.pieces.receiveShadow = true;
    this.plate = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.8 }));
    this.plate.castShadow = this.plate.receiveShadow = true;
    this.wall = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: 0xe4e0d9, roughness: 0.95 }),
    );
    this.wall.receiveShadow = true;
    this.scene.add(this.pieces, this.plate, this.wall);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.minAzimuthAngle = -1.35;
    this.controls.maxAzimuthAngle = 1.35;
    this.controls.minPolarAngle = 0.2;
    this.controls.maxPolarAngle = Math.PI - 0.2;
    this.controls.addEventListener('change', () => (this.dirty = true));

    new ResizeObserver(() => this.resize()).observe(canvas.parentElement!);
    this.resize();
    const tick = () => {
      requestAnimationFrame(tick);
      if (this.controls.update() || this.dirty) {
        this.dirty = false;
        this.renderer.render(this.scene, this.camera);
      }
    };
    tick();
  }

  private resize() {
    const p = this.canvas.parentElement!;
    const w = Math.max(50, p.clientWidth);
    const h = Math.max(50, p.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.frame();
    this.dirty = true;
  }

  /** Put the camera square-on to the wall at a distance that fits it. */
  private frame(width = this.lastW, height = this.lastH) {
    const fov = (this.camera.fov * Math.PI) / 180;
    const fitH = (height * 0.6) / Math.tan(fov / 2);
    const fitW = (width * 0.6) / (Math.tan(fov / 2) * this.camera.aspect);
    const dist = Math.max(fitH, fitW);
    this.camera.position.set(0, 0, dist);
    this.controls?.target.set(0, 0, 0);
    this.controls && (this.controls.maxDistance = dist * 3);
    this.controls && (this.controls.minDistance = dist * 0.1);
  }
  private lastW = 700;
  private lastH = 460;

  resetView() {
    this.frame();
    this.dirty = true;
  }

  setSculpture(sc: Sculpture, d: Design) {
    let nTri = 0;
    for (const p of sc.placed) nTri += sc.pieces[p.piece].mesh.tris.length;
    const pos = new Float32Array(nTri * 9);
    const nrm = new Float32Array(nTri * 9);
    const col = new Float32Array(nTri * 9);
    const cache = new Map<number, { pos: Float32Array; nrm: Float32Array }>();
    const byZ = d.colourBy === 'z';
    let o = 0;
    for (const p of sc.placed) {
      let sh = cache.get(p.piece);
      if (!sh) cache.set(p.piece, (sh = shaded(sc.pieces[p.piece].mesh, 32)));
      const c = Math.cos(p.rot), s = Math.sin(p.rot);
      const r = toLinear(p.colour[0]), g = toLinear(p.colour[1]), b = toLinear(p.colour[2]);
      for (let k = 0; k < sh.pos.length; k += 3) {
        const x = sh.pos[k], y = sh.pos[k + 1], z = sh.pos[k + 2];
        pos[o] = p.cell.x + x * c - y * s;
        pos[o + 1] = p.cell.y + x * s + y * c;
        pos[o + 2] = z;
        const nx = sh.nrm[k], ny = sh.nrm[k + 1];
        nrm[o] = nx * c - ny * s;
        nrm[o + 1] = nx * s + ny * c;
        nrm[o + 2] = sh.nrm[k + 2];
        if (byZ) {
          const rgb = paletteColour(d, z / Math.max(1, sc.depth));
          col[o] = toLinear(rgb[0]); col[o + 1] = toLinear(rgb[1]); col[o + 2] = toLinear(rgb[2]);
        } else {
          col[o] = r; col[o + 1] = g; col[o + 2] = b;
        }
        o += 3;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.pieces.geometry.dispose();
    this.pieces.geometry = geo;

    // back plate: reuse the export triangles, dropping the piece part
    const t = Math.max(0.01, d.backplate);
    const all = wallTriangles(sc, t);
    const plateGeo = new THREE.BufferGeometry();
    plateGeo.setAttribute('position', new THREE.BufferAttribute(all.slice(nTri * 9), 3));
    plateGeo.computeVertexNormals();
    this.plate.geometry.dispose();
    this.plate.geometry = plateGeo;
    this.plate.visible = d.backplate > 0;
    (this.plate.material as THREE.MeshStandardMaterial).color.set(d.board);

    this.size = Math.max(sc.width, sc.height, 100);
    this.wall.scale.set(this.size * 12, this.size * 12, 1);
    this.wall.position.z = -d.backplate - 0.5;

    const key = `${Math.round(sc.width)}x${Math.round(sc.height)}`;
    if (key !== this.framed) {
      this.framed = key;
      this.lastW = sc.width;
      this.lastH = sc.height;
      this.frame();
    }
    this.setLight(d, sc.depth);
  }

  setLight(d: Design, depth = 100) {
    const az = (d.lightAngle * Math.PI) / 180;
    const el = (d.lightElev * Math.PI) / 180;
    const R = this.size * 3;
    this.sun.position.set(R * Math.cos(el) * Math.cos(az), R * Math.cos(el) * Math.sin(az), R * Math.sin(el));
    const cam = this.sun.shadow.camera;
    const half = this.size * 0.85 + depth;
    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
    cam.near = R * 0.2;
    cam.far = R * 2;
    cam.updateProjectionMatrix();
    this.dirty = true;
  }

  png(): Promise<Blob> {
    this.renderer.render(this.scene, this.camera);
    return new Promise((res, rej) => this.canvas.toBlob((b) => (b ? res(b) : rej(new Error('no image'))), 'image/png'));
  }
}
