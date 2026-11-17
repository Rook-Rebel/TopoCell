// აპლიკაციის მდგომარეობა და გამოთვლითი Worker-ების მართვა. გეომეტრია და ერთიანი მოდელი მთავარ ნაკადში ითვლება
// (მილიწამები), 3D ამოხსნები — Worker-ებში, „ბოლო მოთხოვნა იმარჯვებს“ რიგით.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KINDS, Kind } from '../core/geometry/cell';
import { Evaluation, LabConfig, Resolved, defaultConfig, evaluate, resolveGeometries, validateConfig } from '../core/lab';
import { ScanRow, ScanSpec, ScanSummary } from '../core/scan';
import { ConvergenceRow, Fields, PrimaryResult, SecondaryResult } from '../core/solver/solver';
import { Check } from '../core/validation';
import type { Request, Response } from '../worker/protocol';

const STORE_KEY = 'topocell.config.v1';

function loadConfig(): LabConfig {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const c = JSON.parse(raw) as LabConfig;
      const d = defaultConfig();
      if (c && c.geometries && c.electrical && c.version === d.version) return c;
    }
  } catch {
    /* ignore */
  }
  return defaultConfig();
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const TERMINAL = new Set(['primary', 'secondary', 'convergence-done', 'scan-done', 'validate-done']);

