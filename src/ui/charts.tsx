// მსუბუქი SVG გრაფიკები: ხაზოვანი (ჯვარედინი კურსორით), დაწყობილი ზოლები, „ტორნადო“ და სითბური რუკა.
// ფერი ატარებს მხოლოდ იდენტობას (გეომეტრია / კომპონენტი); ტექსტი ყოველთვის ტექსტის ტოკენებშია.
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { niceTicks, sig, tickLabel } from './format';

export interface Series {
  id: string;
  name: string;
  color: string;
  pts: { x: number; y: number }[];
  dashed?: boolean;
}

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(480);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(260, el.clientWidth)));
    ro.observe(el);
    setW(Math.max(260, el.clientWidth));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function interp(pts: { x: number; y: number }[], x: number): number {
  if (pts.length === 0 || x < pts[0].x || x > pts[pts.length - 1].x) return NaN;
  let lo = 0,
    hi = pts.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (pts[m].x <= x) lo = m;
    else hi = m;
  }
  const a = pts[lo],
    b = pts[hi];
  if (b.x === a.x) return a.y;
  return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
}

export function ChartCard(p: { title: string; sub?: ReactNode; legend?: ReactNode; note?: ReactNode; children: ReactNode; table?: ReactNode }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <div className="card chart">
      <div className="chart-head">
        <div>
          <h4>{p.title}</h4>
          {p.sub && <div className="sub">{p.sub}</div>}
        </div>
        {p.table && (
          <button className="btn small" onClick={() => setShowTable((s) => !s)} aria-pressed={showTable}>
            {showTable ? 'გრაფიკი' : 'ცხრილი'}
          </button>
        )}
      </div>
      {p.legend && <div className="chart-legend">{p.legend}</div>}
      {showTable && p.table ? <div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>{p.table}</div> : p.children}
      {p.note && <div className="chart-note">{p.note}</div>}
    </div>
  );
}

