// სასრული სისქის გამტარი სხეულები: ფირფიტა, გადატანილი (swept) ლენტი (რგოლი / მიობიუსი), რკალური გარსი.
// თითო სხეულს აქვს (ა) ჩაკეტილი სამკუთხა ბადე და (ბ) ნიშნიანი მანძილის ფუნქცია (SDF) ერთი და იმავე განსაზღვრებით.
import {
  Mesh,
  Mat3,
  mergeMeshes,
  meshArea,
  meshVolume,
  flipMesh,
  rotationMatrix,
  transformPositions,
} from './mesh';

export type Sdf = (x: number, y: number, z: number) => number;

export interface Solid {
  mesh: Mesh;
  /** ანალიზური ნიშნიანი მანძილი (უარყოფითი — შიგნით). */
  sdf?: Sdf;
  /** შუა ზედაპირით განსაზღვრული გარსი (კლაინის მიახლოება): სხეული = {p : dist(p, ზედაპირი) ≤ half}. */
  shell?: { positions: Float64Array; indices: Uint32Array; half: number };
  /** ზედაპირის საკონტროლო წერტილები მანძილის შესამოწმებლად. */
  samples: Float64Array;
  thickness: number;
  area: number; // გარე (დასველებადი) ზედაპირის ფართობი, m²
  volume: number; // მასალის მოცულობა, m³
  parts: number; // ცალკეული ნაწილების რაოდენობა
}

function finish(mesh: Mesh, sdf: Sdf | undefined, thickness: number, parts: number, samples?: Float64Array): Solid {
  if (meshVolume(mesh) < 0) flipMesh(mesh);
  return {
    mesh,
    sdf,
    samples: samples ?? mesh.positions,
    thickness,
    area: meshArea(mesh),
    volume: meshVolume(mesh),
    parts,
  };
}

// ---------------------------------------------------------------------------------------------
// ფირფიტა (მართკუთხა პარალელეპიპედი)
// ---------------------------------------------------------------------------------------------
export function boxSolid(center: [number, number, number], size: [number, number, number]): Solid {
  const [cx, cy, cz] = center;
  const hx = size[0] / 2,
    hy = size[1] / 2,
    hz = size[2] / 2;
  const positions = new Float64Array(24);
  let n = 0;
  for (let k = 0; k < 2; k++)
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 2; i++) {
        positions[n++] = cx + (i ? hx : -hx);
        positions[n++] = cy + (j ? hy : -hy);
        positions[n++] = cz + (k ? hz : -hz);
      }
  // წვერო = i + 2j + 4k
  const quads = [
    [0, 4, 6, 2], // -x
    [1, 3, 7, 5], // +x
    [0, 1, 5, 4], // -y
    [2, 6, 7, 3], // +y
    [0, 2, 3, 1], // -z
    [4, 5, 7, 6], // +z
  ];
  const indices = new Uint32Array(36);
  const groups = new Uint8Array(12);
  quads.forEach((q, f) => {
    indices.set([q[0], q[1], q[2], q[0], q[2], q[3]], f * 6);
    groups[f * 2] = f;
    groups[f * 2 + 1] = f;
  });
  const sdf: Sdf = (x, y, z) => {
    const qx = Math.abs(x - cx) - hx,
      qy = Math.abs(y - cy) - hy,
      qz = Math.abs(z - cz) - hz;
    const ox = Math.max(qx, 0),
      oy = Math.max(qy, 0),
      oz = Math.max(qz, 0);
    return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0);
  };
  // ზედაპირის საკონტროლო ბადე
  const S = 8;
  const pts: number[] = [];
  for (let a = 0; a <= S; a++)
    for (let b = 0; b <= S; b++) {
      const u = -1 + (2 * a) / S,
        v = -1 + (2 * b) / S;
      pts.push(cx - hx, cy + u * hy, cz + v * hz, cx + hx, cy + u * hy, cz + v * hz);
      pts.push(cx + u * hx, cy - hy, cz + v * hz, cx + u * hx, cy + hy, cz + v * hz);
      pts.push(cx + u * hx, cy + v * hy, cz - hz, cx + u * hx, cy + v * hy, cz + hz);
    }
  return finish({ positions, indices, groups }, sdf, Math.min(...size), 1, new Float64Array(pts));
}

