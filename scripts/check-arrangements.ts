// დიაგნოსტიკა: ყველა განლაგების აგება, დაშორება, მიმყვანების მარშრუტი და აგების დრო.
import { KINDS, buildCell, defaultEnv, defaultGeometries } from '../src/core/geometry/cell';

const g = defaultGeometries();
for (const k of KINDS) {
  const t = performance.now();
  const b = buildCell(k, g, defaultEnv());
  console.log(k, (performance.now() - t).toFixed(0) + 'ms', 'warnings:', b.warnings.length, 'leads clear:', b.cell!.leads.cathode.clear, b.cell!.leads.anode.clear, 'segments:', b.cell!.leads.cathode.points.length - 1, b.cell!.leads.anode.points.length - 1);
}
for (const kind of ['rings', 'mobius'] as const)
  for (const arr of ['stacked', 'side', 'nested', 'conformal'] as const) {
    const gg = defaultGeometries();
    gg[kind].arrangement = arr;
    const b = buildCell(kind, gg, defaultEnv());
    const c = b.cell;
    console.log(kind, arr, 'errors:', b.errors, 'warn:', b.warnings.length, c && `dmin=${(c.minDistance * 1000).toFixed(3)}mm areaA=${(c.areaA * 1e4).toFixed(1)} areaC=${(c.areaC * 1e4).toFixed(1)} volA=${(c.volumeA * 1e6).toFixed(2)} parts=${c.anode.parts} genusA=${c.reportA.genus} comps=${c.reportA.components}`);
  }
const gp = defaultGeometries();
gp.plates.arrangement = 'sandwich';
const bp = buildCell('plates', gp, defaultEnv());
console.log('plates sandwich', bp.errors, bp.warnings, bp.cell && (bp.cell.minDistance * 1000).toFixed(3));
const gr = defaultGeometries();
gr.mobius.placement.rz = 90;
const br = buildCell('mobius', gr, defaultEnv());
console.log('mobius rz=90', br.errors, br.cell && (br.cell.minDistance * 1000).toFixed(3));
