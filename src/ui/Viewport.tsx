// 3D სცენა (Three.js, z ღერძი — ზემოთ). რეალური გამოთვლის ფენები (დენის რუკა, პოტენციალის ჭრილი, ჩაკეტვის ინდიკატორი)
// და საილუსტრაციო ფენა (ბუშტუკები) ვიზუალურად და წარწერებით გამიჯნულია.
import { ReactNode, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Built } from '../core/geometry/cell';
import { KleinMath } from '../core/geometry/klein';
import { Mesh } from '../core/geometry/mesh';
import { Fields } from '../core/solver/solver';
import { cssVar, sig } from './format';

export type Axis = 'none' | 'x' | 'y' | 'z';
export interface ViewOptions {
  opacity: number;
  clipAxis: Axis;
  clipPos: number;
  showTank: boolean;
  showBubbles: boolean;
  colorMode: 'solid' | 'current';
  sliceAxis: Axis;
  slicePos: number;
  showTraps: boolean;
  fieldSource: 'primary' | 'secondary';
}
export const defaultView: ViewOptions = {
  opacity: 1,
  clipAxis: 'none',
  clipPos: 0.5,
  showTank: true,
  showBubbles: true,
  colorMode: 'solid',
  sliceAxis: 'none',
  slicePos: 0.5,
  showTraps: false,
  fieldSource: 'primary',
};

const BLUE = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
const ORANGE = ['#fde6d8', '#f8c3a6', '#f29b72', '#eb6834', '#c24f22', '#963a16', '#6b270d'];

function rampFn(stops: string[], srgb: boolean): (t: number) => [number, number, number] {
  const cols = stops.map((s) => {
    const c = new THREE.Color(s);
    if (srgb) c.convertLinearToSRGB();
    return [c.r, c.g, c.b];
  });
  return (t: number) => {
    const x = Math.max(0, Math.min(1, t)) * (cols.length - 1);
    const i = Math.min(cols.length - 2, Math.floor(x));
    const f = x - i;
    return [cols[i][0] + (cols[i + 1][0] - cols[i][0]) * f, cols[i][1] + (cols[i + 1][1] - cols[i][1]) * f, cols[i][2] + (cols[i + 1][2] - cols[i][2]) * f];
  };
}

