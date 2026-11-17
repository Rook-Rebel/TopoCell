// კლაინის ბოთლი: (ა) მათემატიკური იმერსია თვითგადაკვეთით და (ბ) ფიზიკურად დასაშვები მიახლოება — იგივე ზედაპირი,
// რომელსაც კედელში ყელის გასასვლელი ფანჯარა აქვს ამოჭრილი (ყელი კედელს არ ეხება).
//
// კონსტრუქცია: „განზოგადებული მილი“. სადგურების ჩაკეტილი მიმდევრობა s ∈ [0, 1); თითო სადგური არის წრეწირი
//   P(s, v) = C(s) + ρ(s)·(cos v · e1(s) + sin v · ŷ),  C და e1 xz სიბრტყეშია.
// გარე კორპუსი → მხარი → ყელი → სახელური (გარეთ) → კედლის გავლა → შიდა მილი → გაფართოება → ქვედა ნაპირის U-მობრუნება.
// ბოლო სადგური პირველს ემთხვევა არეკვლით v → π − v: სწორედ ეს იგივეობა ხდის ზედაპირს არაორიენტირებადს.
import { Mesh, surfaceTopology, SurfaceTopology, checkManifold, ManifoldReport, meshArea, meshVolume, flipMesh } from './mesh';
import { Solid } from './solids';

export interface KleinGeom {
  Rb: number; // კორპუსის რადიუსი
  neckRatio: number; // ρn / Rb
  t: number; // კედლის სისქე
  clearance: number; // ღრეჩო ყელის გარე ზედაპირსა და ფანჯრის ნაპირს შორის
  nv?: number;
}

export interface KleinDims {
  Rb: number;
  rhoN: number;
  Hc: number;
  Hs: number;
  Ln: number;
  zTop: number;
  zH: number;
  a1: number;
  a2: number;
  a3: number;
  L1: number;
  L2: number;
  rhoR: number;
  zFl: number;
  rhoW: number;
  height: number;
}

export function kleinDims(g: KleinGeom): KleinDims {
  const Rb = g.Rb;
  const rhoN = g.neckRatio * Rb;
  const Hc = 2.6 * Rb;
  const Hs = 1.0 * Rb;
  const Ln = 0.3 * Rb;
  const zTop = Hc + Hs + Ln;
  const a1 = (Rb + 2.4 * rhoN) / 2;
  const a2 = 1.7 * rhoN;
  const a3 = 1.7 * rhoN;
  const zH = 0.55 * Hc;
  const L1 = zTop - (zH + a2);
  const L2 = 2 * a1 - a2 - a3;
  const rhoR = 0.2 * Rb;
  const zFl = 0.3 * Hc;
  const rhoW = rhoN + g.t / 2 + g.clearance;
  return { Rb, rhoN, Hc, Hs, Ln, zTop, zH, a1, a2, a3, L1, L2, rhoR, zFl, rhoW, height: zTop + a1 + rhoN + rhoR };
}

/** გეომეტრიული პირობები, რომელთა დარღვევაც თვითშეხებას ან გადაგვარებას იწვევს. */
export function kleinConstraintErrors(g: KleinGeom): string[] {
  const d = kleinDims(g);
  const e: string[] = [];
  if (!(g.Rb > 0) || !(g.t > 0)) e.push('კლაინი: ზომები დადებითი უნდა იყოს');
  if (d.rhoN <= g.t * 1.5) e.push('კლაინი: ყელის რადიუსი ძალიან მცირეა კედლის სისქესთან შედარებით');
  if (d.rhoR <= g.t * 1.2) e.push('კლაინი: ქვედა ნაპირის რადიუსი ძალიან მცირეა კედლის სისქესთან შედარებით');
  if (g.clearance < g.t / 2 + 2e-4) e.push('კლაინი: ფანჯრის ღრეჩო უნდა აღემატებოდეს t/2 + 0.2 მმ-ს');
  if (d.rhoW >= 0.42 * d.Hc || d.rhoW >= 0.8 * d.Rb) e.push('კლაინი: ფანჯარა კორპუსის ცილინდრულ ნაწილში არ ეტევა');
  if (d.zH - d.a3 <= d.zFl + 0.02 * d.Rb) e.push('კლაინი: ყელი ძალიან განიერია — შიდა მილი გაფართოებას ეხება');
  if (d.L1 <= 0 || d.L2 <= 0) e.push('კლაინი: სახელურის გეომეტრია გადაგვარებულია');
  if (d.Rb - d.rhoN - g.t <= 1e-4) e.push('კლაინი: შიდა მილი კორპუსის კედელს ეხება');
  return e;
}

