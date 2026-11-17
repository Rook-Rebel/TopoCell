// ელექტროლიტში პოტენციალის სივრცული ამოხსნა:  ∇·(κ∇φ) = 0,  j = −κ∇φ.
//
// დისკრეტიზაცია: სასრული მოცულობები კუბურ ბადეზე (7-წერტილიანი შაბლონი). ავზის კედლები და თავისუფალი ზედაპირი
// იზოლირებულია (∂φ/∂n = 0). ელექტროდის ზედაპირი ჩაშენებული საზღვარია: სითხის უჯრედიდან ელექტროდის ნამდვილ
// ზედაპირამდე მანძილი δ აიღება სხეულის ნიშნიანი მანძილის ფუნქციიდან (Shortley–Weller-ის ტიპის სქემა),
// ამიტომ ვოქსელზე თხელი ელექტროდიც სწორ მანძილზე „ზის“.
//
// პირველადი განაწილება: φ = const ელექტროდებზე (კინეტიკა უგულებელყოფილია) → უჯრედის მუდმივა K [1/m], R = K/κ.
// მეორადი განაწილება: ელექტროდზე Butler–Volmer-ის არაწრფივი სასაზღვრო პირობა (ნიუტონის იტერაცია).
// მესამეული ეფექტები (კონცენტრაცია, ბუშტუკების ნაკადი, ელექტროდის ლითონის წინაღობა) არ მოდელირდება.
import { BBox, pointTriDist2 } from '../geometry/mesh';
import { Cell } from '../geometry/cell';
import { Solid } from '../geometry/solids';
import { Kinetics, bvCurrent, bvSlope, overpotential } from '../physics';

export interface Grid {
  nx: number;
  ny: number;
  nz: number;
  NX: number;
  NY: number;
  NZ: number;
  n: number;
  h: number;
  x0: number;
  y0: number;
  z0: number;
}

const FLUID = 0,
  ANODE = 1,
  CATHODE = 2,
  WALL = 3;
const BIG = 1e3;

export function makeGrid(tank: BBox, N: number): Grid {
  const L = [tank.max[0] - tank.min[0], tank.max[1] - tank.min[1], tank.max[2] - tank.min[2]];
  const h = Math.max(L[0], L[1], L[2]) / N;
  const nx = Math.max(4, Math.ceil(L[0] / h - 1e-9));
  const ny = Math.max(4, Math.ceil(L[1] / h - 1e-9));
  const nz = Math.max(4, Math.ceil(L[2] / h - 1e-9));
  const NX = nx + 2,
    NY = ny + 2,
    NZ = nz + 2;
  return {
    nx,
    ny,
    nz,
    NX,
    NY,
    NZ,
    n: NX * NY * NZ,
    h,
    x0: (tank.min[0] + tank.max[0]) / 2 - (nx * h) / 2 + h / 2,
    y0: (tank.min[1] + tank.max[1]) / 2 - (ny * h) / 2 + h / 2,
    z0: (tank.min[2] + tank.max[2]) / 2 - (nz * h) / 2 + h / 2,
  };
}

/** სხეულის ნიშნიანი მანძილი ვოქსელების ცენტრებში. */
function distanceField(s: Solid, g: Grid): Float32Array {
  const d = new Float32Array(g.n).fill(BIG);
  const { nx, ny, nz, NX, NY, h } = g;
  if (s.sdf) {
    const f = s.sdf;
    for (let k = 0; k < nz; k++) {
      const z = g.z0 + k * h;
      for (let j = 0; j < ny; j++) {
        const y = g.y0 + j * h;
        let idx = 1 + NX * (j + 1 + NY * (k + 1));
        for (let i = 0; i < nx; i++, idx++) d[idx] = f(g.x0 + i * h, y, z);
      }
    }
    return d;
  }
  if (!s.shell) throw new Error('სხეულს არც SDF აქვს და არც გარსი');
  const { positions: P, indices: T, half } = s.shell;
  const R = half + 3 * h;
  for (let t = 0; t < T.length; t += 3) {
    const a = T[t] * 3,
      b = T[t + 1] * 3,
      c = T[t + 2] * 3;
    const ax = P[a],
      ay = P[a + 1],
      az = P[a + 2];
    const bx = P[b],
      by = P[b + 1],
      bz = P[b + 2];
    const cx = P[c],
      cy = P[c + 1],
      cz = P[c + 2];
    const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - R - g.x0) / h));
    const i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) + R - g.x0) / h));
    const j0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - R - g.y0) / h));
    const j1 = Math.min(ny - 1, Math.floor((Math.max(ay, by, cy) + R - g.y0) / h));
    const k0 = Math.max(0, Math.ceil((Math.min(az, bz, cz) - R - g.z0) / h));
    const k1 = Math.min(nz - 1, Math.floor((Math.max(az, bz, cz) + R - g.z0) / h));
    for (let k = k0; k <= k1; k++) {
      const z = g.z0 + k * h;
      for (let j = j0; j <= j1; j++) {
        const y = g.y0 + j * h;
        let idx = i0 + 1 + NX * (j + 1 + NY * (k + 1));
        for (let i = i0; i <= i1; i++, idx++) {
          const d2 = pointTriDist2(g.x0 + i * h, y, z, ax, ay, az, bx, by, bz, cx, cy, cz);
          const dd = Math.sqrt(d2) - half;
          if (dd < d[idx]) d[idx] = dd;
        }
      }
    }
  }
  return d;
}

