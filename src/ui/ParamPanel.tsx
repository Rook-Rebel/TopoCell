import { BandParams, KIND_LABEL, KINDS, Kind, KleinParams, Placement, PlatesParams } from '../core/geometry/cell';
import { FAIR_LABEL, FairConstraint, LabConfig } from '../core/lab';
import { kohConductivity, tafelSlope } from '../core/physics';
import { ARRANGEMENT_LABEL } from '../core/scan';
import { Check, Notice, NumField, Section, Seg, SelectField, Tag } from './controls';
import { Lab } from './useLab';

const MM = 1000;

function PlacementFields({ p, set, rot = true }: { p: Placement; set: (q: Partial<Placement>) => void; rot?: boolean }) {
  return (
    <>
      <div className="hint">ანოდის დამატებითი გადაადგილება და მობრუნება (მობრუნება სრულდება დაშორების მორგებამდე, გადაადგილება — მის შემდეგ).</div>
      <NumField label="Δx" value={p.dx} onChange={(v) => set({ dx: v })} unit="მმ" scale={MM} min={-200} max={200} digits={2} step={1} />
      <NumField label="Δy" value={p.dy} onChange={(v) => set({ dy: v })} unit="მმ" scale={MM} min={-200} max={200} digits={2} step={1} />
      <NumField label="Δz" value={p.dz} onChange={(v) => set({ dz: v })} unit="მმ" scale={MM} min={-200} max={200} digits={2} step={1} />
      {rot && (
        <>
          <NumField label="მობრუნება x ღერძზე" value={p.rx} onChange={(v) => set({ rx: v })} unit="°" min={-180} max={180} digits={1} step={5} />
          <NumField label="მობრუნება y ღერძზე" value={p.ry} onChange={(v) => set({ ry: v })} unit="°" min={-180} max={180} digits={1} step={5} />
          <NumField label="მობრუნება z ღერძზე" value={p.rz} onChange={(v) => set({ rz: v })} unit="°" min={-180} max={180} digits={1} step={5} />
        </>
      )}
    </>
  );
}

