/**
 * Athena > Standup: every project is one line through today (the away log),
 * the decision and tonight (the forecast). V1 Ledger's layout (one column grid,
 * one header bar, a pinned machine row, the selected row opened in place, a
 * gate-only footer) in the Console component language: Inter for names and
 * prose, JetBrains Mono for every figure, hairline rules, glyph + word states,
 * one accent for decisions and selection.
 */
import { useState } from 'react';
import { CalendarClock, MessageSquare } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import { startStandupChat } from '../data/standupChat';
import type { StandupSource } from '../data/types';
import type { StandupView } from '../model/types';
import type { StandupPageProps } from './pageTypes';
import { Press } from './prims';
import { StandupErrors } from './StandupErrors';
import { StandupFooter } from './StandupFooter';
import { StandupHeader } from './StandupHeader';
import { StandupTable } from './StandupTable';
import './fonts';
import './standup-page.css';
import './standup-figure.css';

/**
 * The presses that start work, as ghost controls (with no standup, the empty state carries Open).
 * While deciding, the interview moves to Athena's chat (the in-app `/athena --standup`).
 */
function Starts({ view, source }: { view: StandupView; source: StandupSource }) {
  const { t, tx } = useTranslation();
  const s = t.athena.standup.actions;
  const [starting, setStarting] = useState(false);
  if (view.life === 'decide') {
    const plan = () => {
      setStarting(true);
      void startStandupChat(view, t, tx).finally(() => setStarting(false));
    };
    return (
      <Tooltip content={s.plan_hint} placement="bottom">
        <Press tone="line" busy={starting} icon={<MessageSquare className="sc-ico" aria-hidden="true" />} onClick={plan} data-testid="standup-plan-chat">
          {s.plan}
        </Press>
      </Tooltip>
    );
  }
  if (view.life === 'ended') {
    return <Press tone="solid" busy={source.busy.open} onClick={() => { void source.actions.open(); }} data-testid="standup-open">{s.open}</Press>;
  }
  return null;
}

/** Shared SVG paints: the dotted dead-spot texture and the still running hatch (no motion). */
function Paints() {
  return (
    <svg className="sc-paints" aria-hidden="true" focusable="false">
      <defs>
        <pattern id="sc-dots" width="4" height="4" patternUnits="userSpaceOnUse"><circle className="sc-dot" cx="2" cy="2" r="0.7" /></pattern>
        <pattern id="sc-dots-quiet" width="4" height="4" patternUnits="userSpaceOnUse"><circle className="sc-dot-quiet" cx="2" cy="2" r="0.6" /></pattern>
        <pattern id="sc-hatch" width="3.5" height="3.5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect className="sc-hatch-ink" width="1.4" height="3.5" />
        </pattern>
      </defs>
    </svg>
  );
}

export function StandupPage({ view, source, c, loading, rules }: StandupPageProps) {
  const { t } = useTranslation();
  const s = t.athena.standup;
  const body = view.life === 'none' && !loading ? (
    <div className="sc-empty">
      <ScenarioEmptyState
        icon={CalendarClock}
        size="lg"
        title={s.empty_title}
        subtitle={s.placeholder}
        action={{ label: s.actions.open, onClick: () => { void source.actions.open(); } }}
      />
    </div>
  ) : view.life === 'decide' && view.rows.length === 0 && !loading ? (
    <div className="sc-empty">
      <ScenarioEmptyState icon={CalendarClock} size="md" title={s.nothing_title} subtitle={s.nothing_subtitle} />
    </div>
  ) : (
    <StandupTable view={view} source={source} c={c} loading={loading} />
  );
  return (
    <div className="sc-page" data-standup-id={view.id ?? undefined} data-life={view.life} data-source={source.kind}>
      <Paints />
      <StandupHeader
        view={view}
        actions={<Starts view={view} source={source} />}
      />
      <StandupErrors source={source} />
      {body}
      <StandupFooter
        view={view}
        rules={rules}
        busy={source.busy}
        onRules={() => c.set({ rules: true })}
        onKeys={() => c.set({ keys: true })}
        onArm={() => { void c.arm(); }}
        onAmend={() => { void c.amend(); }}
        onEnd={() => { void c.end(); }}
      />
    </div>
  );
}
