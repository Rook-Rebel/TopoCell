// ელექტროლიზური უჯრედის აწყობა: კათოდი + ანოდი + ავზი (ელექტროლიტის არე), დაშორებისა და ბადის შემოწმებით.
import { BBox, ManifoldReport, SurfaceTopology, bboxVolume, checkManifold, meshBBox, surfaceTopology, unionBBox } from './mesh';
import {
  BandGeom,
  Solid,
  arcSolid,
  bandEdgeStretch,
  bandMidArea,
  bandMidSurface,
  bandRadialReach,
  bandSolid,
  boxSolid,
  fitTranslation,
  minDistance,
  placeSolid,
  unionSolids,
} from './solids';
import { kleinConstraintErrors, kleinDims, kleinPhysical } from './klein';

export type Kind = 'plates' | 'rings' | 'mobius' | 'klein';
export const KINDS: Kind[] = ['plates', 'rings', 'mobius', 'klein'];

export const KIND_LABEL: Record<Kind, string> = {
  plates: 'A · ბრტყელი ფირფიტები',
  rings: 'B · რგოლოვანი ლენტები',
  mobius: 'C · მიობიუსის ლენტები',
  klein: 'D · კლაინის ტიპის გარსი',
};
export const KIND_SHORT: Record<Kind, string> = {
  plates: 'A ფირფიტები',
  rings: 'B რგოლები',
  mobius: 'C მიობიუსი',
  klein: 'D კლაინი',
};

/** ანოდის დამატებითი გადაადგილება/მობრუნება (მობრუნება სრულდება დაშორების მორგებამდე, გადაადგილება — შემდეგ). */
export interface Placement {
  dx: number;
  dy: number;
  dz: number;
  rx: number;
  ry: number;
  rz: number;
}
export const ZERO_PLACEMENT: Placement = { dx: 0, dy: 0, dz: 0, rx: 0, ry: 0, rz: 0 };

export interface PlatesParams {
  width: number;
  height: number;
  thickness: number;
  gap: number;
  arrangement: 'pair' | 'sandwich';
  placement: Placement;
}

export type BandArrangement = 'stacked' | 'side' | 'nested' | 'conformal';
export interface BandParams {
  radius: number;
  width: number;
  thickness: number;
  halfTwists: number;
  phaseDeg: number;
  gap: number;
  arrangement: BandArrangement;
  placement: Placement;
}

export interface KleinParams {
  bodyRadius: number;
  neckRatio: number;
  thickness: number;
  clearance: number;
  gap: number; // ანოდსა და კორპუსს შორის
  anodeSpanDeg: number;
  anodeHeightFrac: number;
  view: 'physical' | 'math';
  placement: Placement;
}

export interface GeometrySet {
  plates: PlatesParams;
  rings: BandParams;
  mobius: BandParams;
  klein: KleinParams;
}

export interface Env {
  tankMargin: number; // ელექტროლიტის ფენა ელექტროდების გაბარიტის გარშემო, m
  minGap: number; // მინიმალური დასაშვები დაშორება ანოდსა და კათოდს შორის, m
  density: number; // ელექტროდის მასალის სიმკვრივე, kg/m³
}

export function defaultGeometries(): GeometrySet {
  return {
    plates: { width: 0.05, height: 0.05, thickness: 0.001, gap: 0.01, arrangement: 'pair', placement: { ...ZERO_PLACEMENT } },
    rings: {
      radius: 0.025,
      width: 0.02,
      thickness: 0.001,
      halfTwists: 0,
      phaseDeg: 0,
      gap: 0.01,
      arrangement: 'stacked',
      placement: { ...ZERO_PLACEMENT },
    },
    mobius: {
      radius: 0.025,
      width: 0.02,
      thickness: 0.001,
      halfTwists: 1,
      phaseDeg: 0,
      gap: 0.01,
      arrangement: 'stacked',
      placement: { ...ZERO_PLACEMENT },
    },
    klein: {
      bodyRadius: 0.018,
      neckRatio: 0.3,
      thickness: 0.001,
      clearance: 0.003,
      gap: 0.01,
      anodeSpanDeg: 240,
      anodeHeightFrac: 0.8,
      view: 'physical',
      placement: { ...ZERO_PLACEMENT },
    },
  };
}

