// ლაბორატორიის კონფიგურაცია, სამართლიანი შედარების ნორმალიზება და ერთიანი მოდელით შეფასება.
import { APP_VERSION } from './constants';
import {
  Built,
  Cell,
  Env,
  GeometrySet,
  KINDS,
  Kind,
  buildCell,
  defaultEnv,
  defaultGeometries,
  scaleGeometry,
} from './geometry/cell';
import { Breakdown, CellModel, ElectricalMode, Kinetics, Operating, Production, production, solveOperating } from './physics';

export type FairConstraint = 'none' | 'volume' | 'area' | 'envelope';

export interface LabConfig {
  version: string;
  units: 'SI';
  active: Kind;
  geometries: GeometrySet;
  env: Env;
  electrolyte: { kappa: number; T: number; p: number; voidFraction: number };
  electrical: {
    mode: ElectricalMode;
    I: number;
    U: number;
    P: number;
    duration: number;
    faradaicH2: number;
    faradaicO2: number;
    extraR: number;
  };
  kinetics: { anode: Kinetics; cathode: Kinetics };
  surface: { roughness: number; thetaA: number; thetaC: number };
  fairness: { constraint: FairConstraint; reference: Kind };
  limits: { jMax: number; uMax: number };
  solver: { enabled: boolean; resolution: number };
}

export function defaultConfig(): LabConfig {
  return {
    version: APP_VERSION,
    units: 'SI',
    active: 'mobius',
    geometries: defaultGeometries(),
    env: defaultEnv(),
    // κ ≈ 62 S/m: 30 wt% (≈6.9 M) KOH, 25 °C (Gilliam et al. 2007-ის კორელაცია)
    electrolyte: { kappa: 62, T: 298.15, p: 101325, voidFraction: 0 },
    electrical: { mode: 'I', I: 5, U: 2.3, P: 12, duration: 3600, faradaicH2: 1, faradaicO2: 1, extraR: 0 },
    // საილუსტრაციო დაშვება: გლუვი ნიკელი ტუტე გარემოში (HER: b ≈ 118 mV/dec; OER: b ≈ 59 mV/dec, 25 °C)
    kinetics: {
      anode: { j0: 1e-3, alphaF: 1.0, alphaR: 1.0 },
      cathode: { j0: 0.1, alphaF: 0.5, alphaR: 0.5 },
    },
    surface: { roughness: 1, thetaA: 0.1, thetaC: 0.1 },
    fairness: { constraint: 'none', reference: 'plates' },
    limits: { jMax: 5000, uMax: 3.0 },
    solver: { enabled: true, resolution: 48 },
  };
}

/** პარამეტრების დასაშვებობის შემოწმება (გეომეტრიის გარდა). ცარიელი სია — ყველაფერი რიგზეა. */
export function validateConfig(c: LabConfig): string[] {
  const e: string[] = [];
  const pos = (v: number, name: string) => {
    if (!(v > 0) || !Number.isFinite(v)) e.push(`${name} დადებითი უნდა იყოს`);
  };
  const frac = (v: number, name: string, max = 1) => {
    if (!(v >= 0 && v <= max)) e.push(`${name} უნდა იყოს 0–${max} შუალედში`);
  };
  pos(c.electrolyte.kappa, 'გამტარობა κ');
  pos(c.electrolyte.T, 'ტემპერატურა');
  if (c.electrolyte.T < 273.15 || c.electrolyte.T > 373.15) e.push('ტემპერატურა უნდა იყოს 0–100 °C (თხევადი წყლის მოდელი)');
  pos(c.electrolyte.p, 'წნევა');
  frac(c.electrolyte.voidFraction, 'აირშემცველობა ε', 0.6);
  if (c.electrical.mode === 'I' && !(c.electrical.I >= 0)) e.push('დენი არ შეიძლება იყოს უარყოფითი');
  if (c.electrical.mode === 'U' && !(c.electrical.U >= 0)) e.push('ძაბვა არ შეიძლება იყოს უარყოფითი');
  if (c.electrical.mode === 'P' && !(c.electrical.P >= 0)) e.push('სიმძლავრე არ შეიძლება იყოს უარყოფითი');
  pos(c.electrical.duration, 'ხანგრძლივობა');
  frac(c.electrical.faradaicH2, 'ფარადეული ეფექტიანობა (H₂)');
  frac(c.electrical.faradaicO2, 'ფარადეული ეფექტიანობა (O₂)');
  if (!(c.electrical.extraR >= 0)) e.push('დამატებითი წინაღობა არ შეიძლება იყოს უარყოფითი');
  for (const [k, name] of [
    [c.kinetics.anode, 'ანოდის'],
    [c.kinetics.cathode, 'კათოდის'],
  ] as const) {
    pos(k.j0, `${name} j₀`);
    pos(k.alphaF, `${name} α`);
    pos(k.alphaR, `${name} α (უკუ)`);
  }
  if (!(c.surface.roughness >= 1)) e.push('უხეშობის კოეფიციენტი ≥ 1 უნდა იყოს');
  frac(c.surface.thetaA, 'დაფარვის წილი θ (ანოდი)', 0.95);
  frac(c.surface.thetaC, 'დაფარვის წილი θ (კათოდი)', 0.95);
  return e;
}

