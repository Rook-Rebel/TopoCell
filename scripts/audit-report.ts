// აუდიტის ანგარიშის გენერატორი: კითხულობს მხოლოდ experiments/*.json და experiments/audit/*.json ფაილებს
// (არცერთი რიცხვი ხელით არ არის ჩაწერილი) და წერს AUDIT.md-ს, CSV ცხრილებს და README-ის კვლევით შეჯამებას.
// გაშვება: npm run audit:report      (სწრაფი დათვალიერება: tsx scripts/audit-report.ts --dump)
import { readFileSync, writeFileSync } from 'node:fs';
import { Row, csvOf, e, f } from './lib';

const J = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const E1 = J('experiments/exp1_same_current.json');
const E2 = J('experiments/exp2_same_power.json');
const E3 = J('experiments/exp3_equal_material.json');
const A = (n: string) => J(`experiments/audit/${n}.json`);
const GRID = A('grid');
const TOL = A('solver_tolerance');
const UTIL = A('utilization');
const TWIST = A('twist');
const GAS = A('gas_pocket');
const MARGIN = A('tank_margin');
const GAP = A('gap_convention');
const OP = A('operating_point');
const SENS = A('sensitivity');
const GEOM = A('geometry_facts');
const REPRO = A('reproducibility');
const LEGACY = A('legacy_n48');
const LG = (id: string): Row => (LEGACY.rows as Row[]).find((r) => r.id === id) as Row;
let TESTS: { numPassedTests: number; numTotalTests: number; numFailedTests: number } | null = null;
try {
  TESTS = J('experiments/audit/tests.json');
} catch {
  /* ტესტების ფაილი არასავალდებულოა */
}

const rowOf = (file: { rows: Row[] }, id: string): Row => file.rows.find((r) => r.id === id) as Row;
const n = (r: Row, k: string): number => r[k] as number;
const pct = (a: number, b: number) => ((a - b) / b) * 100;
const sgn = (v: number, d = 2) => (Number.isFinite(v) ? (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d) : '—');
const table = (head: string[], rows: string[][]) => `| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|\n${rows.map((r) => `| ${r.join(' | ')} |`).join('\n')}\n`;

// ---------------------------------------------------------------------------------------------
// წარმომავლობის ჟურნალი
// ---------------------------------------------------------------------------------------------
type Cat = 'გამოთვლილი' | 'დაშვება' | 'ჰიპოთეზა' | 'ინტერპრეტაცია';
interface Claim {
  text: string;
  value: string;
  src: string;
  fn: string;
  cat: Cat;
}
const ledger: Claim[] = [];
const claim = (text: string, value: string, src: string, fn: string, cat: Cat = 'გამოთვლილი') => {
  ledger.push({ text, value, src, fn, cat });
  return value;
};
const FN = {
  prod: 'physics.ts: production',
  volt: 'physics.ts: voltageAt ← lab.ts: evaluate',
  prim: 'solver.ts: solvePrimary',
  sec: 'solver.ts: solveSecondary',
  meas: 'solver.ts: distMeasures',
  trap: 'solver.ts: analyzeTraps',
  mesh: 'mesh.ts: meshArea / meshVolume',
  dist: 'solids.ts: minDistance',
  gap: 'scripts/lib.ts: gapStats',
  topo: 'mesh.ts: surfaceTopology / checkManifold',
  env: 'cell.ts: finalize',
  norm: 'lab.ts: resolveGeometries',
};

// ---------------------------------------------------------------------------------------------
// ბადის კრებადობის დამხმარეები
// ---------------------------------------------------------------------------------------------
interface GRow {
  N: number;
  [k: string]: number | boolean | undefined;
}
const gcase = (id: string): GRow[] => GRID.cases[id];
const gser = (id: string, key: string) => gcase(id).filter((r) => typeof r[key] === 'number').map((r) => ({ N: r.N, v: r[key] as number }));
interface Conv {
  fine: number;
  range3: number; // max |Q_i − Q_fine| ბოლო სამ დონეზე
  monotone: boolean;
  p: number;
  rich: number;
  gci: number;
}
function conv(vals: number[], ratio = 1.5): Conv {
  const v = vals.slice(-3);
  const fine = v[2];
  const d21 = v[1] - v[0],
    d32 = v[2] - v[1];
  const range3 = Math.max(Math.abs(v[0] - fine), Math.abs(v[1] - fine));
  const monotone = d21 * d32 > 0 && Math.abs(d32) < Math.abs(d21);
  let p = NaN,
    rich = NaN,
    gci = NaN;
  if (monotone) {
    p = Math.log(Math.abs(d21 / d32)) / Math.log(ratio);
    rich = fine + d32 / (ratio ** p - 1);
    gci = 1.25 * Math.abs(d32 / (ratio ** p - 1));
  }
  return { fine, range3, monotone, p, rich, gci };
}

const GRID_IDS: [string, string][] = [
  ['plates_pair', 'ფირფიტების წყვილი'],
  ['plates_sandwich', 'ფირფიტების სენდვიჩი'],
  ['rings_stacked', 'რგოლები, ერთმანეთის თავზე'],
  ['mobius_stacked', 'მიობიუსი, ერთმანეთის თავზე'],
  ['rings_conformal', 'კონფორმული რგოლი'],
  ['mobius_conformal', 'კონფორმული მიობიუსი'],
  ['klein', 'კლაინი'],
];
const NAME: Record<string, string> = Object.fromEntries(GRID_IDS);
const levels: number[] = GRID.levelsPrim;
const levelsSec: number[] = GRID.levelsSec;
const fineN = levelsSec[levelsSec.length - 1];

if (process.argv.includes('--dump')) {
  for (const [id, name] of GRID_IDS) {
    const K = gser(id, 'K'),
      U = gser(id, 'U_sp'),
      kw = gser(id, 'kWh_sp');
    const cK = conv(K.map((x) => x.v)),
      cU = conv(U.map((x) => x.v));
    console.log(name.padEnd(28), 'K', K.map((x) => x.v.toFixed(4)).join(' '), `| range3 ${((cK.range3 / cK.fine) * 100).toFixed(2)}% mono=${cK.monotone} p=${f(cK.p, 2)}`, '| Usp', U.map((x) => x.v.toFixed(4)).join(' '), `range3 ${(cU.range3 * 1e3).toFixed(1)}mV mono=${cU.monotone}`, '| kWh', kw.map((x) => x.v.toFixed(2)).join(' '));
  }
  for (const [a, b] of [
    ['plates_pair', 'mobius_conformal'],
    ['plates_sandwich', 'mobius_conformal'],
    ['rings_conformal', 'mobius_conformal'],
    ['rings_stacked', 'mobius_stacked'],
  ]) {
    const ka = gser(a, 'kWh_sp'),
      kb = gser(b, 'kWh_sp');
    console.log(a, '→', b, 'ΔkWh_sp %:', ka.map((x, i) => `${x.N}:${pct(kb[i].v, x.v).toFixed(3)}`).join(' '), '| ΔK %:', gser(a, 'K').map((x, i) => `${x.N}:${pct(gser(b, 'K')[i].v, x.v).toFixed(2)}`).join(' '));
  }
  console.log('\nGAP');
  for (const r of GAP.rows as Row[]) console.log(String(r.id).padEnd(26), 'N', r.N, `dmin=${f(r.dmin_mm, 2)} dmean=${f(r.dmean_mm, 2)} K=${f(r.K_1_m, 4)} Usp=${f(r.U_sp_V, 4)} kWh_sp=${f(r.kWh_per_kg_sp, 3)} Ac=${f(r.areaC_cm2, 2)} Aa=${f(r.areaA_cm2, 2)} mat=${f(r.material_cm3, 3)}`);
  console.log('\nMARGIN');
  for (const r of MARGIN.rows as Row[]) console.log(r.margin_mm, String(r.id).padEnd(18), 'N', r.N, `h=${f(r.h_mm, 2)} K=${f(r.K_1_m, 3)} U=${f(r.U_V, 4)} Usp=${f(r.U_sp_V, 4)} kWh_sp=${f(r.kWh_per_kg_sp, 2)}`);
  console.log('\nOP');
  for (const r of OP.rows) console.log(r.id.padEnd(18), 'I', r.I, `U=${r.U_lumped.toFixed(4)} Usp=${r.U_sp.toFixed(4)} kWh_sp=${r.kWh_sp.toFixed(2)} util=${r.utilC_kin.toFixed(3)} conv=${r.converged}`);
  console.log('\nE rows');
  for (const E of [E1, E2, E3]) for (const r of E.rows as Row[]) console.log(String(r.id).padEnd(18), r.valid ? `I=${f(r.I_A, 3)} U=${f(r.U_V, 4)} P=${f(r.P_W, 3)} nH2=${f(r.nH2_mmol_h, 3)} Isp=${f(r.I_sp_A, 3)} Usp=${f(r.U_sp_V, 4)} kWhsp=${f(r.kWh_per_kg_sp, 2)} Ac=${f(r.areaC_cm2, 1)} Aa=${f(r.areaA_cm2, 1)} mat=${f(r.material_cm3, 4)} dmin=${f(r.dmin_mm, 2)} dmean=${f(r.dmean_mm, 1)} env=${f(r.envelope_cm3, 0)} util=${f(r.utilC_kin, 3)} shadowP=${f(r.shadowC_primary, 3)} trap=${f(r.trapAreaC, 3)} pocket=${f(r.pocketAreaC, 3)} clos=${e(r.energy_closure)}` : 'INVALID');
  process.exit(0);
}

// =============================================================================================
// ანგარიში
// =============================================================================================
const R3 = (id: string) => rowOf(E3, id);
const R1 = (id: string) => rowOf(E1, id);
const R2 = (id: string) => rowOf(E2, id);
const TW = (id: string) => rowOf(TWIST, id);
const N3: number = E3.solver.N;
const src3 = (id: string, col: string) => `exp3_equal_material.json → rows[${id}].${col}`;
const src1 = (id: string, col: string) => `exp1_same_current.json → rows[${id}].${col}`;
const src2 = (id: string, col: string) => `exp2_same_power.json → rows[${id}].${col}`;
const srcA = (file: string, path: string) => `audit/${file}.json → ${path}`;
const valid3 = (E3.rows as Row[]).filter((r) => r.valid);

// ---- §6 რიცხვები ----
const convK = Object.fromEntries(GRID_IDS.map(([id]) => [id, conv(gser(id, 'K').map((x) => x.v))]));
const convU = Object.fromEntries(GRID_IDS.map(([id]) => [id, conv(gser(id, 'U_sp').map((x) => x.v))]));
const convKw = Object.fromEntries(GRID_IDS.map(([id]) => [id, conv(gser(id, 'kWh_sp').map((x) => x.v))]));
const allG: GRow[] = GRID_IDS.flatMap(([id]) => gcase(id));
const maxOf = (key: string) => Math.max(...allG.filter((r) => typeof r[key] === 'number').map((r) => Math.abs(r[key] as number)));
const worstKrange = Math.max(...GRID_IDS.map(([id]) => (convK[id].range3 / convK[id].fine) * 100));
const worstUrange = Math.max(...GRID_IDS.map(([id]) => convU[id].range3 * 1e3));

interface Pair {
  a: string;
  b: string;
  dPct: { N: number; v: number }[]; // (kWh_b − kWh_a)/kWh_a, %
  dU: { N: number; v: number }[]; // U_b − U_a, mV
  fine: number;
  range3: number;
  fineU: number;
  rangeU: number;
  resolved: boolean;
}
function pair(a: string, b: string): Pair {
  const ka = gser(a, 'kWh_sp'),
    kb = gser(b, 'kWh_sp'),
    ua = gser(a, 'U_sp'),
    ub = gser(b, 'U_sp');
  const dPct = ka.map((x, i) => ({ N: x.N, v: pct(kb[i].v, x.v) }));
  const dU = ua.map((x, i) => ({ N: x.N, v: (ub[i].v - x.v) * 1e3 }));
  const c = conv(dPct.map((x) => x.v)),
    cu = conv(dU.map((x) => x.v));
  return { a, b, dPct, dU, fine: c.fine, range3: c.range3, fineU: cu.fine, rangeU: cu.range3, resolved: Math.abs(c.fine) > 2 * c.range3 };
}
const P_plates_mob = pair('plates_pair', 'mobius_conformal');
const P_sand_mob = pair('plates_sandwich', 'mobius_conformal');
const P_ring_mob = pair('rings_conformal', 'mobius_conformal');
const P_stack = pair('rings_stacked', 'mobius_stacked');
const P_plates_ring = pair('plates_pair', 'rings_conformal');

// ---- §3/§7 დამხმარე რიცხვები ----
const marginRows = MARGIN.rows as Row[];
const margins = [...new Set(marginRows.map((r) => n(r, 'margin_mm')))];
const mrow = (m: number, id: string) => marginRows.find((r) => r.margin_mm === m && r.id === id) as Row;
const savingAt = (m: number) => -pct(n(mrow(m, 'mobius_conformal'), 'kWh_per_kg_sp'), n(mrow(m, 'plates_pair'), 'kWh_per_kg_sp'));
const ringMobAt = (m: number) => (n(mrow(m, 'mobius_conformal'), 'U_sp_V') - n(mrow(m, 'rings_conformal'), 'U_sp_V')) * 1e3;
const opRows = OP.rows as { id: string; I: number; U_sp: number; kWh_sp: number; U_lumped: number; kWh_lumped: number; utilC_kin: number }[];
const currents = [...new Set(opRows.map((r) => r.I))];
const op = (I: number, id: string) => opRows.find((r) => r.I === I && r.id === id)!;
const savingI = (I: number) => -pct(op(I, 'mobius_conformal').kWh_sp, op(I, 'plates_pair').kWh_sp);
const gapRows = GAP.rows as Row[];
const gapFineN = Math.max(...gapRows.map((r) => n(r, 'N')));
const grow = (id: string, N = gapFineN) => gapRows.find((r) => r.id === id && r.N === N) as Row;
const gapEffect_mV = (n(grow('mobius_conformal_mer10'), 'U_sp_V') - n(grow('mobius_conformal_min10'), 'U_sp_V')) * 1e3;
const metal = GEOM.facts.metal_resistance;
const metalDiff = metal.mobius_conformal_anode_one_piece_mV - metal.ring_conformal_anode_two_pieces_mV;
const saving64 = -pct(n(R3('mobius_conformal'), 'kWh_per_kg_sp'), n(R3('plates_pair'), 'kWh_per_kg_sp'));
const savingSand64 = -pct(n(R3('mobius_conformal'), 'kWh_per_kg_sp'), n(R3('plates_sandwich'), 'kWh_per_kg_sp'));
const savMin = Math.min(...margins.map(savingAt), ...currents.map(savingI), ...P_plates_mob.dPct.map((x) => -x.v));
const savMax = Math.max(...margins.map(savingAt), ...currents.map(savingI), ...P_plates_mob.dPct.map((x) => -x.v));

// ---- კლაინის მაჩვენებლები ----
interface URow {
  N: number;
  utilC_kin: number;
  I: number;
  lambda: number;
  secondary: { C: { entropyUtil: number; participation: number; thresholds: number[]; areaAbove: number[]; currentAbove: number[] } };
  primary: { C: { entropyUtil: number; participation: number; areaAbove: number[]; currentAbove: number[] }; shadowC: number };
}
const U = (id: string): { label: string; rows: URow[] } => UTIL.variants[id];
const kleinIds = ['klein_exp1', 'klein_exp2', 'klein_exp3'];
const kUtil = kleinIds.map((id) => U(id).rows.map((r) => r.utilC_kin));
const kUtilAll = kUtil.flat();
const kFine = kleinIds.map((id) => U(id).rows[U(id).rows.length - 1]);
const TH: number[] = kFine[0].secondary.C.thresholds;
const gas1 = GAS.variants.klein_exp1;
const gasRows1 = gas1.rows as { N: number; h_mm: number; clearance_cells: number; noVent: { volume_cm3: number; areaC: number; regions_cm3: Record<string, number> }; pocket: { volume_cm3: number; areaC: number; spillZ_mm: number; zmin_mm: number; zmax_mm: number; regions_cm3: Record<string, number> } }[];
const gFine = gasRows1[gasRows1.length - 1];
const pocketAreaRange = [Math.min(...gasRows1.map((r) => r.pocket.areaC)), Math.max(...gasRows1.map((r) => r.pocket.areaC))];
const noVentAreaRange = [Math.min(...gasRows1.map((r) => r.noVent.areaC)), Math.max(...gasRows1.map((r) => r.noVent.areaC))];

