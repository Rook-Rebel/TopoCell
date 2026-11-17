import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { KIND_LABEL, KIND_SHORT, KINDS, Kind } from './core/geometry/cell';
import { kleinMath } from './core/geometry/klein';
import { ChartsPanel } from './ui/ChartsPanel';
import { Check, Seg, Tag } from './ui/controls';
import { ExperimentsPanel } from './ui/ExperimentsPanel';
import { Methodology, ValidationPanel } from './ui/InfoPanels';
import { ParamPanel } from './ui/ParamPanel';
import { ComparePanel, KpiStrip } from './ui/ResultsPanel';
import { SolverPanel } from './ui/SolverPanel';
import { useLab } from './ui/useLab';
import { Axis, ViewOptions, Viewport, defaultView } from './ui/Viewport';

type Tab = 'compare' | 'charts' | 'solver' | 'experiments' | 'validation' | 'method';
const TABS: { id: Tab; label: string }[] = [
  { id: 'compare', label: 'შედარება' },
  { id: 'charts', label: 'გრაფიკები' },
  { id: 'solver', label: 'სივრცული ანალიზი' },
  { id: 'experiments', label: 'ექსპერიმენტები' },
  { id: 'validation', label: 'ვალიდაცია' },
  { id: 'method', label: 'მეთოდოლოგია' },
];
const AXES: { value: Axis; label: string }[] = [
  { value: 'none', label: '—' },
  { value: 'x', label: 'x' },
  { value: 'y', label: 'y' },
  { value: 'z', label: 'z' },
];

