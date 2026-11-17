import { KIND_LABEL, KIND_SHORT, KINDS } from '../core/geometry/cell';
import { DistStats, richardson } from '../core/solver/solver';
import { XYChart } from './charts';
import { Notice, Tag } from './controls';
import { SERIES_VAR, fmt, sig } from './format';
import { Lab } from './useLab';

function StatsRows({ name, a, c, abs }: { name: string; a: DistStats; c: DistStats; abs: boolean }) {
  const rows: [string, (s: DistStats) => string][] = [
    [abs ? 'საშუალო j, A/m²' : 'საშუალო j (ნორმირებული)', (s) => fmt(s.mean, abs ? 0 : 2)],
    ['მედიანა / საშუალო', (s) => fmt(s.p50, 2)],
    ['95-ე პერცენტილი / საშუალო (მდგრადი)', (s) => fmt(s.p95, 2)],
    ['99-ე პერცენტილი / საშუალო', (s) => fmt(s.p99, 2)],
    ['მაქსიმუმი / საშუალო (ბადეზე მგრძნობიარე)', (s) => fmt(s.max, 2)],
    ['თანაბრობის ინდექსი (∫j)²/(A∫j²)', (s) => fmt(s.participation, 3)],
    ['„დაჩრდილული“ ფართობი (j < 0.1·j̄), %', (s) => fmt(s.shadowFrac * 100, 1)],
  ];
  return (
    <table className="data">
      <thead>
        <tr>
          <th>{name}</th>
          <th>ანოდი</th>
          <th>კათოდი</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([l, f]) => (
          <tr key={l}>
            <td>{l}</td>
            <td>{f(a)}</td>
            <td>{f(c)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SolverPanel({ lab }: { lab: Lab }) {
  const kind = lab.cfg.active;
  const cell = lab.resolved[kind].built.cell;
  const prim = lab.primary[kind];
  const sec = lab.secondary[kind];
  const e = lab.evals[kind];
  const conv = lab.convergence;
  if (!lab.cfg.solver.enabled)
    return (
      <div className="panel">
        <Notice kind="info">სივრცული ამომხსნელი გამორთულია. გამარტივებული რეჟიმი სრულად მუშაობს უხეში d/(κA) შეფასებით; დენის რუკები არ იხატება.</Notice>
      </div>
    );
  if (!cell || !e.valid)
    return (
      <div className="panel">
        <Notice kind="err">აქტიური გეომეტრია დაუშვებელია — სივრცული ამოხსნა არ სრულდება.</Notice>
      </div>
    );
  const convRows = conv && conv.kind === kind ? conv.rows : [];
  const rich = convRows.length >= 2 ? richardson(convRows[convRows.length - 2].K, convRows[convRows.length - 2].h, convRows[convRows.length - 1].K, convRows[convRows.length - 1].h) : NaN;
  return (
    <div className="panel">
      <Notice kind="info">
        <b>რას ითვლის ეს ფენა.</b> ∇·(κ∇φ) = 0 ელექტროლიტში, იზოლირებული კედლებით. <b>პირველადი განაწილება</b> (φ = const ელექტროდებზე) იძლევა მხოლოდ ელექტროლიტის წინაღობას R = K/κ და არ აღწერს
        კინეტიკურ პოლარიზაციას — მისი ძაბვა სრული უჯრედის ძაბვა <u>არ არის</u>. <b>მეორადი განაწილება</b> ამატებს Butler–Volmer-ის სასაზღვრო პირობას. კონცენტრაციული ეფექტები, ბუშტუკების ნაკადი
        და ლითონის წინაღობა არ მოდელირდება.
      </Notice>
      <div className="two-col">
        <div className="card card-pad">
          <div className="row">
            <h3 className="grow">პირველადი განაწილება — {KIND_SHORT[kind]}</h3>
            <Tag kind="solver" />
          </div>
          {!prim ? (
            <p className="sub" style={{ marginTop: 8 }}>
              {lab.solverErrors[kind] ?? 'გამოთვლა მიმდინარეობს…'}
            </p>
          ) : (
            <>
              <table className="data" style={{ marginTop: 6 }}>
                <tbody>
                  <tr>
                    <td>უჯრედის მუდმივა K (3D)</td>
                    <td>{sig(prim.K, 4)} 1/m</td>
                  </tr>
                  <tr>
                    <td>უხეში შეფასება d/A</td>
                    <td>
                      {sig(cell.roughK, 4)} 1/m ({fmt((cell.roughK / prim.K - 1) * 100, 0)} % სხვაობა)
                    </td>
                  </tr>
                  <tr>
                    <td>ელექტროლიტის წინაღობა R = K/κ_eff</td>
                    <td>{e.b ? fmt(e.b.Rel * 1000, 2) : '—'} mΩ</td>
                  </tr>
                  <tr>
                    <td>ბადე</td>
                    <td>
                      {prim.dims.join(' × ')} · h = {fmt(prim.h * 1000, 2)} მმ
                    </td>
                  </tr>
                  <tr>
                    <td>უცნობების რაოდენობა · PCG იტერაციები</td>
                    <td>
                      {prim.unknowns.toLocaleString('en-US')} · {prim.iters}
                    </td>
                  </tr>
                  <tr>
                    <td>დენის ბალანსი |I_a − I_c| / I</td>
                    <td>{prim.balance.toExponential(1)}</td>
                  </tr>
                  <tr>
                    <td>დაშორება ვოქსელებში</td>
                    <td>{fmt(prim.gapCells, 1)}</td>
                  </tr>
                  <tr>
                    <td>ფართობის კორექცია (ბადე → ნამდვილი)</td>
                    <td>
                      {fmt(prim.areaScale[0], 3)} / {fmt(prim.areaScale[1], 3)}
                    </td>
                  </tr>
                  <tr>
                    <td>ამოხსნის დრო</td>
                    <td>{fmt(prim.ms, 0)} ms</td>
                  </tr>
                </tbody>
              </table>
              <p className="hint" style={{ marginTop: 6 }}>
                R = d/(κA) ზუსტია მხოლოდ მაშინ, როცა დენის ხაზები პარალელურია და მთელ კვეთას ავსებს. აქ სხვაობა ნაპირის ეფექტებიდან, უკანა ზედაპირებიდან და ფორმის სიმრუდიდან მოდის.
              </p>
              {prim.warnings.length > 0 && (
                <Notice kind="warn">
                  <ul>
                    {prim.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </Notice>
              )}
              <div className="table-wrap" style={{ marginTop: 8 }}>
                <StatsRows name="დენის სიმკვრივის განაწილება" a={prim.statsA} c={prim.statsC} abs={false} />
              </div>
              <p className="hint" style={{ marginTop: 6 }}>
                პირველად განაწილებაში წიბოებზე j თეორიულად უსასრულოა, ამიტომ მაქსიმუმი ბადის დაწვრილებასთან ერთად იზრდება. მდგრადი მაჩვენებელია 95-ე პერცენტილი (იხ. კრებადობის ცხრილი).
              </p>
            </>
          )}
        </div>
        <div className="card card-pad">
          <div className="row">
            <h3 className="grow">მეორადი განაწილება სამუშაო წერტილზე</h3>
            <button className="btn small" onClick={() => lab.requestSecondary([...KINDS])} disabled={lab.busyInteractive}>
              {lab.busyInteractive ? 'ითვლება…' : 'ყველას გადათვლა'}
            </button>
          </div>
          {!sec ? (
            <p className="sub" style={{ marginTop: 8 }}>
              ჯერ არ არის გამოთვლილი.
            </p>
          ) : (
            <>
              {sec.stale && <Notice kind="warn">პარამეტრები შეიცვალა — ეს შედეგი წინა მდგომარეობას ეკუთვნის.</Notice>}
              {!sec.result.converged && <Notice kind="err">{sec.result.note}</Notice>}
              <table className="data" style={{ marginTop: 6 }}>
                <thead>
                  <tr>
                    <th>სიდიდე</th>
                    <th>სივრცული</th>
                    <th>ერთიანი (0D)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>დენი I, A</td>
                    <td>{fmt(sec.result.I, 4)}</td>
                    <td>{fmt(sec.result.I, 4)}</td>
                  </tr>
                  <tr>
                    <td>უჯრედის ძაბვა U, V</td>
                    <td>{fmt(sec.result.U, 4)}</td>
                    <td>{fmt(sec.result.lumped.U, 4)}</td>
                  </tr>
                  <tr>
                    <td>η_a (დენით შეწონილი), mV</td>
                    <td>{fmt(sec.result.etaA * 1000, 1)}</td>
                    <td>{fmt(sec.result.lumped.etaA * 1000, 1)}</td>
                  </tr>
                  <tr>
                    <td>|η_c| (დენით შეწონილი), mV</td>
                    <td>{fmt(sec.result.etaC * 1000, 1)}</td>
                    <td>{fmt(sec.result.lumped.etaC * 1000, 1)}</td>
                  </tr>
                  <tr>
                    <td>ელექტროლიტში ვარდნა, mV</td>
                    <td>{fmt(sec.result.ohmic * 1000, 1)}</td>
                    <td>{fmt(sec.result.lumped.ohmic * 1000, 1)}</td>
                  </tr>
                  <tr>
                    <td title="A_kin / A, სადაც A_kin = I / (f_r(1−θ)·j_BV(η̄)) და η̄ დენით შეწონილი საშუალო გადაძაბვაა. ეს ზღვრით განსაზღვრული „მომუშავე ფართობის წილი“ არ არის.">
                      კინეტიკურად ეკვივალენტური ფართობი / დასველებული (ანოდი / კათოდი), %
                    </td>
                    <td>
                      {fmt(sec.result.utilA * 100, 0)} / {fmt(sec.result.utilC * 100, 0)}
                    </td>
                    <td>100 / 100 (დაშვება)</td>
                  </tr>
                  <tr>
                    <td>ნიუტონის იტერაციები · ბალანსი</td>
                    <td>
                      {sec.result.iterations} · {sec.result.balance.toExponential(1)}
                    </td>
                    <td>—</td>
                  </tr>
                </tbody>
              </table>
              <p className="hint" style={{ marginTop: 6 }}>
                ΔU = {fmt(sec.result.dU * 1000, 1)} mV. ერთიანი მოდელი იყენებს პირველადი განაწილების მინიმალურ წინაღობას და კინეტიკას თანაბარ j-ზე — ორივე ქვედა ზღვარია, ამიტომ სივრცული ძაბვა
                ყოველთვის ოდნავ მეტია. დიდი ΔU ნიშნავს, რომ ფართობის ნაწილი ეკრანირებულია და 0D შეფასებას ვერ ვენდობით.
              </p>
              <div className="table-wrap" style={{ marginTop: 8 }}>
                <StatsRows name="განაწილება კინეტიკის გათვალისწინებით" a={sec.result.statsA} c={sec.result.statsC} abs />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="two-col">
        <div className="card card-pad">
          <div className="row">
            <h3 className="grow">ელექტროლიტის წვდომა და გაზის ჩაკეტვა</h3>
            <Tag kind="solver">გეომეტრიული ინდიკატორი</Tag>
          </div>
          {prim ? (
            <>
              <table className="data" style={{ marginTop: 6 }}>
                <tbody>
                  <tr>
                    <td>ელექტროლიტის მოცულობა ავზში</td>
                    <td>{fmt(prim.traps.fluidVolume * 1e6, 1)} სმ³</td>
                  </tr>
                  <tr>
                    <td>პირდაპირი განიავების გარეშე: მოცულობა, საიდანაც მონოტონურად აღმავალი გზა არ არსებობს</td>
                    <td>
                      {fmt(prim.traps.trappedVolume * 1e6, 2)} სმ³ ({fmt(prim.traps.trappedFrac * 100, 2)} %)
                    </td>
                  </tr>
                  <tr>
                    <td>კათოდის ფართობი ამ მოცულობასთან (H₂)</td>
                    <td>{fmt(prim.traps.trappedAreaC * 100, 1)} %</td>
                  </tr>
                  <tr>
                    <td>ანოდის ფართობი ამ მოცულობასთან (O₂)</td>
                    <td>{fmt(prim.traps.trappedAreaA * 100, 1)} %</td>
                  </tr>
                  <tr>
                    <td>ჰიდროსტატიკური ჯიბე (მოცულობა გადმოღვრის დონის ზემოთ)</td>
                    <td>
                      {fmt(prim.traps.pocketVolume * 1e6, 2)} სმ³ ({fmt(prim.traps.pocketFrac * 100, 2)} %)
                    </td>
                  </tr>
                  <tr>
                    <td>კათოდის / ანოდის ფართობი ამ ჯიბეში</td>
                    <td>
                      {fmt(prim.traps.pocketAreaC * 100, 1)} % / {fmt(prim.traps.pocketAreaA * 100, 1)} %
                    </td>
                  </tr>
                  <tr>
                    <td>ძირითად მოცულობასთან დაუკავშირებელი ელექტროლიტი</td>
                    <td>{fmt(prim.traps.isolatedVolume * 1e6, 2)} სმ³</td>
                  </tr>
                  <tr>
                    <td>კათოდის „დაჩრდილული“ ფართობი (იონური ეკრანირება)</td>
                    <td>{fmt(prim.statsC.shadowFrac * 100, 1)} %</td>
                  </tr>
                </tbody>
              </table>
              <p className="hint" style={{ marginTop: 6 }}>
                ორივე ინდიკატორი წმინდა გეომეტრიულია. „პირდაპირი განიავება“: არსებობს თუ არა უჯრედიდან თავისუფალ ზედაპირამდე გზა, რომელზეც სიმაღლე არ მცირდება. „ჰიდროსტატიკური ჯიბე“: მოცულობა,
                რომელიც კვაზისტატიკურ ზღვარში გაზით გაივსებოდა, სანამ გაზი გადმოღვრის წერტილს მიაღწევდა. არცერთი არ არის მრავალფაზიანი ნაკადის მოდელი და ბუშტუკების ფაქტობრივ მოცილებას არ
                პროგნოზირებს; ვიწრო ღრეჩოებში შედეგი ბადეზეა დამოკიდებული. 3D ხედში ჩართეთ „გაზის ჯიბეები“ და „პოტენციალის ჭრილი“.
              </p>
              {kind === 'klein' && (
                <Notice kind="warn">
                  გეომეტრიიდან გამოყვანილი ჰიპოთეზა (ექსპერიმენტულად შეუმოწმებელი): ფანჯრის ზედა კიდის ზემოთ მდებარე ღრუ — კორპუსის ზედა ნაწილი, ყელი და სახელური — ჰიდროსტატიკური ჯიბეა. ის
                  გაზით გაივსებოდა, შემდეგ კი გაზი ფანჯრის ღრეჩოდან გავიდოდა; ამ ჯიბეში მოხვედრილი ელექტროდის ზედაპირი მშრალი დარჩებოდა. ზედაპირული დაჭიმულობა, გაზის გახსნა და დინამიკა
                  მოდელში არ არის.
                </Notice>
              )}
            </>
          ) : (
            <p className="sub">გამოთვლა მიმდინარეობს…</p>
          )}
        </div>
        <div className="card card-pad">
          <div className="row">
            <h3 className="grow">ბადის კრებადობის კვლევა</h3>
            <button className="btn small" disabled={conv?.running} onClick={() => lab.runConvergence(kind, [24, 32, 48, 64, 80])}>
              {conv?.running ? 'მიმდინარეობს…' : 'გაშვება (N = 24…80)'}
            </button>
          </div>
          {conv?.error && <Notice kind="err">{conv.error}</Notice>}
          {convRows.length > 0 ? (
            <>
              <div className="table-wrap" style={{ marginTop: 6 }}>
                <table className="data">
                  <thead>
                    <tr>
                      <th>N</th>
                      <th>h, მმ</th>
                      <th>უცნობები</th>
                      <th>K, 1/m</th>
                      <th>ΔK, %</th>
                      <th>p95 (კათ.)</th>
                      <th>max (კათ.)</th>
                      <th>ბალანსი</th>
                      <th>ms</th>
                    </tr>
                  </thead>
                  <tbody>
                    {convRows.map((r, i) => (
                      <tr key={r.N}>
                        <td>{r.N}</td>
                        <td>{fmt(r.h * 1000, 2)}</td>
                        <td>{r.unknowns.toLocaleString('en-US')}</td>
                        <td>{sig(r.K, 5)}</td>
                        <td>{i ? fmt((r.K / convRows[i - 1].K - 1) * 100, 2) : '—'}</td>
                        <td>{fmt(r.p95C, 2)}</td>
                        <td>{fmt(r.maxC, 2)}</td>
                        <td>{r.balance.toExponential(0)}</td>
                        <td>{fmt(r.ms, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {Number.isFinite(rich) && (
                <p className="hint" style={{ marginTop: 6 }}>
                  რიჩარდსონის ექსტრაპოლაცია (ბოლო ორი ბადე, 1-ლი რიგი): K₀ ≈ {sig(rich, 5)} 1/m; სხვაობა ყველაზე წვრილ ბადესთან {fmt(Math.abs(rich / convRows[convRows.length - 1].K - 1) * 100, 2)} % — ეს
                  არის K-ის რიცხვითი გაურკვევლობის შეფასება. p95 სტაბილურდება, max კი იზრდება (სინგულარობა წიბოებზე).
                </p>
              )}
              {convRows.length >= 2 && (
                <XYChart
                  title="K ბადის გარჩევადობის მიხედვით"
                  series={[{ id: 'k', name: 'K', color: SERIES_VAR[kind], pts: convRows.map((r) => ({ x: r.N, y: r.K })) }]}
                  xLabel="N"
                  yLabel="K, 1/m"
                  height={170}
                  points
                />
              )}
            </>
          ) : (
            <p className="hint" style={{ marginTop: 8 }}>
              {KIND_LABEL[kind]}: გაუშვით, რომ ნახოთ, რამდენად არის K, 95-ე პერცენტილი და მაქსიმუმი ბადეზე დამოკიდებული.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