// ---------------------------------------------------------------------------------------------
// გადატანილი ლენტი: მართკუთხა კვეთა (w × t) ბრუნავს მერიდიანულ სიბრტყეში კუთხით θ(u) = n·u/2 + θ0
//   P(u; v, s) = (R + v·cosθ − s·sinθ)·r̂(u) + (v·sinθ + s·cosθ)·ẑ
// n = 0 — ჩვეულებრივი რგოლი; n = 1 — მიობიუსის ლენტი; s = 0 ემთხვევა მომხმარებლის მოცემულ პარამეტრიზაციას.
// ნაკერი: კენტი n-ისას კვეთა ერთი ბრუნის შემდეგ π-ით არის მობრუნებული; მართკუთხედი π-ბრუნვის მიმართ სიმეტრიულია,
// ამიტომ ბოლო რგოლი პირველს უერთდება პერიმეტრის ინდექსის M/2-ით წანაცვლებით. გლობალური ნორმალი არ გამოიყენება.
// ---------------------------------------------------------------------------------------------
export interface BandGeom {
  R: number;
  w: number;
  t: number;
  n: number; // ნახევარბრუნების რაოდენობა
  th0: number; // ფაზა (რად)
  off?: number; // კვეთის ცენტრის წანაცვლება სისქის მიმართულებით (კონფორმული კონტრელექტროდი)
  nu?: number; // სეგმენტები ერთ ბრუნზე
  nw?: number; // სეგმენტები სიგანეზე
}

function bandLoopMesh(g: BandGeom, sC: number, loops: number): Mesh {
  const nu = (g.nu ?? 180) * loops;
  const nw = g.nw ?? 6;
  const M = 2 * nw + 2;
  const hw = g.w / 2,
    ht = g.t / 2;
  const shift = (g.n * loops) % 2 !== 0 ? M / 2 : 0;
  const positions = new Float64Array(nu * M * 3);
  const pv = new Float64Array(M),
    ps = new Float64Array(M);
  for (let k = 0; k <= nw; k++) {
    pv[k] = -hw + (k * g.w) / nw;
    ps[k] = sC - ht;
    pv[nw + 1 + k] = hw - (k * g.w) / nw;
    ps[nw + 1 + k] = sC + ht;
  }
  for (let i = 0; i < nu; i++) {
    const u = (2 * Math.PI * loops * i) / nu;
    const th = (g.n / 2) * u + g.th0;
    const c = Math.cos(th),
      s = Math.sin(th);
    const cu = Math.cos(u),
      su = Math.sin(u);
    for (let k = 0; k < M; k++) {
      const a = pv[k] * c - ps[k] * s;
      const b = pv[k] * s + ps[k] * c;
      const o = (i * M + k) * 3;
      positions[o] = (g.R + a) * cu;
      positions[o + 1] = (g.R + a) * su;
      positions[o + 2] = b;
    }
  }
  const indices = new Uint32Array(nu * M * 6);
  const groups = new Uint8Array(nu * M * 2);
  let q = 0;
  for (let i = 0; i < nu; i++) {
    const i2 = (i + 1) % nu;
    const sh = i + 1 === nu ? shift : 0;
    for (let k = 0; k < M; k++) {
      const a = i * M + k;
      const b = i * M + ((k + 1) % M);
      const c2 = i2 * M + ((k + 1 + sh) % M);
      const d = i2 * M + ((k + sh) % M);
      // დიაგონალი ჭადრაკულად მონაცვლეობს: გადაგრეხილი (არაბრტყელი) ოთხკუთხედების ერთნაირი გაყოფა
      // მოცულობაში სისტემატურ წანაცვლებას იძლევა (~warp·A/12 თითო ოთხკუთხედზე), მონაცვლეობა მას აბათილებს.
      if ((i + k) % 2 === 0) indices.set([a, b, c2, a, c2, d], q * 6);
      else indices.set([a, b, d, b, c2, d], q * 6);
      const grp = k === nw || k === 2 * nw + 1 ? 1 : 0; // 0 — ფართო წახნაგები, 1 — ვიწრო კიდეები
      groups[q * 2] = grp;
      groups[q * 2 + 1] = grp;
      q++;
    }
  }
  return { positions, indices, groups };
}