interface Station {
  cx: number;
  cz: number;
  ex: number;
  ez: number;
  rho: number;
  seg: number; // 0 — გარე კორპუსი, 1 — სახელური/ყელი, 2 — შიდა მილი და ნაპირი
}

function stations(g: KleinGeom, ds: number): Station[] {
  const d = kleinDims(g);
  const out: Station[] = [];
  const rOut = (z: number) => {
    if (z <= d.Hc) return d.Rb;
    if (z >= d.Hc + d.Hs) return d.rhoN;
    return d.rhoN + ((d.Rb - d.rhoN) * (1 + Math.cos((Math.PI * (z - d.Hc)) / d.Hs))) / 2;
  };
  const rIn0 = d.Rb - 2 * d.rhoR;
  const rIn = (z: number) => {
    if (z >= d.zFl) return d.rhoN;
    return d.rhoN + ((rIn0 - d.rhoN) * (1 + Math.cos((Math.PI * z) / d.zFl))) / 2;
  };
  const steps = (len: number) => Math.max(2, Math.ceil(len / ds));
  // A: გარე კორპუსი, z: 0 → zTop (ბოლო წერტილის გარეშე)
  {
    const lenShoulder = Math.hypot(d.Hs, d.Rb - d.rhoN) * 1.15;
    const pieces: [number, number, number][] = [
      [0, d.Hc, steps(d.Hc)],
      [d.Hc, d.Hc + d.Hs, steps(lenShoulder)],
      [d.Hc + d.Hs, d.zTop, steps(d.Ln)],
    ];
    for (const [za, zb, n] of pieces)
      for (let i = 0; i < n; i++) {
        const z = za + ((zb - za) * i) / n;
        out.push({ cx: 0, cz: z, ex: 1, ez: 0, rho: rOut(z), seg: 0 });
      }
  }
  // B: სახელური
  {
    let n = steps(Math.PI * d.a1);
    for (let i = 0; i < n; i++) {
      const al = (Math.PI * i) / n;
      out.push({
        cx: d.a1 - d.a1 * Math.cos(al),
        cz: d.zTop + d.a1 * Math.sin(al),
        ex: Math.cos(al),
        ez: -Math.sin(al),
        rho: d.rhoN,
        seg: 1,
      });
    }
    n = steps(d.L1);
    for (let i = 0; i < n; i++) out.push({ cx: 2 * d.a1, cz: d.zTop - (d.L1 * i) / n, ex: -1, ez: 0, rho: d.rhoN, seg: 1 });
    n = steps((Math.PI / 2) * d.a2);
    const zc2 = d.zTop - d.L1;
    for (let i = 0; i < n; i++) {
      const be = (-Math.PI / 2) * (i / n);
      out.push({
        cx: 2 * d.a1 - d.a2 + d.a2 * Math.cos(be),
        cz: zc2 + d.a2 * Math.sin(be),
        ex: -Math.cos(be),
        ez: -Math.sin(be),
        rho: d.rhoN,
        seg: 1,
      });
    }
    n = steps(d.L2);
    for (let i = 0; i < n; i++)
      out.push({ cx: 2 * d.a1 - d.a2 - (d.L2 * i) / n, cz: d.zH, ex: 0, ez: 1, rho: d.rhoN, seg: 1 });
    n = steps((Math.PI / 2) * d.a3);
    for (let i = 0; i < n; i++) {
      const ga = Math.PI / 2 + (Math.PI / 2) * (i / n);
      out.push({
        cx: d.a3 + d.a3 * Math.cos(ga),
        cz: d.zH - d.a3 + d.a3 * Math.sin(ga),
        ex: Math.cos(ga),
        ez: Math.sin(ga),
        rho: d.rhoN,
        seg: 1,
      });
    }
  }
  // C: შიდა მილი (ქვემოთ), გაფართოება, ნაპირის U-მობრუნება
  {
    const zs = d.zH - d.a3;
    let n = steps(zs - d.zFl);
    for (let i = 0; i < n; i++) {
      const z = zs - ((zs - d.zFl) * i) / n;
      out.push({ cx: 0, cz: z, ex: -1, ez: 0, rho: rIn(z), seg: 2 });
    }
    n = steps(Math.hypot(d.zFl, rIn0 - d.rhoN) * 1.15);
    for (let i = 0; i < n; i++) {
      const z = d.zFl - (d.zFl * i) / n;
      out.push({ cx: 0, cz: z, ex: -1, ez: 0, rho: rIn(z), seg: 2 });
    }
    n = Math.max(6, steps(Math.PI * d.rhoR));
    for (let i = 0; i < n; i++) {
      const be = Math.PI + (Math.PI * i) / n;
      out.push({ cx: 0, cz: d.rhoR * Math.sin(be), ex: -1, ez: 0, rho: d.Rb - d.rhoR + d.rhoR * Math.cos(be), seg: 2 });
    }
  }
  return out;
}

