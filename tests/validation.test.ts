import { describe, expect, it } from 'vitest';
import { geometryChecks, physicsChecks, solverChecks } from '../src/core/validation';
import { defaultConfig, evaluate, resolveGeometries, validateConfig } from '../src/core/lab';
import { KINDS } from '../src/core/geometry/cell';
import { primaryCached, runScan } from '../src/core/scan';
import { presets } from '../src/core/presets';

function runGroup(name: string, checks: ReturnType<typeof physicsChecks>) {
  describe(name, () => {
    for (const c of checks) {
      it(`${c.title} — მოსალოდნელი: ${c.expected}; მიღებული: ${c.actual}`, () => {
        expect(c.pass, `${c.id}: ${c.actual}`).toBe(true);
      });
    }
  });
}

runGroup('ფიზიკა', physicsChecks());
runGroup('გეომეტრია', geometryChecks());
runGroup('სივრცული ამომხსნელი', solverChecks());

describe('უჯრედის დონის შედარება', () => {
  const cfg = defaultConfig();
  it('ნაგულისხმევი კონფიგურაცია ვალიდურია და ოთხივე გეომეტრია აიგება', () => {
    expect(validateConfig(cfg)).toEqual([]);
    const res = resolveGeometries(cfg);
    for (const k of KINDS) expect(res[k].built.errors, k).toEqual([]);
  });

  it('ერთნაირი დენი: H₂ ყველა გეომეტრიაში იდენტურია, ძაბვა — არა', () => {
    const res = resolveGeometries(cfg);
    const evs = KINDS.map((k) => evaluate(res[k], cfg, primaryCached(res[k].built, 32)!.K));
    const n0 = evs[0].prod!.nH2;
    for (const e of evs) expect(e.prod!.nH2).toBe(n0);
    const us = new Set(evs.map((e) => e.b!.U.toFixed(4)));
    expect(us.size).toBeGreaterThan(1);
  });

  it('სამართლიანი ნორმალიზება: ერთნაირი მასალის მოცულობა ±0.01 %', () => {
    const c = { ...cfg, fairness: { constraint: 'volume' as const, reference: 'plates' as const } };
    const res = resolveGeometries(c);
    const ref = res.plates.built.cell!;
    const target = ref.volumeA + ref.volumeC;
    for (const k of KINDS) {
      const cell = res[k].built.cell!;
      expect(Math.abs((cell.volumeA + cell.volumeC) / target - 1), k).toBeLessThan(1e-4);
    }
  });

  it('სამართლიანი ნორმალიზება: ერთნაირი დასველებული ფართობი და გაბარიტი', () => {
    for (const constraint of ['area', 'envelope'] as const) {
      const c = { ...cfg, fairness: { constraint, reference: 'plates' as const } };
      const res = resolveGeometries(c);
      const ref = res.plates.built.cell!;
      const target = constraint === 'area' ? ref.areaA + ref.areaC : ref.envelopeVolume;
      for (const k of KINDS) {
        const cell = res[k].built.cell!;
        const v = constraint === 'area' ? cell.areaA + cell.areaC : cell.envelopeVolume;
        // თუ სამიზნე მიუღწეველია, ეს ფარულად არ იმალება: ბრუნდება შენიშვნა და λ = 1
        if (res[k].normNote) expect(res[k].lambda, `${constraint}/${k}`).toBe(1);
        else expect(Math.abs(v / target - 1), `${constraint}/${k}`).toBeLessThan(1e-3);
      }
    }
  });

  it('სკანირება დეტერმინისტულია (განმეორებადობა)', () => {
    const p = presets()[2];
    const spec = { ...p.scan!, resolution: 24, refineTop: 1, refineResolution: 32 };
    const a = runScan(p.config, spec);
    const b = runScan(p.config, spec);
    expect(JSON.stringify(a.rows)).toBe(JSON.stringify(b.rows));
    expect(a.rows.length).toBe(16);
    expect(a.rows.filter((r) => r.feasible).length).toBeGreaterThan(0);
  });
});