const md: string[] = [];
const P = (s: string) => md.push(s + '\n');

P(`# TopoCell — შედეგების სამეცნიერო აუდიტი`);
P(`**საკვლევი იდეის ავტორი:** ალექსანდრე გაგანაშვილი`);
P(
  `ეს ანგარიში გენერირებულია სკრიპტით \`scripts/audit-report.ts\` ექსპერიმენტების ფაილებიდან (\`experiments/*.json\`, \`experiments/audit/*.json\`). ტექსტში არცერთი რიცხვი ხელით არ არის ჩაწერილი: ყოველი მნიშვნელობა ფაილიდან იკითხება, ხოლო წყარო §1-ის ცხრილშია. ხელახალი გამოთვლა: \`npm run experiments\`, შემდეგ \`npm run audit\`.`,
);
P(
  `ყველა შედეგი ეკუთვნის **ერთ პარამეტრთა ნაკრებს** (25 °C, 1.013 bar, κ = ${E3.baseConfig.electrolyte.kappa} S/m, j₀ და α — საილუსტრაციო, θ = ${E3.baseConfig.surface.thetaA}, სისქე 1 მმ, მინიმალური დაშორება 10 მმ, ავზის მარაგი ${E3.baseConfig.env.tankMargin * 1e3} მმ), თუ სხვა რამ არ არის მითითებული. ეს მოდელის შედეგებია და არა მოწყობილობის პროგნოზი.`,
);

// =============================================================================================
// §0
// =============================================================================================
const sec0: string[] = [];
// (ივსება ქვემოთ, როცა ყველა რიცხვი ცნობილია)

// =============================================================================================
// §3 ფრაზების გადამოწმება
// =============================================================================================
const k0s = n(TW('n0_stacked'), 'K_1_m'),
  k1s = n(TW('n1_stacked'), 'K_1_m'),
  k2s = n(TW('n2_stacked'), 'K_1_m'),
  k3s = n(TW('n3_stacked'), 'K_1_m'),
  k0s90 = n(TW('n0_ph90_stacked'), 'K_1_m'),
  k0s45 = n(TW('n0_ph45_stacked'), 'K_1_m');
const k0d = n(TW('n0_side'), 'K_1_m'),
  k1d = n(TW('n1_side'), 'K_1_m'),
  k0d90 = n(TW('n0_ph90_side'), 'K_1_m');
const k0c = n(TW('n0_conformal'), 'K_1_m'),
  k1c = n(TW('n1_conformal'), 'K_1_m');