export interface Disc {
  grid: Grid;
  type: Uint8Array;
  fluid: Int32Array;
  diagBase: Float64Array;
  nLinks: number;
  linkCell: Int32Array;
  linkEl: Uint8Array; // 0 — ანოდი, 1 — კათოდი
  linkGo: Float64Array; // h/δ
  linkArea: Float64Array; // h²·|n·e| (ნამდვილი ზედაპირის ფართობის წილი)
  linkNax: Float32Array;
  areaGrid: [number, number];
  areaRef: [number, number];
  areaScale: [number, number];
  warnings: string[];
  gapCells: number;
  work?: { r: Float64Array; z: Float64Array; p: Float64Array; q: Float64Array };
}

export function discretize(cell: Cell, N: number, tankOverride?: BBox, areaOverride?: [number, number]): Disc {
  const g = makeGrid(tankOverride ?? cell.tank, N);
  const { NX, NY, n, h } = g;
  const NXY = NX * NY;
  const warnings: string[] = [];
  const dA = distanceField(cell.anode, g);
  const dC = distanceField(cell.cathode, g);
  const padA = Math.max(0, (h - cell.anode.thickness) / 2) + 1e-7 * h;
  const padC = Math.max(0, (h - cell.cathode.thickness) / 2) + 1e-7 * h;
  const type = new Uint8Array(n).fill(WALL);
  let nFluid = 0,
    conflicts = 0;
  for (let k = 0; k < g.nz; k++)
    for (let j = 0; j < g.ny; j++) {
      let idx = 1 + NX * (j + 1 + NY * (k + 1));
      for (let i = 0; i < g.nx; i++, idx++) {
        const a = dA[idx] <= padA,
          c = dC[idx] <= padC;
        if (a && c) {
          conflicts++;
          type[idx] = dA[idx] < dC[idx] ? ANODE : CATHODE;
        } else if (a) type[idx] = ANODE;
        else if (c) type[idx] = CATHODE;
        else {
          type[idx] = FLUID;
          nFluid++;
        }
      }
    }
  if (conflicts > 0) warnings.push(`ბადე ზედმეტად უხეშია: ${conflicts} ვოქსელი ერთდროულად ორივე ელექტროდს ეკუთვნის`);
  const fluid = new Int32Array(nFluid);
  let f = 0;
  for (let idx = 0; idx < n; idx++) if (type[idx] === FLUID) fluid[f++] = idx;
  const strides = [1, -1, NX, -NX, NXY, -NXY];
  const diagBase = new Float64Array(n);
  const lc: number[] = [],
    le: number[] = [],
    lg: number[] = [],
    la: number[] = [],
    ln: number[] = [];
  const gradComp = (d: Float32Array, P: number, s: number, eType: number): number => {
    const tp = type[P + s],
      tm = type[P - s];
    const okP = tp !== eType && tp !== WALL,
      okM = tm !== eType && tm !== WALL;
    if (okP && okM) return (d[P + s] - d[P - s]) / (2 * h);
    if (okP) return (d[P + s] - d[P]) / h;
    if (okM) return (d[P] - d[P - s]) / h;
    return 0;
  };
  const areaGrid: [number, number] = [0, 0];
  for (let q = 0; q < nFluid; q++) {
    const P = fluid[q];
    let nb = 0;
    let gA: number[] | null = null,
      gC: number[] | null = null;
    for (let dir = 0; dir < 6; dir++) {
      const t = type[P + strides[dir]];
      if (t === FLUID) nb++;
      else if (t === ANODE || t === CATHODE) {
        const e = t - 1;
        const d = e === 0 ? dA : dC;
        let gr: number[] | null = e === 0 ? gA : gC;
        if (!gr) {
          gr = [gradComp(d, P, 1, t), gradComp(d, P, NX, t), gradComp(d, P, NXY, t)];
          if (e === 0) gA = gr;
          else gC = gr;
        }
        const gn = Math.hypot(gr[0], gr[1], gr[2]);
        const nax = gn > 1e-6 ? Math.abs(gr[dir >> 1]) / gn : 1;
        const s0 = Math.max(d[P], 0);
        const delta = Math.max(0.2 * h, s0 / Math.max(nax, 1e-3));
        lc.push(P);
        le.push(e);
        lg.push(h / delta);
        la.push(h * h * nax);
        ln.push(nax);
        areaGrid[e] += h * h * nax;
      }
    }
    diagBase[P] = nb;
  }
  const areaRef: [number, number] = areaOverride ?? [cell.areaA, cell.areaC];
  const areaScale: [number, number] = [1, 1];
  for (let e = 0; e < 2; e++) {
    const c = areaGrid[e] > 0 ? areaRef[e] / areaGrid[e] : 1;
    if (c > 0.6 && c < 1.6) areaScale[e] = c;
    else
      warnings.push(
        `${e === 0 ? 'ანოდის' : 'კათოდის'} ბადისეული ფართობი (${(areaGrid[e] * 1e4).toFixed(1)} სმ²) მკვეთრად განსხვავდება ბადის ფართობისგან (${(areaRef[e] * 1e4).toFixed(1)} სმ²) — გარჩევადობა არასაკმარისია`,
      );
  }
  const gapCells = cell.minDistance / h;
  if (gapCells < 2) warnings.push(`ელექტროდებს შორის დაშორება მხოლოდ ${gapCells.toFixed(1)} ვოქსელია — შედეგი ბადეზე ძლიერაა დამოკიდებული`);
  return {
    grid: g,
    type,
    fluid,
    diagBase,
    nLinks: lc.length,
    linkCell: Int32Array.from(lc),
    linkEl: Uint8Array.from(le),
    linkGo: Float64Array.from(lg),
    linkArea: Float64Array.from(la),
    linkNax: Float32Array.from(ln),
    areaGrid,
    areaRef,
    areaScale,
    warnings,
    gapCells,
  };
}

