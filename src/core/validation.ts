// ვალიდაციის შემოწმებები: ერთი და იგივე ფუნქციები გამოიყენება Vitest ტესტებშიც და აპლიკაციის „ვალიდაციის“ პანელშიც.
import { F, R_GAS, U_TN } from './constants';
import {
  CellModel,
  bvCurrent,
  eRev,
  eRevStd,
  kohConductivity,
  overpotential,
  production,
  solveOperating,
  tafelOverpotential,
  units,
  voltageAt,
} from './physics';
import { Cell, buildCell, defaultEnv, defaultGeometries } from './geometry/cell';
import { checkManifold, meshArea, meshVolume, surfaceTopology, BBox } from './geometry/mesh';
import { bandMidSurface, bandSolid, boxSolid, minDistance } from './geometry/solids';
import { kleinMath, kleinPhysical } from './geometry/klein';
import { discretize, solvePrimary, solveSecondary, convergenceStudy } from './solver/solver';
import { defaultConfig } from './lab';

export interface Check {
  id: string;
  group: 'ფიზიკა' | 'გეომეტრია' | 'ამომხსნელი';
  title: string;
  expected: string;
  actual: string;
  pass: boolean;
}

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

export function testModel(over: Partial<CellModel> = {}): CellModel {
  const c = defaultConfig();
  return {
    T: 298.15,
    p: 101325,
    kappa: 62,
    voidFraction: 0,
    areaA: 0.005,
    areaC: 0.005,
    roughness: 1,
    thetaA: 0,
    thetaC: 0,
    kinA: c.kinetics.anode,
    kinC: c.kinetics.cathode,
    K: 4,
    extraR: 0,
    faradaicH2: 1,
    faradaicO2: 1,
    ...over,
  };
}

