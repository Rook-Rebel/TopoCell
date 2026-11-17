// პარამეტრული სკანირება და ოპტიმიზაცია (დეტერმინისტული ბადე — შედეგი სრულად განმეორებადია).
import { Kind, BandArrangement } from './geometry/cell';
import { Built } from './geometry/cell';
import { LabConfig, Resolved, evaluate, resolveGeometries } from './lab';
import { PrimaryResult, discretize, solvePrimary } from './solver/solver';

export type ScanParam = 'size' | 'width' | 'gap' | 'rz' | 'rx' | 'theta' | 'arrangement' | 'span';

export const SCAN_PARAM_LABEL: Record<ScanParam, string> = {
  size: 'ზომა / რადიუსი',
  width: 'სიგანე',
  gap: 'დაშორება',
  rz: 'ანოდის მობრუნება z ღერძის გარშემო',
  rx: 'ანოდის მობრუნება x ღერძის გარშემო',
  theta: 'ბუშტუკებით დაფარვის წილი θ',
  arrangement: 'განლაგება',
  span: 'ანოდის კუთხური გაშლა',
};

export const SCAN_PARAM_UNIT: Record<ScanParam, { unit: string; scale: number }> = {
  size: { unit: 'მმ', scale: 1000 },
  width: { unit: 'მმ', scale: 1000 },
  gap: { unit: 'მმ', scale: 1000 },
  rz: { unit: '°', scale: 1 },
  rx: { unit: '°', scale: 1 },
  theta: { unit: '', scale: 1 },
  arrangement: { unit: '', scale: 1 },
  span: { unit: '°', scale: 1 },
};

export const BAND_ARRANGEMENTS: BandArrangement[] = ['stacked', 'side', 'nested', 'conformal'];
export const ARRANGEMENT_LABEL: Record<string, string> = {
  pair: 'წყვილი (პირისპირ)',
  sandwich: 'სენდვიჩი (კათოდი ორ ანოდს შორის)',
  stacked: 'ღერძის გასწვრივ (ერთმანეთის თავზე)',
  side: 'გვერდიგვერდ',
  nested: 'ჩადგმული (კონცენტრული)',
  conformal: 'კონფორმული (ორმხრივი გადაფარვა)',
};

export function scanParamsFor(kind: Kind): ScanParam[] {
  if (kind === 'plates') return ['size', 'width', 'gap', 'rz', 'theta', 'arrangement'];
  if (kind === 'klein') return ['size', 'gap', 'span', 'theta'];
  return ['size', 'width', 'gap', 'rz', 'rx', 'theta', 'arrangement'];
}

export function arrangementOptions(kind: Kind): string[] {
  if (kind === 'plates') return ['pair', 'sandwich'];
  if (kind === 'klein') return [];
  return BAND_ARRANGEMENTS;
}

export interface ScanAxis {
  param: ScanParam;
  min: number;
  max: number;
  steps: number;
}

export type Objective = 'h2AtPower' | 'kwhPerKg' | 'prodPerVolume';
export const OBJECTIVE_LABEL: Record<Objective, string> = {
  h2AtPower: 'მეტი H₂ იმავე სიმძლავრეზე',
  kwhPerKg: 'ნაკლები kWh/kg H₂',
  prodPerVolume: 'მეტი წარმოება გაბარიტის ერთეულ მოცულობაზე',
};
export const OBJECTIVE_UNIT: Record<Objective, { unit: string; scale: number; maximize: boolean }> = {
  h2AtPower: { unit: 'mmol H₂/h', scale: 3.6e6, maximize: true },
  kwhPerKg: { unit: 'kWh/kg', scale: 1, maximize: false },
  prodPerVolume: { unit: 'mol H₂/(h·L)', scale: 3.6, maximize: true },
};

export interface ScanSpec {
  kind: Kind;
  axes: ScanAxis[];
  objective: Objective;
  maxVolume: number | null; // მასალის მაქს. მოცულობა, m³
  maxEnvelope: number | null; // მაქს. გაბარიტული მოცულობა, m³
  resolution: number;
  refineTop: number;
  refineResolution: number;
}

export interface ScanRow {
  values: number[];
  feasible: boolean;
  reasons: string[];
  K: number;
  objective: number;
  U: number;
  I: number;
  P: number;
  nH2: number;
  kwhPerKg: number;
  areaC: number;
  volume: number;
  envelopeVolume: number;
  minDistance: number;
  balance: number;
  lambda: number;
  /** დაზუსტება წვრილ ბადეზე (მხოლოდ საუკეთესო ვარიანტებისთვის). */
  Kfine?: number;
  objectiveFine?: number;
  uncertainty?: number;
}

export function axisValues(a: ScanAxis): number[] {
  if (a.param === 'arrangement') {
    const out: number[] = [];
    for (let i = Math.round(a.min); i <= Math.round(a.max); i++) out.push(i);
    return out;
  }
  const n = Math.max(1, Math.round(a.steps));
  if (n === 1) return [a.min];
  return Array.from({ length: n }, (_, i) => a.min + ((a.max - a.min) * i) / (n - 1));
}