const twRows = (TWIST.rows as Row[]).filter((r) => r.valid);
const twComparable = twRows.filter((r) => Math.abs(n(r, 'material_cm3') - n(TW('n0_stacked'), 'material_cm3')) < 1e-3 * n(TW('n0_stacked'), 'material_cm3'));
// სპირმენის რანგობრივი კორელაცია K-სა და საშუალო დაშორებას შორის (შესადარ სტრიქონებზე)
function spearman(xs: number[], ys: number[]): number {
  const rank = (v: number[]) => {
    const o = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(v.length);
    o.forEach(([, i], k) => (r[i] = k + 1));
    return r as number[];
  };
  const rx = rank(xs),
    ry = rank(ys);
  const m = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const mx = m(rx),
    my = m(ry);
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (let i = 0; i < rx.length; i++) {
    sxy += (rx[i] - mx) * (ry[i] - my);
    sxx += (rx[i] - mx) ** 2;
    syy += (ry[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}
const rho = spearman(
  twComparable.map((r) => n(r, 'dmean_mm')),
  twComparable.map((r) => n(r, 'K_1_m')),
);
const gapCtl = TWIST.rows.find((r: Row) => r.id === 'n0_stacked_gap22') as Row | undefined;
const gap2 = TWIST.rows.find((r: Row) => r.id === 'n1_stacked_gap2') as Row | undefined;

const geo = (s: string) => s.replace('stacked', 'ერთმანეთის თავზე').replace('side', 'გვერდიგვერდ').replace('conformal', 'კონფორმული');
const twistTable = table(
  ['შემთხვევა', 'λ', 'A კათ. / ან., სმ²', 'მასალა, სმ³', 'd მინ., მმ', 'd საშ. (p10–p90), მმ', 'K, 1/m', 'U ერთიანი, V', 'U სივრც., V', 'kWh/kg სივრც.', 'შენიშვნა'],
  (TWIST.rows as Row[]).map((r) =>
    r.valid
      ? [
          geo(String(r.label)),
          f(r.lambda, 3),
          `${f(r.areaC_cm2, 1)} / ${f(r.areaA_cm2, 1)}`,
          f(r.material_cm3, 3),
          f(r.dmin_mm, 2),
          `${f(r.dmean_mm, 1)} (${f(r.dp10_mm, 1)}–${f(r.dp90_mm, 1)})`,
          f(r.K_1_m, 3),
          f(r.U_V, 4),
          f(r.U_sp_V, 4),
          f(r.kWh_per_kg_sp, 2),
          Math.abs(n(r, 'material_cm3') - n(TW('n0_stacked'), 'material_cm3')) > 0.005 ? '**მასალა არ არის გათანაბრებული** (ნორმალიზება მიუღწეველია) — შედარებაში არ მონაწილეობს' : '',
        ]
      : [geo(String(r.label)), '—', '—', '—', '—', '—', '—', '—', '—', '—', 'დაუშვებელი: ' + r.note],
  ),
);

// =============================================================================================
// აწყობა
// =============================================================================================
const sec3: string[] = [];
sec3.push(`## 3. ოთხი ფრაზის გადამოწმება\n`);
sec3.push(`### 3.1 „გადაგრეხა თავისთავად აუარესებს“ — **არ დასტურდება ამ ზოგადი ფორმით; შეცვლილია**\n`);
sec3.push(
  `ადრინდელი მტკიცება ეყრდნობოდა ერთ წყვილს: მიობიუსი (n = 1) და ბრტყელი რგოლი (n = 0, θ₀ = 0°), ორივე „ერთმანეთის თავზე“. აუდიტისთვის დაემატა საკონტროლო შემთხვევები (ფაილი \`experiments/audit/twist.json\`; I = 5 A, ერთნაირი მასალა, N = ${TWIST.N}; „d საშ.“ — კათოდის ზედაპირიდან ანოდამდე მანძილის ფართობით შეწონილი საშუალო):\n`,
);
sec3.push(twistTable);
sec3.push(`რას აჩვენებს ცხრილი (ყველაფერი — უშუალოდ გამოთვლილი):\n`);
sec3.push(
  `- **ერთმანეთის თავზე:** გადაგრეხილი ლენტების K = ${claim('K, n = 1 / 2 / 3, ერთმანეთის თავზე', `${f(k1s, 2)} / ${f(k2s, 2)} / ${f(k3s, 2)} 1/m`, srcA('twist', 'rows[n1_stacked|n2_stacked|n3_stacked].K_1_m'), FN.prim)}, ბრტყელი რგოლისა (θ₀ = 0°) — ${claim('K, n = 0, θ₀ = 0°, ერთმანეთის თავზე', `${f(k0s, 2)} 1/m`, srcA('twist', 'rows[n0_stacked].K_1_m'), FN.prim)}. მაგრამ **გადაუგრეხავი** ცილინდრული რგოლი (n = 0, θ₀ = 90°) იმავე განლაგებაში იძლევა K = ${claim('K, n = 0, θ₀ = 90°, ერთმანეთის თავზე', `${f(k0s90, 2)} 1/m`, srcA('twist', 'rows[n0_ph90_stacked].K_1_m'), FN.prim)} — ანუ იმდენსავე, რამდენსაც მიობიუსი; θ₀ = 45°-ზე K = ${f(k0s45, 2)}. ორიენტირებადი n = 2 და არაორიენტირებადი n = 1 ერთმანეთისგან ${f(Math.abs(pct(k2s, k1s)), 1)} %-ით განსხვავდება.`,
);
sec3.push(
  `- **გვერდიგვერდ:** აქ გადაგრეხა ბრტყელ რგოლთან შედარებით **აუმჯობესებს**: K = ${claim('K, n = 1 / n = 0 (θ₀ = 0°), გვერდიგვერდ', `${f(k1d, 2)} / ${f(k0d, 2)} 1/m`, srcA('twist', 'rows[n1_side|n0_side].K_1_m'), FN.prim)}; გადაუგრეხავი ცილინდრული რგოლი კიდევ უკეთესია (${f(k0d90, 2)}).`,
);
const kRz = ['n1_rz90_stacked', 'n1_rz180_stacked', 'n1_rz270_stacked'].map((id) => n(TW(id), 'K_1_m'));
sec3.push(
  `- **ფარდობითი მობრუნება:** მიობიუსის ანოდის z ღერძზე მობრუნება (90°, 180°, 270°) იმავე „ერთმანეთის თავზე“ განლაგებაში იძლევა K = ${claim('K, n = 1, ანოდი მობრუნებულია 90° / 180° / 270°', kRz.map((v) => f(v, 2)).join(' / ') + ' 1/m', srcA('twist', 'rows[n1_rz{90,180,270}_stacked].K_1_m'), FN.prim)} (მობრუნების გარეშე ${f(k1s, 2)}) — ანუ იმავე ფორმის ორი ლენტის ურთიერთორიენტაცია K-ს ${f((1 - Math.min(...kRz) / k1s) * 100, 0)} %-მდე ცვლის.`,
);
sec3.push(
  `- **კონფორმული:** n = 0 და n = 1: K = ${claim('K, კონფორმული n = 0 / n = 1', `${f(k0c, 3)} / ${f(k1c, 3)} 1/m`, srcA('twist', 'rows[n0_conformal|n1_conformal].K_1_m'), FN.prim)}; სივრცული ძაბვა ${f(n(TW('n0_conformal'), 'U_sp_V'), 4)} და ${f(n(TW('n1_conformal'), 'U_sp_V'), 4)} V (სხვაობა გარჩევადი არ არის — იხ. §7.2).`,
);
sec3.push(
  `- **რა ხსნის სხვაობას:** მინიმალური დაშორება ყველგან 10 მმ-ია, მაგრამ საშუალო დაშორება განსხვავდება — მაგ. ${f(n(TW('n0_stacked'), 'dmean_mm'), 1)} მმ ბრტყელი რგოლებისთვის და ${f(n(TW('n1_stacked'), 'dmean_mm'), 1)} მმ მიობიუსისთვის (ერთმანეთის თავზე). შესადარ სტრიქონებზე K-სა და საშუალო დაშორებას შორის სპირმენის რანგობრივი კორელაცია ρ = ${claim('სპირმენის ρ (K, საშუალო დაშორება)', f(rho, 2), srcA('twist', 'rows[*].{K_1_m, dmean_mm} (მხოლოდ გათანაბრებული მასალით)'), 'scripts/audit-report.ts: spearman')}.${
    gapCtl && gapCtl.valid ? ` საკონტროლო: ბრტყელი რგოლები მინიმალური დაშორებით 22 მმ (საშუალო ${f(gapCtl.dmean_mm, 1)} მმ) იძლევა K = ${f(gapCtl.K_1_m, 2)} — ${Math.abs(pct(n(gapCtl, 'K_1_m'), k1s)) < 15 ? 'მიობიუსის მნიშვნელობასთან ახლოს' : 'რაც მიობიუსის მნიშვნელობას არ ემთხვევა, ანუ საშუალო დაშორება ერთადერთი ფაქტორი არ არის'} (${f(k1s, 2)}; სხვაობა ${f(Math.abs(pct(n(gapCtl, 'K_1_m'), k1s)), 0)} %).` : ''
  }${gap2 && gap2.valid ? ` თუ მიობიუსის წყვილს დასაშვებ მინიმუმამდე (2 მმ) დავაახლოებთ, K = ${f(gap2.K_1_m, 2)} (საშუალო დაშორება ${f(gap2.dmean_mm, 1)} მმ).` : ''}`,
);
sec3.push(
  `\n**კლასიფიკაცია.** რიცხვები — გამოთვლილი. „მინიმალური დაშორების გათანაბრება“ — შედარების წესი, ანუ მოდელში ჩადებული დაშვება: სხვა წესი (მაგ. საშუალო დაშორების გათანაბრება) სხვა რიგს მოგვცემდა.\n`,
);
sec3.push(
  `**შესწორებული ფორმულირება.** _გამოკვლეულ კონფიგურაციებში გადაგრეხის ნიშანი განლაგებაზეა დამოკიდებული. როცა ორი ერთნაირი ლენტი ღერძის გასწვრივ ხისტად არის გადატანილი და თანაბრდება მინიმალური დაშორება (10 მმ), გადაგრეხილი ლენტების (n = 1, 2, 3) უჯრედის მუდმივა ${f(k1s / k0s, 1)}-ჯერ მეტია, ვიდრე ერთმანეთისკენ პირით მიმართული ბრტყელი რგოლებისა, მაგრამ ტოლია გადაუგრეხავი ცილინდრული რგოლისა იმავე განლაგებაში. გვერდიგვერდ განლაგებაში გადაგრეხა ბრტყელ რგოლს სჯობს, კონფორმულში კი სხვაობა გარჩევადი არ არის. K ${rho >= 0.8 ? 'მჭიდროდ' : 'ნაწილობრივ'} მიჰყვება ზედაპირების საშუალო დაშორებას (ρ = ${f(rho, 2)}) და დამოკიდებულია მათ ურთიერთმიმართულებაზე; ცალმხრივობის (n = 1 წინააღმდეგ n = 2) დამოუკიდებელი ეფექტი ამ მონაცემებში არ ჩანს._\n`,
);

// ---- 3.2 გაზის საკეტი ----
sec3.push(`### 3.2 „სახელური გაზის საკეტია“ — **მოდელი ამას არ ამტკიცებს; შეცვლილია ჰიპოთეზის ფორმულირებით**\n`);
sec3.push(
  `ადრე გამოყენებული იყო ერთი გეომეტრიული ინდიკატორი („პირდაპირი განიავება“) და მისგან გაკეთდა დასკვნა „საკეტის“ შესახებ. აუდიტში დაემატა მეორე ინდიკატორი — **ჰიდროსტატიკური ჯიბე** (\`solver.ts: analyzeTraps\`): მოცულობა, რომელიც გადმოღვრის დონეზე მაღლაა და კვაზისტატიკურ ზღვარში გაზით გაივსებოდა. ორივე გამოითვლება მხოლოდ ვოქსელური გეომეტრიიდან; ნაკადი არ მოდელირდება. კლაინის გარსი ნაგულისხმევი ზომით (\`experiments/audit/gas_pocket.json → variants.klein_exp1\`):\n`,
);
sec3.push(
  table(
    ['N', 'h, მმ', 'ფანჯრის ღრეჩო, ვოქსელი', 'ჯიბის მოცულობა, სმ³', 'კათოდის ფართობი ჯიბეში, %', 'გადმოღვრის დონე z, მმ', 'ჯიბე: კორპუსის ზედა ნაწილი / ყელი+სახელური, სმ³', 'პირდაპირი განიავების გარეშე: კათოდის ფართობი, %'],
    gasRows1.map((r) => [String(r.N), f(r.h_mm, 2), f(r.clearance_cells, 1), f(r.pocket.volume_cm3, 1), f(r.pocket.areaC * 100, 1), f(r.pocket.spillZ_mm, 1), `${f(r.pocket.regions_cm3.bodyAbove, 1)} / ${f(r.pocket.regions_cm3.tube, 1)}`, f(r.noVent.areaC * 100, 1)]),
  ),
);
sec3.push(
  `- ფანჯრის ზედა კიდე (გეომეტრიიდან): z = ${claim('ფანჯრის ზედა კიდის სიმაღლე', `${f(gas1.dims_mm.windowTop, 1)} მმ`, srcA('gas_pocket', 'variants.klein_exp1.dims_mm.windowTop'), 'klein.ts: kleinDims (zH + ρ_w)')}; გამოთვლილი გადმოღვრის დონე — ${claim('ჯიბის გადმოღვრის დონე (N = ' + gFine.N + ')', `${f(gFine.pocket.spillZ_mm, 1)} მმ`, srcA('gas_pocket', `variants.klein_exp1.rows[N=${gFine.N}].pocket.spillZ_mm`), FN.trap, 'ჰიპოთეზა')}. ანუ ჯიბე **ფანჯრის ღრეჩოდან იღვრება**: გაზს გასასვლელი აქვს.`,
);
sec3.push(
  `- ჯიბის მოცულობის უმეტესი ნაწილი (${f((gFine.pocket.regions_cm3.bodyAbove / gFine.pocket.volume_cm3) * 100, 0)} %) კორპუსის ზედა ნაწილშია და არა სახელურში (${f((gFine.pocket.regions_cm3.tube / gFine.pocket.volume_cm3) * 100, 0)} %).`,
);
sec3.push(
  `- ჯიბეში ხვდება კათოდის ფართობის ${claim('კათოდის ფართობი ჰიდროსტატიკურ ჯიბეში (ბადეების დიაპაზონი)', `${f(pocketAreaRange[0] * 100, 0)}–${f(pocketAreaRange[1] * 100, 0)} %`, srcA('gas_pocket', 'variants.klein_exp1.rows[*].pocket.areaC'), FN.trap, 'ჰიპოთეზა')}; „პირდაპირი განიავების გარეშე“ ფართობი — ${claim('კათოდის ფართობი პირდაპირი განიავების გარეშე (ბადეების დიაპაზონი)', `${f(noVentAreaRange[0] * 100, 0)}–${f(noVentAreaRange[1] * 100, 0)} %`, srcA('gas_pocket', 'variants.klein_exp1.rows[*].noVent.areaC'), FN.trap, 'ჰიპოთეზა')}. ორივე ბადესთან ერთად იზრდება და ჯერ არ არის დაკრებილი (ადრე მოყვანილი „≈ 24 %“ პირველი ინდიკატორის მნიშვნელობაა ერთ ბადეზე, N = ${gasRows1[0].N}: ${f(gasRows1[0].noVent.areaC * 100, 1)} %).`,
);
sec3.push(
  `\n**კლასიფიკაცია.** მოცულობები და ფართობები — გამოთვლილი გეომეტრიული სიდიდეები. ის, რომ ეს მოცულობა რეალურად გაზით ივსება და იქ ელექტროდი არ მუშაობს — **გეომეტრიიდან გამოთქმული ჰიპოთეზა**, ექსპერიმენტულად დაუდასტურებელი; ზედაპირული დაჭიმულობა, გაზის გახსნა, წნევის დინამიკა და ბუშტუკების შერწყმა მოდელში არ არის.\n`,
);
sec3.push(
  `**შესწორებული ფორმულირება.** _გეომეტრიული (ჰიდროსტატიკური) ინდიკატორით, კლაინის ტიპის გარსში ფანჯრის ზედა კიდის ზემოთ არსებობს ≈ ${f(gFine.pocket.volume_cm3, 0)} სმ³ ღრუ — ძირითადად კორპუსის ზედა ნაწილი, ნაწილობრივ ყელი და სახელური — რომელიც კვაზისტატიკურ ზღვარში გაზით გაივსებოდა და შემდეგ ფანჯრის ღრეჩოდან გადმოიღვრებოდა; მას ესაზღვრება კათოდის ფართობის ≈ ${f(pocketAreaRange[0] * 100, 0)}–${f(pocketAreaRange[1] * 100, 0)} %. სახელური გაზის გასვლას არ კეტავს. ივსება თუ არა ეს ღრუ რეალურად — მოდელი ვერ ადგენს._\n`,
);

// ---- 3.3 ბუშტუკები ----
sec3.push(`### 3.3 „ბუშტუკები ერთადერთი არხია“ — **დაუსაბუთებელი; ამოღებულია**\n`);
sec3.push(
  `ეს იყო ექსპერიმენტულად დაუდასტურებელი ინტერპრეტაცია, რომელიც მოდელიდან არ გამომდინარეობს: მოდელი აჩვენებს მხოლოდ იმას, რაც მასში შედის. ბუშტუკების გარდა მოდელში **არ არის** კიდევ რამდენიმე არხი, რომელთა ნიშანი და სიდიდე ასევე უცნობია:\n`,
);
sec3.push(
  `- კონვექცია და მასის გადატანა (კონცენტრაციული პოლარიზაცია), ტემპერატურული ველი;\n- დიაფრაგმის/მემბრანის განთავსება და მისი წინაღობა რთულ ფორმაზე;\n- ლითონის წინაღობა: მოდელში ელექტროდი ეკვიპოტენციურია. შეფასება (${metal.formula}; ρ = ${metal.rho_ohm_m} Ω·m — ნიკელი, 20 °C, ცნობარის მნიშვნელობა): კათოდზე ≈ ${claim('ლითონის ვარდნის შეფასება კათოდზე', `${f(metal.cathode_mV, 2)} mV`, srcA('geometry_facts', 'facts.metal_resistance.cathode_mV'), 'scripts/audit-compute.ts (S10): I·ρ·L/(8·w·t)', 'დაშვება')}, მიობიუსის ერთნაწილიან კონტრელექტროდზე ≈ ${f(metal.mobius_conformal_anode_one_piece_mV, 2)} mV, რგოლის ორნაწილიანზე ≈ ${f(metal.ring_conformal_anode_two_pieces_mV, 2)} mV. ეს მცირეა ძაბვის ძირითად სხვაობებთან შედარებით, მაგრამ იმავე რიგისაა, რაც კონფორმული რგოლისა და მიობიუსის სხვაობა (§7.2);\n- ელექტროლიტის გარემო: ავზის მარაგის შეცვლა ${margins[0]}-დან ${margins[margins.length - 1]} მმ-მდე ფირფიტების წყვილის K-ს ${f(n(mrow(margins[0], 'plates_pair'), 'K_1_m'), 2)}-დან ${f(n(mrow(margins[margins.length - 1], 'plates_pair'), 'K_1_m'), 2)}-მდე ცვლის (ეს მოდელირებული, მაგრამ თვითნებურად არჩეული პარამეტრია);\n- დამზადების შეზღუდვები (პარამეტრული მიობიუსის ფორმა არ არის განშლადი), კიდეებზე დენის კონცენტრაცია და მასთან დაკავშირებული დეგრადაცია.\n`,
);
sec3.push(
  `**შესწორებული ფორმულირება.** _ბუშტუკების მოცილება ერთ-ერთი არამოდელირებული ფაქტორია, რომელზეც ფორმას შეუძლია იმოქმედოს; მოდელი ვერ ადგენს, მნიშვნელოვანია თუ არა ის, და ვერც სხვა არამოდელირებულ ფაქტორებთან (კონვექცია, გაზების განცალკევება, ლითონის წინაღობა, დამზადება) მის შედარებით წონას._\n`,
);

// ---- 3.4 ორი ნაწილი ----
const cr = GEOM.facts.rings_conformal_anode,
  cm = GEOM.facts.mobius_conformal_anode;
sec3.push(`### 3.4 „რგოლისთვის ორი ნაწილია საჭირო“ — **„საჭიროა“ არასწორია; შეცვლილია**\n`);
sec3.push(
  `გამოთვლილი ფაქტი (ბადის ბმული კომპონენტების დათვლა, \`mesh.ts: checkManifold\`): აპლიკაციაში გამოყენებულ კონსტრუქციაში — ორი პარალელურად წანაცვლებული ზოლი, კიდის შემოვლის გარეშე — რგოლის (n = 0) კონტრელექტროდს აქვს ${claim('კონფორმული კონტრელექტროდის ბმული კომპონენტები, n = 0', String(cr.connected_components), srcA('geometry_facts', 'facts.rings_conformal_anode.connected_components'), FN.topo)} ბმული კომპონენტი, მიობიუსისას (n = 1) — ${claim('კონფორმული კონტრელექტროდის ბმული კომპონენტები, n = 1', String(cm.connected_components), srcA('geometry_facts', 'facts.mobius_conformal_anode.connected_components'), FN.topo)}. ეს არის არაორიენტირებადი ზედაპირის ორიენტაციული ორმაგი დაფარვის ბმულობის პირდაპირი შედეგი.\n`,
);
sec3.push(
  `მაგრამ „საჭიროა“ ამ ფაქტიდან არ გამომდინარეობს: რგოლის ორმხრივი კონტრელექტროდი ერთ ნაწილადაც დამზადდება — ორ ზოლს შორის ხიდით ან C-ს ფორმის კვეთით, რომელიც რგოლის ერთ კიდეს შემოუვლის. გარდა ამისა, მოდელი კონტრელექტროდს ორივე შემთხვევაში ერთ პოტენციალზე თვლის, ამიტომ ბმულობა გამოთვლილ ძაბვაზე საერთოდ არ მოქმედებს. პრაქტიკული მნიშვნელობა (ნაკლები კონტაქტი, მარტივი აწყობა) — ინტერპრეტაციაა და არა შედეგი.\n`,
);
sec3.push(
  `**შესწორებული ფორმულირება.** _გამოყენებულ კონსტრუქციაში (ორი პარალელური წანაცვლებული ზოლი, კიდის შემოვლის გარეშე) მიობიუსის ლენტის ორმხრივი კონტრელექტროდი ერთი ბმული ნაწილია, გადაუგრეხავი რგოლისა — ორი. ეს კონსტრუქციის თვისებაა: რგოლისთვისაც შესაძლებელია ერთნაწილიანი ვარიანტი. გამოთვლილ ელექტროქიმიურ მაჩვენებლებზე ბმულობა არ მოქმედებს._\n`,
);

// =============================================================================================
// §4 აქტიური ფართობი
// =============================================================================================
const sec4: string[] = [];
sec4.push(`## 4. საიდან მოდის „აქტიური ფართობის 54–63 %“\n`);
sec4.push(`### 4.1 განსაზღვრება\n`);
sec4.push(
  `ეს რიცხვი **არ არის** ზღვრით განსაზღვრული „მომუშავე ფართობის წილი“. კოდში (\`solver.ts: solveSecondary\`, ველები \`utilA\`, \`utilC\`) ის ითვლება ასე:\n\n\`\`\`\nη̄ = Σ_f I_f·η_f / Σ_f I_f              (მეორადი ამოხსნის დენით შეწონილი საშუალო გადაძაბვა)\nA_kin = I / ( f_r·(1−θ) · j_BV(η̄) )      („კინეტიკურად ეკვივალენტური ფართობი“)\nutil = A_kin / A_დასველებული\n\`\`\`\n\nანუ A_kin არის ფართობი, რომელიც **თანაბარი** დენის სიმკვრივისას იმავე საშუალო გადაძაბვას მოგვცემდა. ტაფელის არეში ეს ზუსტად უდრის\n\n\`\`\`\nutil = exp( − Σ_f (a_f/A)·x_f·ln x_f ),   x_f = j_f / j̄\n\`\`\`\n\n(დენის განაწილების ფარდობითი ენტროპიის ექსპონენტა). იგივეობა რიცხვითად მოწმდება ტესტით \`util-identity\` და ქვემოთ ცხრილში (სვეტები „კოდის“ და „ენტროპიული“ ემთხვევა).\n`,
);
sec4.push(`### 4.2 გამოთვლა და ბადის მგრძნობელობა\n`);
sec4.push(
  table(
    ['ვარიანტი', 'N', 'I, A', 'util (კოდის), %', 'util (ენტროპიული), %', 'მონაწილეობის ფარდობა (∫j)²/(A∫j²), %', 'პირველადი: ფართობი j < 0.1·j̄, %'],
    [...kleinIds, 'plates_pair', 'mobius_conformal'].flatMap((id) => U(id).rows.map((r) => [U(id).label, String(r.N), f(r.I, 3), f(r.utilC_kin * 100, 1), f(r.secondary.C.entropyUtil * 100, 1), f(r.secondary.C.participation * 100, 1), f(r.primary.shadowC * 100, 1)])),
  ),
);
sec4.push(
  `- ადრე მოყვანილი „54–63 %“ ერთ ბადეზე (N = 48) იყო მიღებული; იმავე ბადეზე ხელახლა გამოთვლა იძლევა ${claim('ადრინდელი „54–63 %“-ის აღდგენა (N = 48; ექსპ. 1 / 2 / 3)', `${f(n(LG('exp1:klein'), 'utilC_kin') * 100, 0)} / ${f(n(LG('exp2:klein'), 'utilC_kin') * 100, 0)} / ${f(n(LG('exp3:klein'), 'utilC_kin') * 100, 0)} %`, srcA('legacy_n48', 'rows[exp1:klein|exp2:klein|exp3:klein].utilC_kin'), FN.sec)}-ს (ექსპ. 1 / 2 / 3). სამ ბადეზე კლაინის გარსისთვის მნიშვნელობა ${claim('კლაინი: util (კოდის) სამ ბადეზე, სამ ვარიანტში', `${f(Math.min(...kUtilAll) * 100, 0)}–${f(Math.max(...kUtilAll) * 100, 0)} %`, srcA('utilization', 'variants.klein_exp{1,2,3}.rows[*].utilC_kin'), FN.sec)} დიაპაზონშია და **ბადის დაწვრილებასთან ერთად მონოტონურად კლებულობს** (მაგ. ექსპ. 3: ${kUtil[2].map((v) => f(v * 100, 1)).join(' → ')} %, N = ${U('klein_exp3').rows.map((r) => r.N).join(' → ')}). ანუ რიცხვი **დაკრებილი არ არის**: ნამდვილი მნიშვნელობა, სავარაუდოდ, ყველაზე წვრილი ბადის მნიშვნელობაზე დაბალია.`,
);
sec4.push(`- სხვაობა ექსპ. 1-სა და ექსპ. 2/3-ს შორის მოდის გეომეტრიის მასშტაბიდან (λ = ${f(kFine[0].lambda, 3)} და ${f(kFine[2].lambda, 3)}) და სამუშაო წერტილიდან, არა განსაზღვრების ცვლილებიდან.`);
sec4.push(`\n### 4.3 მგრძნობელობა ზღვრის მიმართ\n`);
sec4.push(`თუ „აქტიურ ფართობს“ ზღვრით განვსაზღვრავთ — ფართობის წილი, სადაც j ≥ t·j̄ — პასუხი ზღვარზე ძლიერაა დამოკიდებული (მეორადი განაწილება, ყველაზე წვრილი ბადე; ფრჩხილებში — ამ ფართობზე გამავალი დენის წილი):\n`);
sec4.push(
  table(
    ['ვარიანტი (N)', ...TH.map((t) => `t = ${t}`)],
    [...kleinIds, 'plates_pair', 'mobius_conformal'].map((id) => {
      const r = U(id).rows[U(id).rows.length - 1];
      return [`${U(id).label} (${r.N})`, ...TH.map((_, i) => `${f(r.secondary.C.areaAbove[i] * 100, 0)} % (${f(r.secondary.C.currentAbove[i] * 100, 0)} %)`)];
    }),
  ),
);
const k1f = kFine[0];
sec4.push(
  `- კლაინი, ნაგულისხმევი ზომა: ზღვრის მიხედვით „აქტიური“ ფართობი ${claim('კლაინი (ექსპ. 1): ზღვრით განსაზღვრული აქტიური ფართობი, t = 2 … 0.05', `${f(k1f.secondary.C.areaAbove[TH.length - 1] * 100, 0)} %-დან ${f(k1f.secondary.C.areaAbove[0] * 100, 0)} %-მდე`, srcA('utilization', `variants.klein_exp1.rows[N=${k1f.N}].secondary.C.areaAbove`), FN.meas)} იცვლება. t = 0.05-სა და t = 0.1-ს შორის მკვეთრი ნახტომია (${f(k1f.secondary.C.areaAbove[0] * 100, 0)} % → ${f(k1f.secondary.C.areaAbove[1] * 100, 0)} %): შიდა ზედაპირების დიდ ნაწილზე j საშუალოს 5–10 %-ია, ამიტომ ამ არეში ზღვრის მცირე ცვლილება პასუხს ძლიერ ცვლის (და ბადეზეც დამოკიდებულია: იხ. \`utilization.json\`).`,
);
sec4.push(
  `- უფრო მდგრადი ფორმულირება: ფართობის ≈ ${f(k1f.secondary.C.areaAbove[3] * 100, 0)} % (სადაც j ≥ 0.5·j̄) ატარებს დენის ≈ ${claim('კლაინი (ექსპ. 1): დენის წილი ფართობზე, სადაც j ≥ 0.5·j̄', `${f(k1f.secondary.C.currentAbove[3] * 100, 0)} %`, srcA('utilization', `variants.klein_exp1.rows[N=${k1f.N}].secondary.C.currentAbove[3]`), FN.meas)}-ს; დანარჩენი ფართობი დენს ატარებს, მაგრამ მცირეს.`,
);
sec4.push(`- შედარებისთვის: ფირფიტების წყვილი — util ${f(U('plates_pair').rows[0].utilC_kin * 100, 0)} % (უკანა ზედაპირები ნაკლებ დენს ატარებს), კონფორმული მიობიუსი — ${f(U('mobius_conformal').rows[0].utilC_kin * 100, 0)} %.`);
sec4.push(
  `\n**დასკვნა §4.** „54–63 %“ იყო ერთი კონკრეტული, ზღვრისგან თავისუფალი საზომის მნიშვნელობა ერთ ბადეზე. სწორი ფორმულირება: _კლაინის გარსის კათოდზე დენი ძლიერ არათანაბრად ნაწილდება; კინეტიკურად ეკვივალენტური ფართობი დასველებულის ≈ ${f(Math.min(...kFine.map((r) => r.utilC_kin)) * 100, 0)}–${f(Math.max(...kFine.map((r) => r.utilC_kin)) * 100, 0)} %-ია ყველაზე წვრილ ბადეზე (N = ${kFine[0].N}) და ბადესთან ერთად კლებულობს; ზღვრით განსაზღვრული წილი ზღვრის არჩევაზეა დამოკიდებული._ ფრაზა „ფართობის მხოლოდ X % მუშაობს“ ამოღებულია.\n`,
);

// =============================================================================================
// §5 სრული ცხრილი
// =============================================================================================
const sec5: string[] = [];
sec5.push(`## 5. სრული ცხრილი ყველა განლაგებისთვის (ექსპერიმენტი 3)\n`);
sec5.push(
  `წყარო: \`experiments/exp3_equal_material.json\` (და იგივე \`.csv\`, სადაც ყველა სვეტია). ყველა სტრიქონი ერთ ბადეზეა ამოხსნილი: N = ${N3}; ერთიანი მოდელი იყენებს იმავე ბადის K-ს, სივრცული — მეორად განაწილებას იმავე ბადეზე. კონფიგურაცია: \`baseConfig\` + \`scripts/lib.ts: exp3Cases()[id]\`.\n`,
);
sec5.push(`**ა) ელექტრული სიდიდეები**\n`);
sec5.push(
  table(
    ['განლაგება', 'I, A', 'U ერთიანი, V', 'P ერთიანი, W', 'U სივრც., V', 'P სივრც., W', 'H₂, mmol/h', 'η_F (H₂ / O₂)', 'kWh/kg ერთიანი', 'kWh/kg სივრც.'],
    (E3.rows as Row[]).map((r) => (r.valid ? [String(r.label), f(r.I_A, 3), f(r.U_V, 4), f(r.P_W, 3), f(r.U_sp_V, 4), f(r.P_sp_W, 3), f(r.nH2_mmol_h, 2), `${f(r.faradaicH2, 2)} / ${f(r.faradaicO2, 2)}`, f(r.kWh_per_kg, 2), f(r.kWh_per_kg_sp, 2)] : [String(r.label), ...Array(8).fill('—'), 'დაუშვებელი'])),
  ),
);
sec5.push(`**ბ) გეომეტრია და ბადე**\n`);
sec5.push(
  table(
    ['განლაგება', 'λ', 'A კათოდი, სმ²', 'A ანოდი, სმ²', 'მასალა (ჯამი), სმ³', 'd მინ., მმ', 'd საშ., მმ', 'გაბარიტი, სმ³', 'ავზი, სმ³', 'ბადე N (h, მმ)', 'დაშორება ვოქსელებში', 'K, 1/m'],
    (E3.rows as Row[]).map((r) =>
      r.valid ? [String(r.label), f(r.lambda, 3), f(r.areaC_cm2, 2), f(r.areaA_cm2, 2), f(r.material_cm3, 4), f(r.dmin_mm, 2), f(r.dmean_mm, 1), f(r.envelope_cm3, 1), f(r.tank_cm3, 0), `${r.N} (${f(r.h_mm, 2)})`, f(r.gap_cells, 1), f(r.K_1_m, 3)] : [String(r.label), ...Array(10).fill('—'), String(r.note)],
    ),
  ),
);
const eq = (key: string) => {
  const v = valid3.map((r) => n(r, key));
  const lo = Math.min(...v),
    hi = Math.max(...v);
  return { lo, hi, spread: ((hi - lo) / ((hi + lo) / 2)) * 100 };
};
const eqRow = (name: string, key: string, unit: string, d: number, how: string) => {
  const q = eq(key);
  return [name, `${f(q.lo, d)} – ${f(q.hi, d)} ${unit}`, q.spread < 0.01 ? '0.00 %' : `${f(q.spread, q.spread < 1 ? 3 : 0)} %`, q.spread < 0.1 ? '**დიახ**' : 'არა', how];
};
sec5.push(`**გ) რა არის ნამდვილად გათანაბრებული** (დასაშვებ ${valid3.length} სტრიქონზე; „გაფანტვა“ = (მაქს − მინ) / საშუალო)\n`);
sec5.push(
  table(
    ['სიდიდე', 'დიაპაზონი', 'გაფანტვა', 'გათანაბრებულია?', 'რით'],
    [
      eqRow('დენი I', 'I_A', 'A', 3, 'ელექტრული რეჟიმი (ფიქსირებული I)'),
      eqRow('ფარადეული ეფექტიანობა (H₂)', 'faradaicH2', '', 2, 'მომხმარებლის დაშვება, ყველასთვის ერთნაირი'),
      eqRow('H₂-ის მოლური ნაკადი', 'nH2_mmol_h', 'mmol/h', 2, 'შედეგი: I და η_F ერთნაირია (ფარადეის კანონი)'),
      eqRow('მასალის ჯამური მოცულობა', 'material_cm3', 'სმ³', 4, 'ნორმალიზება λ-ით (სენდვიჩისთვის — ხელით, იხ. lib.ts)'),
      eqRow('სისქე', 'thickness_mm', 'მმ', 2, 'პარამეტრი'),
      eqRow('მინიმალური დაშორება', 'dmin_mm', 'მმ', 2, 'განლაგების მორგება (fitTranslation / წანაცვლება)'),
      eqRow('საშუალო დაშორება', 'dmean_mm', 'მმ', 1, '—'),
      eqRow('კათოდის ფართობი', 'areaC_cm2', 'სმ²', 1, '—'),
      eqRow('ანოდის ფართობი', 'areaA_cm2', 'სმ²', 1, '—'),
      eqRow('გაბარიტული მოცულობა', 'envelope_cm3', 'სმ³', 0, '—'),
      eqRow('ავზის (ელექტროლიტის) მოცულობა', 'tank_cm3', 'სმ³', 0, '— (ერთნაირია მხოლოდ მარაგი, 15 მმ)'),
      eqRow('ბადის ბიჯი h', 'h_mm', 'მმ', 2, '— (ერთნაირია N; h ავზის ზომაზეა დამოკიდებული)'),
      eqRow('ძაბვა U (სივრცული)', 'U_sp_V', 'V', 3, '— (შედეგი)'),
      eqRow('სიმძლავრე P (სივრცული)', 'P_sp_W', 'W', 2, '— (შედეგი)'),
    ],
  ),
);
sec5.push(
  `ამავე ყველა სტრიქონში ერთნაირია: მასალა, κ, T, p, კინეტიკური პარამეტრები, f_r, θ, ε (კონფიგურაციის დონეზე). **არ არის გათანაბრებული** ფართობები, გაბარიტი, საშუალო დაშორება და ელექტროლიტის მოცულობა — ამიტომ „ერთნაირი მასალა“ არ ნიშნავს „სხვა მხრივ ერთნაირ უჯრედს“. კერძოდ, კონფორმულ და სენდვიჩ-განლაგებებში ანოდის ფართობი კათოდისას დაახლოებით ორჯერ აღემატება.\n`,
);
const sideRows = valid3.filter((r) => n(r, 'gap_cells') < 5);
if (sideRows.length)
  sec5.push(
    `შენიშვნა ბადეზე: ${sideRows.map((r) => String(r.label)).join('; ')} — აქ ავზი დიდია, ამიტომ იმავე N-ზე ბიჯი უხეშია (h = ${sideRows.map((r) => f(r.h_mm, 2)).join(', ')} მმ; დაშორება ${sideRows.map((r) => f(r.gap_cells, 1)).join(', ')} ვოქსელი). ამ სტრიქონების რიცხვითი გაურკვევლობა დანარჩენებზე მეტია და ისინი ბადის კვლევაში (§6) არ შედის.
`,
  );
sec5.push(
  `აუდიტის შესწორება: კლაინის გარსისთვის მინიმალური დაშორება ადრე კედლის სისქით (t = ${f(n(R3('klein'), 'thickness_mm'), 0)} მმ) გადაჭარბებული ჩანდა; მიზეზი იყო წერტილების გამეჩხერება \`minDistance\`-ში, რომელიც გარსის ორფენიანი ბადიდან მხოლოდ შიდა ფენას იღებდა. გასწორების შემდეგ მნიშვნელობა ${claim('კლაინი: მინიმალური დაშორება ანოდამდე (გასწორების შემდეგ)', `${f(n(R3('klein'), 'dmin_mm'), 2)} მმ`, src3('klein', 'dmin_mm'), FN.dist)}-ია (ტესტი \`klein-dmin\`). ამომხსნელის შედეგებზე ეს არ მოქმედებს — გეომეტრია სწორი იყო, არასწორი იყო მხოლოდ ანგარიშში ნაჩვენები რიცხვი.\n`,
);

// =============================================================================================
// §6 ბადის გამკვრივება
// =============================================================================================
const sec6: string[] = [];
sec6.push(`## 6. ბადის გამკვრივების კვლევა\n`);
sec6.push(
  `წყარო: \`experiments/audit/grid.json\`. დონეები: N = ${levels.join(', ')} (ბიჯის ფარდობა 1.5), ექსპერიმენტი 3-ის კონფიგურაცია. პირველადი ამოხსნა — ყველა დონეზე; მეორადი — N = ${levelsSec.join(', ')}. ქვემოთ ცალ-ცალკეა (ა) წრფივი ამომხსნელის ნაშთი, (ბ) დენის ბალანსი, (გ) დისკრეტიზაციის ცდომილება და (დ) წყვილებს შორის სხვაობის სტაბილურობა.\n`,
);
sec6.push(`### 6.1 ამომხსნელის ნაშთი (იტერაციული ცდომილება)\n`);
const tolRows = TOL.rows as { tol: number; K: number; iters: number; relres: number; balance: number }[];
const kTight = tolRows[tolRows.length - 1].K;
sec6.push(table(['PCG ტოლერანსი', 'იტერაციები', 'ფარდობითი ნაშთი ‖r‖/‖b‖', 'K, 1/m', '|K − K(1e-12)| / K', 'დენის ბალანსი'], tolRows.map((r) => [r.tol.toExponential(0), String(r.iters), r.relres.toExponential(1), r.K.toFixed(8), Math.abs(r.K / kTight - 1).toExponential(1), r.balance.toExponential(1)])));
const tol9 = tolRows.find((r) => r.tol === 1e-9)!;
sec6.push(
  `(${TOL.case}, N = ${TOL.N}.) სამუშაო ტოლერანსზე (1e-9) K-ის იტერაციული ცდომილება ${claim('K-ის იტერაციული ცდომილება ტოლერანსზე 1e-9', Math.abs(tol9.K / kTight - 1).toExponential(1), srcA('solver_tolerance', 'rows[tol=1e-9].K vs rows[tol=1e-12].K'), 'solver.ts: pcg')}-ია — რამდენიმე რიგით ნაკლები დისკრეტიზაციის ცდომილებაზე. ბადის კვლევის ყველა ამოხსნაში მაქსიმალური ფარდობითი ნაშთი: ${claim('მაქს. PCG ნაშთი ბადის კვლევაში', maxOf('pcg_relres').toExponential(1), srcA('grid', 'cases[*][*].pcg_relres'), 'solver.ts: pcg')}.\n`,
);
sec6.push(`### 6.2 დენის ბალანსი და ენერგიის ბალანსი\n`);
sec6.push(
  table(
    ['შემთხვევა', 'მაქს. |I_a − I_c|/I (პირველადი)', 'მაქს. |I_a − I_c|/I (მეორადი)', 'მაქს. ენერგიის შეუსაბამობა (მეორადი)', 'ნიუტონის იტერაციები'],
    GRID_IDS.map(([id, name]) => {
      const rows = gcase(id);
      const mx = (k: string) => Math.max(...rows.filter((r) => typeof r[k] === 'number').map((r) => Math.abs(r[k] as number)));
      return [name, mx('balance_primary').toExponential(1), mx('balance_secondary').toExponential(1), mx('energy_closure').toExponential(1), rows.filter((r) => typeof r.newton_iters === 'number').map((r) => r.newton_iters).join(', ')];
    }),
  ),
);
sec6.push(
  `დენის ბალანსი დისკრეტული სისტემის იგივეობაა და ამოწმებს მხოლოდ იმას, რომ წრფივი სისტემა ამოხსნილია; ის **არ** ზომავს დისკრეტიზაციის ცდომილებას. მაქსიმუმი ყველა ამოხსნაში: პირველადი ${claim('მაქს. დენის დისბალანსი (პირველადი)', maxOf('balance_primary').toExponential(1), srcA('grid', 'cases[*][*].balance_primary'), FN.prim)}, მეორადი ${claim('მაქს. დენის დისბალანსი (მეორადი)', maxOf('balance_secondary').toExponential(1), srcA('grid', 'cases[*][*].balance_secondary'), FN.sec)}.\n`,
);
sec6.push(`### 6.3 დისკრეტიზაციის ცდომილება\n`);
sec6.push(`**უჯრედის მუდმივა K, 1/m** („გაფანტვა“ — მაქს. გადახრა ყველაზე წვრილი ბადიდან ბოლო სამ დონეზე; p და რიჩარდსონი მხოლოდ მონოტონური კრებადობისას)\n`);
sec6.push(
  table(
    ['შემთხვევა', ...levels.map((N) => `N = ${N}`), 'გაფანტვა, %', 'მონოტონური?', 'დაკვირვებული რიგი p', 'რიჩარდსონი'],
    GRID_IDS.map(([id, name]) => {
      const s = gser(id, 'K'),
        c = convK[id];
      return [name, ...s.map((x) => f(x.v, 4)), f((c.range3 / c.fine) * 100, 2), c.monotone ? 'დიახ' : 'არა', c.monotone ? f(c.p, 1) : '—', c.monotone ? f(c.rich, 4) : '—'];
    }),
  ),
);
sec6.push(`**სივრცული (მეორადი) ძაბვა U, V**\n`);
sec6.push(
  table(
    ['შემთხვევა', ...levelsSec.map((N) => `N = ${N}`), 'გაფანტვა, mV', 'მონოტონური?', 'დაკვირვებული რიგი p', 'kWh/kg (ყველაზე წვრილი)'],
    GRID_IDS.map(([id, name]) => {
      const s = gser(id, 'U_sp'),
        c = convU[id];
      return [name, ...s.map((x) => f(x.v, 4)), f(c.range3 * 1e3, 1), c.monotone ? 'დიახ' : 'არა', c.monotone ? f(c.p, 1) : '—', f(convKw[id].fine, 2)];
    }),
  ),
);
const monoK = GRID_IDS.filter(([id]) => convK[id].monotone).length;
const monoU = GRID_IDS.filter(([id]) => convU[id].monotone);
sec6.push(
  `- კრებადობა **არ არის გლუვი**: K მონოტონურად იკრიბება ${monoK}/${GRID_IDS.length} შემთხვევაში, სივრცული U — ${monoU.length}/${GRID_IDS.length}-ში${monoU.length ? `, და იქაც დაკვირვებული რიგი p = ${monoU.map(([id]) => f(convU[id].p, 1)).join(', ')} სქემის თეორიულ რიგზე (1–2) გაცილებით მეტია — ეს ნიშნავს, რომ ასიმპტოტური არე მიღწეული არ არის` : ''}. მიზეზი: ჩაშენებული საზღვრის სქემაში ცდომილება დამოკიდებულია იმაზე, როგორ ემთხვევა 1 მმ სისქის ელექტროდი ბადის კვანძებს. ამიტომ რიჩარდსონის ექსტრაპოლაცია **არ გამოიყენება** და გაურკვევლობად აღებულია გაფანტვა ბოლო სამ დონეზე.`,
);
sec6.push(
  `- K-ის დისკრეტიზაციის გაურკვევლობა: უარეს შემთხვევაში ${claim('K-ის მაქს. გაფანტვა ბოლო სამ ბადეზე', `±${f(worstKrange, 1)} %`, srcA('grid', 'cases[*][N∈ბოლო სამი].K'), 'scripts/audit-report.ts: conv')}; სივრცული ძაბვისა — ${claim('სივრცული U-ს მაქს. გაფანტვა ბოლო სამ ბადეზე', `±${f(worstUrange, 0)} mV`, srcA('grid', 'cases[*][N∈ბოლო სამი].U_sp'), 'scripts/audit-report.ts: conv')} (კლაინის გარსი; დანარჩენებისთვის ≤ ${f(Math.max(...GRID_IDS.filter(([id]) => id !== 'klein').map(([id]) => convU[id].range3 * 1e3)), 0)} mV).`,
);
sec6.push(`- ადრე ნათქვამი „K-ის გაურკვევლობა 1–2 %“ ამ მონაცემებით ${worstKrange <= 2.05 ? 'დასტურდება' : `ოდნავ ოპტიმისტური იყო: სწორია ≈ ${f(worstKrange, 1)} %-მდე`}.`);
sec6.push(`\n### 6.4 წყვილებს შორის სხვაობის სტაბილურობა\n`);
sec6.push(`სხვაობა Δ = (kWh/kg)_B / (kWh/kg)_A − 1 სივრცული მოდელით, თითო ბადეზე ცალ-ცალკე (ორივე შემთხვევა ერთნაირი N-ით). ბოლოსწინა სვეტი აფასებს მხოლოდ **ბადის მიმართ სტაბილურობას**: „დიახ“, თუ |Δ(ყველაზე წვრილი)| > 2 × გაფანტვა. ეს ჯერ არ ნიშნავს ფიზიკურ გარჩევადობას (იხ. §7).\n`);
const pairRow = (name: string, p: Pair) => [name, ...p.dPct.map((x) => sgn(x.v, 2) + ' %'), `${sgn(p.fine, 2)} %`, `±${f(p.range3, 2)}`, p.resolved ? '**დიახ**' : '**არა**', p.dU.map((x) => sgn(x.v, 1)).join(' / ')];
sec6.push(
  table(
    ['წყვილი A → B', ...levelsSec.map((N) => `N = ${N}`), 'Δ (წვრილი)', 'გაფანტვა, პ.პ.', 'ბადის მიმართ სტაბილურია?', 'ΔU, mV (დონეების მიხედვით)'],
    [
      pairRow('ფირფიტების წყვილი → კონფორმული მიობიუსი', P_plates_mob),
      pairRow('ფირფიტების წყვილი → კონფორმული რგოლი', P_plates_ring),
      pairRow('ფირფიტების სენდვიჩი → კონფორმული მიობიუსი', P_sand_mob),
      pairRow('კონფორმული რგოლი → კონფორმული მიობიუსი', P_ring_mob),
      pairRow('რგოლები → მიობიუსი (ერთმანეთის თავზე)', P_stack),
    ],
  ),
);
const absRM = Math.max(convU.rings_conformal.range3, convU.mobius_conformal.range3) * 1e3;
const absPM = Math.max(convU.plates_pair.range3, convU.mobius_conformal.range3) * 1e3;
sec6.push(
  `ცდომილებების ურთიერთკომპენსაცია მხოლოდ მსგავს გეომეტრიებში ხდება: კონფორმული რგოლისა და მიობიუსის სხვაობის გაფანტვა (±${f(P_ring_mob.rangeU, 1)} mV) ${P_ring_mob.rangeU < 0.5 * absRM ? 'გაცილებით ნაკლებია' : 'არ არის ნაკლები'}, ვიდრე თითო ძაბვისა (±${f(absRM, 1)} mV); ფირფიტებისა და კონფორმული მიობიუსის შემთხვევაში კი სხვაობის გაფანტვა (±${f(P_plates_mob.rangeU, 1)} mV) ${P_plates_mob.rangeU < 0.5 * absPM ? 'ნაკლებია, ვიდრე' : 'იმავე რიგისაა, რაც'} თითო მნიშვნელობისა (±${f(absPM, 1)} mV). ამიტომ განსხვავებული ფორმების შედარებისას გაურკვევლობად სხვაობის საკუთარი გაფანტვაა აღებული და არა უფრო ოპტიმისტური შეფასება.\n`,
);

// =============================================================================================
// §7 ორი შედარება
// =============================================================================================
const sec7: string[] = [];
const pp = R3('plates_pair'),
  mc = R3('mobius_conformal'),
  rc = R3('rings_conformal'),
  ps = R3('plates_sandwich');
sec7.push(`## 7. ორი ცალკე შედარება\n`);
sec7.push(`### 7.1 საბაზისო ფირფიტები და კონფორმული მიობიუსი: „≈ 2.8 % ეკონომია“\n`);
const legacySaving = -pct(n(LG('exp3:mobius_conformal'), 'kWh_per_kg_sp'), n(LG('exp3:plates_pair'), 'kWh_per_kg_sp'));
sec7.push(
  `ადრინდელი ანგარიშის რიცხვი მეორადი ამოხსნით N = 48-ზე იყო მიღებული. იმავე ბადეზე ხელახლა გამოთვლა იძლევა ${claim('ადრინდელი ეკონომიის აღდგენა (N = 48)', `${f(legacySaving, 2)} %`, srcA('legacy_n48', 'rows[exp3:plates_pair|exp3:mobius_conformal].kWh_per_kg_sp'), FN.sec)}-ს (${f(n(LG('exp3:plates_pair'), 'kWh_per_kg_sp'), 2)} → ${f(n(LG('exp3:mobius_conformal'), 'kWh_per_kg_sp'), 2)} kWh/kg) — ანუ „≈ 2.8 %“ სწორად იყო გამოთვლილი. იმავე პირობებში N = ${N3}-ზე: ${claim('ეკონომია: ფირფიტების წყვილი → კონფორმული მიობიუსი (N = ' + N3 + ', სივრცული)', `${f(saving64, 2)} %`, `${src3('plates_pair', 'kWh_per_kg_sp')}; ${src3('mobius_conformal', 'kWh_per_kg_sp')}`, FN.sec)} (${f(n(pp, 'kWh_per_kg_sp'), 2)} → ${f(n(mc, 'kWh_per_kg_sp'), 2)} kWh/kg; ΔU = ${sgn((n(mc, 'U_sp_V') - n(pp, 'U_sp_V')) * 1e3, 1)} mV).\n`,
);
sec7.push(`**ბადის მიხედვით** (§6.4): ${P_plates_mob.dPct.map((x) => `N = ${x.N}: ${f(-x.v, 2)} %`).join('; ')}. ყველაზე წვრილ ბადეზე ${claim('ეკონომია ყველაზე წვრილ ბადეზე ± გაფანტვა', `${f(-P_plates_mob.fine, 2)} ± ${f(P_plates_mob.range3, 2)} %`, srcA('grid', 'cases[plates_pair|mobius_conformal][*].kWh_sp'), FN.sec)} — რიცხვითად გარჩევადი სხვაობაა.\n`);
sec7.push(`**საიდან მოდის** (სივრცული ამოხსნის დაშლა, N = ${N3}; mV):\n`);
sec7.push(
  table(
    ['წევრი', 'ფირფიტების წყვილი', 'კონფორმული მიობიუსი', 'სხვაობა'],
    [
      ['E_rev', f(n(pp, 'eRev_V') * 1e3, 1), f(n(mc, 'eRev_V') * 1e3, 1), sgn((n(mc, 'eRev_V') - n(pp, 'eRev_V')) * 1e3, 1)],
      ['η_a (დენით შეწონილი)', f(pp.etaA_sp_mV, 1), f(mc.etaA_sp_mV, 1), sgn(n(mc, 'etaA_sp_mV') - n(pp, 'etaA_sp_mV'), 1)],
      ['|η_c| (დენით შეწონილი)', f(pp.etaC_sp_mV, 1), f(mc.etaC_sp_mV, 1), sgn(n(mc, 'etaC_sp_mV') - n(pp, 'etaC_sp_mV'), 1)],
      ['ვარდნა ელექტროლიტში', f(pp.ohmic_sp_mV, 1), f(mc.ohmic_sp_mV, 1), sgn(n(mc, 'ohmic_sp_mV') - n(pp, 'ohmic_sp_mV'), 1)],
      ['**U**', f(n(pp, 'U_sp_V') * 1e3, 1), f(n(mc, 'U_sp_V') * 1e3, 1), sgn((n(mc, 'U_sp_V') - n(pp, 'U_sp_V')) * 1e3, 1)],
    ],
  ),
);
const dOhm = n(mc, 'ohmic_sp_mV') - n(pp, 'ohmic_sp_mV'),
  dEtaC = n(mc, 'etaC_sp_mV') - n(pp, 'etaC_sp_mV'),
  dEtaA = n(mc, 'etaA_sp_mV') - n(pp, 'etaA_sp_mV');
sec7.push(
  `ძაბვის სხვაობის ${sgn(dOhm, 0)} mV მოდის ელექტროლიტში ვარდნიდან (K ${f(n(pp, 'K_1_m'), 2)} → ${f(n(mc, 'K_1_m'), 2)} 1/m: კათოდის ორივე მხარე ანოდს უყურებს), ${sgn(dEtaA, 0)} mV — ანოდის გადაძაბვიდან (ანოდის ფართობი ${f(pp.areaA_cm2, 1)} → ${f(mc.areaA_cm2, 1)} სმ²) და ${sgn(dEtaC, 0)} mV — კათოდის გადაძაბვიდან (კათოდის ფართობი ${f(pp.areaC_cm2, 1)} → ${f(mc.areaC_cm2, 1)} სმ²).\n`,
);
sec7.push(`**რა პირობებზეა დამოკიდებული:**\n`);
sec7.push(table(['ავზის მარაგი, მმ', ...margins.map((m) => String(m))], [['ეკონომია, %', ...margins.map((m) => f(savingAt(m), 2))]]));
sec7.push(table(['დენი I, A', ...currents.map((I) => String(I))], [['ეკონომია, %', ...currents.map((I) => f(savingI(I), 2))], ['კათოდის j (ფირფიტები), A/m²', ...currents.map((I) => f((op(I, 'plates_pair') as unknown as { jC: number }).jC, 0))]]));
sec7.push(
  `(წყაროები: \`audit/tank_margin.json\`, \`audit/operating_point.json\`; მეორადი ამოხსნა.) ეკონომია ${claim('ეკონომიის დიაპაზონი გამოკვლეულ პირობებში (მარაგი, დენი, ბადე)', `${f(savMin, 1)}–${f(savMax, 1)} %`, 'audit/tank_margin.json, audit/operating_point.json, audit/grid.json → kWh_sp', FN.sec)} დიაპაზონშია: იზრდება დენთან ერთად (ომური წილი იზრდება) და მცირდება, როცა ელექტროდების გარშემო მეტი ელექტროლიტია (ფირფიტებს ნაპირის დენი ეხმარება).\n`,
);
sec7.push(`**რა არ არის ამ შედარებაში გათანაბრებული** (N = ${N3}):\n`);
sec7.push(
  table(
    ['სიდიდე', 'ფირფიტების წყვილი', 'კონფორმული მიობიუსი', 'ფარდობა'],
    [
      ['მასალა, სმ³', f(pp.material_cm3, 3), f(mc.material_cm3, 3), f(n(mc, 'material_cm3') / n(pp, 'material_cm3'), 3)],
      ['კათოდის ფართობი, სმ²', f(pp.areaC_cm2, 1), f(mc.areaC_cm2, 1), f(n(mc, 'areaC_cm2') / n(pp, 'areaC_cm2'), 2)],
      ['ანოდის ფართობი, სმ²', f(pp.areaA_cm2, 1), f(mc.areaA_cm2, 1), f(n(mc, 'areaA_cm2') / n(pp, 'areaA_cm2'), 2)],
      ['გაბარიტი, სმ³', f(pp.envelope_cm3, 0), f(mc.envelope_cm3, 0), f(n(mc, 'envelope_cm3') / n(pp, 'envelope_cm3'), 1)],
      ['ელექტროლიტის მოცულობა (ავზი), სმ³', f(pp.tank_cm3, 0), f(mc.tank_cm3, 0), f(n(mc, 'tank_cm3') / n(pp, 'tank_cm3'), 1)],
      ['მინ. / საშ. დაშორება, მმ', `${f(pp.dmin_mm, 1)} / ${f(pp.dmean_mm, 1)}`, `${f(mc.dmin_mm, 1)} / ${f(mc.dmean_mm, 1)}`, '—'],
    ],
  ),
);
sec7.push(
  `**ვერდიქტი 7.1.** რიცხვი დასტურდება, მაგრამ მისი ინტერპრეტაცია იცვლება. _ერთნაირი მასალის, ერთნაირი დენისა (5 A) და ერთნაირი მინიმალური დაშორებისას კონფორმული მიობიუსის უჯრედი მოდელში ${f(-P_plates_mob.fine, 1)} ± ${f(P_plates_mob.range3, 1)} %-ით ნაკლებ ენერგიას ხარჯავს, ვიდრე ფირფიტების წყვილი (გამოკვლეულ პირობებში ${f(savMin, 1)}–${f(savMax, 1)} %), ${f(n(mc, 'envelope_cm3') / n(pp, 'envelope_cm3'), 1)}-ჯერ დიდი გაბარიტის ფასად._ ეს არის **ორმხრივი განლაგების** ეფექტი და არა მიობიუსის: იგივე ეფექტს იძლევა კონფორმული რგოლი (${f(-P_plates_ring.fine, 2)} %) და, ნაწილობრივ, ფირფიტების სენდვიჩი (სენდვიჩთან შედარებით კონფორმული მიობიუსის უპირატესობა ${f(-P_sand_mob.fine, 2)} ± ${f(P_sand_mob.range3, 2)} %-ია — ${P_sand_mob.resolved ? 'რიცხვითად გარჩევადი, მაგრამ მცირე' : 'რიცხვითად გარჩევადი არ არის'}).\n`,
);

sec7.push(`### 7.2 კონფორმული რგოლი და კონფორმული მიობიუსი: გარჩევადია თუ არა სხვაობა\n`);
sec7.push(
  table(
    ['', ...levelsSec.map((N) => `N = ${N}`), 'გაფანტვა'],
    [
      ['U სივრც., რგოლი, V', ...gser('rings_conformal', 'U_sp').map((x) => f(x.v, 4)), `±${f(convU.rings_conformal.range3 * 1e3, 1)} mV`],
      ['U სივრც., მიობიუსი, V', ...gser('mobius_conformal', 'U_sp').map((x) => f(x.v, 4)), `±${f(convU.mobius_conformal.range3 * 1e3, 1)} mV`],
      ['ΔU = მიობიუსი − რგოლი, mV', ...P_ring_mob.dU.map((x) => sgn(x.v, 2)), `±${f(P_ring_mob.rangeU, 2)} mV`],
      ['Δ(kWh/kg), %', ...P_ring_mob.dPct.map((x) => sgn(x.v, 3)), `±${f(P_ring_mob.range3, 3)} პ.პ.`],
      ['K რგოლი / მიობიუსი, 1/m', ...levelsSec.map((N) => `${f(gser('rings_conformal', 'K').find((x) => x.N === N)!.v, 3)} / ${f(gser('mobius_conformal', 'K').find((x) => x.N === N)!.v, 3)}`), ''],
    ],
  ),
);
sec7.push(`სხვაობის შედარება სხვა, იმავე რიგის ეფექტებთან:\n`);
sec7.push(
  table(
    ['ეფექტი', 'სიდიდე', 'წყარო'],
    [
      ['ΔU (მიობიუსი − რგოლი), ყველაზე წვრილი ბადე', `${sgn(P_ring_mob.fineU, 2)} mV`, 'audit/grid.json'],
      ['ამ სხვაობის ცვლილება ბადეებს შორის', `±${f(P_ring_mob.rangeU, 2)} mV`, 'audit/grid.json'],
      ['თითო აბსოლუტური ძაბვის ცვლილება ბადეებს შორის', `±${f(Math.max(convU.rings_conformal.range3, convU.mobius_conformal.range3) * 1e3, 1)} mV`, 'audit/grid.json'],
      [
        'ღრეჩოს კონვენცია: მიობიუსი „მერიდიანული წანაცვლება 10 მმ“ მინუს „მინ. დაშორება 10 მმ“',
        `${sgn(gapEffect_mV, 2)} mV (K: ${f(n(grow('mobius_conformal_min10'), 'K_1_m'), 3)} → ${f(n(grow('mobius_conformal_mer10'), 'K_1_m'), 3)}; d მინ. ${f(grow('mobius_conformal_mer10').dmin_mm, 2)} მმ)`,
        `audit/gap_convention.json (N = ${gapFineN})`,
      ],
      ['იგივე ΔU ერთნაირი ბიჯით (h ≈ 1.3 მმ), ავზის მარაგზე ' + margins.join(' / ') + ' მმ', margins.map((m) => sgn(ringMobAt(m), 2)).join(' / ') + ' mV', 'audit/tank_margin.json'],
      ['ლითონის წინაღობა (არამოდელირებული): ერთნაწილიანი მინუს ორნაწილიანი ანოდი', `≈ ${sgn(metalDiff, 2)} mV`, 'audit/geometry_facts.json'],
    ],
  ),
);
const eqH = margins.map(ringMobAt); // იგივე სხვაობა ერთნაირი ბიჯით (h ≈ 1.3 მმ) და არა ერთნაირი N-ით
const signFlips = new Set([...P_ring_mob.dU.map((x) => Math.sign(x.v)), ...eqH.map(Math.sign), Math.sign(P_ring_mob.fineU + gapEffect_mV)]).size > 1;
const absDrift = Math.max(convU.rings_conformal.range3, convU.mobius_conformal.range3) * 1e3;
sec7.push(
  `**ვერდიქტი 7.2.** _რიცხვითად:_ ერთნაირი N-ის ბადეებზე სხვაობა მცირე და სტაბილურია (ყველაზე წვრილ ბადეზე ΔU = ${sgn(P_ring_mob.fineU, 2)} mV, ბოლო სამ დონეზე ±${f(P_ring_mob.rangeU, 2)} mV), თუმცა თითო აბსოლუტური ძაბვა ამავე დონეებზე ±${f(absDrift, 1)} mV-ით იცვლება, ხოლო სხვა, თანაბრად დასაშვები დისკრეტიზაციით (ერთნაირი ბიჯი h ≈ 1.3 მმ ერთნაირი N-ის ნაცვლად; \`tank_margin.json\`) იგივე სხვაობა ${sgn(Math.min(...eqH), 1)}…${sgn(Math.max(...eqH), 1)} mV გამოდის. ანუ სხვაობის რიცხვითი გაურკვევლობა პრაქტიკულ ბადეებზე თავად სხვაობის რიგისაა ან მეტია. _ფიზიკურად:_ მისი სიდიდე (${f(Math.abs(P_ring_mob.fineU), 1)} mV, ანუ ძაბვის ${f((Math.abs(P_ring_mob.fineU) / (n(mc, 'U_sp_V') * 1e3)) * 100, 2)} %) ნაკლებია ან იმავე რიგისაა, რაც სამი დამოუკიდებელი ეფექტი: ღრეჩოს განსაზღვრის კონვენცია (${f(Math.abs(gapEffect_mV), 1)} mV — ნიშანს ცვლის), ავზის ზომა${signFlips ? ' (ნიშანი იცვლება)' : ''} და არამოდელირებული ლითონის წინაღობა (≈ ${f(Math.abs(metalDiff), 1)} mV). K-ის სხვაობის ნიშანიც კონვენციაზეა დამოკიდებული (N = ${gapFineN}): წესით „მინიმალური დაშორება = 10 მმ“ მიობიუსის K რგოლისაზე ${sgn(pct(n(grow('mobius_conformal_min10'), 'K_1_m'), n(grow('rings_conformal'), 'K_1_m')), 1)} %-ით განსხვავდება (საშუალო ღრეჩო ${f(grow('mobius_conformal_min10').dmean_mm, 1)} და ${f(grow('rings_conformal').dmean_mm, 1)} მმ), წესით „მერიდიანული წანაცვლება = 10 მმ“ კი — ${sgn(pct(n(grow('mobius_conformal_mer10'), 'K_1_m'), n(grow('rings_conformal'), 'K_1_m')), 1)} %-ით (საშუალო ღრეჩო ${f(grow('mobius_conformal_mer10').dmean_mm, 1)} მმ). _დასკვნა: ამ მოდელით კონფორმული რგოლი და კონფორმული მიობიუსი ელექტროქიმიურად ერთმანეთისგან არ გაირჩევა; ნებისმიერი ნიშნის მცირე სხვაობა შედარების წესის არჩევით მიიღება._\n`,
);

// =============================================================================================
// §8 ორმაგი დათვლა
// =============================================================================================
const sec8: string[] = [];
const allRows = [...(E1.rows as Row[]), ...(E2.rows as Row[]), ...(E3.rows as Row[])].filter((r) => r.valid);
const maxClosure = Math.max(...allRows.map((r) => Math.abs(n(r, 'energy_closure'))), maxOf('energy_closure'));
sec8.push(`## 8. ხომ არ ითვლება დანაკარგები ორჯერ მეორადი ამომხსნელის გამოყენებისას\n`);
sec8.push(`**კოდის გზის შემოწმება** (\`solver.ts: solveSecondary\`):\n`);
sec8.push(
  `- ელექტროლიტის მოცულობაში ითვლება მხოლოდ ომური გამტარობა (7-წერტილიანი შაბლონი, κ_eff).\n- თითო სასაზღვრო ბმულზე მიმდევრობით არის ორი **განსხვავებული** წინაღობა: ელექტროლიტის ნახევარბმული (სითხის უჯრედის ცენტრიდან ზედაპირამდე, მანძილი δ) და კინეტიკური წინაღობა BV-დან. ნახევარბმულის მონაკვეთი მოცულობით ბმულებში არ შედის.\n- θ და f_r შედის მხოლოდ კინეტიკურ წევრში (მამრავლი m = f_r·(1−θ)); ε — მხოლოდ κ_eff-ში. არცერთი ორჯერ არ გამოიყენება.\n- დამატებითი წინაღობა R_დამ ემატება ერთხელ, ამოხსნის გარეთ: U = U_შიდა + I·R_დამ.\n- მეორადი ამოხსნის ძაბვა **არ** იკრიბება ერთიანი მოდელის წევრებთან: ერთიანი მოდელი (K + კინეტიკა საშუალო j-ზე) და სივრცული მოდელი ორი ცალკე შეფასებაა და ცხრილებში ცალ-ცალკე სვეტებადაა. პირველადი K მეორად ამოხსნაში მხოლოდ საწყისი მიახლოებისთვის გამოიყენება.\n- ანგარიშში ნაჩვენები „ვარდნა ელექტროლიტში“ = U_შიდა − E_rev − η̄_a − η̄_c, სადაც η̄ დენით შეწონილი საშუალოა — ეს განსაზღვრებით იკვრება ჯამში და ორმაგ დათვლას გამორიცხავს.\n`,
);
sec8.push(`**დამოუკიდებელი რიცხვითი შემოწმება** (\`EnergyAudit\`): ამოხსნილი ველიდან ცალკე ითვლება ჯოულის სითბო (მოცულობა + ნახევარბმულები) და Σ I_f·η_f ორივე ელექტროდზე, სადაც I_f **არაწრფივი** BV-დან აიღება, და ჯამი დარდება (U_შიდა − E_rev)·I-ს:\n`);
sec8.push(
  `- მაქსიმალური ფარდობითი შეუსაბამობა ყველა ექსპერიმენტის სტრიქონსა და ბადის კვლევაში: ${claim('ენერგიის ბალანსის მაქს. შეუსაბამობა (ყველა მეორადი ამოხსნა)', maxClosure.toExponential(1), 'exp{1,2,3}.json → rows[*].energy_closure; audit/grid.json → cases[*][*].energy_closure', 'solver.ts: solveSecondary (EnergyAudit)')}.\n- 1D ზღვარში მეორადი ამოხსნა ემთხვევა ერთიან მოდელს (ტესტები \`sec-1d\`, \`energy-1d\`), ხოლო 3D-ში ანგარიშის „ომური“ წევრი ემთხვევა ველიდან დათვლილ ჯოულის სითბოს (ტესტი \`ohmic-3d\`).\n`,
);
sec8.push(
  `**ვერდიქტი §8.** ორმაგი დათვლა არ აღმოჩნდა. აღმოჩნდა სხვა შეუსაბამობა, რომელიც გასწორებულია: ადრინდელ ცხრილში ერთიანი მოდელის სვეტი იყენებდა K-ს N = 64 ბადიდან, სივრცული სვეტი კი N = 48-ზე იყო ამოხსნილი. ახლა ორივე ერთ ბადეზეა (N = ${N3}). N = 48-დან N = ${N3}-ზე გადასვლამ სივრცული ძაბვა უმეტესად ${f(Math.max(...['plates_pair', 'plates_sandwich', 'rings_conformal', 'mobius_conformal', 'klein'].map((id) => Math.abs(n(R3(id), 'U_sp_V') - n(LG('exp3:' + id), 'U_sp_V')) * 1e3)), 0)} mV-მდე შეცვალა (\`audit/legacy_n48.json\`; ბადის ეფექტი, იხ. §6.3).\n`,
);

// =============================================================================================
// §2 კლასიფიკაცია
// =============================================================================================
const sec2: string[] = [];
sec2.push(`## 2. რა არის რა: ოთხი კატეგორია\n`);
sec2.push(`**ა) უშუალოდ გამოთვლილი შედეგი** (კოდის ფუნქციის გამომავალი მნიშვნელობა; წყარო — §1):\n`);
sec2.push(
  `- H₂ და O₂-ის ნაკადები მოცემულ დენზე; ძაბვა, სიმძლავრე, kWh/kg ერთიან და სივრცულ მოდელში;\n- ფართობები, მოცულობები, გაბარიტი, მინიმალური და საშუალო დაშორება, ბადის ტოპოლოგიური ინვარიანტები, ბმული კომპონენტების რაოდენობა;\n- უჯრედის მუდმივა K, დენის განაწილების მაჩვენებლები, კინეტიკურად ეკვივალენტური ფართობი;\n- გეომეტრიული ინდიკატორების **მნიშვნელობები** (ჯიბის მოცულობა, გადმოღვრის დონე);\n- ბადის, ავზის მარაგის, დენისა და ღრეჩოს კონვენციის მიმართ მგრძნობელობა.\n`,
);
sec2.push(`**ბ) მოდელში წინასწარ ჩადებული დაშვება** (შედეგი მათზეა დამოკიდებული, მაგრამ მათ არ ამოწმებს):\n`);
sec2.push(
  `- ფარადეული ეფექტიანობა = ${E3.baseConfig.electrical.faradaicH2} ორივე გაზისთვის; ამიტომ „ერთნაირ დენზე ერთნაირი H₂“ ამ მოდელში იგივეობაა და არა აღმოჩენა;\n- j₀, α, κ, θ = ${E3.baseConfig.surface.thetaA}, ε = ${E3.baseConfig.electrolyte.voidFraction}, f_r = ${E3.baseConfig.surface.roughness} — და ის, რომ ისინი **ყველა ფორმისთვის ერთნაირია**. ეს ყველაზე ძლიერი დაშვებაა: ის წინასწარ გამორიცხავს ფორმის გავლენას ბუშტუკებზე და კინეტიკაზე;\n- ლითონი ეკვიპოტენციურია; ავზი მართკუთხაა, იზოლირებული კედლებით, მარაგით ${E3.baseConfig.env.tankMargin * 1e3} მმ; იზოთერმული, სტაციონარული რეჟიმი; დიაფრაგმა არ არის;\n- შედარების წესები: რა თანაბრდება (მასალა ან ორივე ელექტროდის **ჯამური** ფართობი — კათოდის ფართობი ცალკე არცერთ რეჟიმში არ თანაბრდება), „დაშორება“ = მინიმალური მანძილი, მასშტაბირდება მხოლოდ სიბრტყითი ზომები;\n- ერთიან მოდელში: მთელი დასველებული ფართობი თანაბრად მუშაობს.\n`,
);
sec2.push(`**გ) გეომეტრიიდან გამოთქმული ჰიპოთეზა** (ლოგიკური, მაგრამ მოდელით შეუმოწმებელი):\n`);
sec2.push(
  `- ჰიდროსტატიკურ ჯიბეში მოხვედრილი ელექტროდის ზედაპირი გაზით დაიფარება და არ იმუშავებს;\n- გაზი კლაინის გარსიდან ფანჯრის ღრეჩოთი გავა, როცა ჯიბე გაივსება;\n- ერთნაწილიანი კონტრელექტროდი დამზადებისა და კონტაქტირების თვალსაზრისით მოსახერხებელია;\n- გადაგრეხილი ფორმისთვის დიაფრაგმის განთავსება უფრო რთულია, ვიდრე ბრტყელი ფირფიტებისთვის.\n`,
);
sec2.push(`**დ) ექსპერიმენტულად დაუდასტურებელი ინტერპრეტაცია** (ყველაფერი, რაც მოდელის რიცხვიდან რეალურ მოწყობილობაზე გადადის):\n`);
sec2.push(
  `- „ტოპოლოგია რეალურ ელექტროლიზერში უპირატესობას არ იძლევა“ — მოდელი ამას **ვერ** ამტკიცებს (იხ. §9);\n- „ბუშტუკების მოცილება ერთადერთი დარჩენილი არხია“ — ამოღებულია (§3.3);\n- აბსოლუტური ძაბვები და kWh/kg: კინეტიკა დაუკალიბრებელია; α-ს ±20 % ცვლილება kWh/kg-ს ${claim('მგრძნობელობა: კათოდის α ±20 % (მიობიუსი, ნაგულისხმევი)', `${sgn(SENS.cases.mobius_default_stacked.rows.find((r: { param: string }) => r.param === 'კათოდი α').dHigh, 1)} / ${sgn(SENS.cases.mobius_default_stacked.rows.find((r: { param: string }) => r.param === 'კათოდი α').dLow, 1)} %`, srcA('sensitivity', 'cases.mobius_default_stacked.rows[კათოდი α]'), FN.volt)}-ით ცვლის, K-ის ±20 % — ${claim('მგრძნობელობა: K ±20 % (მიობიუსი, ნაგულისხმევი)', `±${f(Math.abs(SENS.cases.mobius_default_stacked.rows.find((r: { param: string }) => r.param === 'K (გეომეტრია)').dHigh), 1)} %`, srcA('sensitivity', 'cases.mobius_default_stacked.rows[K (გეომეტრია)]'), FN.volt)}-ით;\n- ნებისმიერი დასკვნა, რომელიც სცდება გამოკვლეულ ზომებს, განლაგებებსა და პარამეტრებს.\n`,
);

// =============================================================================================
// §9 საბოლოო დასკვნა
// =============================================================================================
const sec9: string[] = [];
const e1ids = ['plates', 'rings', 'mobius', 'klein'];
const nH2s = e1ids.map((id) => n(R1(id), 'nH2_mmol_h'));
const aCs = e1ids.map((id) => n(R1(id), 'areaC_cm2'));
sec9.push(`## 9. საბოლოო დასკვნა — გამოკვლეული კონსტრუქციებისა და პარამეტრების ფარგლებში\n`);
sec9.push(
  `**რა გამოიკვლია მოდელმა.** ${valid3.length} დასაშვები განლაგება ერთნაირი მასალით (§5), ${twRows.length} დამატებითი შემთხვევა გადაგრეხის კვლევაში (§3.1) და ოთხი საბაზისო სისტემა ორ სხვა რეჟიმში (\`exp1\`, \`exp2\`). ყველა — ერთი ზომის კლასში (ელექტროდები ≈ 3–7 სმ, სისქე 1 მმ, დაშორება 10 მმ), ერთი ელექტროლიტით, ერთი კინეტიკით, დიაფრაგმის გარეშე, 1–10 A დენზე.\n`,
);
sec9.push(`**რა აჩვენა (გამოთვლილი):**\n`);
sec9.push(
  `1. ერთნაირ დენზე H₂-ის ნაკადი ყველა სისტემაში ${claim('H₂-ის ნაკადი 5 A-ზე, ოთხივე სისტემა', `${f(Math.min(...nH2s), 2)}${Math.max(...nH2s) - Math.min(...nH2s) < 1e-9 ? '' : '–' + f(Math.max(...nH2s), 2)} mmol/h`, src1('*', 'nH2_mmol_h'), FN.prod)}-ია, თუმცა კათოდის ფართობი ${claim('კათოდის ფართობის დიაპაზონი (ექსპ. 1)', `${f(Math.min(...aCs), 0)}–${f(Math.max(...aCs), 0)} სმ²`, src1('*', 'areaC_cm2'), FN.mesh)} ფარგლებში იცვლება. ეს ფარადეის კანონისა და η_F = 1 დაშვების პირდაპირი შედეგია.`,
);
sec9.push(
  `2. იმავე R, w, t-ს მქონე რგოლისა და მიობიუსის ლენტის მოცულობა ${claim('რგოლის / მიობიუსის სხეულის მოცულობა', `${f(GEOM.facts.rings.cathode_volume_cm3, 3)} / ${f(GEOM.facts.mobius.cathode_volume_cm3, 3)} სმ³`, srcA('geometry_facts', 'facts.{rings,mobius}.cathode_volume_cm3'), FN.mesh)}, დასველებული ფართობი ${claim('რგოლის / მიობიუსის დასველებული ფართობი', `${f(GEOM.facts.rings.cathode_area_cm2, 1)} / ${f(GEOM.facts.mobius.cathode_area_cm2, 1)} სმ²`, srcA('geometry_facts', 'facts.{rings,mobius}.cathode_area_cm2'), FN.mesh)}: ცალმხრივობა ფართობს ან მასალას არ ამატებს.`,
);
sec9.push(
  `3. ერთნაირი მასალისა და დენისას (5 A) სივრცული მოდელის ენერგიის ხარჯი (kWh/kg, N = ${N3}): ${['rings_conformal', 'mobius_conformal', 'plates_sandwich', 'rings_stacked', 'plates_pair', 'klein', 'mobius_stacked']
    .map((id) => `${NAME[id]} ${claim(`kWh/kg (სივრცული), ${NAME[id]}`, f(n(R3(id), 'kWh_per_kg_sp'), 2), src3(id, 'kWh_per_kg_sp'), FN.sec)}`)
    .join('; ')}. რიცხვითი გაურკვევლობა ≈ ±${f((worstUrange / (n(pp, 'U_sp_V') * 1e3)) * 100, 1)} %-მდე (§6.3).`,
);
sec9.push(
  `4. ერთნაირი სიმძლავრისა (${E2.baseConfig.electrical.P} W) და ერთნაირი **ჯამური** დასველებული ფართობისას (ექსპ. 2; სივრცული მოდელი, N = ${E2.solver.N}) H₂-ის ნაკადი: ${e1ids
    .map((id) => `${String(R2(id).label)} ${claim(`H₂ ერთნაირ სიმძლავრეზე (სივრცული), ${String(R2(id).label)}`, f(n(R2(id), 'nH2_sp_mmol_h'), 2) + ' mmol/h', src2(id, 'nH2_sp_mmol_h'), FN.sec)}`)
    .join('; ')}. ფირფიტებთან შედარებით: ${e1ids
    .slice(1)
    .map((id) => `${String(R2(id).label)} ${sgn(pct(n(R2(id), 'nH2_sp_mmol_h'), n(R2('plates'), 'nH2_sp_mmol_h')), 1)} %`)
    .join(', ')}. (რგოლები და მიობიუსი აქ „ერთმანეთის თავზე“ განლაგებაშია; კათოდის ფართობი ამ რეჟიმშიც განსხვავდება: ${e1ids.map((id) => f(n(R2(id), 'areaC_cm2'), 0)).join(' / ')} სმ².)`,
);
sec9.push(`5. მოდელში სხვაობებს თან ახლავს განლაგების სხვაობა — რამდენად ახლოს და რა კუთხით უყურებს ერთმანეთს ზედაპირები და გამოიყენება თუ არა კათოდის ორივე მხარე. გადაგრეხის ნიშანი განლაგებაზეა დამოკიდებული (§3.1).`);
sec9.push(`6. კონფორმული რგოლი და კონფორმული მიობიუსი მოდელში არ გაირჩევა (§7.2). ორიენტირებადი (n = 2) და არაორიენტირებადი (n = 1) გადაგრეხილი ლენტები „ერთმანეთის თავზე“ განლაგებაში ერთმანეთისგან ${f(Math.abs(pct(k2s, k1s)), 1)} %-ით განსხვავდება K-ში (§3.1).`);
sec9.push(
  `7. კლაინის ტიპის გარსში (რკალური ანოდით, ფანჯრის ღრეჩოთი ${f(gas1.dims_mm.clearance, 0)} მმ) დენი ძლიერ არათანაბრად ნაწილდება (§4); ერთნაირი მასალით მისი ხარჯი ${f(n(R3('klein'), 'kWh_per_kg_sp'), 1)} kWh/kg-ია ფირფიტების წყვილის ${f(n(pp, 'kWh_per_kg_sp'), 1)}-ის წინააღმდეგ, ხოლო ნორმალიზების გარეშე ის ყველაზე დაბალ ძაბვას აჩვენებს მხოლოდ იმიტომ, რომ ${claim('კლაინი / ფირფიტები: მასალის ფარდობა ნორმალიზების გარეშე', f(n(R1('klein'), 'material_cm3') / n(R1('plates'), 'material_cm3'), 1) + '×', src1('klein|plates', 'material_cm3'), FN.mesh)} მეტ მასალას იყენებს. ეს შედეგი ამ კონკრეტულ ანოდს ეკუთვნის: შიგნით მოთავსებული ან სხვა ფორმის ანოდი არ გამოკვლეულა.`,
);
sec9.push(
  `8. ერთნაირი მასალით გაბარიტული ყუთის მოცულობა: ფირფიტების წყვილი ${claim('გაბარიტი: ფირფიტების წყვილი', f(pp.envelope_cm3, 0) + ' სმ³', src3('plates_pair', 'envelope_cm3'), FN.env)}, სენდვიჩი ${f(ps.envelope_cm3, 0)}, კონფორმული რგოლი ${f(rc.envelope_cm3, 0)}, კონფორმული მიობიუსი ${claim('გაბარიტი: კონფორმული მიობიუსი', f(mc.envelope_cm3, 0) + ' სმ³', src3('mobius_conformal', 'envelope_cm3'), FN.env)}, კლაინი ${f(R3('klein').envelope_cm3, 0)} სმ³. (გაბარიტული ყუთი ღრუ ფორმებს სჯის; სხვა საზომი — მაგ. ელექტროლიტის მოცულობა — სხვა ფარდობებს მოგვცემდა.)\n`,
);
sec9.push(
  `**მთავარი დასკვნა.** _გამოკვლეული კონსტრუქციებისა და პარამეტრების ფარგლებში მოდელმა ვერ გამოავლინა ტოპოლოგიის (ცალმხრივობის, არაორიენტირებადობის) დამოუკიდებელი უპირატესობა წყალბადის წარმოებაში, ენერგიის ხარჯში ან გაბარიტში. ყველა გარჩევად სხვაობას თან ახლდა განლაგების, დაშორების ან ფართობის სხვაობა; იქ, სადაც ეს ფაქტორები მაქსიმალურად გათანაბრდა (კონფორმული რგოლი და კონფორმული მიობიუსი; n = 1 და n = 2 ერთნაირ განლაგებაში), სხვაობა გარჩევადობის ზღვარზე დაბალი ან მის ტოლფასი აღმოჩნდა._\n`,
);
sec9.push(`**რას არ ნიშნავს ეს დასკვნა:**\n`);
sec9.push(
  `- ეს **არ არის** მტკიცება, რომ მიობიუსის ან კლაინის ტიპის ელექტროდი ვერცერთ კონსტრუქციაში ვერ იქნება უკეთესი. გამოკვლეულია სასრული რაოდენობის განლაგება ერთ ზომასა და ერთ პარამეტრთა ნაკრებზე.\n- მოდელი სტრუქტურულად ვერ დაინახავდა უპირატესობას, რომელიც მოდის ბუშტუკების მოცილებიდან, კონვექციიდან, გაზების განცალკევებიდან ან დამზადებიდან, რადგან ეს მასში არ არის ან ყველა ფორმისთვის ერთნაირად არის დაშვებული (§2ბ, §3.3). „ვერ გამოავლინა“ ამ არხებისთვის ნიშნავს „ვერ შეამოწმა“.\n- არც უარყოფითი შედეგებია უნივერსალური: „მიობიუსი ერთმანეთის თავზე უარესია“ ეკუთვნის ხისტი გადატანისა და მინიმალური დაშორების წესს; კლაინის შედეგი — ერთ ანოდს.\n- რიცხვები კონკრეტული მოწყობილობის პროგნოზი არ არის: კინეტიკა დაუკალიბრებელია და მისი გაურკვევლობა გეომეტრიის ეფექტს აღემატება (§2დ).\n`,
);

// =============================================================================================
// §0 რა შეიცვალა
// =============================================================================================
sec0.push(`## 0. მოკლედ: რა აღმოაჩინა აუდიტმა და რა შეიცვალა\n`);
sec0.push(
  table(
    ['#', 'რა შემოწმდა', 'შედეგი', 'ქმედება'],
    [
      ['1', '„გადაგრეხა თავისთავად აუარესებს“', `არ დასტურდება: გადაუგრეხავი ცილინდრული რგოლი იმავე განლაგებაში იმავე K-ს იძლევა (${f(k0s90, 2)} და ${f(k1s, 2)} 1/m); გვერდიგვერდ გადაგრეხა ბრტყელ რგოლს სჯობს`, 'ფრაზა შეცვლილია (§3.1)'],
      ['2', '„სახელური გაზის საკეტია“', `ჯიბე ფანჯრის ღრეჩოდან იღვრება (გადმოღვრის დონე ${f(gFine.pocket.spillZ_mm, 1)} მმ ≈ ფანჯრის ზედა კიდე ${f(gas1.dims_mm.windowTop, 1)} მმ); მოცულობის ${f((gFine.pocket.regions_cm3.bodyAbove / gFine.pocket.volume_cm3) * 100, 0)} % კორპუსშია`, 'შეცვლილია ჰიპოთეზის ფორმულირებით (§3.2); დაემატა მეორე ინდიკატორი'],
      ['3', '„ბუშტუკები ერთადერთი არხია“', 'დაუსაბუთებელი ინტერპრეტაცია', 'ამოღებულია (§3.3)'],
      ['4', '„რგოლისთვის ორი ნაწილია საჭირო“', `კომპონენტების რაოდენობა (${cr.connected_components} და ${cm.connected_components}) დასტურდება, „საჭიროა“ — არა`, 'შეცვლილია (§3.4)'],
      ['5', '„აქტიური ფართობის 54–63 %“', `ეს ენტროპიული ეკვივალენტური ფართობია და არა ზღვრული წილი; ბადეზეა დამოკიდებული (${f(Math.min(...kUtilAll) * 100, 0)}–${f(Math.max(...kUtilAll) * 100, 0)} %) და არ არის დაკრებილი`, 'გადარქმეულია და განმარტებულია (§4)'],
      ['6', '≈ 2.8 % ეკონომია (ფირფიტები → კონფ. მიობიუსი)', `დასტურდება: ${f(-P_plates_mob.fine, 2)} ± ${f(P_plates_mob.range3, 2)} %; პირობებზე დამოკიდებული (${f(savMin, 1)}–${f(savMax, 1)} %)`, 'ინტერპრეტაცია დაზუსტდა: ორმხრივი განლაგების ეფექტია (§7.1)'],
      ['7', 'კონფ. რგოლი და კონფ. მიობიუსი', `ΔU = ${sgn(P_ring_mob.fineU, 1)} mV ყველაზე წვრილ ბადეზე; სხვა დისკრეტიზაციით ${sgn(Math.min(...margins.map(ringMobAt)), 1)}…${sgn(Math.max(...margins.map(ringMobAt)), 1)} mV; ღრეჩოს კონვენცია ნიშანს ცვლის — გარჩევადი არ არის`, 'დასკვნა ძალაში რჩება, ახლა დასაბუთებულია (§7.2)'],
      ['8', 'ორმაგი დათვლა მეორად ამომხსნელში', `არ აღმოჩნდა; ენერგიის ბალანსი იკვრება ${maxClosure.toExponential(0)} სიზუსტით`, 'დაემატა დამოუკიდებელი შემოწმება და ტესტები (§8)'],
      ['9', 'ბადეების შერევა ცხრილში', 'ერთიანი სვეტი N = 64-ის K-ით, სივრცული — N = 48-ზე', `გასწორებულია: ყველაფერი N = ${N3}-ზე`],
      ['10', 'მინიმალური დაშორება კლაინისთვის', `კედლის სისქით იყო გადაჭარბებული; რეალურად ${f(n(R3('klein'), 'dmin_mm'), 1)} მმ (ხარვეზი წერტილების გამეჩხერებაში)`, 'გასწორებულია, დაემატა ტესტი (§5)'],
      ['11', 'K-ის რიცხვითი გაურკვევლობა', `≈ ±${f(worstKrange, 1)} %-მდე; კრებადობა არამონოტონურია`, 'რიჩარდსონის ნაცვლად გამოიყენება გაფანტვა (§6.3)'],
      ['12', 'საბოლოო დასკვნა', 'ძველი ფორმულირება უარყოფდა ტოპოლოგიის სარგებელს ზოგადად', 'შეზღუდულია გამოკვლეული კონსტრუქციებით (§9)'],
    ],
  ),
);

// =============================================================================================
// §1 ჟურნალი (ივსება ბოლოს, რადგან claim() ზემოთ გამოიძახება)
// =============================================================================================
const sec1: string[] = [];
sec1.push(`## 1. რიცხვების წარმომავლობა\n`);
sec1.push(
  `ყოველი მნიშვნელობა ქვემოთ წაკითხულია მითითებული ფაილის მითითებული ველიდან ამ ანგარიშის გენერაციის მომენტში. ფაილების ბილიკები \`experiments/\`-ის მიმართაა. კონფიგურაცია: ექსპერიმენტის ფაილებში — ველი \`baseConfig\` (სრული, SI ერთეულებში) პლუს \`scripts/lib.ts: exp3Cases()\`; აუდიტის ფაილებში — ველი \`config\`. სვეტი → ფუნქცია სრული რუკა: თითო ექსპერიმენტის JSON-ის ველი \`functions\`.\n`,
);
sec1.push(
  `განმეორებადობა: შენახული სტრიქონების ხელახალი გამოთვლა იძლევა მაქსიმალურ ფარდობით გადახრას ${(REPRO.checks as { id: string; maxRelDeviation: number }[]).map((c) => `${c.maxRelDeviation.toExponential(1)} (${c.id})`).join(', ')} (\`audit/reproducibility.json\`).${TESTS ? ` ავტომატური ტესტები: ${TESTS.numPassedTests} / ${TESTS.numTotalTests} გავიდა (\`audit/tests.json\`, \`npm test\`).` : ''}\n`,
);
const e1c = E1.baseConfig,
  e2c = E2.baseConfig,
  e3c = E3.baseConfig;
const condOf = (src: string): string => {
  const base = (c: typeof e1c, N: string) => `${c.electrical.mode === 'I' ? `I = ${c.electrical.I} A` : `P = ${c.electrical.P} W`}; შეზღუდვა: ${c.fairness.constraint}; ${N}`;
  if (src.includes('exp{1,2,3}')) return `სამივე ექსპერიმენტი (N = ${N3}) და ბადის კვლევა (N = ${levels.join(', ')})`;
  if (src.includes('tank_margin') || src.includes('operating_point')) return base(e3c, 'N ≈ 44–95 (h ≈ 1.3 მმ) / N = 60') + ' + env.tankMargin = ' + margins.join(', ') + ' მმ / electrical.I = ' + currents.join(', ') + ' A';
  if (src.includes('metal_resistance')) return 'ექსპ. 3-ის მასშტაბირებული ზომები (კონფორმული მიობიუსი); I = 5 A; ρ(Ni) = ' + metal.rho_ohm_m + ' Ω·m';
  if (src.includes('exp1_')) return base(e1c, `N = ${E1.solver.N}`) + ' (presets()[0])';
  if (src.includes('exp2_')) return base(e2c, `N = ${E2.solver.N}`) + ' (presets()[1])';
  if (src.includes('exp3_')) return base(e3c, `N = ${N3}`) + ' (presets()[2] + exp3Cases)';
  if (src.includes('audit/twist')) return base(e3c, `N = ${TWIST.N}`) + '; geometries.mobius-ის ცვლილებები';
  if (src.includes('audit/grid')) return base(e3c, `N = ${levels.join(', ')}`);
  if (src.includes('audit/legacy')) return 'N = 48; კონფიგურაცია — id-ის პრეფიქსის მიხედვით (exp1 / exp2 / exp3)';
  if (src.includes('audit/gas_pocket')) return `კლაინი, ნაგულისხმევი ზომა (presets()[0]); N = ${gasRows1.map((r) => r.N).join(', ')}`;
  if (src.includes('audit/utilization')) return 'presets()[0/1/2]; N = 40, 60, 90';
  if (src.includes('audit/geometry_facts')) return 'ნაგულისხმევი ზომები: R = 25, w = 20, t = 1 მმ (defaultGeometries)';
  if (src.includes('audit/sensitivity')) return base(e1c, 'K: N = 64') + '; ერთიანი მოდელი';
  if (src.includes('audit/solver_tolerance')) return `${TOL.case}; N = ${TOL.N}`;
  return base(e3c, '') + ' + ცვლადი პარამეტრი (იხ. ფაილის ველი config)';
};
sec1.push(table(['#', 'მტკიცება', 'მნიშვნელობა', 'ფაილი → ველი', 'პირობები (კონფიგურაცია)', 'ფუნქცია', 'კატეგორია'], ledger.map((c, i) => [String(i + 1), c.text, c.value, '`' + c.src + '`', condOf(c.src), '`' + c.fn + '`', c.cat])));

const sec10 = [
  `## 10. ფაილები\n`,
  table(
    ['ფაილი', 'შინაარსი'],
    [
      ['`experiments/exp1_same_current.{json,csv}`', 'ერთნაირი დენი, ოთხი სისტემა, ნორმალიზების გარეშე — სრული სვეტები'],
      ['`experiments/exp2_same_power.{json,csv}`', 'ერთნაირი სიმძლავრე, ერთნაირი დასველებული ფართობი'],
      ['`experiments/exp3_equal_material.{json,csv}`', 'ერთნაირი მასალა, ყველა განლაგება (§5) + განლაგება × θ სკანირება'],
      ['`experiments/summary.md`', 'სამივე ექსპერიმენტის მოკლე ცხრილები'],
      ['`experiments/audit/grid.json`', 'ბადის გამკვრივება, 7 შემთხვევა × ' + levels.length + ' დონე (§6)'],
      ['`experiments/audit/solver_tolerance.json`', 'PCG ტოლერანსის გავლენა (§6.1)'],
      ['`experiments/audit/twist.json` (+ `.csv`)', 'გადაგრეხის კვლევა (§3.1)'],
      ['`experiments/audit/gas_pocket.json`', 'გაზის ინდიკატორები კლაინის გარსში, 4 ბადე (§3.2)'],
      ['`experiments/audit/utilization.json`', 'ეკვივალენტური ფართობი და ზღვრული წილები (§4)'],
      ['`experiments/audit/tank_margin.json` (+ `.csv`)', 'ავზის მარაგის მგრძნობელობა (§7)'],
      ['`experiments/audit/gap_convention.json`', 'ღრეჩოს კონვენცია კონფორმული მიობიუსისთვის (§7.2)'],
      ['`experiments/audit/operating_point.json`', 'დენის მგრძნობელობა (§7.1)'],
      ['`experiments/audit/sensitivity.json`', 'პარამეტრული მგრძნობელობა (§2დ)'],
      ['`experiments/audit/geometry_facts.json`', 'ფართობი, მოცულობა, ტოპოლოგია, ბმულობა, ლითონის წინაღობის შეფასება'],
      ['`experiments/audit/legacy_n48.json`', 'ადრინდელი ანგარიშის რიცხვების აღდგენა იმავე ბადეზე (N = 48)'],
      ['`experiments/audit/claims_ledger.csv`', '§1-ის წარმომავლობის ჟურნალი ცხრილის სახით'],
      ['`experiments/audit/reproducibility.json`, `tests.json`', 'განმეორებადობა და ტესტების შედეგი'],
      ['`scripts/lib.ts`, `run-experiments.ts`, `audit-compute.ts`, `audit-report.ts`', 'გამოთვლისა და ანგარიშის სკრიპტები'],
    ],
  ),
];

for (const s of [sec0, sec1, sec2, sec3, sec4, sec5, sec6, sec7, sec8, sec9, sec10]) md.push(s.join('\n'));
writeFileSync('AUDIT.md', md.join('\n'));
writeFileSync('experiments/audit/twist.csv', csvOf(TWIST.rows as Row[]));
writeFileSync('experiments/audit/tank_margin.csv', csvOf(MARGIN.rows as Row[]));
writeFileSync('experiments/audit/claims_ledger.csv', csvOf(ledger.map((c, i) => ({ n: i + 1, claim: c.text, value: c.value, source: c.src, conditions: condOf(c.src), function: c.fn, category: c.cat }))));

// ---- README-ის კვლევითი შეჯამება (იმავე მონაცემებიდან) ----
const readme = readFileSync('README.md', 'utf8');
const BEGIN = '<!-- AUDIT-SUMMARY:BEGIN (გენერირდება scripts/audit-report.ts-ით; ხელით არ შეცვალოთ) -->';
const END = '<!-- AUDIT-SUMMARY:END -->';
const summary = [
  `## კვლევითი შეჯამება (აუდიტის შემდეგ)`,
  ``,
  `სრული აუდიტი, ცხრილები და თითო რიცხვის წყარო — [AUDIT.md](AUDIT.md). ქვემოთ მოყვანილი რიცხვები ექსპერიმენტების ფაილებიდან ავტომატურად ივსება. ისინი ეკუთვნის ნაგულისხმევ, **საილუსტრაციო** პარამეტრებს და მოდელის შედეგია, არა მოწყობილობის პროგნოზი.`,
  ``,
  `### რა აჩვენა მოდელმა გამოკვლეულ კონსტრუქციებზე`,
  ``,
  `1. **ერთნაირ დენზე H₂ ერთნაირია** (${f(nH2s[0], 2)} mmol/h 5 A-ზე ოთხივე სისტემაში) — ფარადეის კანონისა და η_F = 1 დაშვების შედეგი. გეომეტრია მოქმედებს მხოლოდ ძაბვაზე.`,
  `2. **ცალმხრივობა ფართობს ან მასალას არ ამატებს:** იმავე ზომის რგოლი და მიობიუსის ლენტი — ${f(GEOM.facts.rings.cathode_volume_cm3, 2)} და ${f(GEOM.facts.mobius.cathode_volume_cm3, 2)} სმ³, ${f(GEOM.facts.rings.cathode_area_cm2, 1)} და ${f(GEOM.facts.mobius.cathode_area_cm2, 1)} სმ².`,
  `3. **გადაგრეხის ეფექტი განლაგებაზეა დამოკიდებული.** ერთმანეთის თავზე, ერთნაირი მინიმალური დაშორებით, გადაგრეხილი ლენტების K (${f(k1s, 2)} 1/m) ${f(k1s / k0s, 1)}-ჯერ მეტია ბრტყელი რგოლებისაზე (${f(k0s, 2)}), მაგრამ ტოლია გადაუგრეხავი ცილინდრული რგოლისა (${f(k0s90, 2)}); გვერდიგვერდ გადაგრეხა ბრტყელ რგოლს სჯობს (${f(k1d, 2)} და ${f(k0d, 2)}). K ${rho >= 0.8 ? 'მჭიდროდ' : 'ნაწილობრივ'} მიჰყვება ზედაპირების საშუალო დაშორებას (სპირმენის ρ = ${f(rho, 2)}); ორიენტირებადი n = 2 და არაორიენტირებადი n = 1 ერთნაირ განლაგებაში ${f(Math.abs(pct(k2s, k1s)), 1)} %-ით განსხვავდება.`,
  `4. **ორმხრივი განლაგება ეკონომიას იძლევა, ფორმის მიუხედავად.** ერთნაირი მასალითა და 5 A-ზე (სივრცული მოდელი, N = ${N3}, kWh/kg): კონფორმული რგოლი ${f(n(rc, 'kWh_per_kg_sp'), 2)}, კონფორმული მიობიუსი ${f(n(mc, 'kWh_per_kg_sp'), 2)}, ფირფიტების სენდვიჩი ${f(n(ps, 'kWh_per_kg_sp'), 2)}, ფირფიტების წყვილი ${f(n(pp, 'kWh_per_kg_sp'), 2)}. ფირფიტების წყვილთან შედარებით კონფორმული მიობიუსის ეკონომია ${f(-P_plates_mob.fine, 1)} ± ${f(P_plates_mob.range3, 1)} %-ია (პირობების მიხედვით ${f(savMin, 1)}–${f(savMax, 1)} %), ${f(n(mc, 'envelope_cm3') / n(pp, 'envelope_cm3'), 1)}-ჯერ დიდი გაბარიტის ფასად.`,
  `5. **კონფორმული რგოლი და კონფორმული მიობიუსი არ გაირჩევა:** ერთნაირი N-ის ბადეებზე ΔU ≈ ${sgn(P_ring_mob.fineU, 1)} mV, სხვა დისკრეტიზაციით ${sgn(Math.min(...margins.map(ringMobAt)), 1)}…${sgn(Math.max(...margins.map(ringMobAt)), 1)} mV; ღრეჩოს განსაზღვრის კონვენცია სხვაობას ${sgn(gapEffect_mV, 1)} mV-ით ცვლის (ნიშანი იცვლება), ხოლო არამოდელირებული ლითონის წინაღობა იმავე რიგისაა (≈ ${f(Math.abs(metalDiff), 1)} mV).`,
  `6. **კლაინის ტიპის გარსში დენი ძლიერ არათანაბრად ნაწილდება** (კინეტიკურად ეკვივალენტური ფართობი დასველებულის ≈ ${f(Math.min(...kFine.map((r) => r.utilC_kin)) * 100, 0)}–${f(Math.max(...kFine.map((r) => r.utilC_kin)) * 100, 0)} % ყველაზე წვრილ ბადეზე; რიცხვი ბადესთან ერთად კლებულობს). ერთნაირი მასალით მისი ხარჯი ${f(n(R3('klein'), 'kWh_per_kg_sp'), 1)} kWh/kg-ია. შედეგი ერთ კონკრეტულ (გარე, რკალურ) ანოდს ეკუთვნის.`,
  `7. **გეომეტრიული ჰიპოთეზა:** კლაინის გარსში ფანჯრის ზედა კიდის ზემოთ არის ≈ ${f(gFine.pocket.volume_cm3, 0)} სმ³ ჰიდროსტატიკური ჯიბე (კათოდის ფართობის ≈ ${f(pocketAreaRange[0] * 100, 0)}–${f(pocketAreaRange[1] * 100, 0)} %), რომელიც ფანჯრის ღრეჩოდან იღვრება. ივსება თუ არა ის რეალურად გაზით — მოდელი ვერ ადგენს.`,
  ``,
  `**მთავარი დასკვნა.** გამოკვლეული კონსტრუქციებისა და პარამეტრების ფარგლებში მოდელმა ვერ გამოავლინა ტოპოლოგიის (ცალმხრივობის, არაორიენტირებადობის) დამოუკიდებელი უპირატესობა: ყველა გარჩევად სხვაობას თან ახლდა განლაგების, დაშორების ან ფართობის სხვაობა, და იქ, სადაც ეს ფაქტორები მაქსიმალურად გათანაბრდა, სხვაობა გარჩევადობის ზღვარზე დაბალი აღმოჩნდა. ეს **არ არის** მტკიცება, რომ ასეთი უპირატესობა არცერთ კონსტრუქციაში არ არსებობს: მოდელი ვერ ამოწმებს იმ არხებს, რომლებიც მასში არ შედის.`,
  ``,
  `### რა ვერ დაადგინა მოდელმა`,
  ``,
  `- მოდელში არ არის ბუშტუკების დინამიკა, კონვექცია, კონცენტრაციული პოლარიზაცია, ტემპერატურული ველი, დიაფრაგმა და ლითონის წინაღობა; θ და ε ყველა ფორმისთვის ერთნაირი დაშვებაა. ამ არხებით გამოწვეულ უპირატესობას ან ზიანს მოდელი სტრუქტურულად ვერ დაინახავს და ვერც მათ შედარებით წონას შეაფასებს.`,
  `- კინეტიკა დაუკალიბრებელია: კათოდის α-ს ±20 % ცვლილება kWh/kg-ს ${sgn(SENS.cases.mobius_default_stacked.rows.find((r: { param: string }) => r.param === 'კათოდი α').dHigh, 1)} / ${sgn(SENS.cases.mobius_default_stacked.rows.find((r: { param: string }) => r.param === 'კათოდი α').dLow, 1)} %-ით ცვლის, K-ის ±20 % — ±${f(Math.abs(SENS.cases.mobius_default_stacked.rows.find((r: { param: string }) => r.param === 'K (გეომეტრია)').dHigh), 1)} %-ით.`,
  `- რიცხვითი გაურკვევლობა: K ≈ ±${f(worstKrange, 1)} %-მდე, სივრცული ძაბვა ≈ ±${f(worstUrange, 0)} mV-მდე; კრებადობა არამონოტონურია.`,
  `- გამოკვლეულია ერთი ზომის კლასი, ერთი ელექტროლიტი და სასრული რაოდენობის განლაგება; კლაინის გარსისთვის — ერთი ანოდი.`,
  ``,
  `### რა გაზომვებია საჭირო დასადასტურებლად`,
  ``,
  `1. **კინეტიკის კალიბრაცია:** პოლარიზაციის მრუდები (ტაფელის დახრა, j₀) იმავე მასალის ბრტყელ ელექტროდზე, სამელექტროდიან უჯრედში.`,
  `2. **ომური წინაღობა:** იმპედანსის სპექტროსკოპია ან დენის წყვეტის მეთოდი თითო გეომეტრიაზე — პირდაპირი შედარება მოდელის K/κ-სთან.`,
  `3. **ძაბვა–დენის მახასიათებლები** ერთნაირი მასალით, დაშორებითა და ელექტროლიტით, განმეორებებითა და ცდომილების შეფასებით; კონფორმული რგოლისა და მიობიუსის გასარჩევად საჭიროა ≈ 1 mV-ზე უკეთესი განმეორებადობა.`,
  `4. **გაზის ფაქტობრივი გამოსავალი** — ფარადეული ეფექტიანობისა და გაზების ურთიერთშეღწევის გასაზომად.`,
  `5. **ბუშტუკების დაფარვა და მოცილება:** ჩქაროსნული ვიდეოგადაღება სხვადასხვა ორიენტაციასა და დენის სიმკვრივეზე; ძაბვის დრეიფი დროში; კლაინის გარსში — ივსება თუ არა ჯიბე და საიდან გადის გაზი.`,
  `6. **დენის განაწილება:** სეგმენტირებული ელექტროდი ან ლოკალური პოტენციალის ზონდი.`,
  ``,
].join('\n');
let out: string;
if (readme.includes(BEGIN) && readme.includes(END)) {
  out = readme.slice(0, readme.indexOf(BEGIN)) + BEGIN + '\n' + summary + END + readme.slice(readme.indexOf(END) + END.length);
} else {
  const a = readme.indexOf('## კვლევითი შეჯამება');
  const b = readme.indexOf('---\n\n## შეზღუდვები');
  if (a < 0 || b < 0) throw new Error('README-ში კვლევითი შეჯამების სექცია ვერ მოიძებნა');
  out = readme.slice(0, a) + BEGIN + '\n' + summary + END + '\n\n' + readme.slice(b);
}
writeFileSync('README.md', out);
console.log(`AUDIT.md: ${md.join('\n').length} სიმბოლო; ჟურნალი: ${ledger.length} ჩანაწერი; README განახლებულია`);
