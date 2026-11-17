import { useMemo } from 'react';
import { KIND_SHORT, KINDS, Kind } from '../core/geometry/cell';
import { LabConfig, targetValue } from '../core/lab';
import { CellModel, production, solveOperating, voltageAt } from '../core/physics';
import { OBJECTIVE_LABEL, OBJECTIVE_UNIT, SCAN_PARAM_LABEL, SCAN_PARAM_UNIT, ScanSpec } from '../core/scan';
import { Series, StackBars, Tornado, TornadoRow, XYChart } from './charts';
import { SERIES_VAR } from './format';
import { Lab } from './useLab';

function opMetric(cfg: LabConfig, m: CellModel): number {
  const op = solveOperating(cfg.electrical.mode, targetValue(cfg), m);
  return production(op.b, m, 3600).kwhPerKg;
}

export function ChartsPanel({ lab }: { lab: Lab }) {
  const { cfg, evals } = lab;
  const kinds = KINDS.filter((k) => evals[k].valid && evals[k].model && evals[k].b);
  const active = cfg.active;
  const modeText = cfg.electrical.mode === 'I' ? 'ფიქსირებული დენი' : cfg.electrical.mode === 'U' ? 'ფიქსირებული ძაბვა' : 'ფიქსირებული სიმძლავრე';

  const curves = useMemo(() => {
    const iRef = Math.max(0.5, ...kinds.map((k) => evals[k].b!.I));
    const iMax = iRef * 2;
    const n = 60;
    const iv: Series[] = [],
      hp: Series[] = [],
      eh: Series[] = [];
    for (const k of kinds) {
      const m = evals[k].model!;
      const a: Series = { id: k, name: KIND_SHORT[k], color: SERIES_VAR[k], pts: [] };
      const b: Series = { ...a, pts: [] };
      const c: Series = { ...a, pts: [] };
      for (let i = 1; i <= n; i++) {
        const I = (iMax * i) / n;
        const v = voltageAt(I, m);
        const p = production(v, m, 3600);
        a.pts.push({ x: I, y: v.U });
        b.pts.push({ x: v.P, y: p.nH2 * 3.6e6 });
        c.pts.push({ x: p.nH2 * 3.6e6, y: p.kwhPerKg });
      }
      iv.push(a);
      hp.push(b);
      eh.push(c);
    }
    return { iv, hp, eh };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(kinds.map((k) => [evals[k].model, evals[k].b?.I]))]);

  const timeSeries = useMemo(() => {
    const dur = cfg.electrical.duration;
    const s: Series[] = kinds.map((k) => ({
      id: k,
      name: `H₂ · ${KIND_SHORT[k]}`,
      color: SERIES_VAR[k],
      pts: [0, 0.25, 0.5, 0.75, 1].map((f) => ({ x: (f * dur) / 60, y: evals[k].prod!.nH2 * f * dur * 1000 })),
    }));
    if (evals[active].valid && evals[active].prod)
      s.push({
        id: 'o2',
        name: `O₂ · ${KIND_SHORT[active]}`,
        color: SERIES_VAR[active],
        dashed: true,
        pts: [0, 0.5, 1].map((f) => ({ x: (f * dur) / 60, y: evals[active].prod!.nO2 * f * dur * 1000 })),
      });
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(kinds.map((k) => evals[k].prod?.nH2)), cfg.electrical.duration, active]);

  const thetaSeries = useMemo(() => {
    return kinds.map((k) => {
      const m = evals[k].model!;
      const pts = [];
      for (let i = 0; i <= 16; i++) {
        const th = (0.8 * i) / 16;
        pts.push({ x: th, y: opMetric(cfg, { ...m, thetaA: th, thetaC: th }) });
      }
      return { id: k, name: KIND_SHORT[k], color: SERIES_VAR[k], pts } as Series;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(kinds.map((k) => evals[k].model)), cfg.electrical.mode, targetValue(cfg)]);

  const tornado = useMemo<TornadoRow[]>(() => {
    const e = evals[active];
    if (!e.valid || !e.model) return [];
    const m = e.model;
    const base = opMetric(cfg, m);
    const eff = (mm: CellModel) => ((opMetric(cfg, mm) - base) / base) * 100;
    const rows: TornadoRow[] = [
      { name: 'გეომეტრია: K', lowLabel: '−20 %', highLabel: '+20 %', low: eff({ ...m, K: m.K * 0.8 }), high: eff({ ...m, K: m.K * 1.2 }) },
      { name: 'გამტარობა κ', lowLabel: '−20 %', highLabel: '+20 %', low: eff({ ...m, kappa: m.kappa * 0.8 }), high: eff({ ...m, kappa: m.kappa * 1.2 }) },
      { name: 'დასველებული ფართობი', lowLabel: '−20 %', highLabel: '+20 %', low: eff({ ...m, areaA: m.areaA * 0.8, areaC: m.areaC * 0.8 }), high: eff({ ...m, areaA: m.areaA * 1.2, areaC: m.areaC * 1.2 }) },
      { name: 'დაფარვა θ (ორივე)', lowLabel: '−0.10', highLabel: '+0.10', low: eff({ ...m, thetaA: Math.max(0, m.thetaA - 0.1), thetaC: Math.max(0, m.thetaC - 0.1) }), high: eff({ ...m, thetaA: Math.min(0.95, m.thetaA + 0.1), thetaC: Math.min(0.95, m.thetaC + 0.1) }) },
      { name: 'კათოდი: j₀', lowLabel: '÷2', highLabel: '×2', low: eff({ ...m, kinC: { ...m.kinC, j0: m.kinC.j0 / 2 } }), high: eff({ ...m, kinC: { ...m.kinC, j0: m.kinC.j0 * 2 } }) },
      { name: 'ანოდი: j₀', lowLabel: '÷2', highLabel: '×2', low: eff({ ...m, kinA: { ...m.kinA, j0: m.kinA.j0 / 2 } }), high: eff({ ...m, kinA: { ...m.kinA, j0: m.kinA.j0 * 2 } }) },
      { name: 'კათოდი: α', lowLabel: '−20 %', highLabel: '+20 %', low: eff({ ...m, kinC: { ...m.kinC, alphaF: m.kinC.alphaF * 0.8 } }), high: eff({ ...m, kinC: { ...m.kinC, alphaF: m.kinC.alphaF * 1.2 } }) },
      { name: 'ანოდი: α', lowLabel: '−20 %', highLabel: '+20 %', low: eff({ ...m, kinA: { ...m.kinA, alphaF: m.kinA.alphaF * 0.8 } }), high: eff({ ...m, kinA: { ...m.kinA, alphaF: m.kinA.alphaF * 1.2 } }) },
      { name: 'უხეშობა f_r', lowLabel: '—', highLabel: '×2', low: NaN, high: eff({ ...m, roughness: m.roughness * 2 }) },
    ];
    return rows.sort((a, b) => Math.max(Math.abs(b.low) || 0, Math.abs(b.high) || 0) - Math.max(Math.abs(a.low) || 0, Math.abs(a.high) || 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(evals[active].model), cfg.electrical.mode, targetValue(cfg)]);

  const breakdown = kinds.map((k) => {
    const b = evals[k].b!;
    return {
      id: k,
      name: KIND_SHORT[k],
      swatch: SERIES_VAR[k],
      total: b.U,
      parts: [
        { id: 'erev', name: 'E_rev (თერმოდინამიკური მინიმუმი)', color: 'var(--comp-erev)', value: b.eRev },
        { id: 'etaa', name: 'η_a (ანოდი)', color: 'var(--comp-etaa)', value: b.etaA },
        { id: 'etac', name: '|η_c| (კათოდი)', color: 'var(--comp-etac)', value: b.etaC },
        { id: 'ohm', name: 'I·R (ომური)', color: 'var(--comp-ohm)', value: b.ohmic },
      ],
    };
  });
  const markers = (get: (k: Kind) => { x: number; y: number }) => kinds.map((k) => ({ ...get(k), color: SERIES_VAR[k], name: KIND_SHORT[k] }));

  // გეომეტრიის პარამეტრის გავლენა: ბოლო ერთღერძიანი სკანირება
  const scan = lab.scan;
  const scan1d = scan && scan.spec.axes.length === 1 && !scan.running && scan.rows.length > 0 ? scan : null;
  const gapSpec: ScanSpec = {
    kind: active,
    axes: [{ param: 'gap', min: Math.max(cfg.env.minGap, 0.003), max: 0.03, steps: 7 }],
    objective: 'kwhPerKg',
    maxVolume: null,
    maxEnvelope: null,
    resolution: Math.min(cfg.solver.resolution, 48),
    refineTop: 1,
    refineResolution: 64,
  };
  let scanChart = null;
  if (scan1d) {
    const ax = scan1d.spec.axes[0];
    const u = SCAN_PARAM_UNIT[ax.param];
    const o = OBJECTIVE_UNIT[scan1d.spec.objective];
    const pts = scan1d.rows.filter((r) => Number.isFinite(r.objective)).map((r) => ({ x: r.values[0] * u.scale, y: r.objective * o.scale }));
    const kpts = scan1d.rows.filter((r) => Number.isFinite(r.K)).map((r) => ({ x: r.values[0] * u.scale, y: r.K }));
    scanChart = (
      <>
        <XYChart
          title={`გეომეტრიის პარამეტრის გავლენა: ${SCAN_PARAM_LABEL[ax.param]} → ${OBJECTIVE_LABEL[scan1d.spec.objective]}`}
          sub={`${KIND_SHORT[scan1d.spec.kind]} · 3D ამომხსნელი თითო წერტილზე (N = ${scan1d.spec.resolution})`}
          series={[{ id: 's', name: KIND_SHORT[scan1d.spec.kind], color: SERIES_VAR[scan1d.spec.kind], pts }]}
          xLabel={`${SCAN_PARAM_LABEL[ax.param]}${u.unit ? ', ' + u.unit : ''}`}
          yLabel={o.unit}
          points
          note={scan1d.summary?.text}
        />
        <XYChart
          title={`უჯრედის მუდმივა K: ${SCAN_PARAM_LABEL[ax.param]}-ზე დამოკიდებულება`}
          sub="გამოთვლილი ველიდან; შედარებისთვის — K ∝ d მხოლოდ იდეალურ 1D შემთხვევაშია"
          series={[{ id: 'k', name: 'K', color: SERIES_VAR[scan1d.spec.kind], pts: kpts }]}
          xLabel={`${SCAN_PARAM_LABEL[ax.param]}${u.unit ? ', ' + u.unit : ''}`}
          yLabel="K, 1/m"
          points
        />
      </>
    );
  }

  return (
    <div className="panel">
      <div className="hint">
        წირები აგებულია ერთიანი მოდელით, თითო გეომეტრიის K-ით (
        {kinds.map((k) => `${KIND_SHORT[k]}: ${evals[k].kSource === 'solver' ? '3D' : 'უხეში'}`).join(' · ')}). წერტილი — მიმდინარე სამუშაო წერტილი ({modeText}).
      </div>
      <div className="chart-grid">
        <XYChart
          title="I–U მახასიათებელი"
          sub="უჯრედის ძაბვა დენის მიხედვით"
          series={curves.iv}
          xLabel="დენი I, A"
          yLabel="U, V"
          markers={markers((k) => ({ x: evals[k].b!.I, y: evals[k].b!.U }))}
        />
        <StackBars title="ძაბვის შემადგენლები სამუშაო წერტილზე" sub="U = E_rev + η_a + |η_c| + I·R" rows={breakdown} unit="V" note="გეომეტრია პირდაპირ მოქმედებს მხოლოდ I·R წევრზე (K-ის გავლით) და — ფართობის გავლით — გადაძაბვებზე." />
        <XYChart
          title="წყალბადის წარმოება სიმძლავრის მიხედვით"
          sub="იმავე სიმძლავრეზე მაღლა მდებარე წირი = მეტი H₂"
          series={curves.hp}
          xLabel="სიმძლავრე P, W"
          yLabel="H₂, mmol/h"
          yFromZero
          markers={markers((k) => ({ x: evals[k].b!.P, y: evals[k].prod!.nH2 * 3.6e6 }))}
        />
        <XYChart
          title="ენერგიის ხარჯი წარმოების მიხედვით"
          sub="დაბლა მდებარე წირი = ნაკლები ენერგია იმავე წარმოებაზე"
          series={curves.eh}
          xLabel="H₂, mmol/h"
          yLabel="kWh/kg H₂"
          markers={markers((k) => ({ x: evals[k].prod!.nH2 * 3.6e6, y: evals[k].prod!.kwhPerKg }))}
          note="ჰორიზონტალური საზღვარი 39.4 kWh/kg (HHV) მიუღწეველია: ის U = 1.481 V-ს შეესაბამება."
        />
        <XYChart
          title="გაზის რაოდენობა დროში"
          sub="სტაციონარული სამუშაო წერტილი; წყვეტილი — O₂ (აქტიური მოდელი)"
          series={timeSeries}
          xLabel="დრო, წთ"
          yLabel="დაგროვილი რაოდენობა, mmol"
          yFromZero
          note={cfg.electrical.mode === 'I' ? 'ფიქსირებული დენისას H₂-ის წირები ყველა გეომეტრიისთვის ერთმანეთს ზუსტად ემთხვევა (ფარადეის კანონი).' : undefined}
        />
        <XYChart
          title="მგრძნობელობა ბუშტუკებით დაფარვის მიმართ"
          sub={`kWh/kg, როცა θ ორივე ელექტროდზე ერთნაირად იცვლება · ${modeText}`}
          series={thetaSeries}
          xLabel="დაფარვის წილი θ"
          yLabel="kWh/kg H₂"
          note="θ ყველა ფორმისთვის ერთნაირადაა დაშვებული. თუ წირებს შორის მანძილი θ-ის რეალისტურ გაურკვევლობაზე (≈ ±0.1…0.2) ნაკლებია, ფორმების შედარება ბუშტუკების გაზომვის გარეშე ვერ დასრულდება."
        />
        <Tornado
          title={`მგრძნობელობა პარამეტრების მიმართ — ${KIND_SHORT[active]}`}
          sub={`kWh/kg-ის ცვლილება, % · ${modeText}`}
          rows={tornado}
          unit="%"
          note="შეადარეთ სტრიქონი „გეომეტრია: K“ კინეტიკურ პარამეტრებს: თუ j₀-ისა და α-ს გაურკვევლობა K-ის ეფექტს ფარავს, გეომეტრიის სარგებლის დასადასტურებლად ჯერ კინეტიკის კალიბრაციაა საჭირო."
        />
        {scanChart ?? (
          <div className="card chart">
            <div className="chart-head">
              <div>
                <h4>გეომეტრიის პარამეტრის გავლენა შედეგზე</h4>
                <div className="sub">საჭიროებს 3D ამოხსნას თითო წერტილზე (ფონურ ნაკადში)</div>
              </div>
            </div>
            <p className="hint" style={{ margin: '10px 0' }}>
              აქ გამოჩნდება ბოლო ერთპარამეტრიანი სკანირება. სწრაფი დაწყება: აქტიური მოდელის დაშორების სკანირება 7 წერტილზე. სხვა პარამეტრები — ჩანართში „ექსპერიმენტები“.
            </p>
            <button className="btn primary" disabled={lab.scan?.running || !evals[active].valid} onClick={() => lab.runScan(gapSpec)}>
              {lab.scan?.running ? `მიმდინარეობს… ${lab.scan.done}/${lab.scan.total}` : `დაშორების სკანირება — ${KIND_SHORT[active]}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
