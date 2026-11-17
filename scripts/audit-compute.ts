// სამეცნიერო აუდიტის გამოთვლითი ნაწილი. თითო კვლევა ცალკე JSON ფაილად იწერება experiments/audit/-ში;
// ანგარიშს (AUDIT.md) ამ ფაილებიდან აგენერირებს scripts/audit-report.ts.   გაშვება: npm run audit
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { APP_VERSION } from '../src/core/constants';
import { Cell, buildCell, defaultEnv, defaultGeometries } from '../src/core/geometry/cell';
import { kleinDims } from '../src/core/geometry/klein';
import { surfaceTopology } from '../src/core/geometry/mesh';
import { bandEdgeStretch, bandMidArea, bandMidSurface } from '../src/core/geometry/solids';
import { LabConfig, evaluate, modelFor, resolveGeometries, targetValue } from '../src/core/lab';
import { CellModel, production, solveOperating } from '../src/core/physics';
import { presets } from '../src/core/presets';
import { analyzeTraps, discretize, solvePrimary, solveSecondary } from '../src/core/solver/solver';
import { CaseDef, Row, applyCase, exp3Cases, fullRow, gapStats, physFor } from './lib';

const OUT = 'experiments/audit';
mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
const want = (name: string) => only.length === 0 || only.includes(name);
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const save = (name: string, data: unknown) =>
  writeFileSync(`${OUT}/${name}.json`, JSON.stringify({ app: 'TopoCell', version: APP_VERSION, generatedBy: 'scripts/audit-compute.ts', savedAt: new Date().toISOString(), ...(data as object) }, null, 2));

const P = presets();
const cfg1 = P[0].config; // I = 5 A, ნორმალიზების გარეშე
const cfg2 = P[1].config; // P = 12 W, ერთნაირი ფართობი
const cfg3 = P[2].config; // I = 5 A, ერთნაირი მასალა
const cases = exp3Cases();
const byId = (id: string) => cases.find((c) => c.id === id)!;
const M_H2 = 2.01588e-3,
  FAR = 96485.33212;
const kwhkg = (U: number, I: number, etaF = 1) => (U * I) / (((etaF * I) / (2 * FAR)) * 3600) / M_H2 / 1000;

// -------------------------------------------------------------------------------------------------
// S1. ბადის გამკვრივება
// -------------------------------------------------------------------------------------------------
if (want('grid')) {
  const ids = ['plates_pair', 'plates_sandwich', 'rings_stacked', 'mobius_stacked', 'rings_conformal', 'mobius_conformal', 'klein'];
  const levelsSec = [40, 60, 90, 135];
  const levelsPrim = [40, 60, 90, 135];
  const out: Record<string, unknown[]> = {};
  for (const id of ids) {
    const c = byId(id);
    const cfg = applyCase(cfg3, c);
    const res = resolveGeometries(cfg)[c.kind];
    const cell = res.built.cell as Cell;
    const rows: unknown[] = [];
    for (const N of levelsPrim) {
      const disc = discretize(cell, N);
      const prim = solvePrimary(disc);
      const ev = evaluate(res, cfg, prim.K);
      const row: Record<string, unknown> = {
        N,
        h_mm: prim.h * 1e3,
        unknowns: prim.unknowns,
        gap_cells: prim.gapCells,
        K: prim.K,
        pcg_iters: prim.iters,
        pcg_relres: prim.relRes,
        balance_primary: prim.balance,
        areaScaleA: prim.areaScale[0],
        areaScaleC: prim.areaScale[1],
        U_lumped: ev.b!.U,
        kWh_lumped: ev.prod!.kwhPerKg,
        p95C: prim.statsC.p95,
        maxC: prim.statsC.max,
        ms_primary: prim.ms,
      };
      if (levelsSec.includes(N)) {
        const sec = solveSecondary(disc, physFor(cfg, cell), { mode: 'I', value: cfg.electrical.I }, prim.K, false, true);
        Object.assign(row, {
          sec_converged: sec.converged,
          newton_iters: sec.iterations,
          U_sp: sec.U,
          kWh_sp: kwhkg(sec.U, sec.I),
          etaA_sp: sec.etaA,
          etaC_sp: sec.etaC,
          ohmic_sp: sec.ohmic,
          dU: sec.dU,
          balance_secondary: sec.balance,
          energy_closure: sec.energy!.closure,
          max_link_mismatch: sec.energy!.maxLinkMismatch,
          utilC_kin: sec.utilC,
          utilA_kin: sec.utilA,
          utilC_entropy: sec.measuresC!.entropyUtil,
          ms_secondary: sec.ms,
        });
      }
      rows.push(row);
      log('grid', id, 'N', N, 'K', prim.K.toFixed(4), 'Usp', (row.U_sp as number | undefined)?.toFixed(4));
    }
    out[id] = rows;
    save('grid', { config: 'presets()[2] (I = 5 A, ერთნაირი მასალა) + exp3Cases()[id]', levelsPrim, levelsSec, cases: out });
  }
}