export function defaultEnv(): Env {
  return { tankMargin: 0.015, minGap: 0.002, density: 8908 }; // ნიკელი: 8908 kg/m³
}

/** იზოლირებული დენის მიმყვანი: მიმაგრების წერტილი → (საჭიროებისას) ჰორიზონტალური გადახრა გარეთ → ვერტიკალურად ზემოთ. */
export interface Lead {
  points: [number, number, number][];
  clear: boolean;
}

export interface Cell {
  kind: Kind;
  anode: Solid;
  cathode: Solid;
  minDistance: number;
  envelope: BBox;
  envelopeVolume: number;
  tank: BBox;
  tankVolume: number;
  areaA: number;
  areaC: number;
  volumeA: number;
  volumeC: number;
  massA: number;
  massC: number;
  /** უხეში ანალიზური შეფასება K ≈ d/A (მხოლოდ საორიენტაციოდ; რთული ფორმისთვის ზუსტი არ არის). */
  roughK: number;
  leads: { anode: Lead; cathode: Lead };
  reportA: ManifoldReport;
  reportC: ManifoldReport;
  midTopology?: SurfaceTopology; // კათოდის შუა ზედაპირის ტოპოლოგია
  info: { label: string; value: string }[];
  minThickness: number;
}

export interface Built {
  kind: Kind;
  cell: Cell | null;
  errors: string[];
  warnings: string[];
  key: string;
}

const mm = (v: number) => (v * 1000).toFixed(2);