export interface KleinSurface {
  ns: number;
  nv: number;
  /** პარამეტრული ბადის წვეროები (ns+1 რიგი; ბოლო რიგი პირველის ასლია არეკვლით). */
  P: Float64Array;
  N: Float64Array;
  /** სამკუთხედები პარამეტრული ინდექსებით (i·nv + j, i ∈ [0, ns]). */
  tris: Uint32Array;
  dims: KleinDims;
  stationSeg: Uint8Array;
}

/** პარამეტრული წვეროს შეკერილი ინდექსი: რიგი ns ≡ რიგი 0, j → nv/2 − j. */
function weld(ns: number, nv: number, pid: number): number {
  const i = Math.floor(pid / nv),
    j = pid - i * nv;
  if (i < ns) return pid;
  return (nv / 2 - j + nv) % nv;
}

function buildSurface(g: KleinGeom, withWindow: boolean): KleinSurface {
  const d = kleinDims(g);
  const nv = g.nv ?? 56;
  const ds = (2 * Math.PI * d.Rb) / nv;
  const st = stations(g, ds);
  const ns = st.length;
  const P = new Float64Array((ns + 1) * nv * 3);
  const flipJ = (j: number) => (nv / 2 - j + nv) % nv;
  for (let i = 0; i < ns; i++) {
    const s = st[i];
    for (let j = 0; j < nv; j++) {
      const v = (2 * Math.PI * j) / nv;
      const o = (i * nv + j) * 3;
      P[o] = s.cx + s.rho * Math.cos(v) * s.ex;
      P[o + 1] = s.rho * Math.sin(v);
      P[o + 2] = s.cz + s.rho * Math.cos(v) * s.ez;
    }
  }
  const dOf = (pid: number) => Math.hypot(P[pid * 3 + 1], P[pid * 3 + 2] - d.zH);
  // ფანჯარა: კედლის წვეროების მიზიდვა წრიულ ნაპირზე (რომ ნაპირი გლუვი გამოვიდეს)
  if (withWindow) {
    for (let i = 0; i < ns; i++) {
      if (st[i].seg !== 0 || st[i].cz > d.Hc) continue;
      for (let j = 0; j < nv; j++) {
        const pid = i * nv + j;
        const o = pid * 3;
        if (P[o] <= 0) continue;
        const dd = dOf(pid);
        if (Math.abs(dd - d.rhoW) < 0.5 * ds && dd > 1e-12) {
          const sc = d.rhoW / dd;
          const y = P[o + 1] * sc;
          const z = d.zH + (P[o + 2] - d.zH) * sc;
          P[o] = Math.sqrt(Math.max(d.Rb * d.Rb - y * y, 0));
          P[o + 1] = y;
          P[o + 2] = z;
        }
      }
    }
  }
  // ბოლო რიგი — პირველის ასლი არეკვლით
  for (let j = 0; j < nv; j++) {
    const src = flipJ(j) * 3,
      dst = (ns * nv + j) * 3;
    P[dst] = P[src];
    P[dst + 1] = P[src + 1];
    P[dst + 2] = P[src + 2];
  }
  // ნორმალები: N = ∂s × ∂v (რიცხვითი; ნაკერზე გაგრძელება არეკვლით)
  const N = new Float64Array((ns + 1) * nv * 3);
  const at = (i: number, j: number): number => {
    if (i < 0) return ((i + ns) * nv + flipJ(j)) * 3;
    if (i > ns) return ((i - ns) * nv + flipJ(j)) * 3;
    return (i * nv + j) * 3;
  };
  for (let i = 0; i <= ns; i++)
    for (let j = 0; j < nv; j++) {
      const a = at(i - 1, j),
        b = at(i + 1, j);
      const c = at(i, (j + nv - 1) % nv),
        e = at(i, (j + 1) % nv);
      const sx = P[b] - P[a],
        sy = P[b + 1] - P[a + 1],
        sz = P[b + 2] - P[a + 2];
      const vx = P[e] - P[c],
        vy = P[e + 1] - P[c + 1],
        vz = P[e + 2] - P[c + 2];
      let nx = sy * vz - sz * vy,
        ny = sz * vx - sx * vz,
        nz = sx * vy - sy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      const o = (i * nv + j) * 3;
      N[o] = nx;
      N[o + 1] = ny;
      N[o + 2] = nz;
    }
  // სამკუთხედები
  const tris: number[] = [];
  const eps = 1e-9 * d.Rb;
  for (let i = 0; i < ns; i++) {
    const inWindowZone = withWindow && st[i].seg === 0 && st[i].cz <= d.Hc;
    for (let j = 0; j < nv; j++) {
      const p00 = i * nv + j,
        p10 = (i + 1) * nv + j,
        p11 = (i + 1) * nv + ((j + 1) % nv),
        p01 = i * nv + ((j + 1) % nv);
      if (!inWindowZone || P[p00 * 3] <= 0) {
        tris.push(p00, p10, p11, p00, p11, p01);
        continue;
      }
      const cls = (pid: number) => {
        const dd = dOf(pid) - d.rhoW;
        return dd < -eps ? -1 : dd > eps ? 1 : 0;
      };
      const c00 = cls(p00),
        c10 = cls(p10),
        c11 = cls(p11),
        c01 = cls(p01);
      const useAlt = c10 === 0 && c01 === 0 && c00 * c11 < 0;
      const cand = useAlt
        ? [
            [p00, p10, p01],
            [p10, p11, p01],
          ]
        : [
            [p00, p10, p11],
            [p00, p11, p01],
          ];
      for (const tri of cand) {
        const mx = Math.max(cls(tri[0]), cls(tri[1]), cls(tri[2]));
        let remove = false;
        if (mx <= 0) {
          const cy = (P[tri[0] * 3 + 1] + P[tri[1] * 3 + 1] + P[tri[2] * 3 + 1]) / 3;
          const cz = (P[tri[0] * 3 + 2] + P[tri[1] * 3 + 2] + P[tri[2] * 3 + 2]) / 3;
          remove = Math.hypot(cy, cz - d.zH) < d.rhoW;
        }
        if (!remove) tris.push(tri[0], tri[1], tri[2]);
      }
    }
  }
  const stationSeg = new Uint8Array(ns);
  for (let i = 0; i < ns; i++) stationSeg[i] = st[i].seg;
  return { ns, nv, P, N, tris: new Uint32Array(tris), dims: d, stationSeg };
}