export function App() {
  const lab = useLab();
  const { cfg } = lab;
  const [theme, setTheme] = useState<string>(() => localStorage.getItem('topocell.theme') ?? 'dark');
  const [view, setView] = useState<ViewOptions>(defaultView);
  const [tab, setTab] = useState<Tab>('compare');
  // ვიწრო ეკრანზე პარამეტრების პანელი გვერდიდან გამოსაწევია (CSS: ≤ 680 px); ფართოზე ეს მდგომარეობა არაფერს ცვლის
  const [paramsOpen, setParamsOpen] = useState(false);
  const setV = (q: Partial<ViewOptions>) => setView((v) => ({ ...v, ...q }));

  useEffect(() => {
    if (!paramsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setParamsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paramsOpen]);

  // layout-ეფექტი: თემა უნდა დაყენდეს მანამ, სანამ 3D ხედი CSS ცვლადებიდან ფერებს წაიკითხავს
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('topocell.theme', theme);
  }, [theme]);

  const active = cfg.active;
  const compare = lab.compareKind;
  const kg = cfg.geometries.klein;
  const math = useMemo(
    () => (kg.view === 'math' ? kleinMath({ Rb: kg.bodyRadius, neckRatio: kg.neckRatio, t: kg.thickness, clearance: kg.clearance }) : null),
    [kg.view, kg.bodyRadius, kg.neckRatio, kg.thickness, kg.clearance],
  );
  const fieldsFor = (k: Kind) => (view.fieldSource === 'secondary' ? lab.fieldsSecondary[k] : lab.fieldsPrimary[k]);
  const bubblesFor = (k: Kind) => ({ h2: lab.evals[k].prod?.vH2op ?? 0, o2: lab.evals[k].prod?.vO2op ?? 0 });
  const needFields = view.colorMode === 'current' || view.sliceAxis !== 'none' || view.showTraps;
  const fieldChip = (k: Kind) =>
    k === 'klein' && math ? null : needFields && !fieldsFor(k) ? (
      <span className="vp-chip">{cfg.solver.enabled ? 'ველი ითვლება… (რუკა გამოჩნდება ამოხსნის შემდეგ)' : 'ამომხსნელი გამორთულია — სივრცული რუკა არ იხატება'}</span>
    ) : needFields ? (
      <span className="vp-chip real">ველი: {view.fieldSource === 'secondary' ? 'მეორადი განაწილება' : 'პირველადი განაწილება (კინეტიკის გარეშე)'}</span>
    ) : null;

  return (
    <div className="app">
      <header className="header">
        <button className="btn params-toggle" aria-label="პარამეტრები" aria-expanded={paramsOpen} aria-controls="params" onClick={() => setParamsOpen((o) => !o)}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
            <path d="M2 4.5h7M12.5 4.5H14M2 11.5h1.5M7 11.5h7" />
            <circle cx="10.75" cy="4.5" r="1.75" />
            <circle cx="5.25" cy="11.5" r="1.75" />
          </svg>
          <span>პარამეტრები</span>
        </button>
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <svg viewBox="0 0 32 20" width="22" height="14">
              <defs>
                <linearGradient id="tc-mark" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" style={{ stopColor: 'var(--cathode)' }} />
                  <stop offset="1" style={{ stopColor: 'var(--anode)' }} />
                </linearGradient>
              </defs>
              <path
                d="M16 10c-2.6-4-5-6-8-6a6 6 0 0 0 0 12c3 0 5.4-2 8-6s5-6 8-6a6 6 0 0 1 0 12c-3 0-5.4-2-8-6z"
                fill="none"
                stroke="url(#tc-mark)"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <div className="brand-text">
            <h1>TopoCell</h1>
            <span className="brand-sub">ელექტროლიზის ვირტუალური ლაბორატორია</span>
          </div>
        </div>
        <span className="tagline">უჩვეულო გეომეტრიის ელექტროდების პატიოსანი შედარება</span>
        <span className="spacer" />
        <span className={'status ' + (!cfg.solver.enabled ? 'off' : lab.busyInteractive || lab.busyBatch ? 'busy' : 'ok')} aria-live="polite">
          <i aria-hidden />
          <span>
            {!cfg.solver.enabled ? '3D ამომხსნელი გამორთულია' : lab.busyInteractive ? '3D ამოხსნა მიმდინარეობს…' : '3D ამოხსნა განახლებულია'}
            {lab.busyBatch ? ' · ფონური ამოცანა…' : ''}
          </span>
        </span>
        <Seg
          label="თემა"
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'dark', label: 'მუქი' },
            { value: 'light', label: 'ნათელი' },
          ]}
        />
      </header>
      <div className="main">
        <div className={'scrim' + (paramsOpen ? ' open' : '')} onClick={() => setParamsOpen(false)} aria-hidden />
        <aside id="params" className={'sidebar' + (paramsOpen ? ' open' : '')} aria-label="პარამეტრები">
          <ParamPanel lab={lab} />
        </aside>
        <main className="center">
          <div className={'stage' + (compare ? ' split' : '')}>
            <Viewport
              built={lab.resolved[active].built}
              view={view}
              fields={fieldsFor(active)}
              bubbles={bubblesFor(active)}
              kleinMath={active === 'klein' ? math : null}
              theme={theme}
              title={KIND_LABEL[active]}
              extraChips={fieldChip(active)}
            />
            {compare && (
              <Viewport
                built={lab.resolved[compare].built}
                view={view}
                fields={fieldsFor(compare)}
                bubbles={bubblesFor(compare)}
                kleinMath={compare === 'klein' ? math : null}
                theme={theme}
                title={KIND_LABEL[compare]}
                extraChips={fieldChip(compare)}
              />
            )}
          </div>
          <div className="toolbar">
            <section className="card tgroup" aria-label="მოდელი">
              <div className="tgroup-title">მოდელი</div>
              <div className="tgroup-body">
                <Seg label="აქტიური მოდელი" value={active} onChange={(k) => lab.setCfg((c) => ({ ...c, active: k }))} options={KINDS.map((k) => ({ value: k, label: KIND_SHORT[k] }))} />
                <label className="ctl">
                  გვერდიგვერდ
                  <select className="sel" value={compare ?? ''} onChange={(e) => lab.setCompareKind((e.target.value || null) as Kind | null)}>
                    <option value="">— გამორთული</option>
                    {KINDS.filter((k) => k !== active).map((k) => (
                      <option key={k} value={k}>
                        {KIND_SHORT[k]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>
            <section className="card tgroup" aria-label="ხედი">
              <div className="tgroup-title">ხედი</div>
              <div className="tgroup-body">
                <div className="ctl">
                  გამჭვირვალობა
                  <input type="range" min={0.15} max={1} step={0.05} value={view.opacity} onChange={(e) => setV({ opacity: Number(e.target.value) })} aria-label="გამჭვირვალობა" />
                </div>
                <div className="ctl">
                  ჭრილი
                  <Seg label="ჭრილის ღერძი" value={view.clipAxis} onChange={(a) => setV({ clipAxis: a })} options={AXES} />
                  {view.clipAxis !== 'none' && <input type="range" min={0} max={1} step={0.01} value={view.clipPos} onChange={(e) => setV({ clipPos: Number(e.target.value) })} aria-label="ჭრილის მდებარეობა" />}
                </div>
                <Check checked={view.showTank} onChange={(v) => setV({ showTank: v })}>
                  ავზი
                </Check>
                <div className="ctl" title="საილუსტრაციო ფენა — არ არის გამოთვლის შედეგი">
                  <Check checked={view.showBubbles} onChange={(v) => setV({ showBubbles: v })}>
                    ბუშტუკები
                  </Check>
                  <Tag kind="illus" />
                </div>
              </div>
            </section>
            <section className="card tgroup" aria-label="გამოთვლილი ველი">
              <div className="tgroup-title">
                <i className="dot sm" style={{ background: 'var(--good)' }} />
                გამოთვლილი ველი · 3D ამომხსნელი
              </div>
              <div className="tgroup-body">
                <Check checked={view.colorMode === 'current'} onChange={(v) => setV({ colorMode: v ? 'current' : 'solid' })}>
                  დენის რუკა
                </Check>
                <div className="ctl">
                  φ ჭრილი
                  <Seg label="პოტენციალის ჭრილის ღერძი" value={view.sliceAxis} onChange={(a) => setV({ sliceAxis: a })} options={AXES} />
                  {view.sliceAxis !== 'none' && <input type="range" min={0} max={1} step={0.01} value={view.slicePos} onChange={(e) => setV({ slicePos: Number(e.target.value) })} aria-label="პოტენციალის ჭრილის მდებარეობა" />}
                </div>
                <Check checked={view.showTraps} onChange={(v) => setV({ showTraps: v })}>
                  გაზის ჯიბეები
                </Check>
                <div className="ctl">
                  განაწილება
                  <Seg
                    label="ველის წყარო"
                    value={view.fieldSource}
                    onChange={(s) => setV({ fieldSource: s })}
                    options={[
                      { value: 'primary', label: 'პირველადი' },
                      { value: 'secondary', label: 'მეორადი' },
                    ]}
                  />
                </div>
              </div>
            </section>
          </div>

          {lab.configErrors.length > 0 && (
            <div className="notice err" role="alert">
              <span className="ico">✕</span>
              <div>
                <b>დაუშვებელი პარამეტრები — გამოთვლა შეჩერებულია:</b>
                <ul>
                  {lab.configErrors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          <KpiStrip lab={lab} />

          <div className="card">
            <div className="tabs" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={(e) => {
                    setTab(t.id);
                    e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {tab === 'compare' && <ComparePanel lab={lab} />}
            {tab === 'charts' && <ChartsPanel lab={lab} />}
            {tab === 'solver' && <SolverPanel lab={lab} />}
            {tab === 'experiments' && <ExperimentsPanel lab={lab} />}
            {tab === 'validation' && <ValidationPanel lab={lab} />}
            {tab === 'method' && <Methodology />}
          </div>
          <footer className="footer">
            იდეის ავტორი: <b>ალექსანდრე გაგანაშვილი</b> · TopoCell — მოდელის შედეგები მოწყობილობის პროგნოზი არ არის
          </footer>
        </main>
      </div>
    </div>
  );
}
