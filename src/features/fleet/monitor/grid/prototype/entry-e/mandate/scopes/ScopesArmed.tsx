// The armed widen: what it grants, and exactly which items waiting on the
// operator now will stop reaching them, before the second press.

import { Lock } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Kbd } from '../../parts';
import { namedItems, type ScopeLine } from './scopesModel';

export function ScopesArmed({ line }: { line: ScopeLine }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const { named, more } = namedItems(line.absorbed, m, tx);
  return (
    <div className="au-armed au-l-danger flex flex-col gap-1.5 rounded-input px-3 py-2.5" role="alert" data-testid="scopes-armed">
      <span className="au-ink-lamp flex items-center gap-1.5 typo-eyebrow">
        <Lock className="h-3.5 w-3.5" aria-hidden />
        {m.ml_scopes_armed}
      </span>
      {line.widenWhat && <span className="typo-body text-foreground">{line.widenWhat}</span>}
      <span className="typo-body text-foreground">
        {line.absorbed.length === 0 ? m.ml_scopes_armed_nothing_now : tx(m.ml_scopes_armed_leaves, { count: line.absorbed.length })}
      </span>
      {named.length > 0 && (
        <ul className="flex flex-col gap-0.5 pl-4" data-testid="scopes-armed-items">
          {named.map((n, i) => <li key={i} className="list-disc typo-body text-foreground [overflow-wrap:anywhere]">{n}</li>)}
          {more && <li className="list-none typo-caption">{more}</li>}
        </ul>
      )}
      <span className="typo-caption">{m.ml_scopes_armed_from_now}</span>
      <span className="flex flex-wrap items-center gap-1.5 typo-caption">
        <Kbd>W</Kbd> <Kbd>↵</Kbd> {m.ml_scopes_armed_confirm}
        <Kbd>Esc</Kbd> {m.dc_deck_armed_disarm}
      </span>
    </div>
  );
}