/** იაკობის წინაპირობიანი შეუღლებული გრადიენტების მეთოდი. A = diag − (სითხის მეზობლების ჯამი); SPD. */
function pcg(disc: Disc, diag: Float64Array, b: Float64Array, x: Float64Array, tol: number, maxIter: number) {
  const { fluid, grid } = disc;
  const NX = grid.NX,
    NXY = grid.NX * grid.NY;
  if (!disc.work) {
    disc.work = {
      r: new Float64Array(grid.n),
      z: new Float64Array(grid.n),
      p: new Float64Array(grid.n),
      q: new Float64Array(grid.n),
    };
  }
  const { r, z, p, q } = disc.work;
  const nf = fluid.length;
  let bb = 0;
  for (let k = 0; k < nf; k++) {
    const i = fluid[k];
    bb += b[i] * b[i];
  }
  if (bb === 0) {
    for (let k = 0; k < nf; k++) x[fluid[k]] = 0;
    return { iters: 0, rel: 0 };
  }
  let rz = 0,
    rr = 0;
  for (let k = 0; k < nf; k++) {
    const i = fluid[k];
    const ax = diag[i] * x[i] - (x[i - 1] + x[i + 1] + x[i - NX] + x[i + NX] + x[i - NXY] + x[i + NXY]);
    const ri = b[i] - ax;
    r[i] = ri;
    const zi = ri / diag[i];
    z[i] = zi;
    p[i] = zi;
    rz += ri * zi;
    rr += ri * ri;
  }
  let it = 0;
  const target = tol * tol * bb;
  while (rr > target && it < maxIter) {
    let pq = 0;
    for (let k = 0; k < nf; k++) {
      const i = fluid[k];
      const v = diag[i] * p[i] - (p[i - 1] + p[i + 1] + p[i - NX] + p[i + NX] + p[i - NXY] + p[i + NXY]);
      q[i] = v;
      pq += p[i] * v;
    }
    const alpha = rz / pq;
    let rzNew = 0;
    rr = 0;
    for (let k = 0; k < nf; k++) {
      const i = fluid[k];
      x[i] += alpha * p[i];
      const ri = r[i] - alpha * q[i];
      r[i] = ri;
      const zi = ri / diag[i];
      z[i] = zi;
      rzNew += ri * zi;
      rr += ri * ri;
    }
    const beta = rzNew / rz;
    rz = rzNew;
    for (let k = 0; k < nf; k++) {
      const i = fluid[k];
      p[i] = z[i] + beta * p[i];
    }
    it++;
  }
  return { iters: it, rel: Math.sqrt(rr / bb) };
}

export interface DistStats {
  /** საშუალო დენის სიმკვრივე (პირველადში — 1; მეორადში — A/m² გეომეტრიულ ფართობზე). */
  mean: number;
  p50: number; // მედიანა / საშუალო
  p95: number; // 95-ე პერცენტილი / საშუალო (მდგრადი მაჩვენებელი)
  p99: number;
  max: number; // მაქსიმუმი / საშუალო (პირველადში ბადეზეა დამოკიდებული — კიდეებზე სინგულარობა)
  participation: number; // (∫j dA)² / (A·∫j² dA): 1 — თანაბარი განაწილება
  shadowFrac: number; // ფართობის წილი, სადაც j < 0.1·საშუალოზე („დაჩრდილული“)
}

function linkStats(disc: Disc, e: number, linkI: Float64Array, total: number): DistStats {
  const c = disc.areaScale[e];
  const js: number[] = [],
    ws: number[] = [];
  let A = 0,
    sj2 = 0;
  for (let f = 0; f < disc.nLinks; f++) {
    if (disc.linkEl[f] !== e) continue;
    const a = disc.linkArea[f] * c;
    A += a;
    if (disc.linkNax[f] < 0.25) continue;
    const j = Math.abs(linkI[f]) / a;
    js.push(j);
    ws.push(a);
  }
  const mean = Math.abs(total) / A;
  const order = js.map((_, i) => i).sort((a, b) => js[a] - js[b]);
  let wsum = 0;
  for (const w of ws) wsum += w;
  let acc = 0,
    p50 = 0,
    p95 = 0,
    p99 = 0,
    shadow = 0,
    max = 0,
    sj = 0;
  let got50 = false,
    got95 = false,
    got99 = false;
  for (const i of order) {
    acc += ws[i];
    const j = js[i];
    sj += j * ws[i];
    sj2 += j * j * ws[i];
    if (j < 0.1 * mean) shadow += ws[i];
    if (!got50 && acc >= 0.5 * wsum) {
      p50 = j;
      got50 = true;
    }
    if (!got95 && acc >= 0.95 * wsum) {
      p95 = j;
      got95 = true;
    }
    if (!got99 && acc >= 0.99 * wsum) {
      p99 = j;
      got99 = true;
    }
    if (j > max) max = j;
  }
  const m = mean > 0 ? mean : 1;
  return {
    mean,
    p50: p50 / m,
    p95: p95 / m,
    p99: p99 / m,
    max: max / m,
    participation: sj2 > 0 ? (sj * sj) / (wsum * sj2) : 1,
    shadowFrac: wsum > 0 ? shadow / wsum : 0,
  };
}

export interface TrapReport {
  fluidVolume: number;
  trappedVolume: number; // m³: სითხის მოცულობა, საიდანაც ბუშტუკი მონოტონურად ზემოთ ვერ ამოვა
  trappedFrac: number;
  trappedAreaA: number; // ანოდის ფართობის წილი, რომელიც ასეთ „ჯიბეებს“ ესაზღვრება
  trappedAreaC: number;
  isolatedVolume: number; // ელექტროლიტის მოცულობა, რომელიც ძირითად მოცულობასთან დაკავშირებული არ არის
  /** ჰიდროსტატიკური ჯიბე: უჯრედები, რომლებიც საკუთარ „გადმოღვრის დონეზე“ მაღლაა (იხ. analyzeTraps). */
  pocketVolume: number;
  pocketFrac: number;
  pocketAreaA: number;
  pocketAreaC: number;
  /** ჯიბის გადმოღვრის დონე (მოცულობით შეწონილი საშუალო z, m); NaN, თუ ჯიბე არ არის. */
  pocketSpillZ: number;
}

