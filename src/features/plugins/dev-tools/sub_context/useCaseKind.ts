// The per-kind visual language for a use case, in its own module so that both
// the ledger's shared pieces and the detail modal can read it without importing
// each other (contextLedgerShared renders the modal; the modal needs the kind
// meta — going through this file keeps that from being a cycle).
import { Route, Boxes, Plug, Wrench } from 'lucide-react';

export interface KindMeta {
  icon: typeof Route;
  /** Tailwind colour stem, used for the dot / text / chip tints below. */
  stem: string;
  labelKey: 'uc_kind_user_flow' | 'uc_kind_capability' | 'uc_kind_integration' | 'uc_kind_ops';
}

export const KIND_META: Record<string, KindMeta> = {
  user_flow: { icon: Route, stem: 'violet', labelKey: 'uc_kind_user_flow' },
  capability: { icon: Boxes, stem: 'sky', labelKey: 'uc_kind_capability' },
  integration: { icon: Plug, stem: 'emerald', labelKey: 'uc_kind_integration' },
  ops: { icon: Wrench, stem: 'amber', labelKey: 'uc_kind_ops' },
};

export function kindMeta(kind: string): KindMeta {
  return KIND_META[kind] ?? KIND_META.capability!;
}

/** Static class maps — Tailwind's JIT can't see an interpolated stem, so these
 *  are looked up rather than built as `text-${stem}-300` at runtime. */
export const KIND_TEXT: Record<string, string> = {
  violet: 'text-violet-300',
  sky: 'text-sky-300',
  emerald: 'text-emerald-300',
  amber: 'text-amber-300',
};

export const KIND_DOT: Record<string, string> = {
  violet: 'bg-violet-400',
  sky: 'bg-sky-400',
  emerald: 'bg-emerald-400',
  amber: 'bg-amber-400',
};