export function bandSdf(g: BandGeom): Sdf {
  const { R, w, t, n, th0 } = g;
  const off = g.off ?? 0;
  const hw = w / 2,
    ht = t / 2,
    k = n / 2;
  return (x, y, z) => {
    const r = Math.hypot(x, y);
    const u = Math.atan2(y, x);
    const a = r - R;
    const th = k * u + th0;
    const c = Math.cos(th),
      sn = Math.sin(th);
    const v = a * c + z * sn;
    let s = -a * sn + z * c;
    if (off > 0) s = Math.abs(s) - off;
    const qv = Math.abs(v) - hw;
    let qs = Math.abs(s) - ht;
    if (k !== 0 && qs > 0) {
      // გადაგრეხით გამოწვეული დახრის შესწორება: ნამდვილი ნორმალი მერიდიანული სიბრტყიდან γ კუთხით გადაიხრება,
      // tanγ = (n/2)·v/(R + v·cosθ); მანძილი წახნაგამდე = მერიდიანული მანძილი · cosγ.
      const vc = Math.max(-hw, Math.min(hw, v));
      const tg = (k * vc) / Math.max(R + vc * c, 1e-9);
      qs /= Math.sqrt(1 + tg * tg);
    }
    const ox = Math.max(qv, 0),
      oy = Math.max(qs, 0);
    return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qv, qs), 0);
  };
}

/** კვეთის მაქსიმალური რადიალური გაბარიტი (ღერძის გადაკვეთის/თვითგადაკვეთის პირობისთვის). */
export function bandRadialReach(g: BandGeom): number {
  const off = g.off ?? 0;
  if (g.n === 0) {
    return (g.w / 2) * Math.abs(Math.cos(g.th0)) + (off + g.t / 2) * Math.abs(Math.sin(g.th0));
  }
  return Math.hypot(g.w / 2, off + g.t / 2);
}

export function bandSolid(g: BandGeom): Solid {
  const off = g.off ?? 0;
  let mesh: Mesh;
  let parts = 1;
  if (off > 0) {
    if (g.n % 2 !== 0) {
      // კენტი n: წანაცვლებული ლენტი ორი ბრუნის შემდეგ იკეტება და ძირითად ლენტს „ორივე მხრიდან“ ფარავს — ერთი ნაწილი.
      mesh = bandLoopMesh(g, off, 2);
    } else {
      const m1 = bandLoopMesh(g, off, 1);
      const m2 = bandLoopMesh(g, -off, 1);
      if (meshVolume(m1) < 0) flipMesh(m1);
      if (meshVolume(m2) < 0) flipMesh(m2);
      mesh = mergeMeshes([m1, m2]);
      parts = 2;
    }
  } else {
    mesh = bandLoopMesh(g, 0, 1);
  }
  return finish(mesh, bandSdf(g), g.t, parts);
}

/** ლენტის შუა ზედაპირის შეკერილი ბადე ტოპოლოგიის შესამოწმებლად (ორიენტირებადობა, საზღვრის კომპონენტები). */
export function bandMidSurface(g: BandGeom, nu = 96, nv = 6): Mesh {
  const positions = new Float64Array(nu * (nv + 1) * 3);
  for (let i = 0; i < nu; i++) {
    const u = (2 * Math.PI * i) / nu;
    const th = (g.n / 2) * u + g.th0;
    for (let j = 0; j <= nv; j++) {
      const v = -g.w / 2 + (g.w * j) / nv;
      const o = (i * (nv + 1) + j) * 3;
      positions[o] = (g.R + v * Math.cos(th)) * Math.cos(u);
      positions[o + 1] = (g.R + v * Math.cos(th)) * Math.sin(u);
      positions[o + 2] = v * Math.sin(th);
    }
  }
  const odd = g.n % 2 !== 0;
  const id = (i: number, j: number) => {
    if (i === nu) return odd ? nv - j : j; // ნაკერი: კენტი n-ისას v → −v
    return i * (nv + 1) + j;
  };
  const indices = new Uint32Array(nu * nv * 6);
  let q = 0;
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      indices.set([id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1)], q);
      q += 6;
    }
  return { positions, indices };
}

/** პარამეტრული შუა ზედაპირის ფართობი ∫∫|r_u × r_v| du dv (რიცხვითი ინტეგრალი). */
export function bandMidArea(g: BandGeom): number {
  const NU = 720,
    NV = 64;
  let a = 0;
  for (let i = 0; i < NU; i++) {
    const u = ((i + 0.5) * 2 * Math.PI) / NU;
    const th = (g.n / 2) * u + g.th0;
    for (let j = 0; j < NV; j++) {
      const v = -g.w / 2 + ((j + 0.5) * g.w) / NV;
      a += Math.hypot(g.R + v * Math.cos(th), (g.n / 2) * v);
    }
  }
  return (a * (2 * Math.PI) * g.w) / (NU * NV);
}

