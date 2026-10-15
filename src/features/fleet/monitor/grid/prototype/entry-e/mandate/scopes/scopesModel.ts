// The Scopes section as lines (mandate-lanes WP6): every decide scope, then
// the merge policy and the spend cap, each with what it did (acts, when the
// envelope holds it) or what widening it would take off the operator's desk
// (the asks the router would no longer send, counted on the backend), and the
// two amendments it offers. React-free.
//
// Arming comes from the payload (`arms` on a scope row; merge and spend always
// arm a widen): the rule lives in Rust, not here.

import type { DecideScope } from '@/lib/bindings/DecideScope';
import type { MandateChange } from '@/lib/bindings/MandateChange';
import type { MandateScopes } from '@/lib/bindings/MandateScopes';
import type { ScopeItem } from '@/lib/bindings/ScopeItem';
import type { Translations } from '@/i18n/generated/types';
import { mergeLabel, scopeLabel } from '../mandateCopy';

type M = Translations['monitor'];
type Tx = (tpl: string, vars: Record<string, string | number>) => string;

export type ScopeLineId = DecideScope | 'merge' | 'spend';

export interface ScopeLine {
  id: ScopeLineId;
  label: string;
  held: boolean;
  /** The quiet line: acts and agreement, or what a widen would absorb. */
  detail: string;
  absorbed: readonly ScopeItem[];
  /** A widen arms twice and lists what will no longer reach the operator. */
  arms: boolean;
  widen: MandateChange | null;
  narrow: MandateChange | null;
  /** What the widen grants, in words (the armed box's first line). */
  widenWhat: string | null;
}

export function usd(language: string, n: number): string {
  return new Intl.NumberFormat(language, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function absorbLine(m: M, tx: Tx, n: number, signed: boolean): string {
  if (n === 0) return signed ? m.ml_scopes_absorbs_none : m.ml_scopes_absorbs_none_unsigned;
  const tpl = signed
    ? (n === 1 ? m.ml_scopes_absorbs_one : m.ml_scopes_absorbs_other)
    : (n === 1 ? m.ml_scopes_absorbs_one_unsigned : m.ml_scopes_absorbs_other_unsigned);
  return tx(tpl, { count: n });
}

export function scopeLines(s: MandateScopes, m: M, tx: Tx, language: string): ScopeLine[] {
  const lines: ScopeLine[] = s.rows.map((r) => ({
    id: r.scope,
    label: scopeLabel(m, r.scope),
    held: r.held,
    detail: r.held
      ? tx(r.acts === 1 ? m.ml_scopes_acts_one : m.ml_scopes_acts_other, { count: r.acts })
      : absorbLine(m, tx, r.absorbs, s.signed),
    absorbed: r.absorbed,
    arms: r.arms,
    widen: r.held ? null : { kind: 'widenScope', scopes: [r.scope] },
    narrow: r.held ? { kind: 'narrowScope', scopes: [r.scope] } : null,
    widenWhat: r.held ? null : tx(m.ml_scopes_widen_scope, { scope: scopeLabel(m, r.scope) }),
  }));
  const mg = s.merge;
  lines.push({
    id: 'merge',
    label: tx(m.ml_scopes_merge, { policy: mergeLabel(m, mg.policy) }),
    held: mg.policy !== 'never',
    detail: mg.widenTo ? absorbLine(m, tx, mg.absorbs, s.signed) : m.ml_scopes_merge_widest,
    absorbed: mg.absorbed,
    arms: true,
    widen: mg.widenTo ? { kind: 'setMergePolicy', policy: mg.widenTo } : null,
    narrow: mg.narrowTo ? { kind: 'setMergePolicy', policy: mg.narrowTo } : null,
    widenWhat: mg.widenTo ? tx(m.ml_scopes_widen_merge, { policy: mergeLabel(m, mg.widenTo) }) : null,
  });
  const sp = s.spend;
  const cap = sp.capUsd === null ? m.ml_scopes_spend_none : usd(language, sp.capUsd);
  lines.push({
    id: 'spend',
    label: tx(m.ml_scopes_spend, { cap }),
    held: sp.capUsd !== null,
    detail: sp.usedUsd === null
      ? m.ml_steward_spend_unknown
      : tx(m.ml_scopes_spend_used, { used: usd(language, sp.usedUsd) }),
    absorbed: sp.absorbed,
    arms: true,
    widen: { kind: 'setBudget', usd: sp.widenToUsd },
    narrow: sp.narrowToUsd === null ? null : { kind: 'setBudget', usd: sp.narrowToUsd },
    widenWhat: tx(m.ml_scopes_widen_spend, { from: cap, to: usd(language, sp.widenToUsd) }),
  });
  return lines;
}

/** At most this many absorbed items are named in the armed box; the rest are counted. */
export const NAMED_ITEMS = 6;

/** The armed box's item lines: named titles, then "and N more". */
export function namedItems(items: readonly ScopeItem[], m: M, tx: Tx): { named: string[]; more: string | null } {
  const named = items.slice(0, NAMED_ITEMS).map((i) => i.title ?? tx(m.ml_scopes_item_untitled, { kind: i.itemKind }));
  const rest = items.length - named.length;
  return { named, more: rest > 0 ? tx(m.ml_scopes_item_more, { count: rest }) : null };
}