/**
 * გაზის ჩაკეტვის ორი გეომეტრიული ინდიკატორი (არცერთი არ არის მრავალფაზიანი მოდელი):
 *
 * 1) „პირდაპირი განიავება“ (mask): სითხის ვოქსელი განიავებადია, თუ მისგან თავისუფალ ზედაპირამდე არსებობს გზა,
 *    რომელზეც z არასდროს მცირდება. დანარჩენი უჯრედებიდან ამოსული ბუშტუკი ჯერ რომელიმე ჭერქვეშ მოხვდება.
 *
 * 2) „ჰიდროსტატიკური ჯიბე“ (pocketMask): თითო უჯრედისთვის L = max (ყველა გზაზე ზედაპირამდე) min z — დონე, რომლამდეც
 *    გაზმა უნდა ჩამოიწიოს, რომ გამოვიდეს. უჯრედი ჯიბეშია, თუ z > L: კვაზისტატიკურ ზღვარში ეს მოცულობა გაზით ივსება
 *    და შემდეგ გაზი გადმოღვრის წერტილიდან გადის. უგულებელყოფილია ზედაპირული დაჭიმულობა, გახსნა და დინამიკა.
 */
export function analyzeTraps(disc: Disc): { report: TrapReport; mask: Uint8Array; pocketMask: Uint8Array } {
  const { grid: g, type } = disc;
  const { NX, NY, nx, ny, nz, n, h } = g;
  const NXY = NX * NY;
  const vent = new Uint8Array(n);
  const stack = new Int32Array(nx * ny + 8);
  for (let k = nz - 1; k >= 0; k--) {
    let sp = 0;
    for (let j = 0; j < ny; j++) {
      let idx = 1 + NX * (j + 1 + NY * (k + 1));
      for (let i = 0; i < nx; i++, idx++) {
        if (type[idx] !== FLUID) continue;
        if (k === nz - 1 || vent[idx + NXY]) {
          vent[idx] = 1;
          stack[sp++] = idx;
        }
      }
    }
    while (sp > 0) {
      const c = stack[--sp];
      const nb = [c - 1, c + 1, c - NX, c + NX];
      for (let m = 0; m < 4; m++) {
        const q = nb[m];
        if (type[q] === FLUID && !vent[q]) {
          vent[q] = 1;
          stack[sp++] = q;
        }
      }
    }
  }
  // გადმოღვრის დონე L (max–min გზა ზედა ფენიდან; ფენებად დალაგებული რიგი — Dijkstra-ს ანალოგი დისკრეტულ დონეებზე).
  // L < 0 ნიშნავს, რომ უჯრედი ძირითად მოცულობასთან დაკავშირებული არ არის.
  const L = new Int16Array(n).fill(-1);
  const buckets: number[][] = Array.from({ length: nz }, () => []);
  for (let j = 0; j < ny; j++) {
    let idx = 1 + NX * (j + 1 + NY * nz);
    for (let i = 0; i < nx; i++, idx++)
      if (type[idx] === FLUID) {
        L[idx] = nz - 1;
        buckets[nz - 1].push(idx);
      }
  }
  const s6 = [1, -1, NX, -NX, NXY, -NXY];
  for (let k = nz - 1; k >= 0; k--) {
    const b = buckets[k];
    for (let q = 0; q < b.length; q++) {
      const c = b[q];
      for (let m = 0; m < 6; m++) {
        const nb = c + s6[m];
        if (type[nb] !== FLUID || L[nb] >= 0) continue;
        const kn = Math.floor(nb / NXY) - 1;
        const Ln = kn < k ? kn : k;
        L[nb] = Ln;
        buckets[Ln].push(nb);
      }
    }
  }
  const mask = new Uint8Array(n);
  const pocketMask = new Uint8Array(n);
  let nf = 0,
    nt = 0,
    ni = 0,
    np = 0,
    spill = 0;
  for (let k = 0; k < disc.fluid.length; k++) {
    const i = disc.fluid[k];
    nf++;
    if (!vent[i]) {
      nt++;
      mask[i] = 1;
    }
    if (L[i] < 0) ni++;
    else if (Math.floor(i / NXY) - 1 > L[i]) {
      np++;
      pocketMask[i] = 1;
      spill += g.z0 + (L[i] + 0.5) * h;
    }
  }
  const ta = [0, 0],
    pa = [0, 0],
    aa = [0, 0];
  for (let f = 0; f < disc.nLinks; f++) {
    const e = disc.linkEl[f];
    aa[e] += disc.linkArea[f];
    if (!vent[disc.linkCell[f]]) ta[e] += disc.linkArea[f];
    if (pocketMask[disc.linkCell[f]]) pa[e] += disc.linkArea[f];
  }
  const v = h * h * h;
  return {
    report: {
      fluidVolume: nf * v,
      trappedVolume: nt * v,
      trappedFrac: nf ? nt / nf : 0,
      trappedAreaA: aa[0] ? ta[0] / aa[0] : 0,
      trappedAreaC: aa[1] ? ta[1] / aa[1] : 0,
      isolatedVolume: ni * v,
      pocketVolume: np * v,
      pocketFrac: nf ? np / nf : 0,
      pocketAreaA: aa[0] ? pa[0] / aa[0] : 0,
      pocketAreaC: aa[1] ? pa[1] / aa[1] : 0,
      pocketSpillZ: np ? spill / np : NaN,
    },
    mask,
    pocketMask,
  };
}

export const MEASURE_THRESHOLDS = [0.05, 0.1, 0.25, 0.5, 1, 2];