// -------------------------------------------------------------------------------------------------
// S2. ამომხსნელის ტოლერანსი (იტერაციული ცდომილება დისკრეტიზაციისგან გამოყოფილად)
// -------------------------------------------------------------------------------------------------
if (want('tol')) {
  const c = byId('mobius_conformal');
  const cfg = applyCase(cfg3, c);
  const cell = resolveGeometries(cfg)[c.kind].built.cell as Cell;
  const disc = discretize(cell, 60);
  const rows = [1e-3, 1e-5, 1e-7, 1e-9, 1e-12].map((tol) => {
    const p = solvePrimary(disc, false, tol);
    return { tol, K: p.K, iters: p.iters, relres: p.relRes, balance: p.balance };
  });
  save('solver_tolerance', { case: 'mobius_conformal', N: 60, rows });
  log('tol done');
}

// -------------------------------------------------------------------------------------------------
// S3. „აქტიური ფართობი“: განსაზღვრებები, ზღვრის მგრძნობელობა, ბადის მგრძნობელობა
// -------------------------------------------------------------------------------------------------
if (want('util')) {
  const variants: { id: string; label: string; cfg: LabConfig; kind: 'klein' | 'plates' | 'mobius'; mut?: CaseDef }[] = [
    { id: 'klein_exp1', label: 'კლაინი · ნაგულისხმევი ზომა (ექსპ. 1: I = 5 A)', cfg: cfg1, kind: 'klein' },
    { id: 'klein_exp2', label: 'კლაინი · ერთნაირი ფართობი (ექსპ. 2: P = 12 W)', cfg: cfg2, kind: 'klein' },
    { id: 'klein_exp3', label: 'კლაინი · ერთნაირი მასალა (ექსპ. 3: I = 5 A)', cfg: cfg3, kind: 'klein' },
    { id: 'plates_pair', label: 'ფირფიტების წყვილი (ექსპ. 3)', cfg: cfg3, kind: 'plates' },
    { id: 'mobius_conformal', label: 'კონფორმული მიობიუსი (ექსპ. 3)', cfg: applyCase(cfg3, byId('mobius_conformal')), kind: 'mobius' },
  ];
  const out: Record<string, unknown> = {};
  for (const v of variants) {
    const res = resolveGeometries(v.cfg)[v.kind];
    const cell = res.built.cell as Cell;
    const rows = [];
    for (const N of v.kind === 'klein' ? [40, 60, 90] : [60]) {
      const disc = discretize(cell, N);
      const prim = solvePrimary(disc);
      const sec = solveSecondary(disc, physFor(v.cfg, cell), { mode: v.cfg.electrical.mode, value: targetValue(v.cfg) }, prim.K, false, true);
      rows.push({
        N,
        h_mm: prim.h * 1e3,
        I: sec.I,
        U_sp: sec.U,
        converged: sec.converged,
        utilC_kin: sec.utilC,
        utilA_kin: sec.utilA,
        secondary: { C: sec.measuresC, A: sec.measuresA, p95C: sec.statsC.p95, maxC: sec.statsC.max },
        primary: { C: prim.measuresC, A: prim.measuresA, p95C: prim.statsC.p95, maxC: prim.statsC.max, shadowC: prim.statsC.shadowFrac },
        areaScaleC: prim.areaScale[1],
        lambda: res.lambda,
        areaC_cm2: cell.areaC * 1e4,
      });
      log('util', v.id, 'N', N, 'utilC_kin', sec.utilC.toFixed(3), 'entropy', sec.measuresC!.entropyUtil.toFixed(3));
    }
    out[v.id] = { label: v.label, rows };
    save('utilization', { variants: out });
  }
}

