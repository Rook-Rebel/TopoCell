/// <reference lib="webworker" />
// გამოთვლითი Worker: მძიმე ამოხსნები ინტერფეისის ნაკადს არ აყოვნებს.
import { resolveGeometries } from '../core/lab';
import { bruggeman, eRev } from '../core/physics';
import { evalScanPoint, primaryCached, rankRows, refineRow, scanPoints, summarizeScan, ScanRow } from '../core/scan';
import { convergenceStudy, discretize, solvePrimary, solveSecondary, Fields } from '../core/solver/solver';
import { geometryChecks, physicsChecks, solverChecks } from '../core/validation';
import { targetValue } from '../core/lab';
import type { Request, Response } from './protocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const cancelled = new Set<number>();

function post(msg: Response, fields?: Fields) {
  if (fields) {
    // ველები გადაეცემა კოპირების გარეშე (type მასივი კოპირდება, რადგან დისკრეტიზაციას ეკუთვნის)
    const copy = { ...fields, type: fields.type.slice() };
    (msg as any).result.fields = copy;
    ctx.postMessage(msg, [copy.phi.buffer, copy.jA.buffer, copy.jC.buffer, copy.type.buffer, copy.trapMask.buffer]);
  } else ctx.postMessage(msg);
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

ctx.onmessage = async (ev: MessageEvent<Request>) => {
  const msg = ev.data;
  if (msg.type === 'cancel') {
    cancelled.add(msg.id);
    return;
  }
  try {
    if (msg.type === 'primary') {
      const built = resolveGeometries(msg.cfg)[msg.kind].built;
      if (!built.cell || built.errors.length) {
        post({ type: 'primary', id: msg.id, kind: msg.kind, key: built.key, N: msg.N, result: null, error: built.errors.join('; ') });
        return;
      }
      const res = solvePrimary(discretize(built.cell, msg.N), msg.fields);
      const fields = res.fields;
      post({ type: 'primary', id: msg.id, kind: msg.kind, key: built.key, N: msg.N, result: res }, fields);
    } else if (msg.type === 'secondary') {
      const cfg = msg.cfg;
      const built = resolveGeometries(cfg)[msg.kind].built;
      if (!built.cell || built.errors.length) {
        post({ type: 'secondary', id: msg.id, kind: msg.kind, key: built.key, N: msg.N, result: null, K: NaN, error: built.errors.join('; ') });
        return;
      }
      const disc = discretize(built.cell, msg.N);
      const prim = primaryCached(built, msg.N)!;
      const res = solveSecondary(
        disc,
        {
          T: cfg.electrolyte.T,
          eRev: eRev(cfg.electrolyte.T, cfg.electrolyte.p),
          kappaEff: bruggeman(cfg.electrolyte.kappa, cfg.electrolyte.voidFraction),
          kinA: cfg.kinetics.anode,
          kinC: cfg.kinetics.cathode,
          mA: cfg.surface.roughness * (1 - cfg.surface.thetaA),
          mC: cfg.surface.roughness * (1 - cfg.surface.thetaC),
          extraR: cfg.electrical.extraR,
          areaA: built.cell.areaA,
          areaC: built.cell.areaC,
        },
        { mode: cfg.electrical.mode, value: targetValue(cfg) },
        prim.K,
        msg.fields,
      );
      post({ type: 'secondary', id: msg.id, kind: msg.kind, key: built.key, N: msg.N, result: res, K: prim.K }, res.fields);
    } else if (msg.type === 'convergence') {
      const built = resolveGeometries(msg.cfg)[msg.kind].built;
      if (!built.cell || built.errors.length) {
        post({ type: 'convergence-done', id: msg.id, error: built.errors.join('; ') });
        return;
      }
      for (const N of msg.Ns) {
        if (cancelled.has(msg.id)) break;
        const rows = convergenceStudy(built.cell, [N]);
        post({ type: 'convergence-row', id: msg.id, row: rows[0] });
        await tick();
      }
      post({ type: 'convergence-done', id: msg.id });
    } else if (msg.type === 'scan') {
      const pts = scanPoints(msg.spec);
      let rows: ScanRow[] = [];
      let wasCancelled = false;
      for (let i = 0; i < pts.length; i++) {
        if (cancelled.has(msg.id)) {
          wasCancelled = true;
          break;
        }
        rows.push(evalScanPoint(msg.cfg, msg.spec, pts[i], msg.spec.resolution));
        post({ type: 'scan-progress', id: msg.id, done: i + 1, total: pts.length });
        await tick();
      }
      let summary = null;
      if (!wasCancelled) {
        const top = rankRows(rows, msg.spec.objective).slice(0, msg.spec.refineTop);
        rows = rows.map((r) => (top.includes(r) ? refineRow(msg.cfg, msg.spec, r) : r));
        summary = summarizeScan(msg.cfg, msg.spec, rows);
      }
      post({ type: 'scan-done', id: msg.id, rows, summary, cancelled: wasCancelled });
    } else if (msg.type === 'validate') {
      const t0 = performance.now();
      const checks = [...physicsChecks(), ...geometryChecks(), ...solverChecks()];
      post({ type: 'validate-done', id: msg.id, checks, ms: performance.now() - t0 });
    }
  } catch (e) {
    const error = (e as Error).message ?? String(e);
    if (msg.type === 'primary') post({ type: 'primary', id: msg.id, kind: msg.kind, key: '', N: msg.N, result: null, error });
    else if (msg.type === 'secondary') post({ type: 'secondary', id: msg.id, kind: msg.kind, key: '', N: msg.N, result: null, K: NaN, error });
    else if (msg.type === 'convergence') post({ type: 'convergence-done', id: msg.id, error });
    else if (msg.type === 'scan') post({ type: 'scan-done', id: msg.id, rows: [], summary: null, cancelled: false, error });
  }
};