/** შუა ზედაპირის შეკერილი ბადე. */
function midMesh(s: KleinSurface): Mesh {
  const positions = s.P.slice(0, s.ns * s.nv * 3);
  const indices = new Uint32Array(s.tris.length);
  for (let i = 0; i < s.tris.length; i++) indices[i] = weld(s.ns, s.nv, s.tris[i]);
  return { positions, indices };
}

/**
 * არაორიენტირებადი ზედაპირის გასქელება: ორი ფენა P ± (t/2)·N პარამეტრულ მართკუთხედზე; ნაკერზე „ზედა“ ფენა
 * „ქვედას“ უერთდება (რადგან N ნაკერის გადაკვეთისას ნიშანს იცვლის). შედეგი — ერთი ჩაკეტილი ორიენტირებადი ზედაპირი
 * (შუა ზედაპირის ორიენტაციული ორმაგი დაფარვა) პლუს ფანჯრის ნაპირის ზოლი.
 */
function thicken(s: KleinSurface, t: number): Mesh {
  const { ns, nv, P, N, tris } = s;
  const nvert = ns * nv;
  const positions = new Float64Array(nvert * 2 * 3);
  for (let p = 0; p < nvert; p++) {
    for (let a = 0; a < 3; a++) {
      positions[(2 * p) * 3 + a] = P[p * 3 + a] + (t / 2) * N[p * 3 + a];
      positions[(2 * p + 1) * 3 + a] = P[p * 3 + a] - (t / 2) * N[p * 3 + a];
    }
  }
  const top = (pid: number) => {
    const i = Math.floor(pid / nv);
    if (i < ns) return 2 * pid;
    return 2 * weld(ns, nv, pid) + 1; // ნაკერი: ზედა ↔ ქვედა
  };
  const bot = (pid: number) => {
    const i = Math.floor(pid / nv);
    if (i < ns) return 2 * pid + 1;
    return 2 * weld(ns, nv, pid);
  };
  // საზღვრის წიბოები (შეკერილი ინდექსებით)
  const edgeCount = new Map<number, number>();
  const key = (a: number, b: number) => {
    const wa = weld(ns, nv, a),
      wb = weld(ns, nv, b);
    return wa < wb ? wa * nvert + wb : wb * nvert + wa;
  };
  for (let i = 0; i < tris.length; i += 3)
    for (let e = 0; e < 3; e++) {
      const k = key(tris[i + e], tris[i + ((e + 1) % 3)]);
      edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
    }
  const idx: number[] = [];
  const grp: number[] = [];
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i],
      b = tris[i + 1],
      c = tris[i + 2];
    idx.push(top(a), top(b), top(c));
    grp.push(0);
    idx.push(bot(c), bot(b), bot(a));
    grp.push(0);
    for (let e = 0; e < 3; e++) {
      const u = tris[i + e],
        v = tris[i + ((e + 1) % 3)];
      if (edgeCount.get(key(u, v)) === 1) {
        idx.push(top(v), top(u), bot(u), top(v), bot(u), bot(v));
        grp.push(1, 1);
      }
    }
  }
  return { positions, indices: new Uint32Array(idx), groups: new Uint8Array(grp) };
}