export function physicsChecks(): Check[] {
  const out: Check[] = [];
  const add = (id: string, title: string, expected: string, actual: string, pass: boolean) =>
    out.push({ id, group: 'ფიზიკა', title, expected, actual, pass });
  const m = testModel();
  // 1. ფარადეის კანონი: 1 A, 1 სთ
  {
    const p = production(voltageAt(1, m), m, 3600);
    const exp = 3600 / (2 * F);
    add('faraday', 'ფარადეის კანონი: 1 A × 3600 s → n(H₂)', `${exp.toFixed(7)} mol`, `${p.molH2.toFixed(7)} mol`, rel(p.molH2, exp) < 1e-12);
    const vExp = (exp * R_GAS * 298.15) / 101325;
    add('volume', 'იდეალური აირი: V(H₂) 25 °C, 101 325 Pa', `${(vExp * 1000).toFixed(5)} L`, `${(p.volH2op * 1000).toFixed(5)} L`, rel(p.volH2op, vExp) < 1e-12);
    add('normal', 'ნორმალური მოცულობა (0 °C, 101 325 Pa): 22.414 L/mol', `${(exp * 22.41396954).toFixed(5)} Nl`, `${(p.volH2n * 1000).toFixed(5)} Nl`, rel(p.volH2n * 1000, exp * 22.41396954) < 1e-6);
    add('ratio', 'H₂ : O₂ მოლური თანაფარდობა 100 % ფარადეულ ეფექტიანობაზე', '2.000000', (p.molH2 / p.molO2).toFixed(6), rel(p.molH2 / p.molO2, 2) < 1e-12);
  }
  // 2. ერთნაირი დენი, სხვადასხვა ფართობი
  {
    const a = production(voltageAt(3, m), m, 600);
    const m2 = testModel({ areaA: 0.02, areaC: 0.013 });
    const b2 = voltageAt(3, m2);
    const b = production(b2, m2, 600);
    add('area-indep', 'ერთნაირი I და η_F, სხვადასხვა ფართობი → ერთნაირი H₂', `${a.molH2.toExponential(6)} mol`, `${b.molH2.toExponential(6)} mol`, a.molH2 === b.molH2);
    add('area-voltage', '…მაგრამ მეტი ფართობი → დაბალი ძაბვა (იცვლება ენერგია, არა H₂)', `U(დიდი ფართობი) < U(მცირე)`, `${b2.U.toFixed(4)} V < ${voltageAt(3, m).U.toFixed(4)} V`, b2.U < voltageAt(3, m).U);
  }
  // 3. ნულოვანი დენი
  {
    const p = production(voltageAt(0, m), m, 3600);
    add('zero', 'I = 0 → ნულოვანი წარმოება და სიმძლავრე', '0 mol, 0 W', `${p.molH2} mol, ${voltageAt(0, m).P} W`, p.molH2 === 0 && p.molO2 === 0 && voltageAt(0, m).P === 0);
    const op = solveOperating('U', 1.0, m);
    add('below-erev', 'U < E_rev → I = 0 (ფარული ჩანაცვლების გარეშე, შენიშვნით)', 'I = 0 + შენიშვნა', `I = ${op.b.I}, შენიშვნა: ${op.note ? 'კი' : 'არა'}`, op.b.I === 0 && !!op.note);
  }
  // 4. ერთეულები
  add('units', 'ერთეულები: 25 °C; 1 bar; 1000 A/m²; 1 m²', '298.15 K; 100000 Pa; 100 mA/cm²; 10000 cm²', `${units.cToK(25)} K; ${units.barToPa(1)} Pa; ${units.aM2ToMaCm2(1000)} mA/cm²; ${units.m2ToCm2(1)} cm²`, units.cToK(25) === 298.15 && units.barToPa(1) === 1e5 && units.aM2ToMaCm2(1000) === 100 && units.m2ToCm2(1) === 1e4);
  // 5. შექცევადი ძაბვა
  add('erev25', 'E_rev (25 °C, 1 atm)', '1.229 V ± 1 mV', `${eRevStd(298.15).toFixed(4)} V`, Math.abs(eRevStd(298.15) - 1.229) < 1e-3);
  add('erev200', 'E_rev კორელაციის საკონტროლო წერტილი (200 °C)', '1.088 V ± 2 mV', `${eRevStd(473.15).toFixed(4)} V`, Math.abs(eRevStd(473.15) - 1.088) < 2e-3);
  {
    const d = eRev(298.15, 10 * 101325) - eRev(298.15, 101325);
    const exp = ((3 * R_GAS * 298.15) / (4 * F)) * Math.log(10);
    add('nernst', 'ნერნსტის წნევის შესწორება 1 → 10 atm', `${(exp * 1000).toFixed(2)} mV`, `${(d * 1000).toFixed(2)} mV`, rel(d, exp) < 1e-12);
  }
  // 6. BV შებრუნება და ტაფელის ზღვარი
  {
    let worst = 0;
    for (const j of [1e-6, 1e-3, 0.1, 10, 1e3, 1e5]) {
      for (const k of [m.kinA, m.kinC]) worst = Math.max(worst, rel(bvCurrent(overpotential(j, k, 298.15), k, 298.15), j));
    }
    add('bv-inv', 'Butler–Volmer: j(η(j)) = j (6 დეკადაზე)', 'ფარდ. ცდომილება < 1e-9', worst.toExponential(2), worst < 1e-9);
    const j = 1e4 * m.kinC.j0;
    const d = Math.abs(overpotential(j, m.kinC, 298.15) - tafelOverpotential(j, m.kinC, 298.15));
    add('tafel', 'BV → ტაფელის ზღვარი (j = 10⁴·j₀)', '|Δη| < 0.1 mV', `${(d * 1000).toExponential(2)} mV`, d < 1e-4);
  }
  // 7. ენერგია
  {
    const mm = testModel();
    const b = { ...voltageAt(2, mm), U: U_TN, P: U_TN * 2 };
    const p = production(b, mm, 3600);
    add('hhv', 'U = 1.481 V, η_F = 1 → ენერგიის ხარჯი = HHV', '39.39 kWh/kg ± 0.05', `${p.kwhPerKg.toFixed(3)} kWh/kg`, Math.abs(p.kwhPerKg - 39.39) < 0.05);
    add('energy', 'E = U·I·t', `${((U_TN * 2 * 3600) / 3600).toFixed(4)} Wh`, `${p.energyWh.toFixed(4)} Wh`, rel(p.energyWh, U_TN * 2) < 1e-12);
  }
  // 8. რეჟიმების თანხვედრა
  {
    const b0 = voltageAt(2.5, m);
    const u = solveOperating('U', b0.U, m);
    const p = solveOperating('P', b0.P, m);
    add('modes', 'რეჟიმების თანხვედრა: U(I₀) და P(I₀) აბრუნებს I₀-ს', '2.500000 A', `${u.b.I.toFixed(6)} A; ${p.b.I.toFixed(6)} A`, rel(u.b.I, 2.5) < 1e-8 && rel(p.b.I, 2.5) < 1e-8);
  }
  // 9. KOH გამტარობა
  add('koh', 'KOH გამტარობა (Gilliam): 6.9 M, 80 °C', '138 S/m ± 2', `${kohConductivity(6.9, 353.15).toFixed(1)} S/m`, Math.abs(kohConductivity(6.9, 353.15) - 138) < 2);
  return out;
}