function leadFor(self: Solid, other: Solid, zTop: number, minGap: number, margin: number, avoid?: { xy: [number, number]; sep: number }): Lead {
  const p = self.samples;
  let zMax = -Infinity;
  for (let i = 2; i < p.length; i += 3) if (p[i] > zMax) zMax = p[i];
  // კანდიდატები: ყველაზე მაღალი წერტილები, სხვადასხვა (x, y)-ზე
  const cands: [number, number, number][] = [];
  const tol = 1e-4 + 0.02 * Math.abs(zMax);
  const stride = Math.max(1, Math.floor(p.length / 3 / 400));
  for (let i = 0; i < p.length; i += 3 * stride) {
    if (p[i + 2] >= zMax - tol) cands.push([p[i], p[i + 1], p[i + 2]]);
  }
  if (cands.length === 0) cands.push([p[0], p[1], p[2]]);
  // კიდურა წერტილებიც
  let ext = [0, 0, 0, 0];
  for (let i = 0; i < p.length; i += 3) {
    if (p[i] < p[ext[0]]) ext[0] = i;
    if (p[i] > p[ext[1]]) ext[1] = i;
    if (p[i + 1] < p[ext[2] + 1]) ext[2] = i;
    if (p[i + 1] > p[ext[3] + 1]) ext[3] = i;
  }
  for (const e of ext) cands.push([p[e], p[e + 1], p[e + 2]]);
  // მეორე მიმყვანი პირველისგან მოშორებით მაგრდება (რომ კლემები ერთმანეთს არ დაემთხვეს)
  if (avoid) {
    const far = cands.filter((c) => Math.hypot(c[0] - avoid.xy[0], c[1] - avoid.xy[1]) >= avoid.sep);
    const near = cands.filter((c) => Math.hypot(c[0] - avoid.xy[0], c[1] - avoid.xy[1]) < avoid.sep);
    cands.length = 0;
    cands.push(...far.slice(-8).reverse(), ...far.slice(0, 8), ...near);
  }
  const o = other.samples;
  const oStep = 3 * Math.max(1, Math.floor(o.length / 3 / 2500));
  let ox = 0,
    oy = 0,
    on = 0;
  for (let i = 0; i < o.length; i += oStep) {
    ox += o[i];
    oy += o[i + 1];
    on++;
  }
  ox /= on;
  oy /= on;
  // მარშრუტის მინიმალური მანძილი მეორე ელექტროდამდე: ჰორიზონტალური მონაკვეთი c→q და ვერტიკალური q→ზემოთ
  const clearance = (c: [number, number, number], q: [number, number]) => {
    let d = Infinity;
    const hx = q[0] - c[0],
      hy = q[1] - c[1];
    const hl2 = hx * hx + hy * hy;
    for (let i = 0; i < o.length; i += oStep) {
      const px = o[i],
        py = o[i + 1],
        pz = o[i + 2];
      if (pz >= c[2]) {
        const h = Math.hypot(px - q[0], py - q[1]);
        if (h < d) d = h;
      }
      if (hl2 > 0) {
        const t = Math.max(0, Math.min(1, ((px - c[0]) * hx + (py - c[1]) * hy) / hl2));
        const h = Math.hypot(px - c[0] - t * hx, py - c[1] - t * hy, pz - c[2]);
        if (h < d) d = h;
      }
    }
    return d;
  };
  let best: { c: [number, number, number]; q: [number, number]; d: number } | null = null;
  outer: for (const frac of [0, 0.3, 0.6, 0.85]) {
    for (const c of cands.slice(0, 12)) {
      let dx = c[0] - ox,
        dy = c[1] - oy;
      const dl = Math.hypot(dx, dy);
      if (dl < 1e-9) {
        dx = 1;
        dy = 0;
      } else {
        dx /= dl;
        dy /= dl;
      }
      const q: [number, number] = [c[0] + dx * frac * margin, c[1] + dy * frac * margin];
      const d = clearance(c, q);
      if (!best || d > best.d) best = { c, q, d };
      if (d >= minGap * 1.25) break outer;
    }
  }
  const b = best!;
  const pts: [number, number, number][] = [b.c];
  if (b.q[0] !== b.c[0] || b.q[1] !== b.c[1]) pts.push([b.q[0], b.q[1], b.c[2]]);
  pts.push([b.q[0], b.q[1], zTop + 0.012]);
  return { points: pts, clear: b.d >= minGap };
}

function finalize(
  kind: Kind,
  cathode: Solid,
  anode: Solid,
  env: Env,
  roughK: number,
  errors: string[],
  warnings: string[],
  info: { label: string; value: string }[],
  key: string,
  extra: { midTopology?: SurfaceTopology; reportC?: ManifoldReport } = {},
): Built {
  const dmin = minDistance(cathode, anode);
  if (dmin <= 0) errors.push('ანოდი და კათოდი ერთმანეთს კვეთს ან ეხება — კონფიგურაცია დაუშვებელია');
  else if (dmin < env.minGap * (1 - 1e-6) - 1e-9)
    errors.push(`მინიმალური დაშორება ${mm(dmin)} მმ ნაკლებია დასაშვებზე (${mm(env.minGap)} მმ)`);
  const envelope = unionBBox(meshBBox(cathode.mesh), meshBBox(anode.mesh));
  const m = env.tankMargin;
  const tank: BBox = {
    min: [envelope.min[0] - m, envelope.min[1] - m, envelope.min[2] - m],
    max: [envelope.max[0] + m, envelope.max[1] + m, envelope.max[2] + m],
  };
  const reportC = extra.reportC ?? checkManifold(cathode.mesh);
  const reportA = checkManifold(anode.mesh);
  for (const [name, r] of [
    ['კათოდის', reportC],
    ['ანოდის', reportA],
  ] as const) {
    if (!r.closed || !r.oriented)
      errors.push(`${name} ბადე არ არის ჩაკეტილი ორიენტირებული მრავალსახეობა (საზღვრის წიბოები: ${r.boundaryEdges})`);
  }
  const leadC = leadFor(cathode, anode, tank.max[2], env.minGap, env.tankMargin);
  const endC = leadC.points[leadC.points.length - 1];
  const sep = 0.3 * Math.max(envelope.max[0] - envelope.min[0], envelope.max[1] - envelope.min[1]);
  const leads = {
    cathode: leadC,
    anode: leadFor(anode, cathode, tank.max[2], env.minGap, env.tankMargin, { xy: [endC[0], endC[1]], sep }),
  };
  if (!leads.cathode.clear) warnings.push('კათოდის დენის მიმყვანი ანოდთან ძალიან ახლოს გადის — საჭიროა იზოლაცია ან სხვა მარშრუტი');
  if (!leads.anode.clear) warnings.push('ანოდის დენის მიმყვანი კათოდთან ძალიან ახლოს გადის — საჭიროა იზოლაცია ან სხვა მარშრუტი');
  const cell: Cell = {
    kind,
    anode,
    cathode,
    minDistance: dmin,
    envelope,
    envelopeVolume: bboxVolume(envelope),
    tank,
    tankVolume: bboxVolume(tank),
    areaA: anode.area,
    areaC: cathode.area,
    volumeA: anode.volume,
    volumeC: cathode.volume,
    massA: anode.volume * env.density,
    massC: cathode.volume * env.density,
    roughK,
    leads,
    reportA,
    reportC,
    midTopology: extra.midTopology,
    info,
    minThickness: Math.min(anode.thickness, cathode.thickness),
  };
  return { kind, cell, errors, warnings, key };
}