/** შუა ზედაპირის თვითდაშორება: პარამეტრულად დაშორებულ წერტილთა წყვილების მინიმალური მანძილი. */
function selfDistance(s: KleinSurface): number {
  const { ns, nv, P } = s;
  const pts: number[] = [];
  const row: number[] = [];
  // მხოლოდ შენარჩუნებული სამკუთხედების წვეროები (ფანჯარაში ამოჭრილი კედლის წვეროები არ ითვლება)
  const used = new Uint8Array((ns + 1) * nv);
  for (let i = 0; i < s.tris.length; i++) used[s.tris[i]] = 1;
  for (let i = 0; i < ns; i += 2)
    for (let j = 0; j < nv; j += 2) {
      if (!used[i * nv + j]) continue;
      const o = (i * nv + j) * 3;
      pts.push(P[o], P[o + 1], P[o + 2]);
      row.push(i);
    }
  const sep = Math.max(8, Math.round(ns * 0.07));
  let best = Infinity;
  const n = row.length;
  for (let a = 0; a < n; a++) {
    const ax = pts[a * 3],
      ay = pts[a * 3 + 1],
      az = pts[a * 3 + 2];
    for (let b = a + 1; b < n; b++) {
      let di = Math.abs(row[a] - row[b]);
      di = Math.min(di, ns - di);
      if (di < sep) continue;
      const dx = ax - pts[b * 3],
        dy = ay - pts[b * 3 + 1],
        dz = az - pts[b * 3 + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) best = d2;
    }
  }
  return Math.sqrt(best);
}