function toGeometry(m: Mesh): THREE.BufferGeometry {
  const nv = m.positions.length / 3;
  const nt = m.indices.length / 3;
  let G = 1;
  if (m.groups) for (let i = 0; i < m.groups.length; i++) if (m.groups[i] + 1 > G) G = m.groups[i] + 1;
  const map = new Int32Array(nv * G).fill(-1);
  const pos: number[] = [];
  const idx = new Uint32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const g = m.groups ? m.groups[t] : 0;
    for (let e = 0; e < 3; e++) {
      const v = m.indices[3 * t + e];
      const key = v * G + g;
      if (map[key] < 0) {
        map[key] = pos.length / 3;
        pos.push(m.positions[3 * v], m.positions[3 * v + 1], m.positions[3 * v + 2]);
      }
      idx[3 * t + e] = map[key];
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geom.setIndex(new THREE.BufferAttribute(idx, 1));
  geom.computeVertexNormals();
  return geom;
}

/** წვეროების შეფერვა ამომხსნელის ზედაპირული დენის სიმკვრივით (უახლოესი სასაზღვრო უჯრედების საშუალო). */
function colorize(geom: THREE.BufferGeometry, f: Fields, arr: Float32Array, vmax: number, ramp: (t: number) => [number, number, number], neutral: THREE.Color) {
  const pos = geom.getAttribute('position') as THREE.BufferAttribute;
  const nor = geom.getAttribute('normal') as THREE.BufferAttribute;
  const g = f.grid;
  const col = new Float32Array(pos.count * 3);
  const NXY = g.NX * g.NY;
  for (let v = 0; v < pos.count; v++) {
    const px = pos.getX(v) + nor.getX(v) * 0.75 * g.h;
    const py = pos.getY(v) + nor.getY(v) * 0.75 * g.h;
    const pz = pos.getZ(v) + nor.getZ(v) * 0.75 * g.h;
    const fi = (px - g.x0) / g.h,
      fj = (py - g.y0) / g.h,
      fk = (pz - g.z0) / g.h;
    const i0 = Math.round(fi),
      j0 = Math.round(fj),
      k0 = Math.round(fk);
    let sw = 0,
      sv = 0;
    for (let rad = 1; rad <= 2 && sw === 0; rad++) {
      for (let dk = -rad; dk <= rad; dk++) {
        const k = k0 + dk;
        if (k < 0 || k >= g.nz) continue;
        for (let dj = -rad; dj <= rad; dj++) {
          const j = j0 + dj;
          if (j < 0 || j >= g.ny) continue;
          for (let di = -rad; di <= rad; di++) {
            const i = i0 + di;
            if (i < 0 || i >= g.nx) continue;
            const idx = i + 1 + g.NX * (j + 1) + NXY * (k + 1);
            const val = arr[idx];
            if (val > 0) {
              const d2 = (i - fi) ** 2 + (j - fj) ** 2 + (k - fk) ** 2;
              const w = 1 / (d2 + 0.15);
              sw += w;
              sv += w * val;
            }
          }
        }
      }
    }
    if (sw > 0) {
      const c = ramp(sv / sw / vmax);
      col[3 * v] = c[0];
      col[3 * v + 1] = c[1];
      col[3 * v + 2] = c[2];
    } else {
      col[3 * v] = neutral.r;
      col[3 * v + 1] = neutral.g;
      col[3 * v + 2] = neutral.b;
    }
  }
  geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

function fieldMax(f: Fields): number {
  const vals: number[] = [];
  for (const a of [f.jA, f.jC]) for (let i = 0; i < a.length; i++) if (a[i] > 0) vals.push(a[i]);
  if (!vals.length) return 1;
  vals.sort((x, y) => x - y);
  return vals[Math.floor(vals.length * 0.97)] || 1;
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function samplePoints(m: Mesh, n: number, seed: number): Float32Array {
  const nt = m.indices.length / 3;
  const cum = new Float64Array(nt);
  const p = m.positions;
  let acc = 0;
  for (let t = 0; t < nt; t++) {
    const a = m.indices[3 * t] * 3,
      b = m.indices[3 * t + 1] * 3,
      c = m.indices[3 * t + 2] * 3;
    const ux = p[b] - p[a],
      uy = p[b + 1] - p[a + 1],
      uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a],
      vy = p[c + 1] - p[a + 1],
      vz = p[c + 2] - p[a + 2];
    acc += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    cum[t] = acc;
  }
  const rnd = mulberry(seed);
  const out = new Float32Array(n * 3);
  for (let s = 0; s < n; s++) {
    const r = rnd() * acc;
    let lo = 0,
      hi = nt - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    const a = m.indices[3 * lo] * 3,
      b = m.indices[3 * lo + 1] * 3,
      c = m.indices[3 * lo + 2] * 3;
    let u = rnd(),
      v = rnd();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    for (let k = 0; k < 3; k++) out[3 * s + k] = p[a + k] + u * (p[b + k] - p[a + k]) + v * (p[c + k] - p[a + k]);
  }
  return out;
}

function labelSprite(text: string, bg: string, fg: string): THREE.Sprite {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d')!;
  c.fillStyle = bg;
  c.beginPath();
  c.arc(32, 32, 28, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = fg;
  c.font = 'bold 44px system-ui, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, 32, 35);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
}

function bubbleTexture(): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 48;
  const c = cv.getContext('2d')!;
  const g = c.createRadialGradient(24, 24, 4, 24, 24, 22);
  g.addColorStop(0, 'rgba(255,255,255,0.15)');
  g.addColorStop(0.75, 'rgba(255,255,255,0.75)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 48, 48);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function disposeGroup(g: THREE.Group) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = (m as any).material as THREE.Material | THREE.Material[] | undefined;
    if (mat) {
      for (const x of Array.isArray(mat) ? mat : [mat]) {
        const tex = (x as any).map as THREE.Texture | undefined;
        if (tex) tex.dispose();
        x.dispose();
      }
    }
  });
  g.clear();
}

interface Ctx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  gGeom: THREE.Group;
  gField: THREE.Group;
  gBubbles: THREE.Group;
  clip: THREE.Plane;
  dirty: boolean;
  lastKindKey: string;
  bubbles: { pts: THREE.Points; base: Float32Array; phase: Float32Array; speed: Float32Array; top: number; count: number }[];
  animate: boolean;
  mats: THREE.Material[];
  bubbleTex: THREE.Texture;
}