export function geometryChecks(): Check[] {
  const out: Check[] = [];
  const add = (id: string, title: string, expected: string, actual: string, pass: boolean) =>
    out.push({ id, group: 'გეომეტრია', title, expected, actual, pass });
  const cm2 = (a: number) => (a * 1e4).toFixed(4) + ' სმ²';
  const cm3 = (v: number) => (v * 1e6).toFixed(5) + ' სმ³';
  // ფირფიტა
  {
    const W = 0.05,
      H = 0.04,
      t = 0.002;
    const s = boxSolid([0, 0, 0], [t, W, H]);
    const A = 2 * (W * H + W * t + H * t);
    add('box-area', 'ფირფიტის ფართობი 2(WH+Wt+Ht)', cm2(A), cm2(s.area), rel(s.area, A) < 1e-12);
    add('box-vol', 'ფირფიტის მოცულობა W·H·t', cm3(W * H * t), cm3(s.volume), rel(s.volume, W * H * t) < 1e-12);
  }
  const R = 0.025,
    w = 0.02,
    t = 0.001;
  const ring = bandSolid({ R, w, t, n: 0, th0: Math.PI / 2, nu: 360 });
  const mob = bandSolid({ R, w, t, n: 1, th0: 0, nu: 360 });
  {
    const A = 4 * Math.PI * R * (w + t);
    add('ring-area', 'ცილინდრული რგოლის ფართობი 4πR(w+t)', cm2(A), cm2(ring.area), rel(ring.area, A) < 2e-4);
    const V = 2 * Math.PI * R * w * t;
    add('ring-vol', 'რგოლის მოცულობა 2πRwt', cm3(V), cm3(ring.volume), rel(ring.volume, V) < 2e-4);
    add('mob-vol', 'მიობიუსის სხეულის მოცულობა = 2πRwt (პაპუსი): გადაგრეხა მასალას არ ამატებს', cm3(V), cm3(mob.volume), rel(mob.volume, V) < 5e-4);
    const ratio = mob.area / ring.area;
    add('mob-area', 'მიობიუსის დასველებული ფართობი ≈ რგოლის ფართობი (არა ორმაგი)', 'ფარდობა 1.00 ± 0.03', ratio.toFixed(4), Math.abs(ratio - 1) < 0.03);
  }
  {
    const tr = surfaceTopology(bandMidSurface({ R, w, t, n: 0, th0: 0 }));
    const tm = surfaceTopology(bandMidSurface({ R, w, t, n: 1, th0: 0 }));
    const t2 = surfaceTopology(bandMidSurface({ R, w, t, n: 2, th0: 0 }));
    add('topo-ring', 'რგოლის შუა ზედაპირი', 'ორიენტირებადი, 2 საზღვარი, χ = 0', `${tr.orientable ? 'ორიენტირებადი' : 'არაორიენტირებადი'}, ${tr.boundaryComponents}, χ = ${tr.euler}`, tr.orientable && tr.boundaryComponents === 2 && tr.euler === 0);
    add('topo-mob', 'მიობიუსის შუა ზედაპირი', 'არაორიენტირებადი, 1 საზღვარი, χ = 0', `${tm.orientable ? 'ორიენტირებადი' : 'არაორიენტირებადი'}, ${tm.boundaryComponents}, χ = ${tm.euler}`, !tm.orientable && tm.boundaryComponents === 1 && tm.euler === 0);
    add('topo-2', 'ორი ნახევარბრუნი (სრული ბრუნი) — საკონტროლო', 'ორიენტირებადი, 2 საზღვარი', `${t2.orientable ? 'ორიენტირებადი' : 'არაორიენტირებადი'}, ${t2.boundaryComponents}`, t2.orientable && t2.boundaryComponents === 2);
    const rm = checkManifold(mob.mesh);
    add('mob-solid', 'მიობიუსის სასრული სისქის სხეული (ნაკერის ჩათვლით)', 'ჩაკეტილი, ორიენტირებული, 1 კომპონენტი, გვარი 1', `${rm.closed ? 'ჩაკეტილი' : 'ღია'}, ${rm.oriented ? 'ორიენტირებული' : 'არათანმიმდევრული'}, ${rm.components}, გვარი ${rm.genus}`, rm.closed && rm.oriented && rm.components === 1 && rm.genus === 1);
    const conf = bandSolid({ R, w, t, n: 1, th0: 0, off: 0.006 });
    const rc = checkManifold(conf.mesh);
    add('conformal', 'მიობიუსის კონფორმული კონტრელექტროდი (ორმაგი დაფარვა)', 'ერთი ჩაკეტილი ნაწილი, მოცულობა ≈ 2·2πRwt', `${rc.components} ნაწილი, ${rc.closed && rc.oriented ? 'ჩაკეტილი' : 'დეფექტური'}, ${cm3(conf.volume)}`, rc.closed && rc.oriented && rc.components === 1 && rel(conf.volume, 4 * Math.PI * R * w * t) < 2e-3);
  }
  // კლაინი
  {
    const g = { Rb: 0.018, neckRatio: 0.3, t: 0.001, clearance: 0.003 };
    const km = kleinMath(g);
    add('klein-math', 'კლაინის იმერსია (შუა ზედაპირი)', 'ჩაკეტილი, არაორიენტირებადი, χ = 0', `${km.topology.closed ? 'ჩაკეტილი' : 'საზღვრიანი'}, ${km.topology.orientable ? 'ორიენტირებადი' : 'არაორიენტირებადი'}, χ = ${km.topology.euler}`, km.topology.closed && !km.topology.orientable && km.topology.euler === 0 && km.topology.nonManifoldEdges === 0);
    const kp = kleinPhysical(g);
    add('klein-phys-mid', 'ფიზიკური მიახლოება (ფანჯრით): შუა ზედაპირი', 'არაორიენტირებადი, 1 საზღვარი, χ = −1', `${kp.midTopology.orientable ? 'ორიენტირებადი' : 'არაორიენტირებადი'}, ${kp.midTopology.boundaryComponents}, χ = ${kp.midTopology.euler}`, !kp.midTopology.orientable && kp.midTopology.boundaryComponents === 1 && kp.midTopology.euler === -1);
    const r = kp.solidReport;
    add('klein-solid', 'ფიზიკური მიახლოება: გასქელებული სხეული', 'ჩაკეტილი, ორიენტირებული, გვარი 2', `${r.closed ? 'ჩაკეტილი' : 'ღია'}, ${r.oriented ? 'ორიენტირებული' : 'არათანმიმდევრული'}, გვარი ${r.genus}`, r.closed && r.oriented && r.genus === 2 && r.components === 1);
    const vApprox = kp.midArea * g.t;
    add('klein-vol', 'გარსის მოცულობა ≈ შუა ზედაპირის ფართობი × სისქე', cm3(vApprox) + ' ± 3 %', cm3(kp.solid.volume), rel(kp.solid.volume, vApprox) < 0.03);
    add('klein-self', 'თვითგადაკვეთის გარეშე (კონსერვატიული თვითდაშორება > 0)', '> 0 მმ', `${(kp.selfClearance * 1000).toFixed(2)} მმ`, kp.selfClearance > 0);
    const kc = buildCell('klein', defaultGeometries(), defaultEnv()).cell as Cell;
    add('klein-dmin', 'კლაინის გარსსა და რკალურ ანოდს შორის მინიმალური დაშორება = მოცემული 10 მმ', '10.00 მმ ± 0.05', `${(kc.minDistance * 1000).toFixed(3)} მმ`, Math.abs(kc.minDistance - 0.01) < 5e-5);
  }
  // დაშორება და გადაკვეთა
  {
    const a = boxSolid([-0.0055, 0, 0], [0.001, 0.05, 0.05]);
    const b = boxSolid([0.0055, 0, 0], [0.001, 0.05, 0.05]);
    const d = minDistance(a, b);
    add('dist-plates', 'ფირფიტებს შორის მანძილი', '10.0000 მმ', `${(d * 1000).toFixed(4)} მმ`, Math.abs(d - 0.01) < 1e-9);
    const r1 = bandSolid({ R: 0.03, w, t, n: 0, th0: Math.PI / 2 });
    const r2 = bandSolid({ R: 0.02, w, t, n: 0, th0: Math.PI / 2 });
    const d2 = minDistance(r1, r2);
    add('dist-rings', 'კონცენტრულ რგოლებს შორის მანძილი (ΔR − t)', '9.000 მმ', `${(d2 * 1000).toFixed(3)} მმ`, Math.abs(d2 - 0.009) < 2e-5);
    const d3 = minDistance(mob, bandSolid({ R: R * 1.02, w, t, n: 1, th0: 0.3 }));
    add('overlap', 'გადაკვეთილი მიობიუსის ლენტების აღმოჩენა', 'უარყოფითი მანძილი', `${(d3 * 1000).toFixed(3)} მმ`, d3 < 0);
    const geo = defaultGeometries();
    geo.mobius.radius = 0.008;
    const bad = buildCell('mobius', geo, defaultEnv());
    add('self-x', 'თვითგადაკვეთის აკრძალვა: R ≤ კვეთის ნახევარდიაგონალი', 'შეცდომა, გეომეტრია არ აიგება', bad.cell ? 'აიგო' : 'უარყოფილია', !bad.cell && bad.errors.length > 0);
    const geo2 = defaultGeometries();
    geo2.mobius.placement.dz = -0.015;
    const hit = buildCell('mobius', geo2, defaultEnv());
    add('contact', 'ელექტროდების შეხების აკრძალვა (ანოდი გადაწეულია კათოდზე)', 'შეცდომა', hit.errors.length ? 'უარყოფილია' : 'დაშვებულია', hit.errors.length > 0);
  }
  return out;
}

