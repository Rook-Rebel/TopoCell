import { useEffect, useMemo, useRef, useState } from 'react';
import { APP_VERSION } from '../core/constants';
import { KIND_LABEL, KIND_SHORT, KINDS, Kind } from '../core/geometry/cell';
import { LabConfig, toCsv } from '../core/lab';
import { presets } from '../core/presets';
import {
  ARRANGEMENT_LABEL,
  OBJECTIVE_LABEL,
  OBJECTIVE_UNIT,
  Objective,
  SCAN_PARAM_LABEL,
  SCAN_PARAM_UNIT,
  ScanAxis,
  ScanParam,
  ScanRow,
  ScanSpec,
  applyScanValue,
  arrangementOptions,
  axisValues,
  rankRows,
  scanParamsFor,
} from '../core/scan';
import { Heatmap, XYChart } from './charts';
import { Notice, Tag } from './controls';
import { SERIES_VAR, download, fmt, sig } from './format';
import { Lab } from './useLab';

const LIST_KEY = 'topocell.experiments.v1';

interface Snapshot {
  valid: boolean;
  kSource: string;
  K: number;
  I: number;
  U: number;
  P: number;
  nH2: number;
  kwhPerKg: number;
  areaC: number;
  volume: number;
  envelopeVolume: number;
  lambda: number;
}
interface SavedExperiment {
  app: 'TopoCell';
  version: string;
  name: string;
  savedAt: string;
  units: 'SI';
  config: LabConfig;
  results: Record<Kind, Snapshot>;
  scan?: { spec: ScanSpec; rows: ScanRow[]; summary: unknown };
}

function snapshot(lab: Lab): Record<Kind, Snapshot> {
  const out = {} as Record<Kind, Snapshot>;
  for (const k of KINDS) {
    const e = lab.evals[k];
    out[k] = {
      valid: e.valid,
      kSource: e.kSource,
      K: e.K,
      I: e.b?.I ?? NaN,
      U: e.b?.U ?? NaN,
      P: e.b?.P ?? NaN,
      nH2: e.prod?.nH2 ?? NaN,
      kwhPerKg: e.prod?.kwhPerKg ?? NaN,
      areaC: e.areaC,
      volume: e.volume,
      envelopeVolume: e.envelopeVolume,
      lambda: e.lambda,
    };
  }
  return out;
}