export function scanPoints(spec: ScanSpec): number[][] {
  let pts: number[][] = [[]];
  for (const a of spec.axes) {
    const vals = axisValues(a);
    pts = pts.flatMap((p) => vals.map((v) => [...p, v]));
  }
  return pts;
}

export function applyScanValue(cfg: LabConfig, kind: Kind, param: ScanParam, value: number): LabConfig {
  const c: LabConfig = JSON.parse(JSON.stringify(cfg));
  const g = c.geometries;
  switch (param) {
    case 'size':
      if (kind === 'plates') {
        const ratio = g.plates.height / g.plates.width;
        g.plates.width = value;
        g.plates.height = value * ratio;
      } else if (kind === 'klein') g.klein.bodyRadius = value;
      else g[kind].radius = value;
      break;
    case 'width':
      if (kind === 'plates') g.plates.width = value;
      else if (kind !== 'klein') g[kind].width = value;
      break;
    case 'gap':
      g[kind].gap = value;
      break;
    case 'rz':
      g[kind].placement.rz = value;
      break;
    case 'rx':
      g[kind].placement.rx = value;
      break;
    case 'theta':
      c.surface.thetaA = value;
      c.surface.thetaC = value;
      break;
    case 'span':
      g.klein.anodeSpanDeg = value;
      break;
    case 'arrangement': {
      const opts = arrangementOptions(kind);
      const o = opts[Math.max(0, Math.min(opts.length - 1, Math.round(value)))];
      if (kind === 'plates') g.plates.arrangement = o as 'pair' | 'sandwich';
      else if (kind !== 'klein') g[kind].arrangement = o as BandArrangement;
      break;
    }
  }
  return c;
}

const primaryCache = new Map<string, PrimaryResult>();
/** პირველადი ამოხსნა ქეშით (გასაღები: გეომეტრია + ბადის გარჩევადობა). */
export function primaryCached(built: Built, N: number): PrimaryResult | null {
  if (!built.cell) return null;
  const key = built.key + '|' + N;
  let r = primaryCache.get(key);
  if (!r) {
    r = solvePrimary(discretize(built.cell, N));
    primaryCache.set(key, r);
    if (primaryCache.size > 400) primaryCache.delete(primaryCache.keys().next().value as string);
  }
  return r;
}

function objectiveOf(cfg: LabConfig, res: Resolved, K: number, objective: Objective) {
  const c2: LabConfig = objective === 'h2AtPower' ? { ...cfg, electrical: { ...cfg.electrical, mode: 'P' } } : cfg;
  const ev = evaluate(res, c2, K);
  let obj = NaN;
  if (ev.valid && ev.prod) {
    if (objective === 'h2AtPower') obj = ev.prod.nH2;
    else if (objective === 'kwhPerKg') obj = ev.prod.kwhPerKg;
    else obj = ev.prodPerEnvelope;
  }
  return { ev, obj };
}

export function evalScanPoint(cfg: LabConfig, spec: ScanSpec, values: number[], N: number): ScanRow {
  let c = cfg;
  spec.axes.forEach((a, i) => {
    c = applyScanValue(c, spec.kind, a.param, values[i]);
  });
  const res = resolveGeometries(c)[spec.kind];
  const reasons: string[] = [...res.built.errors];
  const row: ScanRow = {
    values,
    feasible: false,
    reasons,
    K: NaN,
    objective: NaN,
    U: NaN,
    I: NaN,
    P: NaN,
    nH2: NaN,
    kwhPerKg: NaN,
    areaC: NaN,
    volume: NaN,
    envelopeVolume: NaN,
    minDistance: NaN,
    balance: NaN,
    lambda: res.lambda,
  };
  if (res.normNote) reasons.push(res.normNote);
  const cell = res.built.cell;
  if (!cell || res.built.errors.length) return row;
  const prim = primaryCached(res.built, N)!;
  const { ev, obj } = objectiveOf(c, res, prim.K, spec.objective);
  row.K = prim.K;
  row.balance = prim.balance;
  row.areaC = cell.areaC;
  row.volume = cell.volumeA + cell.volumeC;
  row.envelopeVolume = cell.envelopeVolume;
  row.minDistance = cell.minDistance;
  if (!ev.valid || !ev.b || !ev.prod) {
    reasons.push(...ev.errors);
    return row;
  }
  row.U = ev.b.U;
  row.I = ev.b.I;
  row.P = ev.b.P;
  row.nH2 = ev.prod.nH2;
  row.kwhPerKg = ev.prod.kwhPerKg;
  row.objective = obj;
  if (spec.maxVolume !== null && row.volume > spec.maxVolume * (1 + 1e-9)) reasons.push('მასალის მოცულობა ზღვარს აღემატება');
  if (spec.maxEnvelope !== null && row.envelopeVolume > spec.maxEnvelope * (1 + 1e-9)) reasons.push('გაბარიტი ზღვარს აღემატება');
  if (Math.max(ev.b.jA, ev.b.jC) > c.limits.jMax) reasons.push('დენის სიმკვრივე სამუშაო დიაპაზონს გარეთაა');
  if (ev.b.U > c.limits.uMax) reasons.push('ძაბვა სამუშაო დიაპაზონს გარეთაა');
  if (!(ev.b.I > 0)) reasons.push('ნულოვანი დენი');
  row.feasible = reasons.length === 0 && Number.isFinite(obj);
  return row;
}