/** კიდის მრუდის სიგრძის ფარდობა ცენტრალურ წრეწირთან (რამდენად „იჭიმება“ ბრტყელი ზოლი ამ წრფოვან ფორმაში). */
export function bandEdgeStretch(g: BandGeom): number {
  const NU = 720;
  let lmax = 0;
  for (const v of [-g.w / 2, g.w / 2]) {
    let L = 0;
    for (let i = 0; i < NU; i++) {
      const u = ((i + 0.5) * 2 * Math.PI) / NU;
      const th = (g.n / 2) * u + g.th0;
      L += Math.hypot(g.R + v * Math.cos(th), (g.n / 2) * v);
    }
    L *= (2 * Math.PI) / NU;
    if (L > lmax) lmax = L;
  }
  return lmax / (2 * Math.PI * g.R) - 1;
}

// ---------------------------------------------------------------------------------------------
// რკალური ცილინდრული გარსი (კლაინის ფორმის კათოდის ანოდი)
// ---------------------------------------------------------------------------------------------
export interface ArcGeom {
  Rm: number; // შუა რადიუსი
  h: number; // სიმაღლე (z)
  t: number; // სისქე (რადიალური)
  span: number; // კუთხური გაშლა, რად
  center: number; // ცენტრის აზიმუტი, რად
  zc: number;
}

export function arcSolid(g: ArcGeom): Solid {
  const nu = Math.max(24, Math.round((g.span / (2 * Math.PI)) * 160));
  const r0 = g.Rm - g.t / 2,
    r1 = g.Rm + g.t / 2;
  const z0 = g.zc - g.h / 2,
    z1 = g.zc + g.h / 2;
  const pr = [r0, r1, r1, r0];
  const pz = [z0, z0, z1, z1];
  const positions = new Float64Array((nu + 1) * 4 * 3);
  for (let i = 0; i <= nu; i++) {
    const a = g.center - g.span / 2 + (g.span * i) / nu;
    for (let k = 0; k < 4; k++) {
      const o = (i * 4 + k) * 3;
      positions[o] = pr[k] * Math.cos(a);
      positions[o + 1] = pr[k] * Math.sin(a);
      positions[o + 2] = pz[k];
    }
  }
  const idx: number[] = [];
  const grp: number[] = [];
  for (let i = 0; i < nu; i++)
    for (let k = 0; k < 4; k++) {
      const a = i * 4 + k,
        b = i * 4 + ((k + 1) % 4),
        c = (i + 1) * 4 + ((k + 1) % 4),
        d = (i + 1) * 4 + k;
      idx.push(a, b, c, a, c, d);
      grp.push(k, k);
    }
  idx.push(0, 2, 1, 0, 3, 2);
  grp.push(4, 4);
  const e = nu * 4;
  idx.push(e, e + 1, e + 2, e, e + 2, e + 3);
  grp.push(5, 5);
  const mesh: Mesh = { positions, indices: new Uint32Array(idx), groups: new Uint8Array(grp) };
  const hs = g.span / 2;
  const sdf: Sdf = (x, y, z) => {
    const r = Math.hypot(x, y);
    let phi = Math.atan2(y, x) - g.center;
    phi = Math.atan2(Math.sin(phi), Math.cos(phi));
    const qz = Math.abs(z - g.zc) - g.h / 2;
    const ap = Math.abs(phi);
    if (ap <= hs) {
      const qr = Math.abs(r - g.Rm) - g.t / 2;
      const ox = Math.max(qr, 0),
        oy = Math.max(qz, 0);
      let d = Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qr, qz), 0);
      if (d < 0) {
        // შიგნით: მანძილი ბოლო წახნაგამდეც გასათვალისწინებელია
        const endDist = -(hs - ap) * r;
        d = Math.max(d, endDist);
      }
      return d;
    }
    const da = ap - hs;
    const xl = r * Math.cos(da),
      yl = r * Math.sin(da);
    const qr = Math.max(Math.abs(xl - g.Rm) - g.t / 2, 0);
    const oz = Math.max(qz, 0);
    return Math.sqrt(qr * qr + yl * yl + oz * oz);
  };
  return finish(mesh, sdf, Math.min(g.t, g.h), 1);
}

// ---------------------------------------------------------------------------------------------
// გარდაქმნები და კომბინაციები
// ---------------------------------------------------------------------------------------------
export interface Pose {
  pos: [number, number, number];
  rotDeg: [number, number, number];
  /** ბრუნვის ცენტრი ლოკალურ კოორდინატებში. */
  pivot?: [number, number, number];
}

