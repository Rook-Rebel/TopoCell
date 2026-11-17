// ექსპერიმენტებისა და აუდიტის სკრიპტების საერთო ნაწილი: შემთხვევების განსაზღვრება და სრული სტრიქონის გამოთვლა.
// ყველა რიცხვი აქ იმავე ბირთვის ფუნქციებით ითვლება, რომლებსაც აპლიკაცია იყენებს (იხ. FUNCTIONS — წარმომავლობის რუკა).
import { Cell, KIND_SHORT, Kind } from '../src/core/geometry/cell';
import { LabConfig, Resolved, evaluate, resolveGeometries, targetValue } from '../src/core/lab';
import { bruggeman, eRev } from '../src/core/physics';
import { ARRANGEMENT_LABEL } from '../src/core/scan';
import { Disc, MEASURE_THRESHOLDS, PrimaryResult, SecondaryPhys, SecondaryResult, discretize, solvePrimary, solveSecondary } from '../src/core/solver/solver';

/** რომელი სვეტი რომელი ფუნქციით ითვლება (ფაილი: ფუნქცია). */
export const FUNCTIONS: Record<string, string> = {
  'I_A, U_V, P_W, etaA_mV, etaC_mV, ohmic_mV': 'src/core/physics.ts: solveOperating → voltageAt (U = E_rev + η_a + |η_c| + I·K/κ_eff), გამოძახებული src/core/lab.ts: evaluate-დან',
  'nH2_mmol_h, nO2_mmol_h, kWh_per_kg': 'src/core/physics.ts: production (ფარადეის კანონი; kWh/kg = P/(ṅ·M))',
  'eRev_V': 'src/core/physics.ts: eRev',
  'K_1_m, pcg_iters, pcg_relres, balance_primary, unknowns, h_mm': 'src/core/solver/solver.ts: discretize → solvePrimary (pcg)',
  'areaC_cm2, areaA_cm2, material_cm3': 'src/core/geometry/mesh.ts: meshArea, meshVolume (ჩაკეტილი ბადე); სხეულები — src/core/geometry/solids.ts, klein.ts',
  'dmin_mm': 'src/core/geometry/solids.ts: minDistance (SDF ზედაპირის წერტილებზე); მორგება — fitTranslation / cell.ts: buildBands',
  'dmean_mm, dp10_mm, dp90_mm': 'scripts/lib.ts: gapStats (კათოდის სამკუთხედების ცენტროიდებზე ანოდის SDF, ფართობით შეწონილი)',
  'envelope_cm3, tank_cm3': 'src/core/geometry/cell.ts: finalize (ღერძებზე გასწორებული გაბარიტული ყუთი; ავზი = გაბარიტი + მარაგი)',
  lambda: 'src/core/lab.ts: resolveGeometries (regula falsi სამიზნე სიდიდეზე)',
  'I_sp_A, U_sp_V, P_sp_W, etaA_sp_mV, etaC_sp_mV, ohmic_sp_mV, newton_iters, balance_secondary': 'src/core/solver/solver.ts: solveSecondary (BV სასაზღვრო პირობა, ნიუტონი)',
  'energy_closure, joule_W, kinetic_W': 'src/core/solver/solver.ts: solveSecondary (EnergyAudit — ველიდან დამოუკიდებლად)',
  'utilC_kin, utilA_kin': 'src/core/solver/solver.ts: solveSecondary: I / (m·j_BV(η̄)) / A, η̄ — დენით შეწონილი საშუალო',
  'utilC_entropy, participationC, areaC_above_*': 'src/core/solver/solver.ts: distMeasures',
  'trapAreaC, pocketAreaC, pocketVol_cm3, pocketSpillZ_mm': 'src/core/solver/solver.ts: analyzeTraps',
};

export function physFor(cfg: LabConfig, cell: Cell): SecondaryPhys {
  return {
    T: cfg.electrolyte.T,
    eRev: eRev(cfg.electrolyte.T, cfg.electrolyte.p),
    kappaEff: bruggeman(cfg.electrolyte.kappa, cfg.electrolyte.voidFraction),
    kinA: cfg.kinetics.anode,
    kinC: cfg.kinetics.cathode,
    mA: cfg.surface.roughness * (1 - cfg.surface.thetaA),
    mC: cfg.surface.roughness * (1 - cfg.surface.thetaC),
    extraR: cfg.electrical.extraR,
    areaA: cell.areaA,
    areaC: cell.areaC,
  };
}