export function XYChart(p: {
  title: string;
  sub?: ReactNode;
  series: Series[];
  xLabel: string;
  yLabel: string;
  markers?: { x: number; y: number; color: string; name: string }[];
  height?: number;
  note?: ReactNode;
  yFromZero?: boolean;
  points?: boolean;
}) {
  const [ref, W] = useWidth();
  const H = p.height ?? 230;
  const m = { l: 54, r: 14, t: 10, b: 36 };
  const [hover, setHover] = useState<{ x: number; px: number; py: number } | null>(null);
  const series = useMemo(() => p.series.map((s) => ({ ...s, pts: s.pts.filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y)).sort((a, b) => a.x - b.x) })), [p.series]);
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (const s of series)
    for (const q of s.pts) {
      if (q.x < x0) x0 = q.x;
      if (q.x > x1) x1 = q.x;
      if (q.y < y0) y0 = q.y;
      if (q.y > y1) y1 = q.y;
    }
  for (const mk of p.markers ?? []) {
    if (Number.isFinite(mk.y)) {
      y0 = Math.min(y0, mk.y);
      y1 = Math.max(y1, mk.y);
    }
  }
  const empty = !Number.isFinite(x0) || !Number.isFinite(y0);
  if (empty) {
    x0 = 0;
    x1 = 1;
    y0 = 0;
    y1 = 1;
  }
  if (p.yFromZero) y0 = Math.min(0, y0);
  const padY = (y1 - y0 || Math.abs(y1) || 1) * 0.06;
  y1 += padY;
  if (!p.yFromZero) y0 -= padY;
  if (x1 === x0) x1 = x0 + 1;
  const sx = (x: number) => m.l + ((x - x0) / (x1 - x0)) * (W - m.l - m.r);
  const sy = (y: number) => H - m.b - ((y - y0) / (y1 - y0)) * (H - m.t - m.b);
  const xt = niceTicks(x0, x1, Math.max(3, Math.floor(W / 90)));
  const yt = niceTicks(y0, y1, 5);
  const xs = xt.length > 1 ? xt[1] - xt[0] : 1;
  const ys = yt.length > 1 ? yt[1] - yt[0] : 1;
  const path = (pts: { x: number; y: number }[]) => pts.map((q, i) => `${i ? 'L' : 'M'}${sx(q.x).toFixed(1)},${sy(q.y).toFixed(1)}`).join('');
  const hv = hover ? series.map((s) => ({ s, y: interp(s.pts, hover.x) })).filter((r) => Number.isFinite(r.y)) : [];
  const tableXs = useMemo(() => Array.from({ length: 11 }, (_, i) => x0 + ((x1 - x0) * i) / 10), [x0, x1]);
  return (
    <ChartCard
      title={p.title}
      sub={p.sub}
      note={p.note}
      legend={
        series.length > 1
          ? series.map((s) => (
              <span key={s.id}>
                <i className="key" style={{ borderTopColor: s.color, borderTopStyle: s.dashed ? 'dashed' : 'solid' }} />
                {s.name}
              </span>
            ))
          : undefined
      }
      table={
        <table className="data">
          <thead>
            <tr>
              <th>{p.xLabel}</th>
              {series.map((s) => (
                <th key={s.id}>{s.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableXs.map((x, i) => (
              <tr key={i}>
                <td>{sig(x, 4)}</td>
                {series.map((s) => (
                  <td key={s.id}>{sig(interp(s.pts, x), 4)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div className="chart-wrap" ref={ref}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          height={H}
          role="img"
          aria-label={p.title}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const px = e.clientX - r.left;
            const x = x0 + ((px - m.l) / (W - m.l - m.r)) * (x1 - x0);
            if (x < x0 || x > x1) setHover(null);
            else setHover({ x, px, py: e.clientY - r.top });
          }}
          onMouseLeave={() => setHover(null)}
        >
          {yt.map((t) => (
            <g key={'y' + t}>
              <line x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} stroke="var(--grid)" strokeWidth={1} />
              <text x={m.l - 7} y={sy(t) + 3.5} textAnchor="end">
                {tickLabel(t, ys)}
              </text>
            </g>
          ))}
          <line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} stroke="var(--axis)" strokeWidth={1} />
          {xt.map((t) => (
            <text key={'x' + t} x={sx(t)} y={H - m.b + 14} textAnchor="middle">
              {tickLabel(t, xs)}
            </text>
          ))}
          <text className="axis-title" x={(m.l + W - m.r) / 2} y={H - 4} textAnchor="middle">
            {p.xLabel}
          </text>
          <text className="axis-title" transform={`translate(12 ${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle">
            {p.yLabel}
          </text>
          {series.map((s) => (
            <g key={s.id}>
              <path d={path(s.pts)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '5 4' : undefined} />
              {p.points && s.pts.map((q, i) => <circle key={i} cx={sx(q.x)} cy={sy(q.y)} r={4} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} />)}
            </g>
          ))}
          {(p.markers ?? [])
            .filter((mk) => Number.isFinite(mk.x) && Number.isFinite(mk.y) && mk.x >= x0 && mk.x <= x1)
            .map((mk, i) => (
              <circle key={i} cx={sx(mk.x)} cy={sy(mk.y)} r={5} fill={mk.color} stroke="var(--surface-1)" strokeWidth={2}>
                <title>{`${mk.name}: სამუშაო წერტილი`}</title>
              </circle>
            ))}
          {hover && hv.length > 0 && (
            <g pointerEvents="none">
              <line x1={sx(hover.x)} x2={sx(hover.x)} y1={m.t} y2={H - m.b} stroke="var(--muted)" strokeWidth={1} />
              {hv.map((r) => (
                <circle key={r.s.id} cx={sx(hover.x)} cy={sy(r.y)} r={4} fill={r.s.color} stroke="var(--surface-1)" strokeWidth={2} />
              ))}
            </g>
          )}
          {empty && (
            <text x={W / 2} y={H / 2} textAnchor="middle">
              მონაცემები არ არის
            </text>
          )}
        </svg>
        {hover && hv.length > 0 && (
          <div className="tooltip" style={{ left: hover.px > W * 0.6 ? undefined : hover.px + 14, right: hover.px > W * 0.6 ? W - hover.px + 14 : undefined, top: Math.max(4, Math.min(H - 30 - hv.length * 18, hover.py - 10)) }}>
            <div className="t-head">
              {p.xLabel}: {sig(hover.x, 4)}
            </div>
            {hv.map((r) => (
              <div className="t-row" key={r.s.id}>
                <span>
                  <i className="key" style={{ display: 'inline-block', width: 12, borderTop: `2px ${r.s.dashed ? 'dashed' : 'solid'} ${r.s.color}`, marginRight: 6, verticalAlign: 3 }} />
                  {r.s.name}
                </span>
                <b className="num">{sig(r.y, 4)}</b>
              </div>
            ))}
          </div>
        )}
      </div>
    </ChartCard>
  );
}

export interface StackRow {
  id: string;
  name: string;
  swatch?: string;
  parts: { id: string; name: string; color: string; value: number }[];
  total: number;
}

/** ჰორიზონტალური დაწყობილი ზოლები (მაგ. ძაბვის შემადგენლები). */
export function StackBars(p: { title: string; sub?: ReactNode; rows: StackRow[]; unit: string; note?: ReactNode; digits?: number }) {
  const [ref, W] = useWidth();
  const [tip, setTip] = useState<{ px: number; py: number; text: string; val: string } | null>(null);
  const rowH = 34;
  const m = { l: 96, r: 64, t: 6, b: 24 };
  const H = m.t + m.b + rowH * p.rows.length;
  const max = Math.max(1e-9, ...p.rows.map((r) => r.total));
  const ticks = niceTicks(0, max, 5);
  const step = ticks.length > 1 ? ticks[1] - ticks[0] : 1;
  const sx = (v: number) => m.l + (v / (ticks[ticks.length - 1] || max)) * (W - m.l - m.r);
  const parts = p.rows[0]?.parts ?? [];
  const d = p.digits ?? 3;
  return (
    <ChartCard
      title={p.title}
      sub={p.sub}
      note={p.note}
      legend={parts.map((c) => (
        <span key={c.id}>
          <i className="key box" style={{ background: c.color }} />
          {c.name}
        </span>
      ))}
      table={
        <table className="data">
          <thead>
            <tr>
              <th>მოდელი</th>
              {parts.map((c) => (
                <th key={c.id}>
                  {c.name}, {p.unit}
                </th>
              ))}
              <th>ჯამი, {p.unit}</th>
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                {r.parts.map((c) => (
                  <td key={c.id}>{c.value.toFixed(d)}</td>
                ))}
                <td>{r.total.toFixed(d)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div className="chart-wrap" ref={ref}>
        <svg viewBox={`0 0 ${W} ${H}`} height={H} role="img" aria-label={p.title} onMouseLeave={() => setTip(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={sx(t)} x2={sx(t)} y1={m.t} y2={H - m.b} stroke="var(--grid)" strokeWidth={1} />
              <text x={sx(t)} y={H - m.b + 14} textAnchor="middle">
                {tickLabel(t, step)}
              </text>
            </g>
          ))}
          {p.rows.map((r, i) => {
            let acc = 0;
            const y = m.t + i * rowH + (rowH - 20) / 2;
            return (
              <g key={r.id}>
                {r.swatch && <rect x={2} y={y + 5} width={10} height={10} rx={3} fill={r.swatch} />}
                <text x={r.swatch ? 17 : 2} y={y + 14} style={{ fill: 'var(--text-secondary)', fontSize: 11.5 }}>
                  {r.name}
                </text>
                {r.parts.map((c, k) => {
                  const xa = sx(acc);
                  acc += c.value;
                  const xb = sx(acc);
                  const w = Math.max(0, xb - xa - 2);
                  const last = k === r.parts.length - 1;
                  return (
                    <rect
                      key={c.id}
                      x={xa}
                      y={y}
                      width={w}
                      height={20}
                      rx={last ? 4 : 0}
                      fill={c.color}
                      onMouseMove={(e) => {
                        const b = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                        setTip({ px: e.clientX - b.left, py: e.clientY - b.top, text: `${r.name} · ${c.name}`, val: `${c.value.toFixed(d)} ${p.unit}` });
                      }}
                    />
                  );
                })}
                <text x={sx(r.total) + 5} y={y + 14} style={{ fill: 'var(--text-primary)', fontSize: 11.5 }}>
                  {r.total.toFixed(d)} {p.unit}
                </text>
              </g>
            );
          })}
        </svg>
        {tip && (
          <div className="tooltip" style={{ left: Math.min(tip.px + 12, W - 190), top: tip.py + 12 }}>
            <div className="t-head">{tip.text}</div>
            <b className="num">{tip.val}</b>
          </div>
        )}
      </div>
    </ChartCard>
  );
}

export interface TornadoRow {
  name: string;
  lowLabel: string;
  highLabel: string;
  low: number; // ეფექტი %, პარამეტრის შემცირებისას
  high: number; // ეფექტი %, პარამეტრის გაზრდისას
}

/** მგრძნობელობის „ტორნადო“: თითო პარამეტრზე ორი ზოლი ნულოვანი ხაზიდან. */
export function Tornado(p: { title: string; sub?: ReactNode; rows: TornadoRow[]; unit: string; note?: ReactNode }) {
  const [ref, W] = useWidth();
  const [tip, setTip] = useState<{ px: number; py: number; text: string; val: string } | null>(null);
  const rowH = 30;
  const m = { l: 150, r: 20, t: 6, b: 24 };
  const H = m.t + m.b + rowH * p.rows.length;
  const max = Math.max(1e-6, ...p.rows.flatMap((r) => [Math.abs(r.low), Math.abs(r.high)].filter(Number.isFinite)));
  const ticks = niceTicks(-max, max, 6);
  const step = ticks.length > 1 ? ticks[1] - ticks[0] : 1;
  const lim = Math.max(Math.abs(ticks[0]), Math.abs(ticks[ticks.length - 1]));
  const sx = (v: number) => m.l + ((v + lim) / (2 * lim)) * (W - m.l - m.r);
  const bar = (v: number, y: number, color: string, label: string, name: string) => {
    if (!Number.isFinite(v)) return null;
    const a = sx(0),
      b = sx(v);
    return (
      <rect
        x={Math.min(a, b)}
        y={y}
        width={Math.max(1, Math.abs(b - a))}
        height={9}
        rx={2}
        fill={color}
        onMouseMove={(e) => {
          const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
          setTip({ px: e.clientX - r.left, py: e.clientY - r.top, text: `${name}: ${label}`, val: `${v > 0 ? '+' : ''}${v.toFixed(2)} ${p.unit}` });
        }}
      />
    );
  };
  return (
    <ChartCard
      title={p.title}
      sub={p.sub}
      note={p.note}
      legend={
        <>
          <span>
            <i className="key box" style={{ background: 'var(--muted)' }} />
            პარამეტრი შემცირებულია
          </span>
          <span>
            <i className="key box" style={{ background: 'var(--text-primary)' }} />
            პარამეტრი გაზრდილია
          </span>
        </>
      }
      table={
        <table className="data">
          <thead>
            <tr>
              <th>პარამეტრი</th>
              <th>შემცირება</th>
              <th>ეფექტი, {p.unit}</th>
              <th>გაზრდა</th>
              <th>ეფექტი, {p.unit}</th>
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td>{r.lowLabel}</td>
                <td>{sig(r.low, 3)}</td>
                <td>{r.highLabel}</td>
                <td>{sig(r.high, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div className="chart-wrap" ref={ref}>
        <svg viewBox={`0 0 ${W} ${H}`} height={H} role="img" aria-label={p.title} onMouseLeave={() => setTip(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={sx(t)} x2={sx(t)} y1={m.t} y2={H - m.b} stroke={t === 0 ? 'var(--axis)' : 'var(--grid)'} strokeWidth={1} />
              <text x={sx(t)} y={H - m.b + 14} textAnchor="middle">
                {tickLabel(t, step)}
              </text>
            </g>
          ))}
          {p.rows.map((r, i) => {
            const y = m.t + i * rowH + 4;
            return (
              <g key={r.name}>
                <text x={2} y={y + 13} style={{ fill: 'var(--text-secondary)', fontSize: 11.5 }}>
                  {r.name}
                </text>
                {bar(r.low, y, 'var(--muted)', r.lowLabel, r.name)}
                {bar(r.high, y + 11, 'var(--text-primary)', r.highLabel, r.name)}
              </g>
            );
          })}
        </svg>
        {tip && (
          <div className="tooltip" style={{ left: Math.min(tip.px + 12, W - 200), top: tip.py + 12 }}>
            <div className="t-head">{tip.text}</div>
            <b className="num">{tip.val}</b>
          </div>
        )}
      </div>
    </ChartCard>
  );
}

const SEQ = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];

/** სითბური რუკა ორპარამეტრიანი სკანირებისთვის. უკეთესი მნიშვნელობა — უფრო მუქი (ერთი ფერის სკალა). */
export function Heatmap(p: {
  xs: string[];
  ys: string[];
  xLabel: string;
  yLabel: string;
  cell: (ix: number, iy: number) => { value: number; text: string; title: string; feasible: boolean } | null;
  maximize: boolean;
}) {
  let lo = Infinity,
    hi = -Infinity;
  const cells: ({ value: number; text: string; title: string; feasible: boolean } | null)[][] = p.ys.map((_, iy) => p.xs.map((_, ix) => p.cell(ix, iy)));
  for (const row of cells)
    for (const c of row)
      if (c && c.feasible && Number.isFinite(c.value)) {
        lo = Math.min(lo, c.value);
        hi = Math.max(hi, c.value);
      }
  const color = (v: number) => {
    let t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
    if (!p.maximize) t = 1 - t;
    const i = Math.max(0, Math.min(SEQ.length - 1, Math.round(t * (SEQ.length - 1))));
    return { bg: SEQ[i], fg: i >= 3 ? '#ffffff' : '#0b0b0b' };
  };
  return (
    <div>
      <div className="heat" style={{ gridTemplateColumns: `minmax(70px, auto) repeat(${p.xs.length}, minmax(52px, 1fr))` }}>
        <div className="axis-lab">
          {p.yLabel} ↓ / {p.xLabel} →
        </div>
        {p.xs.map((x) => (
          <div key={x} className="axis-lab">
            {x}
          </div>
        ))}
        {p.ys.map((y, iy) => [
          <div key={'l' + iy} className="axis-lab">
            {y}
          </div>,
          ...p.xs.map((_, ix) => {
            const c = cells[iy][ix];
            if (!c || !c.feasible || !Number.isFinite(c.value))
              return (
                <div key={ix + '-' + iy} className="cell bad" title={c?.title ?? 'შეფასება ვერ მოხერხდა'}>
                  ✕
                </div>
              );
            const col = color(c.value);
            return (
              <div key={ix + '-' + iy} className="cell" style={{ background: col.bg, color: col.fg }} title={c.title}>
                {c.text}
              </div>
            );
          }),
        ])}
      </div>
      <div className="chart-note">უფრო მუქი = მიზნის მიხედვით უკეთესი; ✕ = დაუშვებელი ვარიანტი (მიზეზი — მიმანიშნებელში და ცხრილში).</div>
    </div>
  );
}