function positive(errors: string[], name: string, v: number) {
  if (!(v > 0) || !Number.isFinite(v)) errors.push(`${name}: მნიშვნელობა დადებითი უნდა იყოს`);
}

function buildPlates(p: PlatesParams, env: Env, key: string): Built {
  const errors: string[] = [];
  const warnings: string[] = [];
  positive(errors, 'სიგანე', p.width);
  positive(errors, 'სიმაღლე', p.height);
  positive(errors, 'სისქე', p.thickness);
  positive(errors, 'დაშორება', p.gap);
  if (errors.length) return { kind: 'plates', cell: null, errors, warnings, key };
  const size: [number, number, number] = [p.thickness, p.width, p.height];
  const pl = p.placement;
  const rot: [number, number, number] = [pl.rx, pl.ry, pl.rz];
  let cathode: Solid, anode: Solid;
  let roughK: number;
  if (p.arrangement === 'sandwich') {
    cathode = boxSolid([0, 0, 0], size);
    const off = p.gap + p.thickness;
    const a = unionSolids([boxSolid([off, 0, 0], size), boxSolid([-off, 0, 0], size)]);
    anode = placeSolid(a, { pos: [pl.dx, pl.dy, pl.dz], rotDeg: rot });
    roughK = p.gap / (2 * p.width * p.height);
  } else {
    const c0 = boxSolid([0, 0, 0], size);
    const a0 = placeSolid(boxSolid([0, 0, 0], size), { pos: [0, 0, 0], rotDeg: rot });
    const hi = p.thickness + p.gap + Math.hypot(p.width, p.height, p.thickness);
    const D = fitTranslation(c0, a0, [1, 0, 0], p.gap, hi);
    if (D === null) {
      errors.push('ფირფიტების განლაგება მოცემული დაშორებით ვერ მოერგო');
      return { kind: 'plates', cell: null, errors, warnings, key };
    }
    cathode = boxSolid([-D / 2, 0, 0], size);
    anode = placeSolid(a0, { pos: [D / 2 + pl.dx, pl.dy, pl.dz], rotDeg: [0, 0, 0] });
    roughK = p.gap / (p.width * p.height);
  }
  const info = [
    { label: 'ერთი ფირფიტის ანალიზური ფართობი 2(WH+Wt+Ht)', value: `${((2 * (p.width * p.height + p.width * p.thickness + p.height * p.thickness)) * 1e4).toFixed(2)} სმ²` },
    { label: 'სხეულის ტოპოლოგია', value: 'სფეროს ტოლფასი (გვარი 0), ორმხრივი' },
  ];
  return finalize('plates', cathode, anode, env, roughK, errors, warnings, info, key);
}