/** კათოდის ზედაპირიდან ანოდამდე მანძილის განაწილება (ფართობით შეწონილი). */
export function gapStats(cell: Cell): { mean: number; p10: number; p50: number; p90: number } {
  const sdf = cell.anode.sdf;
  if (!sdf) return { mean: NaN, p10: NaN, p50: NaN, p90: NaN };
  const p = cell.cathode.mesh.positions,
    ix = cell.cathode.mesh.indices;
  const d: number[] = [],
    w: number[] = [];
  let A = 0,
    s = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3,
      b = ix[t + 1] * 3,
      c = ix[t + 2] * 3;
    const ux = p[b] - p[a],
      uy = p[b + 1] - p[a + 1],
      uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a],
      vy = p[c + 1] - p[a + 1],
      vz = p[c + 2] - p[a + 2];
    const ar = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    const dd = sdf((p[a] + p[b] + p[c]) / 3, (p[a + 1] + p[b + 1] + p[c + 1]) / 3, (p[a + 2] + p[b + 2] + p[c + 2]) / 3);
    d.push(dd);
    w.push(ar);
    A += ar;
    s += ar * dd;
  }
  const order = d.map((_, i) => i).sort((i, j) => d[i] - d[j]);
  const q = (f: number) => {
    let acc = 0;
    for (const i of order) {
      acc += w[i];
      if (acc >= f * A) return d[i];
    }
    return d[order[order.length - 1]];
  };
  return { mean: s / A, p10: q(0.1), p50: q(0.5), p90: q(0.9) };
}

export interface CaseDef {
  id: string;
  label: string;
  kind: Kind;
  mut: (c: LabConfig) => void;
}

/** ექსპერიმენტი 3-ის ყველა განლაგება (თანაბარი მასალა). */
export function exp3Cases(): CaseDef[] {
  const list: CaseDef[] = [
    { id: 'plates_pair', label: 'A ფირფიტები · წყვილი (საბაზისო)', kind: 'plates', mut: () => {} },
    {
      // საბაზისო მოდელის სხვა განლაგება ავტომატურად არ ნორმალიზდება (ის თავად არის საყრდენი), ამიტომ ზომები ხელით
      // მცირდება √(2/3)-ჯერ: სამი ფირფიტის მოცულობა = ორი საწყისი ფირფიტის მოცულობას.
      id: 'plates_sandwich',
      label: 'A ფირფიტები · სენდვიჩი (W, H × 0.816)',
      kind: 'plates',
      mut: (c) => {
        c.geometries.plates.arrangement = 'sandwich';
        c.geometries.plates.width *= Math.sqrt(2 / 3);
        c.geometries.plates.height *= Math.sqrt(2 / 3);
        c.fairness.constraint = 'none';
      },
    },
  ];
  for (const kind of ['rings', 'mobius'] as const)
    for (const a of ['stacked', 'side', 'nested', 'conformal'] as const)
      list.push({ id: `${kind}_${a}`, label: `${KIND_SHORT[kind]} · ${ARRANGEMENT_LABEL[a]}`, kind, mut: (c) => (c.geometries[kind].arrangement = a) });
  list.push({
    id: 'rings_cyl_nested',
    label: 'B რგოლები · ცილინდრული (θ₀ = 90°), ჩადგმული',
    kind: 'rings',
    mut: (c) => {
      c.geometries.rings.phaseDeg = 90;
      c.geometries.rings.arrangement = 'nested';
    },
  });
  list.push({ id: 'klein', label: 'D კლაინი · რკალური ანოდი', kind: 'klein', mut: () => {} });
  return list;
}

export function applyCase(base: LabConfig, c: CaseDef): LabConfig {
  const cfg: LabConfig = JSON.parse(JSON.stringify(base));
  c.mut(cfg);
  return cfg;
}

export type Row = Record<string, number | string | boolean>;

export interface Solved {
  res: Resolved;
  disc: Disc;
  prim: PrimaryResult;
  sec: SecondaryResult;
}

/** ერთი შემთხვევის სრული ამოხსნა ერთსა და იმავე ბადეზე N (პირველადიც და მეორადიც). */
export function solveCase(cfg: LabConfig, kind: Kind, N: number, tol = 1e-9): Solved | { res: Resolved; error: string } {
  const res = resolveGeometries(cfg)[kind];
  const cell = res.built.cell;
  if (!cell || res.built.errors.length) return { res, error: res.built.errors.join(' | ') };
  const disc = discretize(cell, N);
  const prim = solvePrimary(disc, false, tol);
  const sec = solveSecondary(disc, physFor(cfg, cell), { mode: cfg.electrical.mode, value: targetValue(cfg) }, prim.K, false, true);
  return { res, disc, prim, sec };
}

const M_H2 = 2.01588e-3,
  FAR = 96485.33212;

