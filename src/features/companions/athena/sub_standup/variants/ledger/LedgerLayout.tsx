/**
 * PROTOTYPE V1 "Ledger" (2026-11-06): the B/1 Timetable re-cut as a precise
 * instrument. One column grid (name | today | decision | tonight) carries the
 * sticky column head, the pinned machine row and every project row; one
 * header bar, one quiet since-line, one go-gate.
 */
import { CalendarClock } from 'lucide-react';

import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import { FixtureSwitch, HeaderActions } from '../../parts/HeaderActions';
import { StandupErrors } from '../BaselineLayout';
import type { StandupLayoutProps } from '../types';
import { LedgerFooter } from './LedgerFooter';
import { LedgerHeader } from './LedgerHeader';
import { LedgerTable } from './LedgerTable';
import './ledger.css';

export function LedgerLayout({ view, source, c, fixture, onFixture, loading, rules }: StandupLayoutProps) {
  const { t } = useTranslation();
  const s = t.athena.standup;
  const body = view.life === 'none' && !loading ? (
    <div className="sl-empty">
      <ScenarioEmptyState
        icon={CalendarClock}
        size="lg"
        title={s.empty_title}
        subtitle={s.placeholder}
        action={{ label: s.actions.open, onClick: () => { void source.actions.open(); } }}
      />
    </div>
  ) : view.life === 'decide' && view.rows.length === 0 && !loading ? (
    <div className="sl-empty">
      <ScenarioEmptyState icon={CalendarClock} size="md" title={s.nothing_title} subtitle={s.nothing_subtitle} />
    </div>
  ) : (
    <LedgerTable view={view} source={source} c={c} loading={loading} />
  );
  return (
    <div className="sl-page" data-standup-id={view.id ?? undefined} data-life={view.life} data-source={source.kind}>
      <LedgerHeader
        view={view}
        proposing={source.proposing}
        actions={(
          <>
            <HeaderActions view={view} busy={source.busy} onOpen={source.actions.open} onPropose={source.actions.propose} />
            <FixtureSwitch fixture={fixture} onFixture={onFixture} />
          </>
        )}
      />
      <StandupErrors source={source} />
      {body}
      <LedgerFooter
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