function buildBands(kind: 'rings' | 'mobius', p: BandParams, env: Env, key: string): Built {
  const errors: string[] = [];
  const warnings: string[] = [];
  positive(errors, 'რადიუსი', p.radius);
  positive(errors, 'სიგანე', p.width);
  positive(errors, 'სისქე', p.thickness);
  positive(errors, 'დაშორება', p.gap);
  if (!Number.isInteger(p.halfTwists) || p.halfTwists < 0 || p.halfTwists > 5) errors.push('ნახევარბრუნების რაოდენობა უნდა იყოს მთელი რიცხვი 0–5');
  if (errors.length) return { kind, cell: null, errors, warnings, key };
  const g: BandGeom = { R: p.radius, w: p.width, t: p.thickness, n: p.halfTwists, th0: (p.phaseDeg * Math.PI) / 180 };
  const safety = 5e-4;
  if (p.radius - bandRadialReach(g) <= safety) {
    errors.push(
      `ლენტი საკუთარ ღერძს აღწევს (თვითგადაკვეთა): რადიუსი უნდა აღემატებოდეს ${mm(bandRadialReach(g) + safety)} მმ-ს`,
    );
    return { kind, cell: null, errors, warnings, key };
  }
  const cathode = bandSolid(g);
  const pl = p.placement;
  const rot: [number, number, number] = [pl.rx, pl.ry, pl.rz];
  const user: [number, number, number] = [pl.dx, pl.dy, pl.dz];
  let anode: Solid;
  const faceArea = 2 * Math.PI * p.radius * p.width;
  let roughK = p.gap / faceArea;
  if (p.arrangement === 'conformal') {
    // გადაგრეხისას ნამდვილი ნორმალური მანძილი მერიდიანულზე cosγ-ჯერ ნაკლებია (tanγ = (n/2)·v/r);
    // წანაცვლება იზრდება ისე, რომ მინიმალური დაშორება მოცემულ მნიშვნელობას გაუტოლდეს.
    const tg = ((p.halfTwists / 2) * (p.width / 2)) / Math.max(p.radius - p.width / 2, 1e-6);
    const gA: BandGeom = { ...g, off: p.thickness + p.gap * Math.sqrt(1 + tg * tg) };
    if (p.radius - bandRadialReach(gA) <= safety) {
      errors.push('კონფორმული კონტრელექტროდი ღერძს აღწევს — გაზარდეთ რადიუსი ან შეამცირეთ დაშორება/სიგანე');
      return { kind, cell: null, errors, warnings, key };
    }
    anode = placeSolid(bandSolid(gA), { pos: user, rotDeg: rot });
    roughK = p.gap / (2 * faceArea);
  } else if (p.arrangement === 'nested') {
    const dMax = p.radius - bandRadialReach(g) - safety;
    const lowres = (delta: number) =>
      placeSolid(bandSolid({ ...g, R: p.radius - delta, nu: 96 }), { pos: [0, 0, 0], rotDeg: rot });
    const cLow = bandSolid({ ...g, nu: 96 });
    const f = (delta: number) => minDistance(cLow, lowres(delta)) - p.gap;
    const steps = 24;
    let lo = 0,
      hi = -1;
    for (let i = 1; i <= steps; i++) {
      const dl = (dMax * i) / steps;
      if (f(dl) >= 0) {
        hi = dl;
        lo = (dMax * (i - 1)) / steps;
        break;
      }
    }
    if (hi < 0) {
      errors.push('ჩადგმული განლაგება ამ ზომებით გეომეტრიულად დაუშვებელია (შიდა ლენტი ვერ ეტევა მოცემული დაშორებით)');
      return { kind, cell: null, errors, warnings, key };
    }
    for (let i = 0; i < 30; i++) {
      const mid = 0.5 * (lo + hi);
      if (f(mid) < 0) lo = mid;
      else hi = mid;
    }
    anode = placeSolid(bandSolid({ ...g, R: p.radius - hi }), { pos: user, rotDeg: rot });
  } else {
    const a0 = placeSolid(bandSolid(g), { pos: [0, 0, 0], rotDeg: rot });
    const dir: [number, number, number] = p.arrangement === 'stacked' ? [0, 0, 1] : [1, 0, 0];
    const hi = 2 * (p.radius + p.width + p.thickness) + p.gap + 0.01;
    const D = fitTranslation(cathode, a0, dir, p.gap, hi);
    if (D === null) {
      errors.push('განლაგება მოცემული დაშორებით ვერ მოერგო');
      return { kind, cell: null, errors, warnings, key };
    }
    anode = placeSolid(a0, { pos: [dir[0] * D + user[0], dir[1] * D + user[1], dir[2] * D + user[2]], rotDeg: [0, 0, 0] });
  }
  const mid = bandMidSurface(g);
  const topo = surfaceTopology(mid);
  const midA = bandMidArea(g);
  const flat = 2 * Math.PI * p.radius * p.width;
  const info = [
    { label: 'შუა ზედაპირი', value: topo.orientable ? 'ორიენტირებადი (ორმხრივი)' : 'არაორიენტირებადი (ცალმხრივი)' },
    { label: 'შუა ზედაპირის საზღვრის კომპონენტები', value: String(topo.boundaryComponents) },
    { label: 'შუა ზედაპირის ფართობი / ბრტყელი ზოლი 2πRw', value: `${(midA * 1e4).toFixed(3)} / ${(flat * 1e4).toFixed(3)} სმ² (${((midA / flat - 1) * 100).toFixed(2)} %)` },
    { label: 'კიდის წაგრძელება ცენტრალურ წრეწირთან', value: `${(bandEdgeStretch(g) * 100).toFixed(2)} %` },
    { label: 'სხეულის მოცულობა / პაპუსის 2πRwt', value: `${(cathode.volume * 1e6).toFixed(4)} / ${(2 * Math.PI * p.radius * p.width * p.thickness * 1e6).toFixed(4)} სმ³` },
  ];
  if (p.halfTwists % 2 !== 0)
    info.push({
      label: 'შენიშვნა',
      value: 'ცალმხრივობა ფართობს არ აორმაგებს: დასველებული ფართობი ≈ იმავე ზომის რგოლისას',
    });
  return finalize(kind, cathode, anode, env, roughK, errors, warnings, info, key, { midTopology: topo });
}