/** საუკეთესო ვარიანტის დაზუსტება წვრილ ბადეზე: რიცხვითი გაურკვევლობა = |მიზანი(წვრილი) − მიზანი(უხეში)|. */
export function refineRow(cfg: LabConfig, spec: ScanSpec, row: ScanRow): ScanRow {
  let c = cfg;
  spec.axes.forEach((a, i) => {
    c = applyScanValue(c, spec.kind, a.param, row.values[i]);
  });
  const res = resolveGeometries(c)[spec.kind];
  if (!res.built.cell) return row;
  const prim = primaryCached(res.built, spec.refineResolution)!;
  const { obj } = objectiveOf(c, res, prim.K, spec.objective);
  return { ...row, Kfine: prim.K, objectiveFine: obj, uncertainty: Math.abs(obj - row.objective) };
}

export interface ScanSummary {
  best: ScanRow | null;
  baseline: ScanRow; // მიმდინარე (არასკანირებული) დიზაინი იმავე მეთოდით
  improvementPct: number;
  uncertaintyPct: number;
  distinguishable: boolean;
  text: string;
}

export function rankRows(rows: ScanRow[], objective: Objective): ScanRow[] {
  const max = OBJECTIVE_UNIT[objective].maximize;
  return rows
    .filter((r) => r.feasible)
    .sort((a, b) => (max ? b.objective - a.objective : a.objective - b.objective));
}

export function summarizeScan(cfg: LabConfig, spec: ScanSpec, rows: ScanRow[]): ScanSummary {
  const ranked = rankRows(rows, spec.objective);
  const noAxes: ScanSpec = { ...spec, axes: [] };
  let baseline = evalScanPoint(cfg, noAxes, [], spec.resolution);
  baseline = refineRow(cfg, noAxes, baseline);
  const best = ranked[0] ?? null;
  if (!best || !Number.isFinite(baseline.objective)) {
    return {
      best,
      baseline,
      improvementPct: NaN,
      uncertaintyPct: NaN,
      distinguishable: false,
      text: best ? 'საბაზისო დიზაინი დაუშვებელია — შედარება შეუძლებელია.' : 'დასაშვები ვარიანტი ვერ მოიძებნა მოცემული შეზღუდვებით.',
    };
  }
  const bObj = best.objectiveFine ?? best.objective;
  const base = baseline.objectiveFine ?? baseline.objective;
  const imp = ((bObj - base) / Math.abs(base)) * 100;
  const unc = (((best.uncertainty ?? 0) + (baseline.uncertainty ?? 0)) / Math.abs(base)) * 100;
  const max = OBJECTIVE_UNIT[spec.objective].maximize;
  const better = max ? imp > 0 : imp < 0;
  const distinguishable = Math.abs(imp) > unc;
  let text: string;
  if (!distinguishable)
    text = `მოდელი საუკეთესო ვარიანტსა და მიმდინარე დიზაინს ერთმანეთისგან ვერ არჩევს: სხვაობა ${imp.toFixed(2)} % ნაკლებია ბადის რიცხვით გაურკვევლობაზე (±${unc.toFixed(2)} %).`;
  else if (better)
    text = `ამ დაშვებებით საუკეთესო ვარიანტი მიმდინარე დიზაინს ${Math.abs(imp).toFixed(2)} %-ით სჯობს (რიცხვითი გაურკვევლობა ±${unc.toFixed(2)} %). ეს არის მოდელის შედეგი და არა მოწყობილობის პროგნოზი.`;
  else
    text = `სკანირებულ არეში მიმდინარე დიზაინზე უკეთესი ვარიანტი ვერ მოიძებნა (საუკეთესო ${imp.toFixed(2)} %, გაურკვევლობა ±${unc.toFixed(2)} %).`;
  return { best, baseline, improvementPct: imp, uncertaintyPct: unc, distinguishable, text };
}

/** სინქრონული სკანირება (Node სკრიპტისა და ტესტებისთვის; ბრაუზერში იგივე ლოგიკა Worker-ში ეშვება). */
export function runScan(cfg: LabConfig, spec: ScanSpec, onRow?: (done: number, total: number) => void) {
  const pts = scanPoints(spec);
  let rows = pts.map((v, i) => {
    const r = evalScanPoint(cfg, spec, v, spec.resolution);
    onRow?.(i + 1, pts.length);
    return r;
  });
  const top = rankRows(rows, spec.objective).slice(0, spec.refineTop);
  rows = rows.map((r) => (top.includes(r) ? refineRow(cfg, spec, r) : r));
  return { rows, summary: summarizeScan(cfg, spec, rows) };
}
