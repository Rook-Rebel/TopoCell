import { KIND_LABEL, KIND_SHORT, KINDS, Kind } from '../core/geometry/cell';
import { Evaluation, FAIR_LABEL, METRICS, comparisonCsv, pctDelta } from '../core/lab';
import { Notice, Tag } from './controls';
import { SERIES_VAR, download, fmt, pct, sig } from './format';
import { Lab } from './useLab';

function Kpi(p: { label: string; value: string; unit?: string; foot?: React.ReactNode; tag?: React.ReactNode }) {
  return (
    <div className="card kpi">
      <div className="label">{p.label}</div>
      <div className="value num">
        {p.value}
        {p.unit && <small>{p.unit}</small>}
      </div>
      {p.foot && <div className="foot">{p.foot}</div>}
      {p.tag && <div className="kpi-tag">{p.tag}</div>}
    </div>
  );
}

export function KpiStrip({ lab }: { lab: Lab }) {
  const kind = lab.cfg.active;
  const e = lab.evals[kind];
  const sec = lab.secondary[kind];
  const T = lab.cfg.electrolyte.T - 273.15;
  const pBar = lab.cfg.electrolyte.p / 1e5;
  const cond = `${T.toFixed(1)} °C, ${pBar.toFixed(3)} bar (აბს.)`;
  const durMin = lab.cfg.electrical.duration / 60;
  if (!e.valid || !e.b || !e.prod) {
    return (
      <Notice kind="err">
        <b>{KIND_LABEL[kind]}: გამოთვლა შეჩერებულია.</b>
        <ul>
          {e.errors.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      </Notice>
    );
  }
  const b = e.b,
    p = e.prod;
  return (
    <>
      <div className="kpis">
        <Kpi label="H₂ მოლური ნაკადი" value={fmt(p.nH2 * 3.6e6, 2)} unit="mmol/h" foot={`${fmt(p.mH2 * 3.6e9, 2)} მგ/სთ · O₂: ${fmt(p.nO2 * 3.6e6, 2)} mmol/h`} tag={<Tag kind="law" />} />
        <Kpi label="H₂ მოცულობითი ნაკადი" value={fmt(p.vH2op * 3.6e6, 3)} unit="L/h" foot={`სამუშაო პირობებში: ${cond} · ${fmt(p.vH2n * 3.6e6, 3)} Nl/h (0 °C, 1.01325 bar)`} tag={<Tag kind="law" />} />
        <Kpi
          label={`დაგროვილი ${fmt(durMin, 0)} წუთში`}
          value={fmt(p.molH2 * 1000, 2)}
          unit="mmol H₂"
          foot={`H₂: ${fmt(p.volH2op * 1000, 3)} L · O₂: ${fmt(p.molO2 * 1000, 2)} mmol, ${fmt(p.volO2op * 1000, 3)} L (${cond})`}
        />
        <Kpi label="დენი · ძაბვა · სიმძლავრე" value={`${fmt(b.I, 2)} A · ${fmt(b.U, 3)} V`} foot={`P = ${fmt(b.P, 2)} W · მოხმარებული ენერგია: ${fmt(p.energyWh, 2)} Wh`} tag={<Tag kind="model" />} />
        <Kpi label="ენერგიის ხარჯი" value={fmt(p.kwhPerKg, 2)} unit="kWh/kg H₂" foot={`${fmt(p.whPerMol, 2)} Wh/mol · ეფექტიანობა (HHV): ${fmt(p.effHHV * 100, 1)} %`} tag={<Tag kind="model" />} />
        <Kpi label="H₂ ერთ Wh-ზე" value={fmt(p.litersPerWhOp, 4)} unit="L/Wh" foot={`სამუშაო პირობებში (${cond}) · ${fmt(p.nlPerWh, 4)} Nl/Wh`} />
        <Kpi label="საშუალო დენის სიმკვრივე" value={fmt(b.jC, 0)} unit="A/m² (კათოდი)" foot={`ანოდი: ${fmt(b.jA, 0)} A/m² · აქტიურ ფართობზე: ${fmt(b.jCreal, 0)} / ${fmt(b.jAreal, 0)} A/m²`} />
        <Kpi
          label="ფართობი · მასა · გაბარიტი"
          value={`${fmt(e.areaC * 1e4, 1)} სმ²`}
          foot={`კათოდი (დასველებული) · ანოდი: ${fmt(e.areaA * 1e4, 1)} სმ² · მასა: ${fmt(e.mass * 1000, 1)} გ · გაბარიტი: ${fmt(e.envelopeVolume * 1e6, 0)} სმ³`}
        />
        <Kpi
          label="ომური წინაღობა"
          value={fmt(b.R * 1000, 2)}
          unit="mΩ"
          foot={`K = ${sig(e.K, 4)} 1/m · I·R = ${fmt(b.ohmic * 1000, 0)} mV`}
          tag={<Tag kind={e.kSource === 'solver' ? 'solver' : 'rough'} />}
        />
        <Kpi
          label="სივრცული შემოწმება (მეორადი)"
          value={sec ? `${fmt(sec.result.U, 3)} V` : '—'}
          foot={
            sec
              ? `${sec.stale ? 'მოძველებული · ' : ''}ΔU = ${fmt(sec.result.dU * 1000, 1)} mV ერთიან მოდელთან · კათოდის ეკვ. ფართობი ${fmt(sec.result.utilC * 100, 0)} %${sec.result.converged ? '' : ' · არ დაიკრიბა'}`
              : lab.cfg.solver.enabled
                ? 'გამოთვლა მიმდინარეობს ან გამორთულია'
                : 'ამომხსნელი გამორთულია'
          }
          tag={<Tag kind="solver" />}
        />
        <Kpi label="სითბოს გამოყოფა" value={fmt(p.heatW, 2)} unit="W" foot="I·(U − 1.481 V). იზოთერმული რეჟიმი: თბური მართვა არ მოდელირდება" />
      </div>
      {(e.flags.length > 0 || e.warnings.length > 0) && (
        <Notice kind="warn">
          <ul>
            {[...e.flags, ...e.warnings].map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </Notice>
      )}
    </>
  );
}

function conclusion(lab: Lab): string[] {
  const { cfg, evals } = lab;
  const ref = cfg.fairness.reference;
  const valid = KINDS.filter((k) => evals[k].valid && evals[k].b && evals[k].prod);
  if (!evals[ref].valid || valid.length < 2) return ['შედარებისთვის საჭიროა მინიმუმ ორი დასაშვები გეომეტრია, საბაზისოს ჩათვლით.'];
  const base = evals[ref];
  const e = cfg.electrical;
  const out: string[] = [];
  const fair = cfg.fairness.constraint === 'none' ? 'გეომეტრიული ნორმალიზების გარეშე (ზომები განსხვავებულია)' : `შეზღუდვით „${FAIR_LABEL[cfg.fairness.constraint]}“`;
  // რიცხვითი გარჩევადობა: K-ის ~3 %-იანი ბადისეული გაურკვევლობის გავლენა ძაბვაზე
  const res = Math.max(...valid.map((k) => (0.03 * evals[k].b!.ohmic) / evals[k].b!.U)) * 100;
  const others = valid.filter((k) => k !== ref);
  if (e.mode === 'I') {
    out.push(
      `ამ დაშვებებითა და ერთნაირი დენით (I = ${fmt(e.I, 2)} A), ${fair}: ყველა გეომეტრია ზუსტად ერთნაირ H₂-ს იძლევა — ${fmt(base.prod!.nH2 * 3.6e6, 2)} mmol/h (ფარადეის კანონი; ფართობი და ფორმა მოლურ ნაკადს არ ცვლის).`,
    );
    const best = [...valid].sort((a, b) => evals[a].prod!.kwhPerKg - evals[b].prod!.kwhPerKg)[0];
    const d = pctDelta(evals[best].prod!.kwhPerKg, base.prod!.kwhPerKg);
    out.push(
      best === ref
        ? `ენერგიის ყველაზე დაბალი ხარჯი საბაზისო მოდელს აქვს (${fmt(base.prod!.kwhPerKg, 2)} kWh/kg). სხვა ფორმები მეტ ძაბვას მოითხოვს: ${others.map((k) => `${KIND_SHORT[k]} ${pct(pctDelta(evals[k].b!.U, base.b!.U), 1)}`).join(', ')}.`
        : `განსხვავდება მხოლოდ ძაბვა და, შესაბამისად, ენერგია: ყველაზე დაბალი ხარჯი აქვს მოდელს „${KIND_SHORT[best]}“ — ${fmt(evals[best].prod!.kwhPerKg, 2)} kWh/kg (${pct(d, 1)} საბაზისოსთან).`,
    );
  } else if (e.mode === 'U') {
    const best = [...valid].sort((a, b) => evals[b].prod!.nH2 - evals[a].prod!.nH2)[0];
    out.push(
      `ამ დაშვებებითა და ერთნაირი ძაბვით (U = ${fmt(e.U, 3)} V), ${fair}: ყველაზე მეტ H₂-ს იძლევა „${KIND_SHORT[best]}“ (${pct(pctDelta(evals[best].prod!.nH2, base.prod!.nH2), 1)} საბაზისოსთან).`,
    );
    out.push(
      `ეს მეტი წყალბადი მიღებულია მეტი დენისა და ენერგიის ხარჯზე (P: ${pct(pctDelta(evals[best].b!.P, base.b!.P), 1)}); kWh/kg პრაქტიკულად ერთნაირია, რადგან ფიქსირებული ძაბვისას ის მხოლოდ U-სა და ფარადეულ ეფექტიანობაზეა დამოკიდებული.`,
    );
  } else {
    const best = [...valid].sort((a, b) => evals[b].prod!.nH2 - evals[a].prod!.nH2)[0];
    const d = pctDelta(evals[best].prod!.nH2, base.prod!.nH2);
    out.push(
      best === ref
        ? `ამ დაშვებებითა და ერთნაირი სიმძლავრით (P = ${fmt(e.P, 2)} W), ${fair}: ყველაზე მეტ H₂-ს საბაზისო მოდელი იძლევა; სხვები: ${others.map((k) => `${KIND_SHORT[k]} ${pct(pctDelta(evals[k].prod!.nH2, base.prod!.nH2), 1)}`).join(', ')}.`
        : `ამ დაშვებებითა და ერთნაირი სიმძლავრით (P = ${fmt(e.P, 2)} W), ${fair}: „${KIND_SHORT[best]}“ იძლევა ${pct(d, 1)} H₂-ს საბაზისოსთან შედარებით.`,
    );
  }
  out.push(
    `სხვაობის წყარო მოდელში: უჯრედის მუდმივა K (განლაგება, დაშორება, ერთმანეთისკენ მიმართული ზედაპირი) და დასველებული ფართობი (კინეტიკური გადაძაბვა). არც მიობიუსის, არც კლაინის ფორმას ცალკე „ტოპოლოგიური ბონუსი“ არ ენიჭება. ${res.toFixed(1)} %-ზე მცირე სხვაობა ძაბვაში ბადის რიცხვითი გარჩევადობის ფარგლებშია და განსხვავებად არ უნდა ჩაითვალოს.`,
  );
  if (cfg.fairness.constraint === 'none')
    out.push(
      'სიფრთხილე: გეომეტრიული შეზღუდვა არჩეული არ არის, ამიტომ მოდელებს განსხვავებული ფართობი, მასა და გაბარიტი აქვს (იხ. ცხრილი). უფრო დიდი ელექტროდი ამ რეჟიმში „უკეთესი“ ჩანს მხოლოდ იმიტომ, რომ მეტ მასალას ხარჯავს — სამართლიანი დასკვნისთვის აირჩიეთ, რა თანაბრდება.',
    );
  // იცვლება თუ არა რიგი მეორადი (სივრცული) ამოხსნით
  const sec = valid.filter((k) => lab.secondary[k] && !lab.secondary[k]!.stale && lab.secondary[k]!.result.converged);
  if (sec.length === valid.length && e.mode !== 'U') {
    const byLumped = [...valid].sort((a, b) => evals[a].b!.U - evals[b].b!.U);
    const bySpatial = [...valid].sort((a, b) => lab.secondary[a]!.result.U - lab.secondary[b]!.result.U);
    const same = byLumped.every((k, i) => k === bySpatial[i]);
    out.push(
      `სივრცული (მეორადი) ამოხსნით ძაბვების რიგი ${same ? 'იგივე რჩება' : 'იცვლება'}: ${bySpatial.map((k) => `${KIND_SHORT[k]} ${fmt(lab.secondary[k]!.result.U, 3)} V`).join(' < ')}.`,
    );
  }
  const rough = valid.filter((k) => evals[k].kSource === 'rough');
  if (rough.length) out.push(`ყურადღება: ${rough.map((k) => KIND_SHORT[k]).join(', ')} — ომური წინაღობა ჯერ უხეში d/(κA) ფორმულით არის შეფასებული; დაელოდეთ 3D ამოხსნას.`);
  const klein = lab.secondary.klein;
  if (klein && !klein.stale && klein.result.utilC < 0.75)
    out.push(
      `კლაინის ტიპის გარსი: მეორადი განაწილებით კათოდის კინეტიკურად ეკვივალენტური ფართობი დასველებულის ≈ ${fmt(klein.result.utilC * 100, 0)} %-ია (დენი ძლიერ არათანაბრად ნაწილდება; ეს რიცხვი ზღვრით განსაზღვრული „მომუშავე ფართობის წილი“ არ არის და ბადესა და სამუშაო წერტილზეა დამოკიდებული). ერთიანი მოდელი მთელ ფართობს თანაბრად გამოყენებულად თვლის, ამიტომ ამ ფორმას ოპტიმისტურად აფასებს; იხ. სტრიქონი „U (სივრცული)“.`,
    );
  return out;
}

export function ComparePanel({ lab }: { lab: Lab }) {
  const { cfg, evals } = lab;
  const ref = cfg.fairness.reference;
  const base = evals[ref];
  const list = KINDS.map((k) => evals[k]);
  const cls = (m: (typeof METRICS)[number], d: number) => {
    if (!Number.isFinite(d) || Math.abs(d) < 0.005 || m.better === 'none') return 'delta';
    const good = m.better === 'high' ? d > 0 : d < 0;
    return 'delta ' + (good ? 'good' : 'bad');
  };
  const extra: { label: string; unit: string; get: (k: Kind) => number; digits: number }[] = [
    { label: 'U — სივრცული (მეორადი განაწილება)', unit: 'V', get: (k) => lab.secondary[k]?.result.U ?? NaN, digits: 3 },
    { label: 'ΔU სივრცული − ერთიანი', unit: 'mV', get: (k) => (lab.secondary[k]?.result.dU ?? NaN) * 1000, digits: 1 },
    { label: 'კათოდის კინეტიკურად ეკვივალენტური ფართობი / დასველებული (სივრცული)', unit: '%', get: (k) => (lab.secondary[k]?.result.utilC ?? NaN) * 100, digits: 0 },
    { label: 'კათოდის j: 95-ე პერცენტილი / საშუალო (პირველადი)', unit: '—', get: (k) => lab.primary[k]?.statsC.p95 ?? NaN, digits: 2 },
    { label: 'კათოდის ფართობი, სადაც j < 0.1·j̄ (პირველადი განაწილება)', unit: '%', get: (k) => (lab.primary[k]?.statsC.shadowFrac ?? NaN) * 100, digits: 1 },
    { label: 'კათოდის ფართობი პირდაპირი განიავების გარეშე (გეომეტრიული ინდიკატორი)', unit: '%', get: (k) => (lab.primary[k]?.traps.trappedAreaC ?? NaN) * 100, digits: 1 },
    { label: 'კათოდის ფართობი ჰიდროსტატიკურ გაზის ჯიბეში (გეომეტრიული ინდიკატორი)', unit: '%', get: (k) => (lab.primary[k]?.traps.pocketAreaC ?? NaN) * 100, digits: 1 },
  ];
  return (
    <div className="panel">
      <div className="row">
        <h3 className="grow">უჯრედის დონის შედარება — საბაზისო: {KIND_SHORT[ref]}</h3>
        <button className="btn small" onClick={() => download('topocell-comparison.csv', comparisonCsv(list, ref), 'text/csv')}>
          CSV ექსპორტი
        </button>
      </div>
      <Notice kind="info">
        {conclusion(lab).map((t, i) => (
          <p key={i} style={{ marginBottom: 4 }}>
            {t}
          </p>
        ))}
      </Notice>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>მაჩვენებელი</th>
              <th>ერთეული</th>
              {KINDS.map((k) => (
                <th key={k}>
                  <i className="swatch" style={{ background: SERIES_VAR[k] }} />
                  {KIND_SHORT[k]}
                  {k === ref ? ' (საბაზისო)' : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>მდგომარეობა</td>
              <td />
              {KINDS.map((k) => (
                <td key={k}>
                  {evals[k].valid ? (
                    <span className="status-pass">✓ დასაშვები</span>
                  ) : (
                    <span className="status-fail" title={evals[k].errors.join('\n')}>
                      ✕ დაუშვებელი
                    </span>
                  )}
                </td>
              ))}
            </tr>
            <tr>
              <td>მასშტაბი λ (სამართლიანი შედარება)</td>
              <td>—</td>
              {KINDS.map((k) => (
                <td key={k}>{fmt(evals[k].lambda, 4)}</td>
              ))}
            </tr>
            <tr>
              <td>ომური წინაღობის წყარო</td>
              <td />
              {KINDS.map((k) => (
                <td key={k}>{!evals[k].valid ? '—' : evals[k].kSource === 'solver' ? `3D (N=${cfg.solver.resolution})` : 'უხეში d/(κA)'}</td>
              ))}
            </tr>
            {METRICS.map((m) => (
              <tr key={m.id}>
                <td>{m.label}</td>
                <td>{m.unit}</td>
                {KINDS.map((k) => {
                  const v = m.get(evals[k]);
                  const d = pctDelta(v, m.get(base));
                  return (
                    <td key={k}>
                      {fmt(v, m.digits)}
                      {k !== ref && Number.isFinite(d) && <span className={cls(m, d)}>{pct(d, 2)}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
            {extra.map((x) => (
              <tr key={x.label} className="hl">
                <td>
                  {x.label} <Tag kind="solver" />
                </td>
                <td>{x.unit}</td>
                {KINDS.map((k) => {
                  const s = lab.secondary[k];
                  const stale = x.label.includes('სივრცული') ? s?.stale : false;
                  return (
                    <td key={k} style={stale ? { opacity: 0.5 } : undefined} title={stale ? 'მოძველებული — პარამეტრები შეიცვალა' : undefined}>
                      {fmt(x.get(k), x.digits)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="hint">
        პროცენტები — ცვლილება საბაზისო მოდელთან. მწვანე/წითელი მხოლოდ იქ გამოიყენება, სადაც მიმართულებას ცალსახა აზრი აქვს (მაგ. ნაკლები kWh/kg უკეთესია). ნაცრისფერი სტრიქონები 3D ამომხსნელის
        შედეგია; დანარჩენი — ერთიანი (0D) მოდელი, რომელიც მთელ დასველებულ ფართობს თანაბრად გამოყენებულად თვლის და ამიტომ ძაბვის ქვედა (ოპტიმისტური) შეფასებაა.
      </div>
    </div>
  );
}