// ---------------------------------------------------------------------------------------------
// გეომეტრიის აგება ქეშით და სამართლიანი ნორმალიზება
// ---------------------------------------------------------------------------------------------
const buildCache = new Map<string, Built>();
export function cachedBuild(kind: Kind, geo: GeometrySet, env: Env): Built {
  const probe = JSON.stringify([kind, kind === 'klein' ? { ...geo.klein, view: 0 } : geo[kind], env]);
  const hit = buildCache.get(probe);
  if (hit) return hit;
  const b = buildCell(kind, geo, env);
  buildCache.set(probe, b);
  if (buildCache.size > 80) buildCache.delete(buildCache.keys().next().value as string);
  return b;
}

export interface Resolved {
  kind: Kind;
  lambda: number;
  geo: GeometrySet;
  built: Built;
  normNote?: string;
}

function fairMetric(cell: Cell, c: FairConstraint): number {
  if (c === 'volume') return cell.volumeA + cell.volumeC;
  if (c === 'area') return cell.areaA + cell.areaC;
  return cell.envelopeVolume;
}

export const FAIR_LABEL: Record<FairConstraint, string> = {
  none: 'შეზღუდვის გარეშე (როგორც მოცემულია)',
  volume: 'ერთნაირი მასალის მოცულობა (მასა)',
  area: 'ერთნაირი დასველებული ფართობი',
  envelope: 'ერთნაირი გაბარიტული მოცულობა',
};

/**
 * თითო გეომეტრიისთვის პოულობს მასშტაბის კოეფიციენტს λ (სიბრტყითი ზომები), რომ არჩეული სიდიდე საბაზისოს გაუტოლდეს.
 * სისქე, დაშორება და ყველა ფიზიკური პარამეტრი უცვლელია. ერთდროულად მხოლოდ ერთი შეზღუდვა კმაყოფილდება.
 */
