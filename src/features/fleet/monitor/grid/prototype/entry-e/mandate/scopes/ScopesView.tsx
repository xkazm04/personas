// The Scopes section of a mandate page (mandate-lanes WP6): one line per
// decide scope, then the merge policy and the spend cap. A held line says
// what the steward did under it and its agreement (a design figure: nothing
// records yet whether the steward would have decided as the operator did);
// a line not held says how many of the asks waiting now it would absorb,
// counted by the router. ↑/↓ pick a line, W widens it, N narrows it; a widen
// touching merge or spend arms first and lists what will stop reaching you.

import { Expand, Shrink } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { AsyncButton } from '@/features/shared/components/buttons';
import { ListRow, Rows, type RowColumn } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { OVERLAY_DISMISS_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { Kbd } from '../../parts';
import { LampWord } from '../rowParts';
import { useDrawerListKeys } from '../useDrawerKeys';
import { ScopesArmed } from './ScopesArmed';
import { scopeLines, scrollTopToShow } from './scopesModel';
import type { ScopesState } from './useScopes';

export function ScopesView({ state, selected, onSelect, extraLetters }: {
  state: ScopesState;
  selected: number;
  onSelect: (i: number) => void;
  /** The page's own letters that stay live in this view (suspend, back to the log). */
  extraLetters?: Record<string, () => void>;
}) {
  const { t, tx, language } = useTranslation();
  const m = t.monitor;
  const lines = useMemo(() => (state.scopes ? scopeLines(state.scopes, m, tx, language) : []), [state.scopes, m, tx, language]);
  const line = lines[Math.min(selected, lines.length - 1)] ?? null;
  const armed = line && state.armed === line.id ? line : null;
  const listRef = useRef<HTMLDivElement>(null);
  const columns: RowColumn[] = useMemo(() => [
    { width: 'minmax(0, 1fr)' },
    { head: m.ml_fact_status, width: '6.5rem' },
  ], [m]);
  // Keep the picked line in sight as the keys walk the list, and again when
  // the armed box opens above the list and shrinks it. Only the list scrolls:
  // `scrollIntoView` would also move the drawer around it.
  useLayoutEffect(() => {
    const list = listRef.current;
    const row = line ? list?.querySelector(`[data-scope="${line.id}"]`)?.closest('[data-testid="mandate-scope-row"]') : null;
    if (!list || !row) return;
    const to = scrollTopToShow(list.getBoundingClientRect(), list.scrollTop, row.getBoundingClientRect());
    if (to !== null) list.scrollTop = to;
  }, [line, armed]);

  useDrawerListKeys({
    count: lines.length,
    selected,
    onSelect: (i) => { state.disarm(); onSelect(i); },
    onEnter: armed ? () => { void state.widen(armed); } : undefined,
    letters: {
      ...extraLetters,
      w: () => { if (line) void state.widen(line); },
      n: () => { if (line) void state.narrow(line); },
    },
  });
  // Escape disarms before it can step the drawer back.
  useAppKeyboard((e) => {
    if (e.key !== 'Escape' || !state.armed) return false;
    e.preventDefault();
    e.stopImmediatePropagation();
    state.disarm();
    return true;
  }, { priority: OVERLAY_DISMISS_PRIORITY + 2, enabled: !!state.armed });

  const doors = line && (
    <div className="flex flex-wrap items-center gap-2" data-testid="mandate-scope-doors">
      <span className="typo-body text-foreground">{line.label}</span>
      <AsyncButton variant="secondary" size="sm" onClick={() => state.widen(line)} disabled={!line.widen} icon={<Expand className="h-4 w-4" aria-hidden />} iconRight={<span className="ml-1.5 inline-flex"><Kbd>W</Kbd></span>} aria-keyshortcuts="W" data-testid="mandate-scope-widen">
        {armed ? m.ml_scopes_widen_confirm : m.ml_scopes_widen}
      </AsyncButton>
      <AsyncButton variant="secondary" size="sm" onClick={() => state.narrow(line)} disabled={!line.narrow} icon={<Shrink className="h-4 w-4" aria-hidden />} iconRight={<span className="ml-1.5 inline-flex"><Kbd>N</Kbd></span>} aria-keyshortcuts="N" data-testid="mandate-scope-narrow">
        {m.ml_scopes_narrow}
      </AsyncButton>
      <span className="typo-caption text-status-warning" role="status" data-testid="mandate-scopes-notice">{state.notice}</span>
    </div>
  );

  // The picked line, its doors and (armed) what leaves sit above the list, so
  // a widen is never confirmed with its list scrolled out of sight.
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="mandate-scopes">
      {!armed && <p className="typo-caption">{state.scopes && !state.scopes.signed ? m.ml_scopes_unsigned_note : m.ml_scopes_agreement_note}</p>}
      <p className="typo-caption text-status-error" role="status">{state.failed ? m.ml_scopes_failed : null}</p>
      {doors}
      {armed && <ScopesArmed line={armed} />}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        <Rows
          loading={state.scopes === null && !state.failed}
          count={lines.length}
          label={m.ml_scopes}
          columns={columns}
          nameHead={m.ml_col_scope}
          nameWidth="12rem"
          empty={{ title: m.ml_scopes_failed }}
        >
          {lines.map((l, i) => (
            <ListRow
              key={l.id}
              testId="mandate-scope-row"
              size="line"
              nameClass="typo-body text-foreground"
              name={<span data-scope={l.id}>{l.label}</span>}
              cells={[
                <span key="d" className="typo-caption">{l.held && l.id !== 'merge' && l.id !== 'spend' ? `${l.detail} · ${m.ml_scopes_agreement_design}` : l.detail}</span>,
                <LampWord key="h" lamp={{ tone: 'run', lit: l.held }} word={l.held ? m.ml_scopes_held : m.ml_scopes_not_held} />,
              ]}
              state={i === selected ? 'selected' : undefined}
              onPress={() => { state.disarm(); onSelect(i); }}
            />
          ))}
        </Rows>
      </div>
    </div>
  );
}
