import { CalendarClock } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import type { StandupSource } from '../data/types';
import { FixtureSwitch, HeaderActions } from '../parts/HeaderActions';
import { MachineBand } from '../parts/MachineBand';
import { SinceLastStrip } from '../parts/SinceLastStrip';
import { StandupFooter } from '../parts/StandupFooter';
import { StandupHeader } from '../parts/StandupHeader';
import { StandupTable } from '../parts/StandupTable';
import type { StandupLayoutProps } from './types';

/** Inline errors (Athena's two-surface doctrine: the page never speaks in toasts). */
export function StandupErrors({ source }: { source: StandupSource }) {
  const { t } = useTranslation();
  const lines = [source.errors.standup, source.errors.events, source.errors.action].filter(Boolean);
  if (lines.length === 0) return null;
  return (
    <div role="alert" className="flex items-center gap-3 px-5 py-2 border-b border-primary/10">
      <div className="flex-1 min-w-0">{lines.map((l) => <p key={l} className="typo-body su-error">{l}</p>)}</div>
      {source.errors.action && <Button variant="ghost" size="sm" onClick={source.actions.clearError}>{t.athena.standup.dismiss}</Button>}
    </div>
  );
}

/** The shipped B/1 "Timetable" port (WP4 f89e9286c5), kept as the A/B reference. */
export function BaselineLayout({ view, source, c, fixture, onFixture, loading, rules }: StandupLayoutProps) {
  const { t } = useTranslation();
  return (
    <div className="su-page" data-standup-id={view.id ?? undefined} data-life={view.life} data-source={source.kind}>
      <StandupHeader
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
      {view.sinceLast && <SinceLastStrip since={view.sinceLast} />}
      {view.life === 'none' && !loading ? (
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <ScenarioEmptyState
            icon={CalendarClock}
            size="lg"
            title={t.athena.standup.empty_title}
            subtitle={t.athena.standup.placeholder}
            action={{ label: t.athena.standup.actions.open, onClick: () => { void source.actions.open(); } }}
          />
        </div>
      ) : (
        <>
          <MachineBand view={view} zoom={c.ui.zoom} utilizationLong={source.utilizationLong} loading={source.loading.machine} error={source.errors.machine} />
          {view.life === 'decide' && view.rows.length === 0 && !loading ? (
            <div className="flex-1 min-h-0 flex items-center justify-center">
              <ScenarioEmptyState icon={CalendarClock} size="md" title={t.athena.standup.nothing_title} subtitle={t.athena.standup.nothing_subtitle} />
            </div>
          ) : (
            <StandupTable
              view={view}
              sel={c.ui.sel}
              typingKey={c.ui.typing}
              proposing={source.proposing}
              loading={loading}
              onSelect={c.select}
              onPick={c.pick}
              onTyped={c.typed}
            />
          )}
        </>
      )}
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
