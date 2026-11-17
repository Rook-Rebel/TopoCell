// მომზადებული ექსპერიმენტების უთავო (headless) გაშვება: იგივე გამოთვლითი ბირთვი, რაც აპლიკაციაში.
// შედეგები იწერება experiments/ საქაღალდეში (JSON + CSV + summary.md).  გაშვება: npm run experiments
//
// აუდიტის შემდეგ: (1) ერთიანი და სივრცული მოდელი ერთსა და იმავე ბადეზე ითვლება (N = 64);
// (2) თითო სტრიქონში ჩაწერილია ყველა პირობა (I, U, P, ṅ, η_F, ფართობები, მასალა, დაშორება, გაბარიტი, ბადე);
// (3) ფაილში ინახება სრული კონფიგურაცია და სვეტი → ფუნქცია რუკა.
import { mkdirSync, writeFileSync } from 'node:fs';
import { APP_VERSION } from '../src/core/constants';
import { KIND_SHORT, KINDS } from '../src/core/geometry/cell';
import { FAIR_LABEL, LabConfig, toCsv } from '../src/core/lab';
import { presets } from '../src/core/presets';
import { ARRANGEMENT_LABEL, runScan } from '../src/core/scan';
import { FUNCTIONS, Row, applyCase, csvOf, exp3Cases, f, fullRow, mdTable } from './lib';

const OUT = 'experiments';
mkdirSync(OUT, { recursive: true });
export const N_MAIN = 64;

function save(name: string, title: string, cfg: LabConfig, rows: Row[], extra: Record<string, unknown> = {}) {
  writeFileSync(`${OUT}/${name}.csv`, csvOf(rows));
  writeFileSync(
    `${OUT}/${name}.json`,
    JSON.stringify(
      {
        app: 'TopoCell',
        version: APP_VERSION,
        name: title,
        generatedBy: 'scripts/run-experiments.ts',
        savedAt: new Date().toISOString(),
        units: 'კონფიგურაცია — SI; სტრიქონების სვეტები — სახელში მითითებული ერთეულით',
        solver: { N: N_MAIN, note: 'პირველადი და მეორადი ამოხსნა ერთსა და იმავე ბადეზე; PCG ტოლერანსი 1e-9' },
        functions: FUNCTIONS,
        baseConfig: cfg,
        rows,
        ...extra,
      },
      null,
      2,
    ),
  );
}

const stdCols: [string, (r: Row) => string][] = [
  ['მოდელი', (r) => String(r.label)],
  ['λ', (r) => f(r.lambda, 3)],
  ['A კათ. / ან., სმ²', (r) => `${f(r.areaC_cm2, 1)} / ${f(r.areaA_cm2, 1)}`],
  ['მასალა, სმ³', (r) => f(r.material_cm3, 3)],
  ['გაბარიტი, სმ³', (r) => f(r.envelope_cm3, 0)],
  ['d მინ. / საშ., მმ', (r) => `${f(r.dmin_mm, 2)} / ${f(r.dmean_mm, 1)}`],
  ['K, 1/m', (r) => f(r.K_1_m, 3)],
  ['I, A', (r) => f(r.I_A, 3)],
  ['U, V', (r) => f(r.U_V, 4)],
  ['P, W', (r) => f(r.P_W, 3)],
  ['H₂, mmol/h', (r) => f(r.nH2_mmol_h, 2)],
  ['kWh/kg', (r) => f(r.kWh_per_kg, 2)],
  ['U სივრც., V', (r) => f(r.U_sp_V, 4)],
  ['kWh/kg სივრც.', (r) => f(r.kWh_per_kg_sp, 2)],
];