// -------------------------------------------------------------------------------------------------
// S4. გადაგრეხის კვლევა: n × განლაგება, საკონტროლო ფაზები და მობრუნებები (ერთნაირი მასალა, I = 5 A)
// -------------------------------------------------------------------------------------------------
if (want('twist')) {
  const rows: Row[] = [];
  const add = (id: string, label: string, mut: (c: LabConfig) => void) => {
    const cfg: LabConfig = JSON.parse(JSON.stringify(cfg3));
    mut(cfg);
    const r = fullRow(cfg, 'mobius', id, label, 60);
    rows.push(r);
    log('twist', id, r.valid ? `K=${Number(r.K_1_m).toFixed(3)} dmean=${Number(r.dmean_mm).toFixed(1)} Usp=${Number(r.U_sp_V).toFixed(4)}` : 'INVALID ' + r.note);
    save('twist', { config: 'presets()[2] + ცვლილებები geometries.mobius-ზე (halfTwists, phaseDeg, arrangement, placement)', N: 60, rows });
  };
  for (const arr of ['stacked', 'side', 'conformal'] as const)
    for (const n of [0, 1, 2, 3])
      add(`n${n}_${arr}`, `n = ${n}, θ₀ = 0°, ${arr}`, (c) => {
        c.geometries.mobius.halfTwists = n;
        c.geometries.mobius.arrangement = arr;
      });
  for (const arr of ['stacked', 'side'] as const)
    for (const ph of [45, 90])
      add(`n0_ph${ph}_${arr}`, `n = 0, θ₀ = ${ph}°, ${arr}`, (c) => {
        c.geometries.mobius.halfTwists = 0;
        c.geometries.mobius.phaseDeg = ph;
        c.geometries.mobius.arrangement = arr;
      });
  for (const rz of [90, 180, 270])
    add(`n1_rz${rz}_stacked`, `n = 1, ანოდი მობრუნებულია z-ზე ${rz}°, stacked`, (c) => {
      c.geometries.mobius.halfTwists = 1;
      c.geometries.mobius.arrangement = 'stacked';
      c.geometries.mobius.placement.rz = rz;
    });
  for (const rz of [180])
    add(`n1_rz${rz}_side`, `n = 1, ანოდი მობრუნებულია z-ზე ${rz}°, side`, (c) => {
      c.geometries.mobius.halfTwists = 1;
      c.geometries.mobius.arrangement = 'side';
      c.geometries.mobius.placement.rz = rz;
    });
  // საკონტროლო: იგივე საშუალო დაშორება სხვადასხვა გზით
  add('n0_stacked_gap22', 'n = 0, θ₀ = 0°, stacked, მინ. დაშორება 22 მმ (≈ n = 1-ის საშუალო დაშორება)', (c) => {
    c.geometries.mobius.halfTwists = 0;
    c.geometries.mobius.arrangement = 'stacked';
    c.geometries.mobius.gap = 0.022;
  });
  add('n1_stacked_gap2', 'n = 1, θ₀ = 0°, stacked, მინ. დაშორება 2 მმ (დასაშვები მინიმუმი)', (c) => {
    c.geometries.mobius.halfTwists = 1;
    c.geometries.mobius.arrangement = 'stacked';
    c.geometries.mobius.gap = 0.002;
  });
}