export function resolveGeometries(cfg: LabConfig): Record<Kind, Resolved> {
  const out = {} as Record<Kind, Resolved>;
  const ref = cfg.fairness.reference;
  const refBuilt = cachedBuild(ref, cfg.geometries, cfg.env);
  const constraint = cfg.fairness.constraint;
  for (const kind of KINDS) {
    if (kind === ref || constraint === 'none' || !refBuilt.cell) {
      out[kind] = {
        kind,
        lambda: 1,
        geo: cfg.geometries,
        built: kind === ref ? refBuilt : cachedBuild(kind, cfg.geometries, cfg.env),
        normNote: constraint !== 'none' && !refBuilt.cell && kind !== ref ? 'საბაზისო გეომეტრია დაუშვებელია — ნორმალიზება არ შესრულდა' : undefined,
      };
      continue;
    }
    const target = fairMetric(refBuilt.cell, constraint);
    const f = (lam: number): number => {
      const b = cachedBuild(kind, scaleGeometry(kind, cfg.geometries, lam), cfg.env);
      return b.cell ? fairMetric(b.cell, constraint) / target - 1 : NaN;
    };
    let lo = 0.3,
      hi = 3.5;
    let flo = f(lo),
      fhi = f(hi);
    // დაუშვებელი საზღვრების შევიწროება
    for (let i = 0; i < 6 && Number.isNaN(flo); i++) {
      lo *= 1.25;
      flo = f(lo);
    }
    for (let i = 0; i < 6 && Number.isNaN(fhi); i++) {
      hi /= 1.25;
      fhi = f(hi);
    }
    let lam = 1;
    let note: string | undefined;
    if (Number.isNaN(flo) || Number.isNaN(fhi) || flo * fhi > 0) {
      note = 'ნორმალიზება ვერ შესრულდა (სამიზნე მიუღწეველია λ ∈ [0.3, 3.5]) — ნაჩვენებია საწყისი ზომები';
    } else {
      // Illinois-ის მეთოდი (regula falsi)
      let side = 0;
      for (let i = 0; i < 40; i++) {
        lam = (lo * fhi - hi * flo) / (fhi - flo);
        const fm = f(lam);
        if (Number.isNaN(fm)) {
          note = 'ნორმალიზების დროს გეომეტრია დაუშვებელი გახდა — ნაჩვენებია საწყისი ზომები';
          lam = 1;
          break;
        }
        if (Math.abs(fm) < 2e-5) break;
        if (fm * fhi > 0) {
          hi = lam;
          fhi = fm;
          if (side === -1) flo /= 2;
          side = -1;
        } else {
          lo = lam;
          flo = fm;
          if (side === 1) fhi /= 2;
          side = 1;
        }
      }
    }
    const geo = lam === 1 ? cfg.geometries : scaleGeometry(kind, cfg.geometries, lam);
    out[kind] = { kind, lambda: lam, geo, built: cachedBuild(kind, geo, cfg.env), normNote: note };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// შეფასება ერთიანი მოდელით
// ---------------------------------------------------------------------------------------------
export function modelFor(cell: Cell, cfg: LabConfig, K: number): CellModel {
  return {
    T: cfg.electrolyte.T,
    p: cfg.electrolyte.p,
    kappa: cfg.electrolyte.kappa,
    voidFraction: cfg.electrolyte.voidFraction,
    areaA: cell.areaA,
    areaC: cell.areaC,
    roughness: cfg.surface.roughness,
    thetaA: cfg.surface.thetaA,
    thetaC: cfg.surface.thetaC,
    kinA: cfg.kinetics.anode,
    kinC: cfg.kinetics.cathode,
    K,
    extraR: cfg.electrical.extraR,
    faradaicH2: cfg.electrical.faradaicH2,
    faradaicO2: cfg.electrical.faradaicO2,
  };
}

export function targetValue(cfg: LabConfig): number {
  const e = cfg.electrical;
  return e.mode === 'I' ? e.I : e.mode === 'U' ? e.U : e.P;
}

export type KSource = 'solver' | 'rough';

export interface Evaluation {
  kind: Kind;
  valid: boolean;
  errors: string[];
  warnings: string[];
  flags: string[];
  lambda: number;
  kSource: KSource;
  K: number;
  model: CellModel | null;
  op: Operating | null;
  b: Breakdown | null;
  prod: Production | null;
  areaA: number;
  areaC: number;
  volume: number; // მასალის მოცულობა (ორივე ელექტროდი), m³
  mass: number; // kg
  envelopeVolume: number;
  tankVolume: number;
  minDistance: number;
  prodPerEnvelope: number; // mol H₂/(s·m³)
}

export function evaluate(res: Resolved, cfg: LabConfig, K: number | null): Evaluation {
  const cell = res.built.cell;
  const cfgErrors = validateConfig(cfg);
  const base = {
    kind: res.kind,
    lambda: res.lambda,
    warnings: [...res.built.warnings, ...(res.normNote ? [res.normNote] : [])],
    flags: [] as string[],
  };
  if (!cell || res.built.errors.length || cfgErrors.length) {
    return {
      ...base,
      valid: false,
      errors: [...res.built.errors, ...cfgErrors],
      kSource: 'rough',
      K: NaN,
      model: null,
      op: null,
      b: null,
      prod: null,
      areaA: cell?.areaA ?? NaN,
      areaC: cell?.areaC ?? NaN,
      volume: cell ? cell.volumeA + cell.volumeC : NaN,
      mass: cell ? cell.massA + cell.massC : NaN,
      envelopeVolume: cell?.envelopeVolume ?? NaN,
      tankVolume: cell?.tankVolume ?? NaN,
      minDistance: cell?.minDistance ?? NaN,
      prodPerEnvelope: NaN,
    };
  }
  const kSource: KSource = K !== null && Number.isFinite(K) ? 'solver' : 'rough';
  const Kuse = kSource === 'solver' ? (K as number) : cell.roughK;
  const model = modelFor(cell, cfg, Kuse);
  const op = solveOperating(cfg.electrical.mode, targetValue(cfg), model);
  const prod = production(op.b, model, cfg.electrical.duration);
  const flags: string[] = [];
  if (op.note) flags.push(op.note);
  if (Math.max(op.b.jA, op.b.jC) > cfg.limits.jMax)
    flags.push(`დენის სიმკვრივე სამუშაო დიაპაზონს აღემატება (> ${cfg.limits.jMax} A/m²)`);
  if (op.b.U > cfg.limits.uMax) flags.push(`ძაბვა სამუშაო დიაპაზონს აღემატება (> ${cfg.limits.uMax} V)`);
  if (kSource === 'rough') flags.push('ომური წინაღობა — უხეში შეფასება d/(κA); 3D ამომხსნელის შედეგი ჯერ არ არის');
  return {
    ...base,
    flags,
    valid: true,
    errors: [],
    kSource,
    K: Kuse,
    model,
    op,
    b: op.b,
    prod,
    areaA: cell.areaA,
    areaC: cell.areaC,
    volume: cell.volumeA + cell.volumeC,
    mass: cell.massA + cell.massC,
    envelopeVolume: cell.envelopeVolume,
    tankVolume: cell.tankVolume,
    minDistance: cell.minDistance,
    prodPerEnvelope: prod.nH2 / cell.envelopeVolume,
  };
}

// ---------------------------------------------------------------------------------------------
// შედარების ცხრილის მეტრიკები
// ---------------------------------------------------------------------------------------------
export interface MetricDef {
  id: string;
  label: string;
  unit: string;
  get: (e: Evaluation) => number;
  digits: number;
  /** რომელი მიმართულებაა „უკეთესი“: მაღალი, დაბალი თუ ნეიტრალური. */
  better: 'high' | 'low' | 'none';
}

export const METRICS: MetricDef[] = [
  { id: 'I', label: 'დენი I', unit: 'A', get: (e) => e.b?.I ?? NaN, digits: 3, better: 'none' },
  { id: 'U', label: 'უჯრედის ძაბვა U', unit: 'V', get: (e) => e.b?.U ?? NaN, digits: 3, better: 'low' },
  { id: 'P', label: 'სიმძლავრე P', unit: 'W', get: (e) => e.b?.P ?? NaN, digits: 2, better: 'none' },
  { id: 'nH2', label: 'H₂ მოლური ნაკადი', unit: 'mmol/h', get: (e) => (e.prod?.nH2 ?? NaN) * 3.6e6, digits: 2, better: 'high' },
  { id: 'vH2', label: 'H₂ მოცულობითი ნაკადი (სამუშაო T, p)', unit: 'L/h', get: (e) => (e.prod?.vH2op ?? NaN) * 3.6e6, digits: 3, better: 'high' },
  { id: 'vH2n', label: 'H₂ ნაკადი (ნორმალური პირობები)', unit: 'Nl/h', get: (e) => (e.prod?.vH2n ?? NaN) * 3.6e6, digits: 3, better: 'high' },
  { id: 'kwh', label: 'ენერგიის ხარჯი', unit: 'kWh/kg H₂', get: (e) => e.prod?.kwhPerKg ?? NaN, digits: 2, better: 'low' },
  { id: 'wh', label: 'ენერგიის ხარჯი', unit: 'Wh/mol H₂', get: (e) => e.prod?.whPerMol ?? NaN, digits: 2, better: 'low' },
  { id: 'lwh', label: 'H₂ ერთ Wh-ზე (სამუშაო T, p)', unit: 'L/Wh', get: (e) => e.prod?.litersPerWhOp ?? NaN, digits: 4, better: 'high' },
  { id: 'eff', label: 'ეფექტიანობა (HHV)', unit: '%', get: (e) => (e.prod?.effHHV ?? NaN) * 100, digits: 1, better: 'high' },
  { id: 'etaA', label: 'ანოდის გადაძაბვა η_a', unit: 'mV', get: (e) => (e.b?.etaA ?? NaN) * 1000, digits: 1, better: 'low' },
  { id: 'etaC', label: 'კათოდის გადაძაბვა |η_c|', unit: 'mV', get: (e) => (e.b?.etaC ?? NaN) * 1000, digits: 1, better: 'low' },
  { id: 'ohm', label: 'ომური ვარდნა I·R', unit: 'mV', get: (e) => (e.b?.ohmic ?? NaN) * 1000, digits: 1, better: 'low' },
  { id: 'K', label: 'უჯრედის მუდმივა K', unit: '1/m', get: (e) => e.K, digits: 3, better: 'low' },
  { id: 'jC', label: 'კათოდის საშუალო j', unit: 'A/m²', get: (e) => e.b?.jC ?? NaN, digits: 0, better: 'none' },
  { id: 'jA', label: 'ანოდის საშუალო j', unit: 'A/m²', get: (e) => e.b?.jA ?? NaN, digits: 0, better: 'none' },
  { id: 'areaC', label: 'კათოდის დასველებული ფართობი', unit: 'სმ²', get: (e) => e.areaC * 1e4, digits: 2, better: 'none' },
  { id: 'areaA', label: 'ანოდის დასველებული ფართობი', unit: 'სმ²', get: (e) => e.areaA * 1e4, digits: 2, better: 'none' },
  { id: 'mass', label: 'ელექტროდების მასა', unit: 'გ', get: (e) => e.mass * 1000, digits: 2, better: 'low' },
  { id: 'vol', label: 'მასალის მოცულობა', unit: 'სმ³', get: (e) => e.volume * 1e6, digits: 3, better: 'low' },
  { id: 'env', label: 'გაბარიტული მოცულობა', unit: 'სმ³', get: (e) => e.envelopeVolume * 1e6, digits: 1, better: 'low' },
  { id: 'ppv', label: 'წარმოება გაბარიტის ერთეულზე', unit: 'mol H₂/(h·L)', get: (e) => e.prodPerEnvelope * 3.6, digits: 4, better: 'high' },
  { id: 'dmin', label: 'მინიმალური დაშორება', unit: 'მმ', get: (e) => e.minDistance * 1000, digits: 2, better: 'none' },
];

export function pctDelta(v: number, base: number): number {
  if (!Number.isFinite(v) || !Number.isFinite(base) || base === 0) return NaN;
  return ((v - base) / Math.abs(base)) * 100;
}

// ---------------------------------------------------------------------------------------------
// ექსპორტი
// ---------------------------------------------------------------------------------------------
export function toCsv(header: string[], rows: (string | number)[][]): string {
  const esc = (v: string | number) => {
    const s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : v;
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
}

export function comparisonCsv(evals: Evaluation[], baseline: Kind): string {
  const base = evals.find((e) => e.kind === baseline);
  const header = ['metric', 'unit', ...evals.flatMap((e) => [e.kind, `${e.kind}_delta_pct_vs_${baseline}`])];
  const rows = METRICS.map((m) => [
    m.label,
    m.unit,
    ...evals.flatMap((e) => [m.get(e), base ? pctDelta(m.get(e), m.get(base)) : NaN]),
  ]);
  return toCsv(header, rows);
}