class JobQueue {
  private worker: Worker;
  private busy = false;
  private q = new Map<string, Request>();
  constructor(
    private onMsg: (m: Response) => void,
    private onBusy: (b: boolean) => void,
  ) {
    this.worker = new Worker(new URL('../worker/solver.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<Response>) => {
      if (TERMINAL.has(e.data.type)) this.busy = false;
      this.onMsg(e.data);
      this.pump();
    };
    this.worker.onerror = () => {
      this.busy = false;
      this.pump();
    };
  }
  push(slot: string, req: Request) {
    this.q.delete(slot);
    this.q.set(slot, req);
    this.pump();
  }
  drop(prefix: string) {
    for (const k of [...this.q.keys()]) if (k.startsWith(prefix)) this.q.delete(k);
  }
  cancel(id: number) {
    this.worker.postMessage({ type: 'cancel', id } satisfies Request);
  }
  private pump() {
    if (this.busy) return;
    const first = this.q.entries().next();
    if (first.done) {
      this.onBusy(false);
      return;
    }
    const [slot, req] = first.value;
    this.q.delete(slot);
    this.busy = true;
    this.onBusy(true);
    this.worker.postMessage(req);
  }
  dispose() {
    this.worker.terminate();
  }
}

export interface SecEntry {
  sig: string;
  result: SecondaryResult;
  K: number;
}
export interface FieldEntry {
  sig: string;
  fields: Fields;
}

export function physSig(cfg: LabConfig): string {
  const e = cfg.electrical;
  return JSON.stringify([cfg.electrolyte, e.mode, e.mode === 'I' ? e.I : e.mode === 'U' ? e.U : e.P, e.extraR, cfg.kinetics, cfg.surface]);
}

let nextId = 1;

export function useLab() {
  const [cfg, setCfgRaw] = useState<LabConfig>(loadConfig);
  const [compareKind, setCompareKind] = useState<Kind | null>(null);
  const [autoSecondary, setAutoSecondary] = useState(true);
  const setCfg = useCallback((fn: (c: LabConfig) => LabConfig) => setCfgRaw((c) => fn(c)), []);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(cfg));
      } catch {
        /* ignore */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [cfg]);

  // --- გეომეტრია (დაყოვნებით) ---
  const geomKey = JSON.stringify([cfg.geometries, cfg.env, cfg.fairness]);
  const debGeomKey = useDebounced(geomKey, 160);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const resolved = useMemo<Record<Kind, Resolved>>(
    () => resolveGeometries(cfgRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [debGeomKey],
  );
  const configErrors = useMemo(() => validateConfig(cfg), [cfg]);

  // --- Worker-ები ---
  const [, bump] = useState(0);
  const primaryMap = useRef(new Map<string, PrimaryResult>());
  const primFields = useRef<Partial<Record<Kind, FieldEntry>>>({});
  const secMap = useRef<Partial<Record<Kind, SecEntry>>>({});
  const secFields = useRef<Partial<Record<Kind, FieldEntry>>>({});
  const solverErrors = useRef<Partial<Record<Kind, string>>>({});
  const [busyInteractive, setBusyInteractive] = useState(false);
  const [busyBatch, setBusyBatch] = useState(false);
  const [convergence, setConvergence] = useState<{ kind: Kind; rows: ConvergenceRow[]; running: boolean; error?: string } | null>(null);
  const [scan, setScan] = useState<{
    spec: ScanSpec;
    cfg: LabConfig;
    rows: ScanRow[];
    summary: ScanSummary | null;
    running: boolean;
    done: number;
    total: number;
    id: number;
    error?: string;
    cancelled?: boolean;
  } | null>(null);
  const [validation, setValidation] = useState<{ checks: Check[]; running: boolean; ms: number } | null>(null);
  const pendingSig = useRef(new Map<number, string>());
  const interactive = useRef<JobQueue | null>(null);
  const batch = useRef<JobQueue | null>(null);

  useEffect(() => {
    const onMsg = (m: Response) => {
      if (m.type === 'primary') {
        if (m.result) {
          const { fields, ...rest } = m.result;
          primaryMap.current.set(m.key + '|' + m.N, rest);
          if (primaryMap.current.size > 300) primaryMap.current.delete(primaryMap.current.keys().next().value as string);
          if (fields) primFields.current[m.kind] = { sig: m.key + '|' + m.N, fields };
          delete solverErrors.current[m.kind];
        } else if (m.error) solverErrors.current[m.kind] = m.error;
        bump((x) => x + 1);
      } else if (m.type === 'secondary') {
        const sig = pendingSig.current.get(m.id);
        pendingSig.current.delete(m.id);
        if (m.result && sig) {
          const { fields, ...rest } = m.result;
          secMap.current[m.kind] = { sig, result: rest, K: m.K };
          if (fields) secFields.current[m.kind] = { sig, fields };
        }
        bump((x) => x + 1);
      } else if (m.type === 'convergence-row') {
        setConvergence((c) => (c ? { ...c, rows: [...c.rows, m.row] } : c));
      } else if (m.type === 'convergence-done') {
        setConvergence((c) => (c ? { ...c, running: false, error: m.error } : c));
      } else if (m.type === 'scan-progress') {
        setScan((s) => (s && s.id === m.id ? { ...s, done: m.done, total: m.total } : s));
      } else if (m.type === 'scan-done') {
        setScan((s) => (s && s.id === m.id ? { ...s, rows: m.rows, summary: m.summary, running: false, error: m.error, cancelled: m.cancelled } : s));
      } else if (m.type === 'validate-done') {
        setValidation({ checks: m.checks, running: false, ms: m.ms });
      }
    };
    interactive.current = new JobQueue(onMsg, setBusyInteractive);
    batch.current = new JobQueue(onMsg, setBusyBatch);
    return () => {
      interactive.current?.dispose();
      batch.current?.dispose();
    };
  }, []);

  const N = cfg.solver.resolution;
  const solverOn = cfg.solver.enabled;
  const order = useMemo(() => {
    const first: Kind[] = [cfg.active];
    if (compareKind && compareKind !== cfg.active) first.push(compareKind);
    return [...first, ...KINDS.filter((k) => !first.includes(k))];
  }, [cfg.active, compareKind]);

  // პირველადი ამოხსნა: თითო გეომეტრიაზე ერთხელ (K მხოლოდ გეომეტრიაზეა დამოკიდებული)
  useEffect(() => {
    const q = interactive.current;
    if (!q || !solverOn) return;
    const t = setTimeout(() => {
      for (const kind of order) {
        const b = resolved[kind].built;
        if (!b.cell || b.errors.length) continue;
        const sig = b.key + '|' + N;
        const wantFields = kind === cfg.active || kind === compareKind;
        const have = primaryMap.current.has(sig);
        const haveFields = primFields.current[kind]?.sig === sig;
        if (!have || (wantFields && !haveFields)) {
          q.push('p:' + kind, { type: 'primary', id: nextId++, cfg: cfgRef.current, kind, N, fields: wantFields });
        }
      }
    }, 250);
    return () => clearTimeout(t);
  }, [resolved, N, solverOn, order, cfg.active, compareKind]);

  // მეორადი ამოხსნა სამუშაო წერტილზე
  const pSig = physSig(cfg);
  const debPSig = useDebounced(pSig, 700);
  const requestSecondary = useCallback(
    (kinds: Kind[]) => {
      const q = interactive.current;
      if (!q) return;
      const c = cfgRef.current;
      const ps = physSig(c);
      for (const kind of kinds) {
        const b = resolved[kind].built;
        if (!b.cell || b.errors.length) continue;
        const sig = b.key + '|' + c.solver.resolution + '|' + ps;
        const wantFields = kind === c.active || kind === compareKind;
        if (secMap.current[kind]?.sig === sig && (!wantFields || secFields.current[kind]?.sig === sig)) continue;
        const id = nextId++;
        pendingSig.current.set(id, sig);
        q.push('s:' + kind, { type: 'secondary', id, cfg: c, kind, N: c.solver.resolution, fields: wantFields });
      }
    },
    [resolved, compareKind],
  );
  useEffect(() => {
    if (!solverOn || !autoSecondary || configErrors.length) return;
    const t = setTimeout(() => requestSecondary(order), 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved, debPSig, N, solverOn, autoSecondary, order, requestSecondary]);

  // --- შეფასება ერთიანი მოდელით ---
  const primary = {} as Record<Kind, PrimaryResult | null>;
  const evals = {} as Record<Kind, Evaluation>;
  const secondary = {} as Record<Kind, (SecEntry & { stale: boolean }) | null>;
  const fieldsPrimary = {} as Record<Kind, Fields | null>;
  const fieldsSecondary = {} as Record<Kind, Fields | null>;
  for (const kind of KINDS) {
    const b = resolved[kind].built;
    const sig = b.key + '|' + N;
    const p = solverOn ? (primaryMap.current.get(sig) ?? null) : null;
    primary[kind] = p;
    evals[kind] = evaluate(resolved[kind], cfg, p ? p.K : null);
    const s = secMap.current[kind];
    const curSig = sig + '|' + pSig;
    secondary[kind] = s && solverOn ? { ...s, stale: s.sig !== curSig } : null;
    const pf = primFields.current[kind];
    fieldsPrimary[kind] = solverOn && pf && pf.sig === sig ? pf.fields : null;
    const sf = secFields.current[kind];
    fieldsSecondary[kind] = solverOn && sf && sf.sig === curSig ? sf.fields : null;
  }

  const runConvergence = useCallback((kind: Kind, Ns: number[]) => {
    setConvergence({ kind, rows: [], running: true });
    batch.current?.push('conv', { type: 'convergence', id: nextId++, cfg: cfgRef.current, kind, Ns });
  }, []);
  const runScan = useCallback((spec: ScanSpec, cfgOverride?: LabConfig) => {
    const id = nextId++;
    const c = cfgOverride ?? cfgRef.current;
    setScan({ spec, cfg: c, rows: [], summary: null, running: true, done: 0, total: 0, id });
    batch.current?.push('scan', { type: 'scan', id, cfg: c, spec });
  }, []);
  const cancelScan = useCallback(() => {
    setScan((s) => {
      if (s?.running) batch.current?.cancel(s.id);
      return s;
    });
  }, []);
  const runValidation = useCallback(() => {
    setValidation((v) => ({ checks: v?.checks ?? [], running: true, ms: 0 }));
    batch.current?.push('validate', { type: 'validate', id: nextId++ });
  }, []);

  return {
    cfg,
    setCfg,
    resolved,
    configErrors,
    evals,
    primary,
    secondary,
    fieldsPrimary,
    fieldsSecondary,
    solverErrors: solverErrors.current,
    busyInteractive,
    busyBatch,
    compareKind,
    setCompareKind,
    autoSecondary,
    setAutoSecondary,
    requestSecondary,
    convergence,
    runConvergence,
    scan,
    runScan,
    cancelScan,
    validation,
    runValidation,
  };
}

export type Lab = ReturnType<typeof useLab>;