function buildKlein(p: KleinParams, env: Env, key: string): Built {
  const errors: string[] = [];
  const warnings: string[] = [];
  positive(errors, 'კორპუსის რადიუსი', p.bodyRadius);
  positive(errors, 'სისქე', p.thickness);
  positive(errors, 'დაშორება', p.gap);
  if (!(p.anodeSpanDeg >= 30 && p.anodeSpanDeg <= 300)) errors.push('ანოდის კუთხური გაშლა უნდა იყოს 30°–300°');
  if (!(p.neckRatio >= 0.2 && p.neckRatio <= 0.34)) errors.push('ყელის ფარდობა უნდა იყოს 0.20–0.34');
  const g = { Rb: p.bodyRadius, neckRatio: p.neckRatio, t: p.thickness, clearance: p.clearance };
  if (!errors.length) errors.push(...kleinConstraintErrors(g));
  if (errors.length) return { kind: 'klein', cell: null, errors, warnings, key };
  const kp = kleinPhysical(g);
  const d = kleinDims(g);
  if (kp.selfClearance <= 0) errors.push('კლაინის გარსი საკუთარ თავს ეხება — გაზარდეთ ღრეჩო ან შეამცირეთ სისქე');
  const pl = p.placement;
  const hA = p.anodeHeightFrac * d.Hc;
  const a0 = arcSolid({
    Rm: d.Rb + p.thickness / 2 + p.gap + p.thickness / 2,
    h: hA,
    t: p.thickness,
    span: (p.anodeSpanDeg * Math.PI) / 180,
    center: Math.PI,
    zc: d.Hc / 2,
  });
  const anode = placeSolid(a0, { pos: [pl.dx, pl.dy, pl.dz], rotDeg: [pl.rx, pl.ry, pl.rz], pivot: [0, 0, d.Hc / 2] });
  const roughK = p.gap / (((p.anodeSpanDeg * Math.PI) / 180) * d.Rb * hA);
  const t = kp.midTopology;
  const info = [
    {
      label: 'შუა ზედაპირი (ფანჯრით)',
      value: `χ = ${t.euler}, ${t.orientable ? 'ორიენტირებადი' : 'არაორიენტირებადი'}, საზღვრის კომპონენტები: ${t.boundaryComponents}`,
    },
    { label: 'ტოპოლოგია', value: 'კლაინის ბოთლი მინუს დისკო — ნამდვილი (ჩაკეტილი) კლაინის ბოთლი აღარ არის' },
    { label: 'გასქელებული სხეულის საზღვარი', value: `χ = ${kp.solidReport.euler}, გვარი ${kp.solidReport.genus ?? '—'}` },
    { label: 'ფანჯრის ღრეჩო ყელის გარშემო', value: `${mm(p.clearance)} მმ` },
    { label: 'თვითდაშორება (კონსერვატიული)', value: `${mm(kp.selfClearance)} მმ` },
    { label: 'შუა ზედაპირის ფართობი', value: `${(kp.midArea * 1e4).toFixed(2)} სმ²` },
  ];
  warnings.push('კლაინის ტიპის გარსს აქვს ნახევრად ჩაკეტილი ღრუები: დენის განაწილება და გაზის გასვლის გზები შეამოწმეთ ჩანართში „სივრცული ანალიზი“ (ერთიანი მოდელი მათ ვერ ხედავს)');
  return finalize('klein', kp.solid, anode, env, roughK, errors, warnings, info, key, {
    midTopology: kp.midTopology,
    reportC: kp.solidReport,
  });
}

