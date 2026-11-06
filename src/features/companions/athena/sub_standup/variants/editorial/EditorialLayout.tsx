/**
 * PROTOTYPE R2-B "Editorial" (2026-11-06): the kept V1 Ledger layout (one column grid:
 * project | today | decision | tonight, pinned machine row, one header, one go-gate) set as a
 * finely printed timetable. Fraunces + Inter, rules instead of boxes, states as typographic marks.
 */
import { CalendarClock } from 'lucide-react';

import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import { FixtureSwitch, HeaderActions } from '../../parts/HeaderActions';
import { StandupErrors } from '../BaselineLayout';
import type { StandupLayoutProps } from '../types';
import { PatternDefs } from './axis';
import { EditorialFooter } from './EditorialFooter';
import { EditorialHeader } from './EditorialHeader';
import { EditorialTable } from './EditorialTable';
import './fonts';
import './editorial.css';
import './figures.css';

export function EditorialLayout({ view, source, c, fixture, onFixture, loading, rules }: StandupLayoutProps) {
  const { t } = useTranslation();
  const s = t.athena.standup;
  const body = view.life === 'none' && !loading ? (
    <div className="se-empty">
      <ScenarioEmptyState
        icon={CalendarClock}
        size="lg"
        title={s.empty_title}
        subtitle={s.placeholder}
        action={{ label: s.actions.open, onClick: () => { void source.actions.open(); } }}
      />
    </div>
  ) : view.life === 'decide' && view.rows.length === 0 && !loading ? (
    <div className="se-empty">
      <ScenarioEmptyState icon={CalendarClock} size="md" title={s.nothing_title} subtitle={s.nothing_subtitle} />
    </div>
  ) : (
    <EditorialTable view={view} source={source} c={c} loading={loading} />
  );
  return (
    <div className="se-page" data-standup-id={view.id ?? undefined} data-life={view.life} data-source={source.kind}>
      <PatternDefs />
      <EditorialHeader
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
      <EditorialFooter
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