// -------------------------------------------------------------------------------------------------
// S5. გაზის ჯიბე კლაინის გარსში: მდებარეობა და ბადის მგრძნობელობა (ამოხსნა არ სჭირდება)
// -------------------------------------------------------------------------------------------------
if (want('gas')) {
  const out: Record<string, unknown> = {};
  for (const [vid, cfg] of [
    ['klein_exp1', cfg1],
    ['klein_exp3', cfg3],
  ] as const) {
    const res = resolveGeometries(cfg)[('klein')];
    const cell = res.built.cell as Cell;
    const kp = res.geo.klein;
    const d = kleinDims({ Rb: kp.bodyRadius, neckRatio: kp.neckRatio, t: kp.thickness, clearance: kp.clearance });
    const zWinTop = d.zH + d.rhoW;
    const rows = [];
    for (const N of [48, 72, 108, 144]) {
      const disc = discretize(cell, N);
      const tr = analyzeTraps(disc);
      const g = disc.grid;
      const v = g.h ** 3;
      const reg = { bodyAbove: 0, bodyBelow: 0, tube: 0 };
      const regNoVent = { bodyAbove: 0, bodyBelow: 0, tube: 0 };
      let zmin = Infinity,
        zmax = -Infinity;
      for (let k = 0; k < g.nz; k++)
        for (let j = 0; j < g.ny; j++)
          for (let i = 0; i < g.nx; i++) {
            const idx = i + 1 + g.NX * (j + 1 + g.NY * (k + 1));
            if (!tr.mask[idx] && !tr.pocketMask[idx]) continue;
            const x = g.x0 + i * g.h,
              y = g.y0 + j * g.h,
              z = g.z0 + k * g.h;
            const inBody = Math.hypot(x, y) <= d.Rb && z <= d.Hc + d.Hs;
            const key = inBody ? (z > zWinTop ? 'bodyAbove' : 'bodyBelow') : 'tube';
            if (tr.pocketMask[idx]) {
              reg[key] += v;
              if (z < zmin) zmin = z;
              if (z > zmax) zmax = z;
            }
            if (tr.mask[idx]) regNoVent[key] += v;
          }
      rows.push({
        N,
        h_mm: g.h * 1e3,
        clearance_cells: kp.clearance / g.h,
        noVent: { volume_cm3: tr.report.trappedVolume * 1e6, areaC: tr.report.trappedAreaC, areaA: tr.report.trappedAreaA, regions_cm3: mapScale(regNoVent, 1e6) },
        pocket: { volume_cm3: tr.report.pocketVolume * 1e6, areaC: tr.report.pocketAreaC, areaA: tr.report.pocketAreaA, spillZ_mm: tr.report.pocketSpillZ * 1e3, zmin_mm: zmin * 1e3, zmax_mm: zmax * 1e3, regions_cm3: mapScale(reg, 1e6) },
        isolated_cm3: tr.report.isolatedVolume * 1e6,
        fluid_cm3: tr.report.fluidVolume * 1e6,
      });
      log('gas', vid, 'N', N, 'pocket', (tr.report.pocketVolume * 1e6).toFixed(2), 'cm3 areaC', tr.report.pocketAreaC.toFixed(3), 'noVent areaC', tr.report.trappedAreaC.toFixed(3), 'spill', (tr.report.pocketSpillZ * 1e3).toFixed(1));
    }
    out[vid] = {
      dims_mm: { Rb: d.Rb * 1e3, Hc: d.Hc * 1e3, zH: d.zH * 1e3, rhoN: d.rhoN * 1e3, rhoW: d.rhoW * 1e3, windowTop: zWinTop * 1e3, windowBottom: (d.zH - d.rhoW) * 1e3, zTop: d.zTop * 1e3, handleTop: (d.zTop + d.a1 + d.rhoN) * 1e3, clearance: kp.clearance * 1e3 },
      rows,
    };
  }
  save('gas_pocket', { regions: 'bodyAbove — კორპუსის ღრუ ფანჯრის ზედა კიდის ზემოთ (მხრის ჩათვლით); bodyBelow — კორპუსის ღრუ მის ქვემოთ (შიდა მილისა და ძირის ჩათვლით); tube — ყელი და სახელური', variants: out });
}
function mapScale(o: Record<string, number>, s: number) {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v * s]));
}