const MAX_BUBBLES = 600;

export function Viewport(p: {
  built: Built;
  view: ViewOptions;
  fields: Fields | null;
  bubbles: { h2: number; o2: number };
  kleinMath: KleinMath | null;
  theme: string;
  title: string;
  extraChips?: ReactNode;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<Ctx | null>(null);
  const [glError, setGlError] = useState<string | null>(null);
  const [legend, setLegend] = useState<{ vmax: number; unit: string } | null>(null);
  const [sliceLegend, setSliceLegend] = useState<{ lo: number; hi: number; unit: string } | null>(null);
  const cell = p.built.cell;

  // --- ინიციალიზაცია ---
  useEffect(() => {
    const el = mount.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch (e) {
      setGlError('WebGL მიუწვდომელია ამ ბრაუზერში — 3D ხედი ვერ ჩაირთო. გამოთვლები და გრაფიკები მუშაობს.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.localClippingEnabled = true;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.001, 20);
    camera.up.set(0, 0, 1);
    camera.position.set(0.2, -0.25, 0.15);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x555560, 1.5));
    const dl = new THREE.DirectionalLight(0xffffff, 1.6);
    dl.position.set(0.4, -0.6, 1);
    scene.add(dl);
    const dl2 = new THREE.DirectionalLight(0xffffff, 0.5);
    dl2.position.set(-0.6, 0.5, -0.3);
    scene.add(dl2);
    const gGeom = new THREE.Group(),
      gField = new THREE.Group(),
      gBubbles = new THREE.Group();
    scene.add(gGeom, gField, gBubbles);
    const ctx: Ctx = {
      renderer,
      scene,
      camera,
      controls,
      gGeom,
      gField,
      gBubbles,
      clip: new THREE.Plane(new THREE.Vector3(-1, 0, 0), 1e3),
      dirty: true,
      lastKindKey: '',
      bubbles: [],
      animate: false,
      mats: [],
      bubbleTex: bubbleTexture(),
    };
    ctxRef.current = ctx;
    controls.addEventListener('change', () => (ctx.dirty = true));
    const resize = () => {
      const w = el.clientWidth,
        h = el.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      ctx.dirty = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    let raf = 0;
    const t0 = performance.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      if (ctx.animate && ctx.bubbles.length) {
        const t = (performance.now() - t0) / 1000;
        for (const b of ctx.bubbles) {
          if (b.count === 0) continue;
          const attr = b.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
          const a = attr.array as Float32Array;
          for (let i = 0; i < b.count; i++) {
            const z0 = b.base[3 * i + 2];
            const u = (t * b.speed[i] + b.phase[i]) % 1;
            a[3 * i] = b.base[3 * i] + 0.0007 * Math.sin(t * 3 + i);
            a[3 * i + 1] = b.base[3 * i + 1] + 0.0007 * Math.cos(t * 2.3 + i * 1.7);
            a[3 * i + 2] = z0 + u * (b.top - z0);
          }
          attr.needsUpdate = true;
        }
        ctx.dirty = true;
      }
      if (ctx.dirty) {
        ctx.dirty = false;
        renderer.render(scene, camera);
      }
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      disposeGroup(gGeom);
      disposeGroup(gField);
      disposeGroup(gBubbles);
      ctx.bubbleTex.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      ctxRef.current = null;
    };
  }, []);

  // --- გეომეტრია, შეფერვა, ბუშტუკების წყაროები ---
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    disposeGroup(ctx.gGeom);
    disposeGroup(ctx.gBubbles);
    ctx.bubbles = [];
    ctx.mats = [];
    ctx.scene.background = new THREE.Color(cssVar('--surface-1') || '#1a1a19');
    const dark = p.theme !== 'light';
    setLegend(null);
    if (!cell) {
      ctx.dirty = true;
      return;
    }
    const tank = cell.tank;
    const size = new THREE.Vector3(tank.max[0] - tank.min[0], tank.max[1] - tank.min[1], tank.max[2] - tank.min[2]);
    const center = new THREE.Vector3((tank.max[0] + tank.min[0]) / 2, (tank.max[1] + tank.min[1]) / 2, (tank.max[2] + tank.min[2]) / 2);
    const kindKey = p.built.kind + (p.kleinMath ? ':math' : '');
    if (ctx.lastKindKey !== kindKey) {
      ctx.lastKindKey = kindKey;
      const rad = size.length() / 2;
      const dist = (rad / Math.sin((ctx.camera.fov * Math.PI) / 360)) * 1.05;
      const dir = new THREE.Vector3(0.9, -1.3, 0.7).normalize();
      ctx.camera.position.copy(center).addScaledVector(dir, dist);
      ctx.camera.near = dist / 200;
      ctx.camera.far = dist * 20;
      ctx.camera.updateProjectionMatrix();
      ctx.controls.target.copy(center);
    }
    const axisCol = new THREE.Color(cssVar('--axis') || '#383835');
    if (p.kleinMath) {
      // მათემატიკური იმერსია: სისქის გარეშე, თვითგადაკვეთის მრუდით
      const geom = toGeometry(p.kleinMath.mesh);
      const mat = new THREE.MeshStandardMaterial({ color: cssVar('--comp-etaa') || '#9085e9', side: THREE.DoubleSide, roughness: 0.6, metalness: 0.05, transparent: true, opacity: 0.8 });
      ctx.mats.push(mat);
      ctx.gGeom.add(new THREE.Mesh(geom, mat));
      const pts: THREE.Vector3[] = [];
      const c = p.kleinMath.curve;
      for (let i = 0; i < c.length - 3; i += 3) pts.push(new THREE.Vector3(c[i], c[i + 1], c[i + 2]));
      const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 120, p.kleinMath.dims.Rb * 0.03, 10, true);
      ctx.gGeom.add(new THREE.Mesh(tube, new THREE.MeshBasicMaterial({ color: cssVar('--critical') || '#e66767' })));
      ctx.dirty = true;
      return;
    }
    const useMap = p.view.colorMode === 'current' && !!p.fields;
    let ramp: ((t: number) => [number, number, number]) | null = null;
    let vmax = 1;
    if (useMap && p.fields) {
      ramp = rampFn(dark ? [...BLUE].reverse() : BLUE, false);
      vmax = fieldMax(p.fields);
      setLegend({ vmax, unit: p.fields.unit === 'rel' ? '× საშუალო j' : 'A/m²' });
    }
    const neutral = new THREE.Color(dark ? '#3a3a38' : '#d8d7d2');
    const mk = (mesh: Mesh, color: string, arr: Float32Array | null) => {
      const geom = toGeometry(mesh);
      let mat: THREE.MeshStandardMaterial;
      if (arr && ramp && p.fields) {
        colorize(geom, p.fields, arr, vmax, ramp, neutral);
        mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide });
      } else {
        mat = new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.55, side: THREE.DoubleSide });
      }
      mat.clippingPlanes = [ctx.clip];
      ctx.mats.push(mat);
      ctx.gGeom.add(new THREE.Mesh(geom, mat));
    };
    const anodeCol = cssVar('--anode') || '#c9a36b';
    const cathCol = cssVar('--cathode') || '#8d98a6';
    mk(cell.cathode.mesh, cathCol, useMap && p.fields ? p.fields.jC : null);
    mk(cell.anode.mesh, anodeCol, useMap && p.fields ? p.fields.jA : null);
    // ავზი (ელექტროლიტის არე)
    const box = new THREE.BoxGeometry(size.x, size.y, size.z);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: axisCol }));
    edges.position.copy(center);
    edges.name = 'tank';
    ctx.gGeom.add(edges);
    const water = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: dark ? '#5aa0d0' : '#2a78d6', transparent: true, opacity: 0.045, depthWrite: false, side: THREE.BackSide }));
    water.position.copy(center);
    water.name = 'tank';
    ctx.gGeom.add(water);
    const ax = new THREE.AxesHelper(Math.min(size.x, size.y, size.z) * 0.22);
    ax.position.set(tank.min[0], tank.min[1], tank.min[2]);
    ax.name = 'tank';
    ctx.gGeom.add(ax);
    // დენის მიმყვანები
    const leadR = Math.max(0.0005, size.length() * 0.004);
    for (const [lead, col, sign] of [
      [cell.leads.cathode, cathCol, '−'],
      [cell.leads.anode, anodeCol, '+'],
    ] as const) {
      const up = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i + 1 < lead.points.length; i++) {
        const a = new THREE.Vector3(...lead.points[i]),
          b = new THREE.Vector3(...lead.points[i + 1]);
        const len = a.distanceTo(b);
        if (len < 1e-9) continue;
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(leadR, leadR, len, 10), new THREE.MeshStandardMaterial({ color: col, roughness: 0.5, metalness: 0.4 }));
        cyl.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
        cyl.position.copy(a).add(b).multiplyScalar(0.5);
        ctx.gGeom.add(cyl);
      }
      const end = lead.points[lead.points.length - 1];
      const sp = labelSprite(sign, col, '#0b0b0b');
      const s = size.length() * 0.045;
      sp.scale.set(s, s, s);
      sp.position.set(end[0], end[1], end[2] + s * 0.7);
      ctx.gGeom.add(sp);
    }
    // ბუშტუკების წყაროები (საილუსტრაციო)
    const top = tank.max[2];
    const mkBubbles = (mesh: Mesh, color: string, seed: number) => {
      const base = samplePoints(mesh, MAX_BUBBLES, seed);
      const rnd = mulberry(seed * 7 + 1);
      const phase = new Float32Array(MAX_BUBBLES),
        speed = new Float32Array(MAX_BUBBLES);
      for (let i = 0; i < MAX_BUBBLES; i++) {
        phase[i] = rnd();
        const rise = Math.max(1e-4, top - base[3 * i + 2]);
        speed[i] = (0.02 + 0.03 * rnd()) / rise;
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(base), 3));
      geom.setDrawRange(0, 0);
      const mat = new THREE.PointsMaterial({ color, size: Math.max(0.0012, size.length() * 0.012), map: ctx.bubbleTex, transparent: true, depthWrite: false, sizeAttenuation: true, opacity: 0.9 });
      const pts = new THREE.Points(geom, mat);
      pts.frustumCulled = false;
      ctx.gBubbles.add(pts);
      ctx.bubbles.push({ pts, base, phase, speed, top, count: 0 });
    };
    mkBubbles(cell.cathode.mesh, dark ? '#bfe9ff' : '#3aa0d8', 11);
    mkBubbles(cell.anode.mesh, dark ? '#ffcdb5' : '#e0703a', 29);
    ctx.dirty = true;
  }, [cell, p.built.key, p.kleinMath, p.fields, p.view.colorMode, p.theme]);

  // --- მსუბუქი პარამეტრები: გამჭვირვალობა, ჭრილი, ავზი, ბუშტუკების რაოდენობა ---
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    for (const m of ctx.mats) {
      const sm = m as THREE.MeshStandardMaterial;
      const base = p.kleinMath ? 0.8 : 1;
      sm.transparent = p.view.opacity * base < 0.999;
      sm.opacity = p.view.opacity * base;
      sm.depthWrite = sm.opacity > 0.6;
      sm.needsUpdate = true;
    }
    if (cell && p.view.clipAxis !== 'none') {
      const a = p.view.clipAxis === 'x' ? 0 : p.view.clipAxis === 'y' ? 1 : 2;
      const c = cell.tank.min[a] + p.view.clipPos * (cell.tank.max[a] - cell.tank.min[a]);
      // იჭრება კამერის საწყისი მხარისკენ მიმართული ნახევარი (x: +, y: −, z: +), რომ ჭრილი პირდაპირ ჩანდეს
      const s = a === 1 ? 1 : -1;
      ctx.clip.normal.set(a === 0 ? s : 0, a === 1 ? s : 0, a === 2 ? s : 0);
      ctx.clip.constant = -s * c;
    } else {
      ctx.clip.normal.set(-1, 0, 0);
      ctx.clip.constant = 1e3;
    }
    ctx.gGeom.traverse((o) => {
      if (o.name === 'tank') o.visible = p.view.showTank;
    });
    const show = p.view.showBubbles && !p.kleinMath && !!cell && p.built.errors.length === 0;
    // ნაწილაკების რაოდენობა მოცულობითი ნაკადის პროპორციულია (H₂ : O₂ ფიზიკური მოდელიდან), მაგრამ მოლეკულების რაოდენობას არ ასახავს
    const k = 350 / 6.3e-7;
    const counts = [Math.min(MAX_BUBBLES, Math.round(p.bubbles.h2 * k)), Math.min(MAX_BUBBLES, Math.round(p.bubbles.o2 * k))];
    ctx.bubbles.forEach((b, i) => {
      b.count = show ? counts[i] : 0;
      b.pts.geometry.setDrawRange(0, b.count);
    });
    ctx.animate = show && (counts[0] > 0 || counts[1] > 0);
    ctx.dirty = true;
  }, [cell, p.built.key, p.built.errors.length, p.view.opacity, p.view.clipAxis, p.view.clipPos, p.view.showTank, p.view.showBubbles, p.bubbles.h2, p.bubbles.o2, p.kleinMath, p.fields, p.view.colorMode, p.theme]);

  // --- ამომხსნელის ველები: პოტენციალის ჭრილი და გაზის ჩაკეტვის ინდიკატორი ---
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    disposeGroup(ctx.gField);
    setSliceLegend(null);
    const f = p.fields;
    if (!f || p.kleinMath) {
      ctx.dirty = true;
      return;
    }
    const g = f.grid;
    const dark = p.theme !== 'light';
    if (p.view.sliceAxis !== 'none') {
      const a = p.view.sliceAxis === 'x' ? 0 : p.view.sliceAxis === 'y' ? 1 : 2;
      const dims = [g.nx, g.ny, g.nz];
      const s = Math.max(0, Math.min(dims[a] - 1, Math.round(p.view.slicePos * (dims[a] - 1))));
      const ua = a === 0 ? 1 : 0;
      const va = a === 2 ? 1 : 2;
      const w = dims[ua],
        h = dims[va];
      const data = new Uint8Array(w * h * 4);
      const ramp = rampFn(dark ? [...ORANGE].reverse() : ORANGE, true);
      const [lo, hi] = f.phiRange;
      const an = new THREE.Color(cssVar('--anode') || '#c9a36b').convertLinearToSRGB();
      const ca = new THREE.Color(cssVar('--cathode') || '#8d98a6').convertLinearToSRGB();
      const strides = [1, g.NX, g.NX * g.NY];
      for (let v = 0; v < h; v++)
        for (let u = 0; u < w; u++) {
          const ijk = [0, 0, 0];
          ijk[a] = s;
          ijk[ua] = u;
          ijk[va] = v;
          const idx = (ijk[0] + 1) * strides[0] + (ijk[1] + 1) * strides[1] + (ijk[2] + 1) * strides[2];
          const o = (v * w + u) * 4;
          const t = f.type[idx];
          let c: [number, number, number];
          if (t === 1) c = [an.r, an.g, an.b];
          else if (t === 2) c = [ca.r, ca.g, ca.b];
          else c = ramp((f.phi[idx] - lo) / (hi - lo || 1));
          data[o] = c[0] * 255;
          data[o + 1] = c[1] * 255;
          data[o + 2] = c[2] * 255;
          data[o + 3] = 235;
        }
      const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(w * g.h, h * g.h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      const org = [g.x0, g.y0, g.z0];
      const cen = [org[0] + ((g.nx - 1) * g.h) / 2, org[1] + ((g.ny - 1) * g.h) / 2, org[2] + ((g.nz - 1) * g.h) / 2];
      cen[a] = org[a] + s * g.h;
      const X = new THREE.Vector3(),
        Y = new THREE.Vector3(),
        Z = new THREE.Vector3();
      if (a === 2) {
        X.set(1, 0, 0);
        Y.set(0, 1, 0);
        Z.set(0, 0, 1);
      } else if (a === 0) {
        X.set(0, 1, 0);
        Y.set(0, 0, 1);
        Z.set(1, 0, 0);
      } else {
        X.set(1, 0, 0);
        Y.set(0, 0, 1);
        Z.set(0, -1, 0);
      }
      plane.matrixAutoUpdate = false;
      plane.matrix.makeBasis(X, Y, Z).setPosition(cen[0], cen[1], cen[2]);
      ctx.gField.add(plane);
      setSliceLegend({ lo, hi, unit: f.unit === 'rel' ? 'ნორმირებული φ (ანოდი = 1, კათოდი = 0)' : 'V (ელექტროლიტის პოტენციალი)' });
    }
    if (p.view.showTraps) {
      const pts: number[] = [];
      for (let k = 0; k < g.nz; k++)
        for (let j = 0; j < g.ny; j++)
          for (let i = 0; i < g.nx; i++) {
            const idx = i + 1 + g.NX * (j + 1) + g.NX * g.NY * (k + 1);
            if (f.trapMask[idx]) pts.push(g.x0 + i * g.h, g.y0 + j * g.h, g.z0 + k * g.h);
          }
      if (pts.length) {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        const m = new THREE.Points(geom, new THREE.PointsMaterial({ color: cssVar('--serious') || '#ec835a', size: g.h * 0.85, transparent: true, opacity: 0.5, depthWrite: false }));
        ctx.gField.add(m);
      }
    }
    ctx.dirty = true;
  }, [p.fields, p.view.sliceAxis, p.view.slicePos, p.view.showTraps, p.kleinMath, p.theme]);

  const dark = p.theme !== 'light';
  const grad = (stops: string[]) => `linear-gradient(90deg, ${(dark ? [...stops].reverse() : stops).join(',')})`;
  const invalid = p.built.errors.length > 0;
  return (
    <div className="viewport">
      <div ref={mount} style={{ position: 'absolute', inset: 0 }} />
      {glError && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }} className="sub">
          {glError}
        </div>
      )}
      <div className="vp-top">
        <span className="vp-chip title">{p.title}</span>
        {!p.kleinMath && (
          <>
            <span className="vp-chip">
              <i className="dot" style={{ background: 'var(--cathode)' }} />
              კათოდი (−) · H₂
            </span>
            <span className="vp-chip">
              <i className="dot" style={{ background: 'var(--anode)' }} />
              ანოდი (+) · O₂
            </span>
          </>
        )}
        {p.kleinMath && <span className="vp-chip illus">სასწავლო ხედი: იმერსია თვითგადაკვეთით (წითელი მრუდი) — ფიზიკურ გამოთვლაში არ მონაწილეობს</span>}
        {invalid && <span className="vp-chip bad">✕ დაუშვებელი კონფიგურაცია — გამოთვლა შეჩერებულია</span>}
        {p.extraChips}
      </div>
      <div className="vp-bottom">
        {legend && (
          <div className="vp-chip real">
            <div>ზედაპირული დენის სიმკვრივე · გამოთვლილი ველი</div>
            <div className="legend-bar" style={{ background: grad(BLUE) }} />
            <div className="legend-scale">
              <span>0</span>
              <span>
                {sig(legend.vmax, 3)} {legend.unit}
              </span>
            </div>
          </div>
        )}
        {sliceLegend && (
          <div className="vp-chip real">
            <div>პოტენციალის ჭრილი · გამოთვლილი ველი</div>
            <div className="legend-bar" style={{ background: grad(ORANGE) }} />
            <div className="legend-scale">
              <span>{sig(sliceLegend.lo, 3)}</span>
              <span>{sig(sliceLegend.hi, 3)}</span>
            </div>
            <div className="legend-scale">
              <span>{sliceLegend.unit}</span>
            </div>
          </div>
        )}
        {p.view.showTraps && p.fields && !p.kleinMath && (
          <div className="vp-chip real">
            <i className="dot" style={{ background: 'var(--serious)' }} />
            გაზის შესაძლო ჩაკეტვა (გეომეტრიული ინდიკატორი)
          </div>
        )}
        {p.view.showBubbles && !p.kleinMath && !invalid && (
          <div
            className="vp-chip illus"
            title="ბუშტუკების ტრაექტორია და რაოდენობა ფიზიკურ მოდელს არ წარმოადგენს; ნაწილაკები მოლეკულების რაოდენობას არ ასახავს. საერთო ელექტროლიტში H₂ და O₂ ერევა — ეს განცალკევებული შეგროვების სისტემა არ არის."
          >
            ბუშტუკები — საილუსტრაციო ანიმაცია (არა გამოთვლა); გაზები აქ განცალკევებული არ არის
          </div>
        )}
        <span className="grow" />
        <span className="vp-chip sub">z ↑ · თრევა — ბრუნვა, გორგოლაჭი — მასშტაბი, მარჯვენა ღილაკი — გადაადგილება</span>
      </div>
    </div>
  );
}