export interface KleinPhysical {
  solid: Solid;
  midTopology: SurfaceTopology;
  solidReport: ManifoldReport;
  midArea: number;
  /** შუა ზედაპირის თვითდაშორება მინუს სისქე (კონსერვატიული შეფასება; ≤ 0 ნიშნავს შეხებას). */
  selfClearance: number;
  dims: KleinDims;
}

/** ფიზიკურად დასაშვები მიახლოება: კლაინის ბოთლი მინუს დისკო (ფანჯარა), გასქელებული t სისქეზე. */
export function kleinPhysical(g: KleinGeom): KleinPhysical {
  const surf = buildSurface(g, true);
  const mid = midMesh(surf);
  const mesh = thicken(surf, g.t);
  if (meshVolume(mesh) < 0) flipMesh(mesh);
  const solid: Solid = {
    mesh,
    shell: { positions: mid.positions, indices: mid.indices, half: g.t / 2 },
    samples: mesh.positions,
    thickness: g.t,
    area: meshArea(mesh),
    volume: meshVolume(mesh),
    parts: 1,
  };
  return {
    solid,
    midTopology: surfaceTopology(mid),
    solidReport: checkManifold(mesh),
    midArea: meshArea(mid),
    selfClearance: selfDistance(surf) - g.t,
    dims: surf.dims,
  };
}

export interface KleinMath {
  mesh: Mesh; // იმერსიის შუა ზედაპირი (სისქის გარეშე)
  topology: SurfaceTopology;
  /** თვითგადაკვეთის მრუდი: ყელის ცილინდრისა და კორპუსის ცილინდრის თანაკვეთა. */
  curve: Float64Array;
  dims: KleinDims;
}

/** მათემატიკური იმერსია (სასწავლო): თვითგადაკვეთა მონიშნულია; ფიზიკურ გამოთვლაში არ მონაწილეობს. */
export function kleinMath(g: KleinGeom): KleinMath {
  const surf = buildSurface(g, false);
  const mesh = midMesh(surf);
  const d = surf.dims;
  const n = 96;
  const curve = new Float64Array((n + 1) * 3);
  for (let i = 0; i <= n; i++) {
    const a = (2 * Math.PI * i) / n;
    const y = d.rhoN * Math.cos(a);
    const z = d.zH + d.rhoN * Math.sin(a);
    curve[i * 3] = Math.sqrt(d.Rb * d.Rb - y * y);
    curve[i * 3 + 1] = y;
    curve[i * 3 + 2] = z;
  }
  return { mesh, topology: surfaceTopology(mesh), curve, dims: d };
}
