import { ReactNode, useEffect, useRef, useState } from 'react';

interface NumProps {
  label: ReactNode;
  hint?: ReactNode;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  /** ეკრანზე ნაჩვენები = მნიშვნელობა·scale + offset */
  scale?: number;
  offset?: number;
  min: number; // ეკრანის ერთეულებში
  max: number;
  digits?: number;
  step?: number;
  integer?: boolean;
}

function show(v: number, digits: number): string {
  if (!Number.isFinite(v)) return '';
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e6)) return v.toExponential(2);
  return String(+v.toFixed(digits));
}

/** რიცხვითი ველი. დაუშვებელი მნიშვნელობა არ გადაეცემა მოდელს და არ იცვლება ფარულად — ველი წითლდება და ჩანს მიზეზი. */
export function NumField(p: NumProps) {
  const scale = p.scale ?? 1;
  const offset = p.offset ?? 0;
  const digits = p.digits ?? 3;
  const disp = p.value * scale + offset;
  const [text, setText] = useState(() => show(disp, digits));
  const [err, setErr] = useState<string | null>(null);
  const focused = useRef(false);
  useEffect(() => {
    const parsed = Number(text.replace(',', '.'));
    const tol = Math.max(1e-9, Math.abs(disp) * 1e-9) + 0.5 * 10 ** -digits;
    if (!focused.current || !Number.isFinite(parsed) || Math.abs(parsed - disp) > tol) {
      if (!focused.current || (Number.isFinite(parsed) && parsed >= p.min && parsed <= p.max)) {
        setText(show(disp, digits));
        setErr(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disp]);
  const commit = (s: string) => {
    setText(s);
    const v = Number(s.replace(',', '.'));
    if (s.trim() === '' || !Number.isFinite(v)) {
      setErr('შეიყვანეთ რიცხვი');
      return;
    }
    if (p.integer && !Number.isInteger(v)) {
      setErr('საჭიროა მთელი რიცხვი');
      return;
    }
    if (v < p.min || v > p.max) {
      setErr(`დასაშვებია ${show(p.min, digits)} – ${show(p.max, digits)}${p.unit ? ' ' + p.unit : ''}`);
      return;
    }
    setErr(null);
    p.onChange((v - offset) / scale);
  };
  return (
    <div className="field">
      <label>
        {p.label}
        {p.hint && <small>{p.hint}</small>}
      </label>
      <div className={'input' + (err ? ' invalid' : '')}>
        <input
          inputMode="decimal"
          value={text}
          aria-invalid={!!err}
          onFocus={() => (focused.current = true)}
          onBlur={() => {
            focused.current = false;
            if (!err) setText(show(disp, digits));
          }}
          onChange={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const st = p.step ?? 10 ** -Math.min(digits, 2);
              const cur = Number(text.replace(',', '.'));
              const base = Number.isFinite(cur) ? cur : disp;
              const nv = Math.min(p.max, Math.max(p.min, base + (e.key === 'ArrowUp' ? st : -st)));
              commit(show(nv, digits));
            }
          }}
        />
        {p.unit && <span className="unit">{p.unit}</span>}
      </div>
      {err && <div className="err">{err}</div>}
    </div>
  );
}

export function SelectField<T extends string>(p: {
  label: ReactNode;
  hint?: ReactNode;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  wide?: boolean;
}) {
  return (
    <div className={'field' + (p.wide ? ' wide' : '')}>
      <label>
        {p.label}
        {p.hint && <small>{p.hint}</small>}
      </label>
      <select className="sel" value={p.value} onChange={(e) => p.onChange(e.target.value as T)}>
        {p.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Seg<T extends string>(p: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label?: string }) {
  return (
    <div className="seg" role="group" aria-label={p.label}>
      {p.options.map((o) => (
        <button key={o.value} aria-pressed={p.value === o.value} onClick={() => p.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Section(p: { title: ReactNode; tag?: ReactNode; open?: boolean; children: ReactNode }) {
  return (
    <details className="section" open={p.open ?? false}>
      <summary>
        <span className="grow">{p.title}</span>
        {p.tag}
      </summary>
      <div className="body">{p.children}</div>
    </details>
  );
}

export function Check(p: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" checked={p.checked} onChange={(e) => p.onChange(e.target.checked)} />
      <span>{p.children}</span>
    </label>
  );
}

export type TagKind = 'law' | 'model' | 'assume' | 'illus' | 'solver' | 'rough';
const TAG_TEXT: Record<TagKind, string> = {
  law: 'ფიზიკური კანონი',
  model: 'საინჟინრო მოდელი',
  assume: 'მომხმარებლის დაშვება',
  illus: 'საილუსტრაციო',
  solver: '3D ამომხსნელი',
  rough: 'უხეში შეფასება',
};
export function Tag(p: { kind: TagKind; children?: ReactNode }) {
  return <span className={'tag ' + p.kind}>{p.children ?? TAG_TEXT[p.kind]}</span>;
}

export function Notice(p: { kind: 'err' | 'warn' | 'info'; children: ReactNode }) {
  const ico = p.kind === 'err' ? '✕' : p.kind === 'warn' ? '!' : 'i';
  return (
    <div className={'notice ' + p.kind} role={p.kind === 'err' ? 'alert' : undefined}>
      <span className="ico" aria-hidden>
        {ico}
      </span>
      <div>{p.children}</div>
    </div>
  );
}