function loadList(): SavedExperiment[] {
  try {
    return JSON.parse(localStorage.getItem(LIST_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function defaultAxis(kind: Kind, param: ScanParam, cfg: LabConfig): ScanAxis {
  const g = cfg.geometries;
  const size = kind === 'plates' ? g.plates.width : kind === 'klein' ? g.klein.bodyRadius : g[kind].radius;
  const width = kind === 'plates' ? g.plates.width : kind === 'klein' ? 0.02 : g[kind].width;
  switch (param) {
    case 'size':
      return { param, min: size * 0.6, max: size * 1.6, steps: 6 };
    case 'width':
      return { param, min: width * 0.5, max: width * 1.5, steps: 6 };
    case 'gap':
      return { param, min: Math.max(cfg.env.minGap, 0.003), max: 0.03, steps: 7 };
    case 'rz':
    case 'rx':
      return { param, min: 0, max: 180, steps: 7 };
    case 'theta':
      return { param, min: 0, max: 0.6, steps: 7 };
    case 'span':
      return { param, min: 90, max: 300, steps: 6 };
    case 'arrangement':
      return { param, min: 0, max: arrangementOptions(kind).length - 1, steps: arrangementOptions(kind).length };
  }
}

function valueLabel(kind: Kind, param: ScanParam, v: number): string {
  if (param === 'arrangement') return ARRANGEMENT_LABEL[arrangementOptions(kind)[Math.round(v)]] ?? String(v);
  const u = SCAN_PARAM_UNIT[param];
  return `${sig(v * u.scale, 3)}${u.unit ? ' ' + u.unit : ''}`;
}

function AxisEditor({ kind, axis, onChange, cfg, onRemove }: { kind: Kind; axis: ScanAxis; onChange: (a: ScanAxis) => void; cfg: LabConfig; onRemove?: () => void }) {
  const u = SCAN_PARAM_UNIT[axis.param];
  const cat = axis.param === 'arrangement';
  const num = (v: number, set: (x: number) => void, w = 74) => (
    <input
      className="sel"
      style={{ width: w, textAlign: 'right' }}
      value={String(+(v * u.scale).toFixed(4))}
      onChange={(e) => {
        const x = Number(e.target.value.replace(',', '.'));
        if (Number.isFinite(x)) set(x / u.scale);
      }}
    />
  );
  return (
    <div className="row">
      <select className="sel" style={{ width: 230 }} value={axis.param} onChange={(e) => onChange(defaultAxis(kind, e.target.value as ScanParam, cfg))}>
        {scanParamsFor(kind).map((p) => (
          <option key={p} value={p}>
            {SCAN_PARAM_LABEL[p]}
          </option>
        ))}
      </select>
      {cat ? (
        <span className="sub">ყველა ვარიანტი ({arrangementOptions(kind).length})</span>
      ) : (
        <>
          {num(axis.min, (x) => onChange({ ...axis, min: x }))}
          <span className="sub">…</span>
          {num(axis.max, (x) => onChange({ ...axis, max: x }))}
          <span className="sub">{u.unit}</span>
          <input
            className="sel"
            style={{ width: 52, textAlign: 'right' }}
            value={axis.steps}
            onChange={(e) => {
              const x = Math.round(Number(e.target.value));
              if (x >= 2 && x <= 15) onChange({ ...axis, steps: x });
            }}
          />
          <span className="sub">ბიჯი</span>
        </>
      )}
      {onRemove && (
        <button className="btn small" onClick={onRemove}>
          მოშორება
        </button>
      )}
    </div>
  );
}

export function ExperimentsPanel({ lab }: { lab: Lab }) {
  const { cfg } = lab;
  const [list, setList] = useState<SavedExperiment[]>(loadList);
  const [name, setName] = useState('');
  const [repro, setRepro] = useState<SavedExperiment | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<Kind>(cfg.active);
  const [axes, setAxes] = useState<ScanAxis[]>(() => [defaultAxis(cfg.active, 'gap', cfg)]);
  const [objective, setObjective] = useState<Objective>('kwhPerKg');
  const [maxVol, setMaxVol] = useState('');
  const [maxEnv, setMaxEnv] = useState('');
  const [res, setRes] = useState(40);
  const [refineTop, setRefineTop] = useState(3);

  useEffect(() => {
    try {
      localStorage.setItem(LIST_KEY, JSON.stringify(list));
    } catch {
      /* ignore */
    }
  }, [list]);

  const makeExperiment = (nm: string): SavedExperiment => ({
    app: 'TopoCell',
    version: APP_VERSION,
    name: nm,
    savedAt: new Date().toISOString(),
    units: 'SI',
    config: JSON.parse(JSON.stringify(cfg)),
    results: snapshot(lab),
    scan: lab.scan && !lab.scan.running && lab.scan.rows.length ? { spec: lab.scan.spec, rows: lab.scan.rows, summary: lab.scan.summary } : undefined,
  });

  const restore = (ex: SavedExperiment, check: boolean) => {
    lab.setCfg(() => JSON.parse(JSON.stringify(ex.config)));
    setRepro(check ? ex : null);
    setMsg(`„${ex.name}“ აღდგენილია.`);
  };

  // განმეორებადობა: აღდგენილი კონფიგურაციის ხელახალი გამოთვლა შენახულ შედეგებთან
  const reproStatus = useMemo(() => {
    if (!repro) return null;
    if (JSON.stringify(repro.config) !== JSON.stringify(cfg)) return { state: 'changed' as const };
    const now = snapshot(lab);
    let worst = 0;
    let pending = false;
    for (const k of KINDS) {
      const a = repro.results[k],
        b = now[k];
      if (!a || !a.valid) continue;
      if (a.kSource === 'solver' && b.kSource !== 'solver') {
        pending = true;
        continue;
      }
      for (const f of ['K', 'I', 'U', 'P', 'nH2', 'kwhPerKg', 'areaC', 'volume', 'envelopeVolume'] as const) {
        const x = a[f],
          y = b[f];
        if (Number.isFinite(x) && Number.isFinite(y) && x !== 0) worst = Math.max(worst, Math.abs(y / x - 1));
      }
    }
    return { state: pending ? ('pending' as const) : ('done' as const), worst };
  }, [repro, cfg, lab]);

  const onImport = async (file: File) => {
    try {
      const ex = JSON.parse(await file.text()) as SavedExperiment;
      if (ex.app !== 'TopoCell' || !ex.config?.geometries || !ex.config?.electrical) throw new Error('ფაილი TopoCell-ის ექსპერიმენტი არ არის');
      if (ex.version !== APP_VERSION) throw new Error(`ვერსია არ ემთხვევა (${ex.version} ≠ ${APP_VERSION})`);
      setList((l) => [{ ...ex, name: ex.name + ' (იმპორტი)' }, ...l]);
      restore(ex, !!ex.results);
    } catch (e) {
      setMsg('იმპორტის შეცდომა: ' + (e as Error).message);
    }
  };

  const spec: ScanSpec = {
    kind,
    axes,
    objective,
    maxVolume: maxVol.trim() && Number(maxVol) > 0 ? Number(maxVol) * 1e-6 : null,
    maxEnvelope: maxEnv.trim() && Number(maxEnv) > 0 ? Number(maxEnv) * 1e-6 : null,
    resolution: res,
    refineTop,
    refineResolution: Math.round(res * 1.5),
  };
  const nPoints = axes.reduce((n, a) => n * axisValues(a).length, 1);
  const scan = lab.scan;
  const ou = scan ? OBJECTIVE_UNIT[scan.spec.objective] : OBJECTIVE_UNIT[objective];
  const ranked = scan ? rankRows(scan.rows, scan.spec.objective) : [];
  const scanCsv = () => {
    if (!scan) return '';
    const header = [...scan.spec.axes.map((a) => a.param), 'feasible', 'reasons', 'objective', 'objective_fine', 'uncertainty', 'U_V', 'I_A', 'P_W', 'nH2_mol_s', 'kWh_per_kg', 'K_1_m', 'K_fine', 'lambda', 'areaC_m2', 'volume_m3', 'envelope_m3', 'minDistance_m', 'balance'];
    const rows = scan.rows.map((r) => [...r.values, r.feasible ? 1 : 0, r.reasons.join(' | '), r.objective, r.objectiveFine ?? NaN, r.uncertainty ?? NaN, r.U, r.I, r.P, r.nH2, r.kwhPerKg, r.K, r.Kfine ?? NaN, r.lambda, r.areaC, r.volume, r.envelopeVolume, r.minDistance, r.balance]);
    return toCsv(header, rows);
  };

  let scanViz = null;
  if (scan && !scan.running && scan.rows.length) {
    const sa = scan.spec.axes;
    if (sa.length === 1) {
      const u = SCAN_PARAM_UNIT[sa[0].param];
      scanViz =
        sa[0].param === 'arrangement' ? null : (
          <XYChart
            title={`${SCAN_PARAM_LABEL[sa[0].param]} → ${OBJECTIVE_LABEL[scan.spec.objective]}`}
            sub={KIND_SHORT[scan.spec.kind]}
            series={[{ id: 's', name: KIND_SHORT[scan.spec.kind], color: SERIES_VAR[scan.spec.kind], pts: scan.rows.filter((r) => r.feasible).map((r) => ({ x: r.values[0] * u.scale, y: r.objective * ou.scale })) }]}
            xLabel={`${SCAN_PARAM_LABEL[sa[0].param]}${u.unit ? ', ' + u.unit : ''}`}
            yLabel={ou.unit}
            points
          />
        );
    } else if (sa.length === 2) {
      const xs = axisValues(sa[0]),
        ys = axisValues(sa[1]);
      const find = (ix: number, iy: number) => scan.rows.find((r) => Math.abs(r.values[0] - xs[ix]) < 1e-12 && Math.abs(r.values[1] - ys[iy]) < 1e-12);
      scanViz = (
        <div className="card chart">
          <div className="chart-head">
            <div>
              <h4>
                {OBJECTIVE_LABEL[scan.spec.objective]}, {ou.unit}
              </h4>
              <div className="sub">{KIND_SHORT[scan.spec.kind]} · ორპარამეტრიანი სკანირება</div>
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <Heatmap
              xs={xs.map((v) => valueLabel(scan.spec.kind, sa[0].param, v))}
              ys={ys.map((v) => valueLabel(scan.spec.kind, sa[1].param, v))}
              xLabel={SCAN_PARAM_LABEL[sa[0].param]}
              yLabel={SCAN_PARAM_LABEL[sa[1].param]}
              maximize={ou.maximize}
              cell={(ix, iy) => {
                const r = find(ix, iy);
                if (!r) return null;
                return { value: r.objective * ou.scale, text: sig(r.objective * ou.scale, 4), feasible: r.feasible, title: r.feasible ? `U = ${fmt(r.U, 3)} V · K = ${sig(r.K, 4)} 1/m` : r.reasons.join('; ') };
              }}
            />
          </div>
        </div>
      );
    }
  }

  return (
    <div className="panel">
      <h3>მომზადებული ექსპერიმენტები</h3>
      <div className="two-col">
        {presets().map((p) => (
          <div className="card card-pad" key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h3>{p.title}</h3>
            <p className="sub">{p.question}</p>
            <p className="hint">
              <b>რას დააკვირდეთ:</b> {p.watch}
            </p>
            <div className="row" style={{ marginTop: 'auto' }}>
              <button
                className="btn primary"
                onClick={() => {
                  lab.setCfg(() => JSON.parse(JSON.stringify(p.config)));
                  setRepro(null);
                  setMsg(`ჩაიტვირთა: ${p.title}. შედეგები — ჩანართებში „შედარება“ და „გრაფიკები“.`);
                }}
              >
                ჩატვირთვა
              </button>
              {p.scan && (
                <button
                  className="btn"
                  disabled={scan?.running}
                  onClick={() => {
                    lab.setCfg(() => JSON.parse(JSON.stringify(p.config)));
                    setKind(p.scan!.kind);
                    setAxes(p.scan!.axes);
                    setObjective(p.scan!.objective);
                    lab.runScan(p.scan!, p.config);
                  }}
                >
                  ჩატვირთვა + სკანირება
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {msg && <Notice kind="info">{msg}</Notice>}

      <h3>შენახვა, აღდგენა, განმეორებადობა</h3>
      <div className="row">
        <input className="sel" style={{ width: 260 }} placeholder="ექსპერიმენტის სახელი" value={name} onChange={(e) => setName(e.target.value)} />
        <button
          className="btn primary"
          onClick={() => {
            const ex = makeExperiment(name.trim() || `ექსპერიმენტი ${list.length + 1}`);
            setList((l) => [ex, ...l]);
            setName('');
            setMsg(`შენახულია: „${ex.name}“ (ბრაუზერის მეხსიერებაში).`);
          }}
        >
          მიმდინარე მდგომარეობის შენახვა
        </button>
        <button className="btn" onClick={() => download(`topocell-${Date.now()}.json`, JSON.stringify(makeExperiment(name.trim() || 'ექსპორტი'), null, 2), 'application/json')}>
          JSON ექსპორტი
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          JSON იმპორტი
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImport(f);
            e.target.value = '';
          }}
        />
      </div>
      {reproStatus && repro && (
        <Notice kind={reproStatus.state === 'done' && reproStatus.worst < 1e-9 ? 'info' : 'warn'}>
          <b>განმეორებადობის შემოწმება — „{repro.name}“:</b>{' '}
          {reproStatus.state === 'changed'
            ? 'კონფიგურაცია აღდგენის შემდეგ შეიცვალა — შედარება გაუქმებულია.'
            : reproStatus.state === 'pending'
              ? '3D ამოხსნა მიმდინარეობს…'
              : `ხელახლა გამოთვლილი და შენახული შედეგების მაქსიმალური ფარდობითი გადახრა: ${reproStatus.worst.toExponential(2)} ${reproStatus.worst < 1e-9 ? '— იდენტურია ✓' : '— განსხვავება აღმოჩენილია'}`}
        </Notice>
      )}
      {list.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>სახელი</th>
                <th>შენახვის დრო</th>
                <th>რეჟიმი</th>
                <th>აქტიური მოდელი</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((ex, i) => (
                <tr key={ex.savedAt + i}>
                  <td>{ex.name}</td>
                  <td>{new Date(ex.savedAt).toLocaleString('ka-GE')}</td>
                  <td>
                    {ex.config.electrical.mode} · {ex.config.fairness.constraint}
                  </td>
                  <td>{KIND_SHORT[ex.config.active]}</td>
                  <td>
                    <span className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                      <button className="btn small" onClick={() => restore(ex, true)}>
                        აღდგენა + გამეორება
                      </button>
                      <button className="btn small" onClick={() => download(`topocell-${ex.name.replace(/[^\p{L}\p{N}]+/gu, '_')}.json`, JSON.stringify(ex, null, 2), 'application/json')}>
                        JSON
                      </button>
                      <button className="btn small" onClick={() => setList((l) => l.filter((_, j) => j !== i))}>
                        წაშლა
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3>პარამეტრული სკანირება და ოპტიმიზაცია</h3>
      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="row">
          <span className="sub" style={{ width: 90 }}>
            მოდელი
          </span>
          <select
            className="sel"
            style={{ width: 230 }}
            value={kind}
            onChange={(e) => {
              const k = e.target.value as Kind;
              setKind(k);
              setAxes([defaultAxis(k, 'gap', cfg)]);
            }}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <span className="sub">მიზანი</span>
          <select className="sel" style={{ width: 300 }} value={objective} onChange={(e) => setObjective(e.target.value as Objective)}>
            {(Object.keys(OBJECTIVE_LABEL) as Objective[]).map((o) => (
              <option key={o} value={o}>
                {OBJECTIVE_LABEL[o]}
              </option>
            ))}
          </select>
        </div>
        {axes.map((a, i) => (
          <div className="row" key={i}>
            <span className="sub" style={{ width: 90 }}>
              ღერძი {i + 1}
            </span>
            <AxisEditor kind={kind} axis={a} cfg={cfg} onChange={(na) => setAxes((l) => l.map((x, j) => (j === i ? na : x)))} onRemove={axes.length > 1 ? () => setAxes((l) => l.filter((_, j) => j !== i)) : undefined} />
          </div>
        ))}
        {axes.length < 2 && (
          <div>
            <button className="btn small" onClick={() => setAxes((l) => [...l, defaultAxis(kind, l[0].param === 'theta' ? 'gap' : 'theta', cfg)])}>
              + მეორე ღერძი
            </button>
          </div>
        )}
        <div className="row">
          <span className="sub" style={{ width: 90 }}>
            შეზღუდვები
          </span>
          <span className="sub">მასალა ≤</span>
          <input className="sel" style={{ width: 70, textAlign: 'right' }} placeholder="—" value={maxVol} onChange={(e) => setMaxVol(e.target.value)} />
          <span className="sub">სმ³ · გაბარიტი ≤</span>
          <input className="sel" style={{ width: 70, textAlign: 'right' }} placeholder="—" value={maxEnv} onChange={(e) => setMaxEnv(e.target.value)} />
          <span className="sub">
            სმ³ · მინ. დაშორება ≥ {fmt(cfg.env.minGap * 1000, 1)} მმ · j ≤ {cfg.limits.jMax} A/m² · U ≤ {cfg.limits.uMax} V
          </span>
        </div>
        <div className="row">
          <span className="sub" style={{ width: 90 }}>
            ბადე
          </span>
          <select className="sel" style={{ width: 150 }} value={res} onChange={(e) => setRes(Number(e.target.value))}>
            <option value={32}>N = 32 (სწრაფი)</option>
            <option value={40}>N = 40</option>
            <option value={48}>N = 48 (ნელი)</option>
          </select>
          <span className="sub">საუკეთესო</span>
          <select className="sel" style={{ width: 60 }} value={refineTop} onChange={(e) => setRefineTop(Number(e.target.value))}>
            {[1, 2, 3, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <span className="sub">ვარიანტი ზუსტდება N = {Math.round(res * 1.5)}-ზე (რიცხვითი გაურკვევლობის შესაფასებლად)</span>
        </div>
        <div className="row">
          <button className="btn primary" disabled={scan?.running || nPoints > 150} onClick={() => lab.runScan(spec)}>
            სკანირების გაშვება ({nPoints} წერტილი)
          </button>
          {scan?.running && (
            <button className="btn" onClick={lab.cancelScan}>
              შეჩერება
            </button>
          )}
          {nPoints > 150 && <span className="sub">მაქსიმუმ 150 წერტილი</span>}
          <span className="sub">
            ელექტრული რეჟიმი: {objective === 'h2AtPower' ? `P = ${cfg.electrical.P} W (მიზნის მიხედვით)` : `როგორც პანელში (${cfg.electrical.mode})`} · გეომეტრიული შეზღუდვა: {cfg.fairness.constraint}
          </span>
        </div>
        {cfg.fairness.constraint !== 'none' && axes.some((a) => a.param === 'size') && (
          <Notice kind="warn">ჩართულია გეომეტრიული ნორმალიზება: ზომის სკანირებას მასშტაბი λ აკომპენსირებს. ზომის გავლენის სანახავად აირჩიეთ „შეზღუდვის გარეშე“.</Notice>
        )}
        {scan?.running && (
          <div>
            <div className="progress">
              <div style={{ width: `${scan.total ? (100 * scan.done) / scan.total : 3}%` }} />
            </div>
            <div className="sub" style={{ marginTop: 4 }}>
              {scan.done} / {scan.total || '…'} — გამოთვლა ფონურ ნაკადშია, ინტერფეისი თავისუფალია
            </div>
          </div>
        )}
      </div>

      {scan && !scan.running && (
        <>
          {scan.error && <Notice kind="err">{scan.error}</Notice>}
          {scan.cancelled && <Notice kind="warn">სკანირება შეჩერდა — ნაჩვენებია ნაწილობრივი შედეგი, შეჯამების გარეშე.</Notice>}
          {scan.summary && (
            <Notice kind={scan.summary.distinguishable ? 'info' : 'warn'}>
              <b>შეჯამება ({KIND_SHORT[scan.spec.kind]} · {OBJECTIVE_LABEL[scan.spec.objective]}):</b> {scan.summary.text}
              <div className="hint" style={{ marginTop: 4 }}>
                გაურკვევლობა აქ მხოლოდ ბადის რიცხვითი ცდომილებაა (უხეში vs წვრილი ბადე). მოდელის ფორმის გაურკვევლობა — კინეტიკა, θ-ის გეომეტრიაზე დამოუკიდებლობა, ბუშტუკების ნაკადის უგულებელყოფა —
                მასში არ შედის და, როგორც წესი, უფრო დიდია.
              </div>
            </Notice>
          )}
          <div className="chart-grid">{scanViz}</div>
          <div className="row">
            <h3 className="grow">
              შედეგები: {ranked.length} დასაშვები / {scan.rows.length} სულ
            </h3>
            {ranked[0] && (
              <button
                className="btn small"
                onClick={() => {
                  lab.setCfg((c) => {
                    let n = c;
                    scan.spec.axes.forEach((a, i) => (n = applyScanValue(n, scan.spec.kind, a.param, ranked[0].values[i])));
                    return { ...n, active: scan.spec.kind };
                  });
                  setMsg('საუკეთესო ვარიანტის პარამეტრები გადატანილია კონფიგურაციაში.');
                }}
              >
                საუკეთესოს გამოყენება
              </button>
            )}
            <button className="btn small" onClick={() => download('topocell-scan.csv', scanCsv(), 'text/csv')}>
              CSV
            </button>
            <button className="btn small" onClick={() => download('topocell-scan.json', JSON.stringify({ app: 'TopoCell', version: APP_VERSION, config: scan.cfg, spec: scan.spec, rows: scan.rows, summary: scan.summary }, null, 2), 'application/json')}>
              JSON
            </button>
          </div>
          <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>#</th>
                  {scan.spec.axes.map((a) => (
                    <th key={a.param}>{SCAN_PARAM_LABEL[a.param]}</th>
                  ))}
                  <th>მდგომარეობა</th>
                  <th>მიზანი, {ou.unit}</th>
                  <th>± რიცხვითი</th>
                  <th>U, V</th>
                  <th>I, A</th>
                  <th>K, 1/m</th>
                  <th>λ</th>
                  <th>მასალა, სმ³</th>
                  <th>გაბარიტი, სმ³</th>
                  <th>d_min, მმ</th>
                </tr>
              </thead>
              <tbody>
                {[...ranked, ...scan.rows.filter((r) => !r.feasible)].map((r, i) => (
                  <tr key={i} className={i === 0 && r.feasible ? 'hl' : undefined}>
                    <td>{r.feasible ? i + 1 : '—'}</td>
                    {scan.spec.axes.map((a, j) => (
                      <td key={j}>{valueLabel(scan.spec.kind, a.param, r.values[j])}</td>
                    ))}
                    <td>{r.feasible ? <span className="status-pass">✓ დასაშვები</span> : <span className="status-fail" title={r.reasons.join('\n')}>✕ {r.reasons[0] ?? ''}</span>}</td>
                    <td>{sig(r.objective * ou.scale, 5)}</td>
                    <td>{r.uncertainty !== undefined ? sig(r.uncertainty * ou.scale, 2) : '—'}</td>
                    <td>{fmt(r.U, 3)}</td>
                    <td>{fmt(r.I, 3)}</td>
                    <td>{sig(r.K, 4)}</td>
                    <td>{fmt(r.lambda, 3)}</td>
                    <td>{fmt(r.volume * 1e6, 2)}</td>
                    <td>{fmt(r.envelopeVolume * 1e6, 0)}</td>
                    <td>{fmt(r.minDistance * 1000, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="hint">
        სკანირება დეტერმინისტულ ბადეზე სრულდება (შემთხვევითი რიცხვების გარეშე), ამიტომ იგივე კონფიგურაცია და სპეციფიკაცია ყოველთვის იმავე შედეგს იძლევა. <Tag kind="solver" /> თითო წერტილზე სრულდება
        პირველადი 3D ამოხსნა; შეფასება — ერთიანი მოდელით.
      </p>
    </div>
  );
}