// -------------------------------------------------------------------------------------------------
// S6. ავზის მარაგის (ელექტროლიტის გარემოს) მგრძნობელობა — ბადის ბიჯი მუდმივია (h ≈ 1.3 მმ)
// -------------------------------------------------------------------------------------------------
if (want('margin')) {
  const rows: Row[] = [];
  for (const margin of [0.008, 0.015, 0.03])
    for (const id of ['plates_pair', 'plates_sandwich', 'rings_conformal', 'mobius_conformal']) {
      const c = byId(id);
      const cfg = applyCase(cfg3, c);
      cfg.env.tankMargin = margin;
      const cell = resolveGeometries(cfg)[c.kind].built.cell as Cell;
      const L = Math.max(cell.tank.max[0] - cell.tank.min[0], cell.tank.max[1] - cell.tank.min[1], cell.tank.max[2] - cell.tank.min[2]);
      const N = Math.round(L / 0.0013);
      const r = fullRow(cfg, c.kind, id, c.label, N);
      r.margin_mm = margin * 1e3;
      rows.push(r);
      log('margin', margin, id, 'N', N, 'K', Number(r.K_1_m).toFixed(3), 'kWh_sp', Number(r.kWh_per_kg_sp).toFixed(2));
      save('tank_margin', { config: 'presets()[2] + env.tankMargin', rows });
    }
}

// -------------------------------------------------------------------------------------------------
// S7. კონფორმული მიობიუსის ღრეჩოს კონვენცია: მინ. დაშორება = 10 მმ  vs  მერიდიანული წანაცვლება = 10 მმ
// -------------------------------------------------------------------------------------------------
if (want('gap')) {
  const rows: Row[] = [];
  const g0 = cfg3.geometries.mobius;
  const tg = (0.5 * (g0.width / 2)) / (g0.radius - g0.width / 2);
  const stretch = Math.sqrt(1 + tg * tg);
  for (const N of [60, 90])
    for (const [id, gap, label] of [
      ['mobius_conformal_min10', g0.gap, 'კონფორმული მიობიუსი · მინ. დაშორება 10 მმ (ნაგულისხმევი)'],
      ['mobius_conformal_mer10', g0.gap / stretch, 'კონფორმული მიობიუსი · მერიდიანული წანაცვლება 10 მმ (მინ. ≈ 9.49 მმ)'],
      ['rings_conformal', g0.gap, 'კონფორმული რგოლი · 10 მმ'],
    ] as const) {
      const cfg: LabConfig = JSON.parse(JSON.stringify(cfg3));
      const kind = id === 'rings_conformal' ? 'rings' : 'mobius';
      cfg.geometries[kind].arrangement = 'conformal';
      cfg.geometries[kind].gap = gap;
      const r = fullRow(cfg, kind, id, label, N);
      rows.push(r);
      log('gap', id, 'N', N, 'K', Number(r.K_1_m).toFixed(4), 'dmin', Number(r.dmin_mm).toFixed(2), 'dmean', Number(r.dmean_mm).toFixed(2), 'Usp', Number(r.U_sp_V).toFixed(4));
      save('gap_convention', { stretch, rows });
    }
}

