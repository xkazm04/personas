/**
 * PROTOTYPE R2-A "Console" (2026-11-06): V1 Ledger's layout kept whole (one
 * column grid, one header bar, pinned machine row, an opened selected row, a
 * gate-only footer), every component redrawn as a precision ops instrument:
 * Inter for names and prose, JetBrains Mono for every figure, hairline rules,
 * glyph + word states, one accent for decisions and selection.
 */
import { CalendarClock, Sparkles } from 'lucide-react';

import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import { FixtureSwitch } from '../../parts/HeaderActions';
import type { StandupView } from '../../model/types';
import type { StandupSource } from '../../data/types';
import { StandupErrors } from '../BaselineLayout';
import type { StandupLayoutProps } from '../types';
import { ConsoleFooter } from './ConsoleFooter';
import { ConsoleHeader } from './ConsoleHeader';
import { ConsoleTable } from './ConsoleTable';
import { Press } from './prims';
import './fonts';
import './console.css';
import './console-figure.css';

/** The presses that start work, as ghost controls (with no standup, the empty state carries Open). */
function Starts({ view, source }: { view: StandupView; source: StandupSource }) {
  const { t } = useTranslation();
  const s = t.athena.standup.actions;
  if (view.life === 'decide') {
    return (
      <Press tone="line" busy={source.busy.propose} icon={<Sparkles className="sc-ico" aria-hidden="true" />} onClick={() => { void source.actions.propose(); }}>
        {s.propose}
      </Press>
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

export function ConsoleLayout({ view, source, c, fixture, onFixture, loading, rules }: StandupLayoutProps) {
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
    <ConsoleTable view={view} source={source} c={c} loading={loading} />
  );
  return (
    <div className="sc-page" data-standup-id={view.id ?? undefined} data-life={view.life} data-source={source.kind}>
      <Paints />
      <ConsoleHeader
        view={view}
        proposing={source.proposing}
        actions={(
          <>
            <Starts view={view} source={source} />
            <FixtureSwitch fixture={fixture} onFixture={onFixture} />
          </>
        )}
      />
      <StandupErrors source={source} />
      {body}
      <ConsoleFooter
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