let md = `# TopoCell — მომზადებული ექსპერიმენტების შედეგები\n\nგენერირებულია სკრიპტით \`npm run experiments\` (ვერსია ${APP_VERSION}). ყველა სტრიქონი ერთ ბადეზეა ამოხსნილი (N = ${N_MAIN}): „U“ — ერთიანი მოდელი ამ ბადის K-ით; „სივრც.“ — მეორადი განაწილება იმავე ბადეზე. პარამეტრები ნაგულისხმევია (საილუსტრაციო დაშვებები). სრული სვეტები — შესაბამის CSV/JSON ფაილებში; რიცხვითი გაურკვევლობა და ინტერპრეტაცია — AUDIT.md-ში.\n\n`;
const t0 = Date.now();
const P = presets();

for (const [i, name] of [
  [0, 'exp1_same_current'],
  [1, 'exp2_same_power'],
] as const) {
  const cfg = P[i].config;
  const rows = KINDS.map((k) => fullRow(cfg, k, k, KIND_SHORT[k], N_MAIN));
  save(name, P[i].title, cfg, rows);
  const e = cfg.electrical;
  md += `## ${P[i].title}\n\nრეჟიმი: ${e.mode === 'I' ? `I = ${e.I} A` : `P = ${e.P} W`}; ${FAIR_LABEL[cfg.fairness.constraint]}.\n\n${mdTable(rows, stdCols)}\n`;
  console.log(name, 'done', ((Date.now() - t0) / 1000).toFixed(0) + 's');
}
{
  const cfg = P[2].config;
  const rows = exp3Cases().map((c) => {
    const r = fullRow(applyCase(cfg, c), c.kind, c.id, c.label, N_MAIN);
    console.log('  ', c.id, r.valid ? `K=${f(r.K_1_m, 3)} U=${f(r.U_V, 4)} Usp=${f(r.U_sp_V, 4)} closure=${Number(r.energy_closure).toExponential(1)}` : 'INVALID');
    return r;
  });
  const scan = runScan(cfg, P[2].scan!);
  save('exp3_equal_material', P[2].title, cfg, rows, { caseNote: 'თითო სტრიქონის კონფიგურაცია = baseConfig + scripts/lib.ts: exp3Cases()[id].mut', scan: { spec: P[2].scan, rows: scan.rows, summary: scan.summary } });
  const arr = ['stacked', 'side', 'nested', 'conformal'];
  writeFileSync(
    `${OUT}/exp3_scan_arrangement_theta.csv`,
    toCsv(
      ['arrangement', 'theta', 'feasible', 'reasons', 'kWh_per_kg', 'U_V', 'K_1_m', 'lambda', 'material_cm3'],
      scan.rows.map((r) => [arr[Math.round(r.values[0])], r.values[1], r.feasible ? 1 : 0, r.reasons.join(' | '), r.objective, r.U, r.K, r.lambda, r.volume * 1e6]),
    ),
  );
  md += `## ${P[2].title}\n\nრეჟიმი: I = ${cfg.electrical.I} A; ${FAIR_LABEL[cfg.fairness.constraint]} (საბაზისო: A ფირფიტები, წყვილი).\n\n${mdTable(rows, [...stdCols, ['შენიშვნა', (r) => (r.valid ? String(r.note ?? '') : 'დაუშვებელი: ' + r.note)]])}\n`;
  md += `### θ-ის მგრძნობელობა (მიობიუსი, განლაგება × θ; kWh/kg, ერთიანი მოდელი, N = ${P[2].scan!.resolution})\n\n`;
  const thetas = [...new Set(scan.rows.map((r) => r.values[1]))];
  md += `| განლაგება | ${thetas.map((t) => 'θ = ' + t.toFixed(2)).join(' | ')} |\n|---|${thetas.map(() => '---').join('|')}|\n`;
  for (let a = 0; a < 4; a++)
    md += `| ${ARRANGEMENT_LABEL[arr[a]]} | ${thetas.map((t) => { const r = scan.rows.find((x) => Math.round(x.values[0]) === a && x.values[1] === t)!; return r.feasible ? f(r.objective, 2) : '✕'; }).join(' | ')} |\n`;
  console.log('exp3 done', ((Date.now() - t0) / 1000).toFixed(0) + 's');
}
writeFileSync(`${OUT}/summary.md`, md);
console.log('written', OUT);