export function placeSolid(s: Solid, pose: Pose): Solid {
  const R = rotationMatrix(pose.rotDeg[0], pose.rotDeg[1], pose.rotDeg[2]);
  const pv = pose.pivot ?? [0, 0, 0];
  // p' = R·(p − pivot) + pivot + pos
  const t: [number, number, number] = [
    pv[0] + pose.pos[0] - (R[0] * pv[0] + R[1] * pv[1] + R[2] * pv[2]),
    pv[1] + pose.pos[1] - (R[3] * pv[0] + R[4] * pv[1] + R[5] * pv[2]),
    pv[2] + pose.pos[2] - (R[6] * pv[0] + R[7] * pv[1] + R[8] * pv[2]),
  ];
  const mesh: Mesh = {
    positions: transformPositions(s.mesh.positions, R, t),
    indices: s.mesh.indices,
    groups: s.mesh.groups,
  };
  const samples = s.samples === s.mesh.positions ? mesh.positions : transformPositions(s.samples, R, t);
  const inner = s.sdf;
  const sdf: Sdf | undefined = inner
    ? (x, y, z) => {
        const dx = x - t[0],
          dy = y - t[1],
          dz = z - t[2];
        return inner(R[0] * dx + R[3] * dy + R[6] * dz, R[1] * dx + R[4] * dy + R[7] * dz, R[2] * dx + R[5] * dy + R[8] * dz);
      }
    : undefined;
  const shell = s.shell
    ? { positions: transformPositions(s.shell.positions, R, t), indices: s.shell.indices, half: s.shell.half }
    : undefined;
  return { ...s, mesh, sdf, shell, samples };
}

export function unionSolids(list: Solid[]): Solid {
  if (list.length === 1) return list[0];
  const mesh = mergeMeshes(list.map((s) => s.mesh));
  const sdfs = list.map((s) => s.sdf!).filter(Boolean);
  let total = 0;
  for (const s of list) total += s.samples.length;
  const samples = new Float64Array(total);
  let o = 0;
  for (const s of list) {
    samples.set(s.samples, o);
    o += s.samples.length;
  }
  return {
    mesh,
    sdf: (x, y, z) => {
      let d = Infinity;
      for (const f of sdfs) {
        const v = f(x, y, z);
        if (v < d) d = v;
      }
      return d;
    },
    samples,
    thickness: Math.min(...list.map((s) => s.thickness)),
    area: list.reduce((a, s) => a + s.area, 0),
    volume: list.reduce((a, s) => a + s.volume, 0),
    parts: list.reduce((a, s) => a + s.parts, 0),
  };
}

/**
 * ორ სხეულს შორის მინიმალური მანძილი: ერთი სხეულის ზედაპირის წერტილებზე მეორის SDF-ის მინიმუმი (ორივე მიმართულებით,
 * თუ SDF არსებობს). უარყოფითი მნიშვნელობა ნიშნავს გადაკვეთას. offset — b სხეულის დამატებითი გადატანა.
 */
export function minDistance(a: Solid, b: Solid, offset: [number, number, number] = [0, 0, 0]): number {
  let d = Infinity;
  const [tx, ty, tz] = offset;
  // ყველა საკონტროლო წერტილი გამოიყენება. (აუდიტი: ადრინდელი გამეჩხერება ყოველ მე-4 წვეროზე კლაინის გარსის
  // ორფენიან წვეროთა რიგს ემთხვეოდა და მხოლოდ შიდა ფენას იღებდა → დაშორება t-ით იყო გადაჭარბებული.)
  if (b.sdf) {
    const p = a.samples;
    for (let i = 0; i < p.length; i += 3) {
      const v = b.sdf(p[i] - tx, p[i + 1] - ty, p[i + 2] - tz);
      if (v < d) d = v;
    }
  }
  if (a.sdf) {
    const p = b.samples;
    for (let i = 0; i < p.length; i += 3) {
      const v = a.sdf(p[i] + tx, p[i + 1] + ty, p[i + 2] + tz);
      if (v < d) d = v;
    }
  }
  return d;
}

/** გადატანის მანძილის მორგება მოცემული ღერძის გასწვრივ ისე, რომ მინიმალური დაშორება = gap. */
export function fitTranslation(
  a: Solid,
  b: Solid,
  dir: [number, number, number],
  gap: number,
  hi: number,
): number | null {
  const f = (D: number) => minDistance(a, b, [dir[0] * D, dir[1] * D, dir[2] * D]) - gap;
  if (f(hi) < 0) return null;
  let lo = 0;
  // ვეძებთ უმცირეს D-ს, რომლის ზემოთაც დაშორება ≥ gap: hi-დან ქვემოთ ბისექცია
  let h = hi;
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + h);
    if (f(mid) < 0) lo = mid;
    else h = mid;
  }
  return h;
}