/** სრული სტრიქონი: ელექტრული, გეომეტრიული, ბადის და მეორადი ამოხსნის სვეტები. */
export function fullRow(cfg: LabConfig, kind: Kind, id: string, label: string, N: number): Row {
  const s = solveCase(cfg, kind, N);
  const base: Row = { id, label, kind, valid: !('error' in s), mode: cfg.electrical.mode, constraint: cfg.fairness.constraint, N };
  if ('error' in s) return { ...base, note: s.error, lambda: s.res.lambda };
  const { res, prim, sec } = s;
  const cell = res.built.cell!;
  const ev = evaluate(res, cfg, prim.K);
  const b = ev.b!,
    pr = ev.prod!;
  const g = gapStats(cell);
  const nH2sp = (cfg.electrical.faradaicH2 * sec.I) / (2 * FAR);
  const row: Row = {
    ...base,
    note: [...(res.normNote ? [res.normNote] : []), ...(sec.converged ? [] : ['მეორადი ამოხსნა არ დაიკრიბა']), ...prim.warnings].join(' | '),
    lambda: res.lambda,
    // ელექტრული (ერთიანი მოდელი, K იმავე ბადიდან)
    I_A: b.I,
    U_V: b.U,
    P_W: b.P,
    nH2_mmol_h: pr.nH2 * 3.6e6,
    nO2_mmol_h: pr.nO2 * 3.6e6,
    faradaicH2: cfg.electrical.faradaicH2,
    faradaicO2: cfg.electrical.faradaicO2,
    kWh_per_kg: pr.kwhPerKg,
    eRev_V: b.eRev,
    etaA_mV: b.etaA * 1e3,
    etaC_mV: b.etaC * 1e3,
    ohmic_mV: b.ohmic * 1e3,
    // გეომეტრია
    areaC_cm2: cell.areaC * 1e4,
    areaA_cm2: cell.areaA * 1e4,
    material_cm3: (cell.volumeA + cell.volumeC) * 1e6,
    thickness_mm: cell.minThickness * 1e3,
    partsC: cell.cathode.parts,
    partsA: cell.anode.parts,
    componentsA: cell.reportA.components,
    dmin_mm: cell.minDistance * 1e3,
    dmean_mm: g.mean * 1e3,
    dp10_mm: g.p10 * 1e3,
    dp90_mm: g.p90 * 1e3,
    envelope_cm3: cell.envelopeVolume * 1e6,
    tank_cm3: cell.tankVolume * 1e6,
    // ბადე და პირველადი ამოხსნა
    h_mm: prim.h * 1e3,
    unknowns: prim.unknowns,
    gap_cells: prim.gapCells,
    K_1_m: prim.K,
    K_rough_1_m: cell.roughK,
    pcg_iters: prim.iters,
    pcg_relres: prim.relRes,
    balance_primary: prim.balance,
    areaScaleA: prim.areaScale[0],
    areaScaleC: prim.areaScale[1],
    p95C_primary: prim.statsC.p95,
    shadowC_primary: prim.statsC.shadowFrac,
    // მეორადი ამოხსნა (იგივე ბადე)
    sec_converged: sec.converged,
    newton_iters: sec.iterations,
    I_sp_A: sec.I,
    U_sp_V: sec.U,
    P_sp_W: sec.P,
    nH2_sp_mmol_h: nH2sp * 3.6e6,
    kWh_per_kg_sp: nH2sp > 0 ? sec.P / (nH2sp * 3600) / M_H2 / 1000 : NaN,
    etaA_sp_mV: sec.etaA * 1e3,
    etaC_sp_mV: sec.etaC * 1e3,
    ohmic_sp_mV: sec.ohmic * 1e3,
    dU_mV: sec.dU * 1e3,
    balance_secondary: sec.balance,
    energy_closure: sec.energy!.closure,
    utilC_kin: sec.utilC,
    utilA_kin: sec.utilA,
    utilC_entropy: sec.measuresC!.entropyUtil,
    participationC: sec.measuresC!.participation,
    // გაზის ინდიკატორები
    trapAreaC: prim.traps.trappedAreaC,
    pocketAreaC: prim.traps.pocketAreaC,
    pocketVol_cm3: prim.traps.pocketVolume * 1e6,
    pocketSpillZ_mm: prim.traps.pocketSpillZ * 1e3,
  };
  MEASURE_THRESHOLDS.forEach((t, i) => (row[`areaC_above_${t}`] = sec.measuresC!.areaAbove[i]));
  return row;
}

export const f = (v: unknown, d = 2): string => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—');
export const e = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) ? v.toExponential(1) : '—');

export function mdTable(rows: Row[], cols: [string, (r: Row) => string][]): string {
  const head = `| ${cols.map((c) => c[0]).join(' | ')} |\n|${cols.map(() => '---').join('|')}|\n`;
  return head + rows.map((r) => `| ${cols.map((c) => c[1](r)).join(' | ')} |`).join('\n') + '\n';
}

export function csvOf(rows: Row[]): string {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown) => {
    const s = v === undefined || v === null ? '' : typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}