// -------------------------------------------------------------------------------------------------
// S8. სამუშაო წერტილის მგრძნობელობა (I) საკვანძო წყვილებისთვის — მეორადი ამოხსნა N = 60
// -------------------------------------------------------------------------------------------------
if (want('current')) {
  const rows: Record<string, unknown>[] = [];
  for (const id of ['plates_pair', 'plates_sandwich', 'rings_conformal', 'mobius_conformal']) {
    const c = byId(id);
    const cfg = applyCase(cfg3, c);
    const res = resolveGeometries(cfg)[c.kind];
    const cell = res.built.cell as Cell;
    const disc = discretize(cell, 60);
    const prim = solvePrimary(disc);
    for (const I of [1, 2, 5, 10]) {
      const cI: LabConfig = { ...cfg, electrical: { ...cfg.electrical, I } };
      const ev = evaluate(res, cI, prim.K);
      const sec = solveSecondary(disc, physFor(cI, cell), { mode: 'I', value: I }, prim.K, false, true);
      rows.push({ id, I, K: prim.K, U_lumped: ev.b!.U, kWh_lumped: ev.prod!.kwhPerKg, U_sp: sec.U, kWh_sp: kwhkg(sec.U, sec.I), jC: ev.b!.jC, converged: sec.converged, closure: sec.energy!.closure, utilC_kin: sec.utilC });
      log('current', id, I, 'Usp', sec.U.toFixed(4));
    }
    save('operating_point', { config: 'presets()[2] + electrical.I', N: 60, rows });
  }
}

// -------------------------------------------------------------------------------------------------
// S9. პარამეტრული მგრძნობელობა (ერთიანი მოდელი, K — N = 64-დან): kWh/kg-ის ცვლილება, %
// -------------------------------------------------------------------------------------------------
if (want('sens')) {
  const out: Record<string, unknown> = {};
  for (const [id, cfg, kind] of [
    ['mobius_default_stacked', cfg1, 'mobius'],
    ['plates_default', cfg1, 'plates'],
    ['mobius_conformal_equal_material', applyCase(cfg3, byId('mobius_conformal')), 'mobius'],
  ] as const) {
    const res = resolveGeometries(cfg)[kind];
    const cell = res.built.cell as Cell;
    const prim = solvePrimary(discretize(cell, 64));
    const m = modelFor(cell, cfg, prim.K);
    const metric = (mm: CellModel) => production(solveOperating(cfg.electrical.mode, targetValue(cfg), mm).b, mm, 3600).kwhPerKg;
    const base = metric(m);
    const eff = (mm: CellModel) => ((metric(mm) - base) / base) * 100;
    const rows = [
      { param: 'K (გეომეტრია)', low: '−20 %', high: '+20 %', dLow: eff({ ...m, K: m.K * 0.8 }), dHigh: eff({ ...m, K: m.K * 1.2 }) },
      { param: 'κ', low: '−20 %', high: '+20 %', dLow: eff({ ...m, kappa: m.kappa * 0.8 }), dHigh: eff({ ...m, kappa: m.kappa * 1.2 }) },
      { param: 'დასველებული ფართობი', low: '−20 %', high: '+20 %', dLow: eff({ ...m, areaA: m.areaA * 0.8, areaC: m.areaC * 0.8 }), dHigh: eff({ ...m, areaA: m.areaA * 1.2, areaC: m.areaC * 1.2 }) },
      { param: 'θ (ორივე)', low: '−0.10', high: '+0.10', dLow: eff({ ...m, thetaA: m.thetaA - 0.1, thetaC: m.thetaC - 0.1 }), dHigh: eff({ ...m, thetaA: m.thetaA + 0.1, thetaC: m.thetaC + 0.1 }) },
      { param: 'θ (ორივე)', low: '0.10 → 0', high: '0.10 → 0.45', dLow: eff({ ...m, thetaA: 0, thetaC: 0 }), dHigh: eff({ ...m, thetaA: 0.45, thetaC: 0.45 }) },
      { param: 'კათოდი j₀', low: '÷2', high: '×2', dLow: eff({ ...m, kinC: { ...m.kinC, j0: m.kinC.j0 / 2 } }), dHigh: eff({ ...m, kinC: { ...m.kinC, j0: m.kinC.j0 * 2 } }) },
      { param: 'ანოდი j₀', low: '÷2', high: '×2', dLow: eff({ ...m, kinA: { ...m.kinA, j0: m.kinA.j0 / 2 } }), dHigh: eff({ ...m, kinA: { ...m.kinA, j0: m.kinA.j0 * 2 } }) },
      { param: 'კათოდი α', low: '−20 %', high: '+20 %', dLow: eff({ ...m, kinC: { ...m.kinC, alphaF: m.kinC.alphaF * 0.8 } }), dHigh: eff({ ...m, kinC: { ...m.kinC, alphaF: m.kinC.alphaF * 1.2 } }) },
      { param: 'ანოდი α', low: '−20 %', high: '+20 %', dLow: eff({ ...m, kinA: { ...m.kinA, alphaF: m.kinA.alphaF * 0.8 } }), dHigh: eff({ ...m, kinA: { ...m.kinA, alphaF: m.kinA.alphaF * 1.2 } }) },
    ];
    out[id] = { baseline_kWh_per_kg: base, K: prim.K, mode: cfg.electrical.mode, target: targetValue(cfg), rows };
  }
  save('sensitivity', { model: 'ერთიანი (0D) მოდელი: physics.ts solveOperating/production; K — solvePrimary N = 64', cases: out });
  log('sens done');
}

