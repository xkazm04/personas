import { memo } from 'react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { AwayRules } from '@/lib/bindings/AwayRules';
import type { BusyAction } from '../../data/types';
import type { RowState, StandupView } from '../../model/types';
import { CONSOLE_COPY, fill } from './copy';
import { Press } from './prims';
import { StateGlyph } from './StateMark';

const LEGEND: RowState[] = ['proposed', 'decided', 'running', 'done', 'waits', 'refused'];

/** The state legend behind the help press: glyph + word, the same marks the rows use. */
function Legend() {
  const { t } = useTranslation();
  return (
    <span className="sc-legend">
      {LEGEND.map((k) => (
        <span key={k} className="sc-state"><StateGlyph state={k} /><span className="sc-state__word">{t.athena.standup.state[k]}</span></span>
      ))}
      <span className="sc-legend__keys">{CONSOLE_COPY.footer.help_keys}</span>
    </span>
  );
}

/** One status segment: a state glyph, a mono figure, the words after it. */
function Seg({ state, n, words, wide = false }: { state: RowState; n: number; words: string; wide?: boolean }) {
  return (
    <span className={`sc-seg ${wide ? 'sc-wide' : ''}`}>
      <StateGlyph state={state} />
      <span className="sc-num sc-num--strong">{n}</span>
      <span className="sc-seg__words">{words}</span>
    </span>
  );
}

interface Props {
  view: StandupView;
  rules: AwayRules | null;
  busy: Partial<Record<BusyAction, boolean>>;
  onRules: () => void;
  onKeys: () => void;
  onArm: () => void;
  onAmend: () => void;
  onEnd: () => void;
}

/** The status bar and its gate: away rules and help on the left, the plan in figures, the one accent press. */
export const ConsoleFooter = memo(function ConsoleFooter({ view, rules, busy, onRules, onKeys, onArm, onAmend, onEnd }: Props) {
  const { t, tx } = useTranslation();
  const s = t.athena.standup.footer;
  const f = CONSOLE_COPY.footer;
  const c = view.counts;
  return (
    <footer className="sc-foot">
      {rules && (
        <Press tone="ghost" k="R" onClick={onRules}>
          {f.rules}<span className="sc-press__meta">{fill(f.locked, { n: rules.park.length })}</span>
        </Press>
      )}
      <Tooltip content={<Legend />} placement="top">
        <Press tone="ghost" k="?" onClick={onKeys} aria-label={f.help} />
      </Tooltip>
      {view.life !== 'none' && (
        <p className="sc-foot__plan">
          {view.plannedDirections > 0 ? (
            <>
              <Seg state="decided" n={view.plannedDirections} words={f.directions} />
              <Seg state="running" n={view.plannedRuns} words={f.runs} />
            </>
          ) : <span className="sc-seg__words">{f.plan_none}</span>}
          {c.proposed > 0
            ? <Seg state="proposed" n={c.proposed} words={f.off} wide />
            : <span className="sc-seg sc-wide"><StateGlyph state="done" /><span className="sc-seg__words">{f.resolved}</span></span>}
        </p>
      )}
      <span className="sc-foot__go">
        {view.life === 'decide' && (
          <Press tone="solid" k="G" busy={busy.arm} onClick={onArm} data-testid="standup-arm" className="sc-arm">
            {tx(s.arm, { n: view.revision })}
          </Press>
        )}
        {(view.life === 'armed' || view.life === 'return') && (
          <>
            <Press tone="ghost" busy={busy.end} onClick={onEnd}>{s.end}</Press>
            <Press tone="line" k="N" busy={busy.open} onClick={onAmend}>{tx(s.amend, { n: view.revision + 1 })}</Press>
          </>
        )}
      </span>
    </footer>
  );
});