export function ParamPanel({ lab }: { lab: Lab }) {
  const { cfg, setCfg } = lab;
  const kind = cfg.active;
  const patch = (fn: (c: LabConfig) => void) =>
    setCfg((c) => {
      const n: LabConfig = JSON.parse(JSON.stringify(c));
      fn(n);
      return n;
    });
  const e = cfg.electrical;
  const built = lab.resolved[kind].built;
  const lam = lab.resolved[kind].lambda;
  const TC = cfg.electrolyte.T;

  const geomFields = () => {
    if (kind === 'plates') {
      const g = cfg.geometries.plates;
      const set = (q: Partial<PlatesParams>) => patch((c) => Object.assign(c.geometries.plates, q));
      return (
        <>
          <NumField label="სიგანე W" value={g.width} onChange={(v) => set({ width: v })} unit="მმ" scale={MM} min={5} max={300} digits={2} step={1} />
          <NumField label="სიმაღლე H" value={g.height} onChange={(v) => set({ height: v })} unit="მმ" scale={MM} min={5} max={300} digits={2} step={1} />
          <NumField label="სისქე t" value={g.thickness} onChange={(v) => set({ thickness: v })} unit="მმ" scale={MM} min={0.2} max={10} digits={2} step={0.1} />
          <NumField label="დაშორება d" hint="ზედაპირებს შორის" value={g.gap} onChange={(v) => set({ gap: v })} unit="მმ" scale={MM} min={0.5} max={100} digits={2} step={0.5} />
          <SelectField
            label="განლაგება"
            value={g.arrangement}
            onChange={(v) => set({ arrangement: v })}
            options={[
              { value: 'pair', label: ARRANGEMENT_LABEL.pair },
              { value: 'sandwich', label: ARRANGEMENT_LABEL.sandwich },
            ]}
            wide
          />
          <PlacementFields p={g.placement} set={(q) => patch((c) => Object.assign(c.geometries.plates.placement, q))} />
        </>
      );
    }
    if (kind === 'rings' || kind === 'mobius') {
      const g = cfg.geometries[kind];
      const set = (q: Partial<BandParams>) => patch((c) => Object.assign(c.geometries[kind], q));
      return (
        <>
          <NumField label="რადიუსი R" hint="ცენტრალური წრეწირი" value={g.radius} onChange={(v) => set({ radius: v })} unit="მმ" scale={MM} min={3} max={200} digits={2} step={1} />
          <NumField label="სიგანე w" value={g.width} onChange={(v) => set({ width: v })} unit="მმ" scale={MM} min={1} max={150} digits={2} step={1} />
          <NumField label="სისქე t" value={g.thickness} onChange={(v) => set({ thickness: v })} unit="მმ" scale={MM} min={0.2} max={10} digits={2} step={0.1} />
          <NumField
            label="ნახევარბრუნები n"
            hint={kind === 'rings' ? '0 — გადაუგრეხავი (კონტროლი)' : '1 — მიობიუსი; 2 — სრული ბრუნი (ორმხრივი)'}
            value={g.halfTwists}
            onChange={(v) => set({ halfTwists: Math.round(v) })}
            min={kind === 'rings' ? 0 : 1}
            max={kind === 'rings' ? 0 : 5}
            digits={0}
            step={1}
            integer
          />
          <NumField label="კვეთის ფაზა θ₀" hint="0° — ბრტყელი რგოლი; 90° — ცილინდრი (n = 0)" value={g.phaseDeg} onChange={(v) => set({ phaseDeg: v })} unit="°" min={-180} max={180} digits={1} step={15} />
          <NumField label="დაშორება" hint="მინიმალური, ზედაპირებს შორის" value={g.gap} onChange={(v) => set({ gap: v })} unit="მმ" scale={MM} min={0.5} max={100} digits={2} step={0.5} />
          <SelectField
            label="განლაგება"
            value={g.arrangement}
            onChange={(v) => set({ arrangement: v })}
            options={(['stacked', 'side', 'nested', 'conformal'] as const).map((a) => ({ value: a, label: ARRANGEMENT_LABEL[a] }))}
            wide
          />
          {g.arrangement === 'conformal' && (
            <div className="hint">
              კონფორმული ანოდი აქ აგებულია როგორც კათოდის ორივე ლოკალურ მხარეს პარალელურად წანაცვლებული ზოლი (კიდის შემოვლის გარეშე).{' '}
              {g.halfTwists % 2 ? 'კენტი n-ისას ეს ზოლი ერთი ბმული ნაწილია, რომელიც ორ ბრუნს აკეთებს.' : 'ლუწი n-ისას ამ კონსტრუქციაში ორი ცალკე ზოლი მიიღება; მოდელი ორივეს ერთ პოტენციალზე თვლის (ხიდით ან კიდის შემოვლით ერთ ნაწილადაც დამზადდებოდა).'}{' '}
              მასალის ხარჯი ≈ 2×.
            </div>
          )}
          <PlacementFields p={g.placement} set={(q) => patch((c) => Object.assign(c.geometries[kind].placement, q))} />
        </>
      );
    }
    const g = cfg.geometries.klein;
    const set = (q: Partial<KleinParams>) => patch((c) => Object.assign(c.geometries.klein, q));
    return (
      <>
        <div className="field wide">
          <label>ხედის რეჟიმი</label>
          <Seg
            value={g.view}
            onChange={(v) => set({ view: v })}
            options={[
              { value: 'physical', label: 'ბ) ფიზიკური მიახლოება' },
              { value: 'math', label: 'ა) მათემატიკური იმერსია' },
            ]}
          />
        </div>
        <div className="hint">
          {g.view === 'math'
            ? 'სასწავლო ხედი: ნამდვილი კლაინის ბოთლის იმერსია ℝ³-ში აუცილებლად თვითგადაკვეთადია (წითელი მრუდი). ასეთი ელექტროდის დამზადება შეუძლებელია; გამოთვლები ყოველთვის ბ) მიახლოებაზე სრულდება.'
            : 'იგივე ზედაპირი, რომლის კედელშიც ყელის გასასვლელი ფანჯარაა ამოჭრილი. ტოპოლოგიურად ეს „კლაინის ბოთლი მინუს დისკოა“ — ნამდვილი კლაინის ბოთლი აღარ არის.'}
        </div>
        <NumField label="კორპუსის რადიუსი" value={g.bodyRadius} onChange={(v) => set({ bodyRadius: v })} unit="მმ" scale={MM} min={6} max={120} digits={2} step={1} />
        <NumField label="ყელის ფარდობა ρ/R" value={g.neckRatio} onChange={(v) => set({ neckRatio: v })} min={0.2} max={0.34} digits={3} step={0.01} />
        <NumField label="კედლის სისქე t" value={g.thickness} onChange={(v) => set({ thickness: v })} unit="მმ" scale={MM} min={0.2} max={5} digits={2} step={0.1} />
        <NumField label="ფანჯრის ღრეჩო" hint="ყელსა და კედლის ნაპირს შორის" value={g.clearance} onChange={(v) => set({ clearance: v })} unit="მმ" scale={MM} min={0.5} max={20} digits={2} step={0.5} />
        <NumField label="ანოდამდე დაშორება" value={g.gap} onChange={(v) => set({ gap: v })} unit="მმ" scale={MM} min={0.5} max={100} digits={2} step={0.5} />
        <NumField label="ანოდის კუთხური გაშლა" hint="რკალური გარსი კორპუსის გარშემო" value={g.anodeSpanDeg} onChange={(v) => set({ anodeSpanDeg: v })} unit="°" min={30} max={300} digits={0} step={10} />
        <NumField label="ანოდის სიმაღლის წილი" value={g.anodeHeightFrac} onChange={(v) => set({ anodeHeightFrac: v })} min={0.2} max={1} digits={2} step={0.05} />
        <PlacementFields p={g.placement} set={(q) => patch((c) => Object.assign(c.geometries.klein.placement, q))} />
      </>
    );
  };

  return (
    <div>
      <Section title="შედარების რეჟიმი" open>
        <div className="field wide">
          <label>ელექტრული რეჟიმი — რა ფიქსირდება</label>
          <Seg
            value={e.mode}
            onChange={(v) => patch((c) => (c.electrical.mode = v))}
            options={[
              { value: 'I', label: 'დენი I' },
              { value: 'U', label: 'ძაბვა U' },
              { value: 'P', label: 'სიმძლავრე P' },
            ]}
          />
        </div>
        {e.mode === 'I' && <NumField label="დენი I" value={e.I} onChange={(v) => patch((c) => (c.electrical.I = v))} unit="A" min={0} max={500} digits={3} step={0.5} />}
        {e.mode === 'U' && <NumField label="უჯრედის ძაბვა U" value={e.U} onChange={(v) => patch((c) => (c.electrical.U = v))} unit="V" min={0} max={10} digits={3} step={0.05} />}
        {e.mode === 'P' && <NumField label="სიმძლავრე P" value={e.P} onChange={(v) => patch((c) => (c.electrical.P = v))} unit="W" min={0} max={2000} digits={2} step={1} />}
        <NumField label="ექსპერიმენტის ხანგრძლივობა" value={e.duration} onChange={(v) => patch((c) => (c.electrical.duration = v))} unit="წთ" scale={1 / 60} min={0.1} max={100000} digits={1} step={10} />
        <SelectField<FairConstraint>
          label="გეომეტრიული შეზღუდვა — რა თანაბრდება"
          value={cfg.fairness.constraint}
          onChange={(v) => patch((c) => (c.fairness.constraint = v))}
          options={(Object.keys(FAIR_LABEL) as FairConstraint[]).map((k) => ({ value: k, label: FAIR_LABEL[k] }))}
          wide
        />
        {cfg.fairness.constraint !== 'none' && (
          <div className="hint">
            A–D გეომეტრიების სიბრტყითი ზომები მასშტაბირდება (λ), რომ არჩეული სიდიდე საბაზისო A მოდელს გაუტოლდეს. სისქე, დაშორება და ყველა ფიზიკური პარამეტრი უცვლელია. დანარჩენი სიდიდეები
            განსხვავებული რჩება და ცხრილში ჩანს.
          </div>
        )}
      </Section>

      <Section title="გეომეტრია" open>
        <SelectField<Kind>
          label="აქტიური მოდელი"
          value={kind}
          onChange={(v) => patch((c) => (c.active = v))}
          options={KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
          wide
        />
        {lam !== 1 && (
          <div className="hint">
            სამართლიანი შედარების მასშტაბი: λ = {lam.toFixed(4)} (ქვემოთ მოცემულია საწყისი, არამასშტაბირებული ზომები).
          </div>
        )}
        {geomFields()}
        {built.errors.length > 0 && (
          <Notice kind="err">
            <ul>
              {built.errors.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </Notice>
        )}
      </Section>

      <Section title="უჯრედი და მასალა">
        <NumField label="მინ. დასაშვები დაშორება" hint="ანოდსა და კათოდს შორის; ნაკლები — აკრძალულია" value={cfg.env.minGap} onChange={(v) => patch((c) => (c.env.minGap = v))} unit="მმ" scale={MM} min={0.1} max={50} digits={2} step={0.5} />
        <NumField label="ელექტროლიტის მარაგი" hint="ავზის კედლამდე, ყველა მხრიდან" value={cfg.env.tankMargin} onChange={(v) => patch((c) => (c.env.tankMargin = v))} unit="მმ" scale={MM} min={2} max={100} digits={1} step={1} />
        <NumField label="მასალის სიმკვრივე" hint="ნაგულისხმევი: ნიკელი" value={cfg.env.density} onChange={(v) => patch((c) => (c.env.density = v))} unit="kg/m³" min={500} max={25000} digits={0} step={100} />
        <div className="hint">ორივე ელექტროდი ერთი მასალისაა და ლითონი ეკვიპოტენციურად ითვლება (ლითონის წინაღობა ≪ ელექტროლიტის). ავზის კედლები და ზედაპირი იზოლირებულია.</div>
      </Section>

      <Section title="ელექტროლიტი" tag={<Tag kind="assume" />}>
        <NumField label="გამტარობა κ" value={cfg.electrolyte.kappa} onChange={(v) => patch((c) => (c.electrolyte.kappa = v))} unit="S/m" min={0.01} max={300} digits={2} step={1} />
        <button
          className="btn small"
          title="Gilliam et al. (2007) კორელაცია, 6.9 mol/L KOH"
          onClick={() => patch((c) => (c.electrolyte.kappa = +kohConductivity(6.9, c.electrolyte.T).toFixed(2)))}
        >
          κ ← 30 % KOH მოცემულ T-ზე ({kohConductivity(6.9, TC).toFixed(1)} S/m)
        </button>
        <NumField label="ტემპერატურა T" value={cfg.electrolyte.T} onChange={(v) => patch((c) => (c.electrolyte.T = v))} unit="°C" offset={-273.15} min={0} max={100} digits={1} step={5} />
        <NumField label="აბსოლუტური წნევა p" value={cfg.electrolyte.p} onChange={(v) => patch((c) => (c.electrolyte.p = v))} unit="bar" scale={1e-5} min={0.1} max={200} digits={3} step={0.5} />
        <NumField label="აირშემცველობა ε" hint="მოცულობითი წილი ელექტროლიტში (Bruggeman)" value={cfg.electrolyte.voidFraction} onChange={(v) => patch((c) => (c.electrolyte.voidFraction = v))} min={0} max={0.6} digits={3} step={0.02} />
        <div className="hint">
          იზოთერმული რეჟიმი: T ფიქსირებულია და საჭირო თბური მართვა (გათბობა/გაგრილება) არ მოდელირდება. κ და კინეტიკური პარამეტრები T-ის ცვლილებისას ავტომატურად არ იცვლება — შეცვალეთ
          შეგნებულად.
        </div>
      </Section>

      <Section title="ელექტროდული კინეტიკა" tag={<Tag kind="assume">საილუსტრაციო დაშვება</Tag>}>
        <div className="hint">Butler–Volmer: j = j₀·[exp(α·Fη/RT) − exp(−α′·Fη/RT)]. მნიშვნელობები გლუვი ნიკელის რიგისაა ტუტე გარემოში და კონკრეტული ელექტროდისთვის დაკალიბრებული არ არის.</div>
        <NumField label="ანოდი (OER): j₀" value={cfg.kinetics.anode.j0} onChange={(v) => patch((c) => (c.kinetics.anode.j0 = v))} unit="A/m²" min={1e-9} max={1e4} digits={6} />
        <NumField label="ანოდი: α" hint={`ტაფელის დახრა ${(tafelSlope(cfg.kinetics.anode.alphaF, TC) * 1000).toFixed(0)} mV/dec`} value={cfg.kinetics.anode.alphaF} onChange={(v) => patch((c) => (c.kinetics.anode.alphaF = v))} min={0.05} max={4} digits={3} step={0.05} />
        <NumField label="ანოდი: α′ (უკურეაქცია)" value={cfg.kinetics.anode.alphaR} onChange={(v) => patch((c) => (c.kinetics.anode.alphaR = v))} min={0.05} max={4} digits={3} step={0.05} />
        <NumField label="კათოდი (HER): j₀" value={cfg.kinetics.cathode.j0} onChange={(v) => patch((c) => (c.kinetics.cathode.j0 = v))} unit="A/m²" min={1e-9} max={1e4} digits={6} />
        <NumField label="კათოდი: α" hint={`ტაფელის დახრა ${(tafelSlope(cfg.kinetics.cathode.alphaF, TC) * 1000).toFixed(0)} mV/dec`} value={cfg.kinetics.cathode.alphaF} onChange={(v) => patch((c) => (c.kinetics.cathode.alphaF = v))} min={0.05} max={4} digits={3} step={0.05} />
        <NumField label="კათოდი: α′ (უკურეაქცია)" value={cfg.kinetics.cathode.alphaR} onChange={(v) => patch((c) => (c.kinetics.cathode.alphaR = v))} min={0.05} max={4} digits={3} step={0.05} />
      </Section>

      <Section title="ზედაპირი, ბუშტუკები, დანაკარგები" tag={<Tag kind="assume" />}>
        <NumField label="უხეშობის კოეფიციენტი f_r" hint="აქტიური / გეომეტრიული ფართობი" value={cfg.surface.roughness} onChange={(v) => patch((c) => (c.surface.roughness = v))} min={1} max={5000} digits={2} step={0.5} />
        <NumField label="დაფარვის წილი θ — ანოდი (O₂)" value={cfg.surface.thetaA} onChange={(v) => patch((c) => (c.surface.thetaA = v))} min={0} max={0.95} digits={3} step={0.05} />
        <NumField label="დაფარვის წილი θ — კათოდი (H₂)" value={cfg.surface.thetaC} onChange={(v) => patch((c) => (c.surface.thetaC = v))} min={0} max={0.95} digits={3} step={0.05} />
        <div className="hint">
          A_eff = A_დასველებული · f_r · (1 − θ). θ მხოლოდ კინეტიკაში შედის; ელექტროლიტის გამტარობაზე ბუშტუკების გავლენა ცალკე პარამეტრია (ε) — ერთი და იგივე ეფექტი ორჯერ არ ითვლება. θ ყველა
          გეომეტრიისთვის ერთნაირია: მოდელი არ ამტკიცებს, რომ რომელიმე ფორმა გაზს უკეთ იცილებს.
        </div>
        <NumField label="ფარადეული ეფექტიანობა — H₂" value={e.faradaicH2} onChange={(v) => patch((c) => (c.electrical.faradaicH2 = v))} min={0} max={1} digits={3} step={0.01} />
        <NumField label="ფარადეული ეფექტიანობა — O₂" value={e.faradaicO2} onChange={(v) => patch((c) => (c.electrical.faradaicO2 = v))} min={0} max={1} digits={3} step={0.01} />
        <NumField label="დამატებითი წინაღობა" hint="კონტაქტები, დიაფრაგმა (მიმდევრობით)" value={e.extraR} onChange={(v) => patch((c) => (c.electrical.extraR = v))} unit="mΩ" scale={1000} min={0} max={10000} digits={2} step={5} />
      </Section>

      <Section title="სამუშაო დიაპაზონი">
        <NumField label="მაქს. დენის სიმკვრივე" value={cfg.limits.jMax} onChange={(v) => patch((c) => (c.limits.jMax = v))} unit="A/m²" min={10} max={1e5} digits={0} step={500} />
        <NumField label="მაქს. უჯრედის ძაბვა" value={cfg.limits.uMax} onChange={(v) => patch((c) => (c.limits.uMax = v))} unit="V" min={1.3} max={10} digits={2} step={0.1} />
        <div className="hint">დიაპაზონის გარეთ შედეგი არ იცვლება და არ იმალება — ის ინიშნება გაფრთხილებით, ხოლო სკანირებაში ასეთი ვარიანტი დაუშვებლად ითვლება.</div>
      </Section>

      <Section title="სივრცული ამომხსნელი" tag={<Tag kind="solver" />}>
        <Check checked={cfg.solver.enabled} onChange={(v) => patch((c) => (c.solver.enabled = v))}>
          3D პოტენციალის ამოხსნა ჩართულია
        </Check>
        <SelectField
          label="ბადის გარჩევადობა N"
          hint="ვოქსელები ავზის გრძელ გვერდზე"
          value={String(cfg.solver.resolution)}
          onChange={(v) => patch((c) => (c.solver.resolution = Number(v)))}
          options={[
            { value: '32', label: '32 — ესკიზი' },
            { value: '48', label: '48 — სტანდარტული' },
            { value: '64', label: '64 — ზუსტი' },
            { value: '80', label: '80 — ძალიან ზუსტი (ნელი)' },
          ]}
        />
        <Check checked={lab.autoSecondary} onChange={lab.setAutoSecondary}>
          მეორადი განაწილება ავტომატურად (სამუშაო წერტილზე)
        </Check>
        {!cfg.solver.enabled && (
          <div className="hint">გამორთვისას ომური წინაღობა უხეში d/(κA) ფორმულით ფასდება და სივრცული რუკები არ იხატება (გამოგონილი ველები არ ჩანს).</div>
        )}
      </Section>

      <div className="row" style={{ padding: '12px 4px' }}>
        <button
          className="btn"
          onClick={() => {
            if (confirm('ყველა პარამეტრი დაბრუნდეს საწყის მნიშვნელობებზე?')) lab.setCfg(() => JSON.parse(JSON.stringify(defaultCfg())));
          }}
        >
          საწყისი პარამეტრები
        </button>
      </div>
    </div>
  );
}

import { defaultConfig } from '../core/lab';
function defaultCfg() {
  return defaultConfig();
}