/** დენის განაწილების არათანაბრობის მაჩვენებლები (ზღვრის გარეშე და ზღვრით). x = j / საშუალო j. */
export interface DistMeasures {
  /** exp(−Σ (a/A)·x·ln x): ტაფელის ზღვარში ზუსტად უდრის „კინეტიკურად ეკვივალენტური ფართობის“ წილს. */
  entropyUtil: number;
  /** 1 / Σ (a/A)·x² — წრფივი კინეტიკის ეკვივალენტური ფართობის წილი. */
  participation: number;
  thresholds: number[];
  /** ფართობის წილი, სადაც j ≥ t·საშუალო. */
  areaAbove: number[];
  /** ამ ფართობზე გამავალი დენის წილი. */
  currentAbove: number[];
}

export function distMeasures(disc: Disc, e: number, linkI: Float64Array): DistMeasures {
  const c = disc.areaScale[e];
  let A = 0,
    I = 0;
  for (let f = 0; f < disc.nLinks; f++) {
    if (disc.linkEl[f] !== e) continue;
    A += disc.linkArea[f] * c;
    I += Math.abs(linkI[f]);
  }
  const mean = A > 0 ? I / A : 0;
  let kl = 0,
    s2 = 0;
  const areaAbove = MEASURE_THRESHOLDS.map(() => 0);
  const currentAbove = MEASURE_THRESHOLDS.map(() => 0);
  if (mean > 0) {
    for (let f = 0; f < disc.nLinks; f++) {
      if (disc.linkEl[f] !== e) continue;
      const a = disc.linkArea[f] * c;
      if (!(a > 0)) continue;
      const x = Math.abs(linkI[f]) / a / mean;
      const w = a / A;
      if (x > 0) kl += w * x * Math.log(x);
      s2 += w * x * x;
      for (let t = 0; t < MEASURE_THRESHOLDS.length; t++)
        if (x >= MEASURE_THRESHOLDS[t]) {
          areaAbove[t] += w;
          currentAbove[t] += w * x;
        }
    }
  }
  return {
    entropyUtil: mean > 0 ? Math.exp(-kl) : 1,
    participation: s2 > 0 ? 1 / s2 : 1,
    thresholds: MEASURE_THRESHOLDS.slice(),
    areaAbove,
    currentAbove,
  };
}

export interface Fields {
  grid: Grid;
  phi: Float32Array;
  jA: Float32Array; // ანოდის მიმდებარე უჯრედებში ზედაპირული დენის სიმკვრივე
  jC: Float32Array;
  type: Uint8Array;
  trapMask: Uint8Array;
  /** ერთეული: 'rel' — j/საშუალო (პირველადი), 'abs' — A/m² (მეორადი). */
  unit: 'rel' | 'abs';
  phiRange: [number, number];
}

export interface PrimaryResult {
  K: number; // უჯრედის მუდმივა, 1/m
  balance: number; // |I_a + I_c| / I_a
  iters: number;
  relRes: number;
  statsA: DistStats;
  statsC: DistStats;
  measuresA: DistMeasures;
  measuresC: DistMeasures;
  areaGrid: [number, number];
  areaScale: [number, number];
  unknowns: number;
  h: number;
  dims: [number, number, number];
  gapCells: number;
  ms: number;
  warnings: string[];
  traps: TrapReport;
  fields?: Fields;
}