// -------------------------------------------------------------------------------------------------
// S10. გეომეტრიული ფაქტები (ნაგულისხმევი ზომები) და კონტრელექტროდის ბმულობა
// -------------------------------------------------------------------------------------------------
if (want('geom')) {
  const env = defaultEnv();
  const facts: Record<string, unknown> = {};
  for (const kind of ['rings', 'mobius'] as const) {
    const geo = defaultGeometries();
    const p = geo[kind];
    const b = buildCell(kind, geo, env).cell as Cell;
    const g = { R: p.radius, w: p.width, t: p.thickness, n: p.halfTwists, th0: (p.phaseDeg * Math.PI) / 180 };
    const topo = surfaceTopology(bandMidSurface(g));
    facts[kind] = {
      params_mm: { R: p.radius * 1e3, w: p.width * 1e3, t: p.thickness * 1e3, n: p.halfTwists },
      cathode_area_cm2: b.areaC * 1e4,
      cathode_volume_cm3: b.volumeC * 1e6,
      pappus_volume_cm3: 2 * Math.PI * p.radius * p.width * p.thickness * 1e6,
      mid_area_cm2: bandMidArea(g) * 1e4,
      flat_strip_area_cm2: 2 * Math.PI * p.radius * p.width * 1e4,
      edge_stretch: bandEdgeStretch(g),
      mid_orientable: topo.orientable,
      mid_boundary_components: topo.boundaryComponents,
      solid_genus: b.reportC.genus,
    };
    const gc = defaultGeometries();
    gc[kind].arrangement = 'conformal';
    const bc = buildCell(kind, gc, env).cell as Cell;
    facts[kind + '_conformal_anode'] = { connected_components: bc.reportA.components, genus_total: bc.reportA.genus, closed: bc.reportA.closed, area_cm2: bc.areaA * 1e4, volume_cm3: bc.volumeA * 1e6, dmin_mm: bc.minDistance * 1e3, gap: gapStats(bc) };
  }
  // ლითონის წინაღობის შეფასება (მოდელში ლითონი ეკვიპოტენციურია): ρ(Ni, 20 °C) ≈ 6.93e-8 Ω·m
  // (ცნობარის მნიშვნელობა: https://knowledgedoor.com/2/elements_handbook/nickel.html)
  const rhoNi = 6.93e-8;
  const metal = (L: number, w: number, t: number, I: number) => (I * rhoNi * L) / (8 * w * t); // ერთწერტილიანი კონტაქტი, თანაბარი დენის აღება
  const c3 = resolveGeometries(applyCase(cfg3, byId('mobius_conformal'))).mobius;
  const R = c3.geo.mobius.radius,
    w = c3.geo.mobius.width,
    t = c3.geo.mobius.thickness;
  const Lc = 2 * Math.PI * R;
  facts.metal_resistance = {
    rho_ohm_m: rhoNi,
    formula: 'ΔV_max ≈ I·ρ·L / (8·w·t): რგოლური ზოლი ერთი კონტაქტით, დენი თანაბრად იკრიბება სიგრძეზე',
    scaled_dims_mm: { R: R * 1e3, w: w * 1e3, t: t * 1e3 },
    cathode_mV: metal(Lc, w, t, 5) * 1e3,
    mobius_conformal_anode_one_piece_mV: metal(2 * Lc, w, t, 5) * 1e3,
    ring_conformal_anode_two_pieces_mV: metal(Lc, w, t, 2.5) * 1e3,
  };
  save('geometry_facts', { facts });
  log('geom done');
}

