// მთავარ ნაკადსა და გამოთვლით Worker-ს შორის შეტყობინებების ტიპები.
import { Kind } from '../core/geometry/cell';
import { LabConfig } from '../core/lab';
import { ScanRow, ScanSpec, ScanSummary } from '../core/scan';
import { Check } from '../core/validation';
import { ConvergenceRow, PrimaryResult, SecondaryResult } from '../core/solver/solver';

export type Request =
  | { type: 'primary'; id: number; cfg: LabConfig; kind: Kind; N: number; fields: boolean }
  | { type: 'secondary'; id: number; cfg: LabConfig; kind: Kind; N: number; fields: boolean }
  | { type: 'convergence'; id: number; cfg: LabConfig; kind: Kind; Ns: number[] }
  | { type: 'scan'; id: number; cfg: LabConfig; spec: ScanSpec }
  | { type: 'validate'; id: number }
  | { type: 'cancel'; id: number };

export type Response =
  | { type: 'primary'; id: number; kind: Kind; key: string; N: number; result: PrimaryResult | null; error?: string }
  | { type: 'secondary'; id: number; kind: Kind; key: string; N: number; result: SecondaryResult | null; K: number; error?: string }
  | { type: 'convergence-row'; id: number; row: ConvergenceRow }
  | { type: 'convergence-done'; id: number; error?: string }
  | { type: 'scan-progress'; id: number; done: number; total: number }
  | { type: 'scan-done'; id: number; rows: ScanRow[]; summary: ScanSummary | null; cancelled: boolean; error?: string }
  | { type: 'validate-done'; id: number; checks: Check[]; ms: number };
