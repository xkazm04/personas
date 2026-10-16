// The ledger's controls and callouts (PORTED from bp src/components/ledger/train/ui/Controls.tsx): its one action
// button, a segmented control and a boxed message. Every press is the sheet's one press target (ui/Press.tsx) wearing
// bp's `.tr-btn` look (styles/ledger-train.css); a hover hint is the shared Tooltip, never `title=`.
import type { ReactNode } from 'react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Press } from '../ui/Press';

/** `go` the filled primary, `acc` / `rw` / `ds` the decisions (accept, rework, descope), `warn` a failing act. */
export type BtnTone = 'go' | 'acc' | 'rw' | 'ds' | 'warn';

export interface BtnProps {
  children: ReactNode;
  onClick?(): void;
  tone?: BtnTone;
  /** The key that presses it, shown after the label. */
  kbd?: string;
  /** `nav`: the compare header's 30 px form; `row`: a list row's quiet 28 px action. */
  size?: 'nav' | 'row';
  disabled?: boolean;
  /** The hover hint (the shared Tooltip). */
  tip?: string;
  /** The accessible name when the label is a glyph. */
  label?: string;
  /** A toggle's state. */
  pressed?: boolean;
  testId?: string;
}

export function Btn({ children, onClick, tone, kbd, size, disabled = false, tip, label, pressed, testId }: BtnProps) {
  const b = (
    <Press tone={'tr-btn' + (tone ? ' ' + tone : '') + (size ? ' ' + size : '')} onClick={onClick} disabled={disabled} on={pressed} aria-label={label} data-testid={testId}>
      {children}{kbd ? <kbd>{kbd}</kbd> : null}
    </Press>
  );
  return tip ? <Tooltip content={tip} placement="top">{b}</Tooltip> : b;
}

export interface SegOption<T extends string> { value: T; label: string }

/** A row of mutually exclusive presses (`aria-pressed`). */
export function Seg<T extends string>({ options, value, onChange, label }: { options: readonly SegOption<T>[]; value: T; onChange(v: T): void; label: string }) {
  return (
    <span className="tr-seg" role="group" aria-label={label}>
      {options.map((o) => <Press key={o.value} tone="tr-seg-b" on={o.value === value} onClick={() => onChange(o.value)}>{o.label}</Press>)}
    </span>
  );
}

/** `note` amber bar, `diff` accent bar (about the screens), `flag` a failed build, `error` a refusal, `empty` dashed. */
export type CalloutTone = 'note' | 'diff' | 'flag' | 'error' | 'empty';
export function Callout({ tone, children, testId }: { tone: CalloutTone; children: ReactNode; testId?: string }) {
  return <div className={'tr-call ' + tone} role={tone === 'error' ? 'alert' : undefined} data-testid={testId}>{children}</div>;
}

/** A link-styled press inside running text (bp's `.tr-lnk`). */
export function Lnk({ children, onClick }: { children: ReactNode; onClick(): void }) {
  return <Press tone="tr-lnk" onClick={onClick}>{children}</Press>;
}