// -------------------------------------------------------------------------------------------------
// S11. განმეორებადობა: შენახული ექსპერიმენტის სტრიქონების ხელახალი გამოთვლა
// -------------------------------------------------------------------------------------------------
if (want('repro')) {
  const stored = JSON.parse(readFileSync('experiments/exp3_equal_material.json', 'utf8'));
  const checks = [];
  for (const id of ['plates_pair', 'mobius_conformal']) {
    const c = byId(id);
    const fresh = fullRow(applyCase(cfg3, c), c.kind, c.id, c.label, stored.solver.N);
    const old = stored.rows.find((r: Row) => r.id === id);
    let worst = 0,
      worstKey = '';
    for (const k of Object.keys(fresh)) {
      const a = fresh[k],
        b = old[k];
      if (typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && b !== 0) {
        const d = Math.abs(a / b - 1);
        if (d > worst) {
          worst = d;
          worstKey = k;
        }
      }
    }
    checks.push({ id, N: stored.solver.N, maxRelDeviation: worst, worstKey });
    log('repro', id, worst.toExponential(2), worstKey);
  }
  save('reproducibility', { file: 'experiments/exp3_equal_material.json', checks });
}
// -------------------------------------------------------------------------------------------------
// S12. ადრინდელი ანგარიშის რიცხვების აღდგენა იმავე ბადეზე, რომელზეც ისინი მიღებული იყო (მეორადი ამოხსნა N = 48)
// -------------------------------------------------------------------------------------------------
if (want('legacy')) {
  const rows: Row[] = [];
  for (const id of ['plates_pair', 'plates_sandwich', 'rings_stacked', 'mobius_stacked', 'rings_conformal', 'mobius_conformal', 'klein']) {
    const c = byId(id);
    const r = fullRow(applyCase(cfg3, c), c.kind, 'exp3:' + id, c.label, 48);
    rows.push(r);
    log('legacy exp3', id, Number(r.kWh_per_kg_sp).toFixed(2));
  }
  rows.push(fullRow(cfg1, 'klein', 'exp1:klein', 'კლაინი (ექსპ. 1)', 48));
  rows.push(fullRow(cfg2, 'klein', 'exp2:klein', 'კლაინი (ექსპ. 2)', 48));
  save('legacy_n48', { note: 'ადრინდელი (აუდიტამდელი) ანგარიშის სივრცული რიცხვები მეორადი ამოხსნით N = 48-ზე იყო მიღებული; აქ ისინი ხელახლა არის გამოთვლილი', N: 48, rows });
}
log('audit-compute finished');