export function buildCell(kind: Kind, geo: GeometrySet, env: Env): Built {
  const params = geo[kind];
  const key = JSON.stringify([kind, kind === 'klein' ? { ...(params as KleinParams), view: 0 } : params, env.tankMargin, env.minGap, env.density]);
  const errors: string[] = [];
  if (!(env.tankMargin >= 0.002)) errors.push('ავზის მარაგი უნდა იყოს მინიმუმ 2 მმ');
  if (!(env.minGap > 0)) errors.push('მინიმალური დაშორება დადებითი უნდა იყოს');
  if (!(env.density > 0)) errors.push('სიმკვრივე დადებითი უნდა იყოს');
  if (errors.length) return { kind, cell: null, errors, warnings: [], key };
  try {
    if (kind === 'plates') return buildPlates(geo.plates, env, key);
    if (kind === 'rings') return buildBands('rings', geo.rings, env, key);
    if (kind === 'mobius') return buildBands('mobius', geo.mobius, env, key);
    return buildKlein(geo.klein, env, key);
  } catch (e) {
    return { kind, cell: null, errors: [`გეომეტრიის აგების შეცდომა: ${(e as Error).message}`], warnings: [], key };
  }
}

/** ზომების მასშტაბირება სამართლიანი შედარებისთვის: იცვლება სიბრტყითი ზომები; სისქე და დაშორება უცვლელია. */
export function scaleGeometry(kind: Kind, geo: GeometrySet, lambda: number): GeometrySet {
  const out: GeometrySet = JSON.parse(JSON.stringify(geo));
  if (kind === 'plates') {
    out.plates.width *= lambda;
    out.plates.height *= lambda;
  } else if (kind === 'rings' || kind === 'mobius') {
    out[kind].radius *= lambda;
    out[kind].width *= lambda;
  } else {
    out.klein.bodyRadius *= lambda;
  }
  return out;
}