/** 1D საკონტროლო უჯრედი: ფირფიტები ავზის მთელ კვეთას ავსებს → K = d/A ზუსტად. */
export function plates1D(N: number) {
  const W = 0.05,
    t = 0.001,
    d = 0.01;
  const geo = defaultGeometries();
  geo.plates = { ...geo.plates, width: W, height: W, thickness: t, gap: d };
  const built = buildCell('plates', geo, defaultEnv());
  const cell = built.cell as Cell;
  const tank: BBox = { min: [-(d / 2 + t), -W / 2, -W / 2], max: [d / 2 + t, W / 2, W / 2] };
  const disc = discretize(cell, N, tank, [W * W, W * W]);
  return { cell, disc, W, d, exactK: d / (W * W) };
}

export function solverChecks(): Check[] {
  const out: Check[] = [];
  const add = (id: string, title: string, expected: string, actual: string, pass: boolean) =>
    out.push({ id, group: 'ამომხსნელი', title, expected, actual, pass });
  // 1. 1D ფირფიტები
  const p1 = plates1D(20);
  const r1 = solvePrimary(p1.disc);
  add('k-1d', 'პარალელური ფირფიტები, 1D ზღვარი: K = d/A', `${p1.exactK.toFixed(5)} 1/m`, `${r1.K.toFixed(5)} 1/m`, rel(r1.K, p1.exactK) < 1e-6);
  add('balance', 'დენის ბალანსი |I_a − I_c|/I', '< 1e-6', r1.balance.toExponential(2), r1.balance < 1e-6);
  // 2. მეორადი განაწილება 1D-ში = ერთიანი მოდელი
  {
    const c = defaultConfig();
    const E = eRev(298.15, 101325);
    const A = p1.W * p1.W;
    const ph = { T: 298.15, eRev: E, kappaEff: 62, kinA: c.kinetics.anode, kinC: c.kinetics.cathode, mA: 0.9, mC: 0.9, extraR: 0, areaA: A, areaC: A };
    const s = solveSecondary(p1.disc, ph, { mode: 'I', value: 2 }, r1.K);
    add('sec-1d', 'მეორადი განაწილება 1D-ში ემთხვევა ერთიან მოდელს (I = 2 A)', `U = ${s.lumped.U.toFixed(5)} V`, `U = ${s.U.toFixed(5)} V (${s.iterations} იტერ.)`, s.converged && Math.abs(s.U - s.lumped.U) < 2e-5);
    const su = solveSecondary(p1.disc, ph, { mode: 'U', value: s.U }, r1.K);
    add('sec-u', 'მეორადი ამოხსნა ფიქსირებული U-ით აბრუნებს იმავე I-ს', '2.0000 A', `${su.I.toFixed(4)} A`, su.converged && rel(su.I, 2) < 1e-4);
    const sa = solveSecondary(p1.disc, ph, { mode: 'I', value: 2 }, r1.K, false, true);
    add('energy-1d', 'ენერგიის ბალანსი 1D-ში: (U − E_rev)·I = ჯოული + Σ I·η (დანაკარგი ორჯერ არ ითვლება)', '|შეუსაბამობა| < 1e-7', sa.energy!.closure.toExponential(1), Math.abs(sa.energy!.closure) < 1e-7);
  }
  // 2ბ. ენერგიის ბალანსი და ეკვივალენტური ფართობის იგივეობა 3D-ში (მიობიუსის წყვილი)
  {
    const c = defaultConfig();
    const cell = buildCell('mobius', defaultGeometries(), defaultEnv()).cell as Cell;
    const disc = discretize(cell, 36);
    const pr = solvePrimary(disc);
    const ph = { T: 298.15, eRev: eRev(298.15, 101325), kappaEff: 62, kinA: c.kinetics.anode, kinC: c.kinetics.cathode, mA: 0.9, mC: 0.9, extraR: 0, areaA: cell.areaA, areaC: cell.areaC };
    const s = solveSecondary(disc, ph, { mode: 'I', value: 5 }, pr.K, false, true);
    const en = s.energy!;
    add('energy-3d', 'ენერგიის ბალანსი 3D-ში (მიობიუსი, I = 5 A)', '|შეუსაბამობა| < 1e-6', en.closure.toExponential(1), s.converged && Math.abs(en.closure) < 1e-6);
    add('ohmic-3d', 'ანგარიშის „ომური“ წევრი = ველიდან დათვლილი ჯოულის სითბო', 'ფარდ. სხვაობა < 1e-6', rel(en.reportedOhmicW, en.jouleBulkW + en.jouleLinksW).toExponential(1), rel(en.reportedOhmicW, en.jouleBulkW + en.jouleLinksW) < 1e-6);
    add('util-identity', 'ეკვივალენტური ფართობის წილი = exp(−Σ (a/A)·x·ln x) (ტაფელის არე)', '|სხვაობა| < 0.005', Math.abs(s.utilC - s.measuresC!.entropyUtil).toExponential(1), Math.abs(s.utilC - s.measuresC!.entropyUtil) < 0.005);
    add('pocket-open', 'ღია გეომეტრია (მიობიუსის წყვილი): ჰიდროსტატიკური ჯიბე არ არსებობს', '0 სმ³', `${(pr.traps.pocketVolume * 1e6).toFixed(3)} სმ³`, pr.traps.pocketVolume === 0);
  }
  // 3. კონცენტრული ცილინდრები
  {
    const h = 0.0015;
    const geo = defaultGeometries();
    const wz = 14 * h;
    const tt = 0.002;
    const cath = bandSolid({ R: 0.015, w: wz, t: tt, n: 0, th0: Math.PI / 2 });
    const an = bandSolid({ R: 0.03, w: wz, t: tt, n: 0, th0: Math.PI / 2 });
    const base = buildCell('rings', geo, defaultEnv()).cell as Cell;
    const cell: Cell = { ...base, cathode: cath, anode: an, areaA: an.area, areaC: cath.area, minDistance: 0.013 };
    const half = 22 * h;
    const tank: BBox = { min: [-half, -half, -wz / 2], max: [half, half, wz / 2] };
    const r = solvePrimary(discretize(cell, 44, tank));
    const exact = Math.log(0.029 / 0.016) / (2 * Math.PI * wz);
    add('k-cyl', 'კონცენტრული ცილინდრები: K = ln(r₂/r₁)/(2πL)', `${exact.toFixed(4)} 1/m ± 3 %`, `${r.K.toFixed(4)} 1/m (${(rel(r.K, exact) * 100).toFixed(2)} %)`, rel(r.K, exact) < 0.03);
  }
  // 4. ბადის კრებადობა მიობიუსის წყვილზე
  {
    const cell = buildCell('mobius', defaultGeometries(), defaultEnv()).cell as Cell;
    const rows = convergenceStudy(cell, [24, 36, 54]);
    const d1 = Math.abs(rows[1].K - rows[0].K) / rows[1].K;
    const d2 = Math.abs(rows[2].K - rows[1].K) / rows[2].K;
    add('conv', 'ბადის კრებადობა (მიობიუსი, N = 24 → 36 → 54): K-ის ცვლილება', 'ბოლო ცვლილება < 5 %', `${(d1 * 100).toFixed(2)} % → ${(d2 * 100).toFixed(2)} %`, d2 < 0.05);
    const worstBal = Math.max(...rows.map((r) => r.balance));
    add('conv-bal', 'დენის ბალანსი ყველა ბადეზე', '< 1e-6', worstBal.toExponential(2), worstBal < 1e-6);
  }
  return out;
}