function cellMaps(disc: Disc, linkI: Float64Array, norm: [number, number]): { jA: Float32Array; jC: Float32Array } {
  const n = disc.grid.n;
  const fl = [new Float64Array(n), new Float64Array(n)];
  const ar = [new Float64Array(n), new Float64Array(n)];
  for (let f = 0; f < disc.nLinks; f++) {
    const e = disc.linkEl[f],
      P = disc.linkCell[f];
    fl[e][P] += Math.abs(linkI[f]);
    ar[e][P] += disc.linkArea[f] * disc.areaScale[e];
  }
  const out = [new Float32Array(n), new Float32Array(n)];
  for (let f = 0; f < disc.nLinks; f++) {
    const e = disc.linkEl[f],
      P = disc.linkCell[f];
    if (ar[e][P] > 0) out[e][P] = fl[e][P] / ar[e][P] / norm[e];
  }
  return { jA: out[0], jC: out[1] };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** პირველადი დენის განაწილება: φ_ანოდი = 1, φ_კათოდი = 0, κ = 1. */
export function solvePrimary(disc: Disc, wantFields = false, tol = 1e-9): PrimaryResult {
  const t0 = now();
  const { grid: g, fluid } = disc;
  const diag = new Float64Array(g.n);
  const b = new Float64Array(g.n);
  for (let k = 0; k < fluid.length; k++) diag[fluid[k]] = disc.diagBase[fluid[k]];
  for (let f = 0; f < disc.nLinks; f++) {
    const P = disc.linkCell[f];
    diag[P] += disc.linkGo[f];
    if (disc.linkEl[f] === 0) b[P] += disc.linkGo[f];
  }
  for (let k = 0; k < fluid.length; k++) if (diag[fluid[k]] === 0) diag[fluid[k]] = 1;
  const x = new Float64Array(g.n);
  const res = pcg(disc, diag, b, x, tol, 40000);
  const linkI = new Float64Array(disc.nLinks);
  let Ia = 0,
    Ic = 0;
  for (let f = 0; f < disc.nLinks; f++) {
    const P = disc.linkCell[f];
    if (disc.linkEl[f] === 0) {
      const v = g.h * disc.linkGo[f] * (1 - x[P]);
      linkI[f] = v;
      Ia += v;
    } else {
      const v = g.h * disc.linkGo[f] * x[P];
      linkI[f] = v;
      Ic += v;
    }
  }
  const traps = analyzeTraps(disc);
  const statsA = linkStats(disc, 0, linkI, Ia);
  const statsC = linkStats(disc, 1, linkI, Ic);
  const out: PrimaryResult = {
    K: Ia > 0 ? 1 / Ia : Infinity,
    balance: Ia > 0 ? Math.abs(Ia - Ic) / Ia : 0,
    iters: res.iters,
    relRes: res.rel,
    statsA: { ...statsA, mean: 1 },
    statsC: { ...statsC, mean: 1 },
    measuresA: distMeasures(disc, 0, linkI),
    measuresC: distMeasures(disc, 1, linkI),
    areaGrid: disc.areaGrid,
    areaScale: disc.areaScale,
    unknowns: fluid.length,
    h: g.h,
    dims: [g.nx, g.ny, g.nz],
    gapCells: disc.gapCells,
    ms: 0,
    warnings: disc.warnings.slice(),
    traps: traps.report,
  };
  if (wantFields) {
    const maps = cellMaps(disc, linkI, [statsA.mean || 1, statsC.mean || 1]);
    const phi = new Float32Array(g.n);
    for (let i = 0; i < g.n; i++) {
      const t = disc.type[i];
      phi[i] = t === FLUID ? x[i] : t === ANODE ? 1 : t === CATHODE ? 0 : NaN;
    }
    out.fields = { grid: g, phi, jA: maps.jA, jC: maps.jC, type: disc.type, trapMask: traps.mask, unit: 'rel', phiRange: [0, 1] };
  }
  out.ms = now() - t0;
  return out;
}

export interface SecondaryPhys {
  T: number;
  eRev: number;
  kappaEff: number;
  kinA: Kinetics;
  kinC: Kinetics;
  mA: number; // f_r·(1 − θ_a): აქტიური/გეომეტრიული ფართობი
  mC: number;
  extraR: number;
  areaA: number;
  areaC: number;
}

export interface SecondaryResult {
  converged: boolean;
  iterations: number;
  note?: string;
  I: number;
  U: number;
  P: number;
  etaA: number; // დენით შეწონილი საშუალო გადაძაბვა
  etaC: number;
  ohmic: number; // ელექტროლიტში ძაბვის ვარდნა (ენერგეტიკულად თანმიმდევრული)
  RelEff: number; // ohmic / I
  utilA: number; // კინეტიკურად ეკვივალენტური ფართობი / დასველებული ფართობი
  utilC: number;
  statsA: DistStats;
  statsC: DistStats;
  balance: number;
  lumped: { U: number; etaA: number; etaC: number; ohmic: number };
  dU: number; // U_სივრცული − U_ერთიანი
  ms: number;
  measuresA?: DistMeasures;
  measuresC?: DistMeasures;
  /** ენერგიის დამოუკიდებელი ბალანსი (მხოლოდ wantAudit-ისას). */
  energy?: EnergyAudit;
  fields?: Fields;
}

/**
 * ენერგიის ბალანსი, გამოთვლილი ამოხსნილი ველიდან დამოუკიდებლად (არა ანგარიშში გამოყენებული სხვაობით):
 *   (U_შიდა − E_rev)·I  =  ჯოულის სითბო ელექტროლიტში (მოცულობა + სასაზღვრო ნახევარბმულები)  +  Σ I_f·η_f (ანოდი)  +  Σ I_f·η_f (კათოდი).
 * სასაზღვრო დენები აქ არაწრფივი BV-დან ითვლება (არა გაწრფივებული მნიშვნელობიდან), ამიტომ შეუსაბამობა ერთდროულად
 * ამოწმებს ნიუტონის კრებადობას და იმას, რომ არცერთი დანაკარგი ორჯერ ან საერთოდ გამოტოვებული არ არის.
 */
export interface EnergyAudit {
  inputW: number; // (U_შიდა − E_rev)·I
  jouleBulkW: number;
  jouleLinksW: number;
  kineticAW: number;
  kineticCW: number;
  closure: number; // (ჯამი − inputW) / inputW
  maxLinkMismatch: number; // max |I_BV − I_გაწრფივებული| / I
  reportedOhmicW: number; // ანგარიშის „ohmic“·I — უნდა ემთხვეოდეს jouleBulkW + jouleLinksW
}

/**
 * მეორადი დენის განაწილება BV სასაზღვრო პირობით. სამიზნე: ფიქსირებული I, U ან P.
 * K — პირველადი ამოხსნის უჯრედის მუდმივა (საწყისი მიახლოებისა და შედარებისთვის).
 */
export function solveSecondary(
  disc: Disc,
  ph: SecondaryPhys,
  target: { mode: 'I' | 'U' | 'P'; value: number },
  K: number,
  wantFields = false,
  wantAudit = false,
): SecondaryResult {
  const t0 = now();
  const { grid: g, fluid } = disc;
  const h = g.h;
  const kh = ph.kappaEff * h;
  const Rel = K / ph.kappaEff;
  const lumpedParts = (I: number) => {
    const ea = overpotential(I / (ph.areaA * ph.mA), ph.kinA, ph.T);
    const ec = overpotential(I / (ph.areaC * ph.mC), ph.kinC, ph.T);
    return { ea, ec, U: ph.eRev + ea + ec + I * (Rel + ph.extraR) };
  };
  const solveFor = (fn: (I: number) => number): number => {
    let lo = 0,
      hi = 1e-6,
      guard = 0;
    while (fn(hi) < 0 && guard++ < 200) {
      lo = hi;
      hi *= 2;
    }
    for (let i = 0; i < 100; i++) {
      const mid = 0.5 * (lo + hi);
      if (fn(mid) < 0) lo = mid;
      else hi = mid;
    }
    return 0.5 * (lo + hi);
  };
  let I0: number;
  if (target.mode === 'I') I0 = target.value;
  else if (target.mode === 'U') I0 = target.value <= ph.eRev ? 0 : solveFor((I) => lumpedParts(I).U - target.value);
  else I0 = target.value <= 0 ? 0 : solveFor((I) => lumpedParts(I).U * I - target.value);
  const zeroStats: DistStats = { mean: 0, p50: 0, p95: 0, p99: 0, max: 0, participation: 1, shadowFrac: 0 };
  if (!(I0 > 0)) {
    return {
      converged: true,
      iterations: 0,
      note: 'ნულოვანი დენი: ელექტროლიზი არ მიმდინარეობს',
      I: 0,
      U: target.mode === 'U' ? target.value : ph.eRev,
      P: 0,
      etaA: 0,
      etaC: 0,
      ohmic: 0,
      RelEff: Rel,
      utilA: 1,
      utilC: 1,
      statsA: zeroStats,
      statsC: zeroStats,
      balance: 0,
      lumped: { U: ph.eRev, etaA: 0, etaC: 0, ohmic: 0 },
      dU: 0,
      ms: now() - t0,
    };
  }
  const l0 = lumpedParts(I0);
  let W = l0.ea + l0.ec + I0 * Rel; // შიდა უჯრედის ძაბვა მინუს E_rev
  const eta = new Float64Array(disc.nLinks);
  for (let f = 0; f < disc.nLinks; f++) eta[f] = disc.linkEl[f] === 0 ? l0.ea : l0.ec;
  const Rdiff0 =
    Rel + 1 / (ph.mA * bvSlope(l0.ea, ph.kinA, ph.T) * ph.areaA) + 1 / (ph.mC * bvSlope(l0.ec, ph.kinC, ph.T) * ph.areaC);
  let Rdiff = Rdiff0;
  const diag = new Float64Array(g.n);
  const b = new Float64Array(g.n);
  const x = new Float64Array(g.n);
  // საწყისი ველი: წრფივი ინტერპოლაციის ნაცვლად — შუა მნიშვნელობა
  for (let k = 0; k < fluid.length; k++) x[fluid[k]] = l0.ec + 0.5 * I0 * Rel;
  const geff = new Float64Array(disc.nLinks);
  const phiEff = new Float64Array(disc.nLinks);
  const linkI = new Float64Array(disc.nLinks);
  let Ia = 0,
    Ic = 0;
  let converged = false;
  let it = 0;
  let prevW = NaN,
    prevI = NaN;
  const maxIt = 80;
  for (it = 1; it <= maxIt; it++) {
    for (let k = 0; k < fluid.length; k++) {
      const i = fluid[k];
      diag[i] = disc.diagBase[i];
      b[i] = 0;
    }
    for (let f = 0; f < disc.nLinks; f++) {
      const e = disc.linkEl[f];
      const P = disc.linkCell[f];
      const kin = e === 0 ? ph.kinA : ph.kinC;
      const m = e === 0 ? ph.mA : ph.mC;
      const jk = m * bvCurrent(eta[f], kin, ph.T);
      const gk = m * bvSlope(eta[f], kin, ph.T);
      const Gk = gk * disc.linkArea[f] * disc.areaScale[e];
      const Go = kh * disc.linkGo[f];
      const G = (Go * Gk) / (Go + Gk);
      const phi = e === 0 ? W - eta[f] + jk / gk : eta[f] - jk / gk;
      geff[f] = G;
      phiEff[f] = phi;
      diag[P] += G / kh;
      b[P] += (G * phi) / kh;
    }
    for (let k = 0; k < fluid.length; k++) if (diag[fluid[k]] === 0) diag[fluid[k]] = 1;
    pcg(disc, diag, b, x, 1e-9, 20000);
    Ia = 0;
    Ic = 0;
    let maxD = 0;
    for (let f = 0; f < disc.nLinks; f++) {
      const e = disc.linkEl[f];
      const P = disc.linkCell[f];
      const Go = kh * disc.linkGo[f];
      let etaNew: number;
      if (e === 0) {
        const If = geff[f] * (phiEff[f] - x[P]);
        linkI[f] = If;
        Ia += If;
        etaNew = W - (x[P] + If / Go);
      } else {
        const If = geff[f] * (x[P] - phiEff[f]);
        linkI[f] = If;
        Ic += If;
        etaNew = x[P] - If / Go;
      }
      let d = etaNew - eta[f];
      if (Math.abs(d) > maxD) maxD = Math.abs(d);
      if (d > 0.1) d = 0.1;
      else if (d < -0.1) d = -0.1;
      eta[f] += d;
    }
    // სამიზნის მორგება
    let err = 0;
    if (it >= 2 && Number.isFinite(prevI) && Math.abs(Ia - prevI) > 1e-10 * Math.abs(Ia) && Math.abs(W - prevW) > 0) {
      const sl = (W - prevW) / (Ia - prevI);
      if (sl > 0.2 * Rdiff0 && sl < 5 * Rdiff0) Rdiff = sl;
    }
    prevW = W;
    prevI = Ia;
    if (target.mode === 'I') {
      err = (target.value - Ia) / target.value;
      W += Rdiff * (target.value - Ia);
    } else if (target.mode === 'U') {
      const Wn = target.value - Ia * ph.extraR - ph.eRev;
      err = (Wn - W) / target.value;
      W = ph.extraR > 0 ? W + (Wn - W) * (Rdiff / (Rdiff + ph.extraR)) : Wn;
    } else {
      const Uc = W + ph.eRev + Ia * ph.extraR;
      const Pk = Uc * Ia;
      err = (target.value - Pk) / target.value;
      W += (target.value - Pk) / (Ia + Uc / (Rdiff + ph.extraR));
    }
    if (maxD < 2e-7 && Math.abs(err) < 1e-7 && it >= 2) {
      converged = true;
      break;
    }
  }
  const I = Ia;
  const Wfinal = prevW; // W, რომლითაც ბოლო ამოხსნა შესრულდა
  let sa = 0,
    sc = 0;
  for (let f = 0; f < disc.nLinks; f++) {
    if (disc.linkEl[f] === 0) sa += linkI[f] * eta[f];
    else sc += linkI[f] * eta[f];
  }
  const etaA = Ia > 0 ? sa / Ia : 0;
  const etaC = Ic > 0 ? sc / Ic : 0;
  const ohmic = Wfinal - etaA - etaC;
  const U = Wfinal + ph.eRev + I * ph.extraR;
  const lump = lumpedParts(I);
  const jEqA = ph.mA * bvCurrent(etaA, ph.kinA, ph.T);
  const jEqC = ph.mC * bvCurrent(etaC, ph.kinC, ph.T);
  const statsA = linkStats(disc, 0, linkI, Ia);
  const statsC = linkStats(disc, 1, linkI, Ic);
  const out: SecondaryResult = {
    converged,
    iterations: Math.min(it, maxIt),
    note: converged ? undefined : 'ნიუტონის იტერაცია არ დაიკრიბა — შედეგი არასანდოა',
    I,
    U,
    P: U * I,
    etaA,
    etaC,
    ohmic,
    RelEff: ohmic / I,
    utilA: jEqA > 0 ? I / jEqA / ph.areaA : 1,
    utilC: jEqC > 0 ? I / jEqC / ph.areaC : 1,
    statsA,
    statsC,
    balance: Ia > 0 ? Math.abs(Ia - Ic) / Ia : 0,
    lumped: { U: lump.U, etaA: lump.ea, etaC: lump.ec, ohmic: I * Rel },
    dU: U - lump.U,
    ms: 0,
    measuresA: distMeasures(disc, 0, linkI),
    measuresC: distMeasures(disc, 1, linkI),
  };
  if (wantAudit) {
    const NX = g.NX,
      NXY = g.NX * g.NY;
    const type = disc.type;
    let bulk = 0;
    for (let k = 0; k < fluid.length; k++) {
      const i = fluid[k];
      const xi = x[i];
      if (type[i + 1] === FLUID) bulk += (xi - x[i + 1]) ** 2;
      if (type[i + NX] === FLUID) bulk += (xi - x[i + NX]) ** 2;
      if (type[i + NXY] === FLUID) bulk += (xi - x[i + NXY]) ** 2;
    }
    bulk *= kh;
    let links = 0,
      kinA = 0,
      kinC = 0,
      mism = 0;
    for (let f = 0; f < disc.nLinks; f++) {
      const e = disc.linkEl[f];
      const kin = e === 0 ? ph.kinA : ph.kinC;
      const m = e === 0 ? ph.mA : ph.mC;
      const Ibv = m * bvCurrent(eta[f], kin, ph.T) * disc.linkArea[f] * disc.areaScale[e];
      links += (Ibv * Ibv) / (kh * disc.linkGo[f]);
      if (e === 0) kinA += Ibv * eta[f];
      else kinC += Ibv * eta[f];
      const d = Math.abs(Ibv - linkI[f]) / I;
      if (d > mism) mism = d;
    }
    const input = Wfinal * I;
    out.energy = {
      inputW: input,
      jouleBulkW: bulk,
      jouleLinksW: links,
      kineticAW: kinA,
      kineticCW: kinC,
      closure: (bulk + links + kinA + kinC - input) / input,
      maxLinkMismatch: mism,
      reportedOhmicW: ohmic * I,
    };
  }
  if (wantFields) {
    const maps = cellMaps(disc, linkI, [1, 1]);
    const phi = new Float32Array(g.n);
    let lo = Infinity,
      hi = -Infinity;
    for (let k = 0; k < fluid.length; k++) {
      const v = x[fluid[k]];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    for (let i = 0; i < g.n; i++) phi[i] = disc.type[i] === FLUID ? x[i] : NaN;
    out.fields = {
      grid: g,
      phi,
      jA: maps.jA,
      jC: maps.jC,
      type: disc.type,
      trapMask: analyzeTraps(disc).mask,
      unit: 'abs',
      phiRange: [lo, hi],
    };
  }
  out.ms = now() - t0;
  return out;
}

export interface ConvergenceRow {
  N: number;
  h: number;
  unknowns: number;
  K: number;
  balance: number;
  maxA: number;
  maxC: number;
  p95A: number;
  p95C: number;
  iters: number;
  ms: number;
  gapCells: number;
}

/** ბადის კრებადობის კვლევა: K, დენის ბალანსი, მაქსიმუმი (ბადეზე მგრძნობიარე) და 95-ე პერცენტილი (მდგრადი). */
export function convergenceStudy(cell: Cell, Ns: number[], onRow?: (r: ConvergenceRow) => void): ConvergenceRow[] {
  const rows: ConvergenceRow[] = [];
  for (const N of Ns) {
    const disc = discretize(cell, N);
    const r = solvePrimary(disc);
    const row: ConvergenceRow = {
      N,
      h: r.h,
      unknowns: r.unknowns,
      K: r.K,
      balance: r.balance,
      maxA: r.statsA.max,
      maxC: r.statsC.max,
      p95A: r.statsA.p95,
      p95C: r.statsC.p95,
      iters: r.iters,
      ms: r.ms,
      gapCells: r.gapCells,
    };
    rows.push(row);
    onRow?.(row);
  }
  return rows;
}

/** რიჩარდსონის ექსტრაპოლაცია პირველი რიგის სქემისთვის: K₀ ≈ K₂ + (K₂ − K₁)·h₂/(h₁ − h₂). */
export function richardson(K1: number, h1: number, K2: number, h2: number): number {
  return K2 + ((K2 - K1) * h2) / (h1 - h2);
}
