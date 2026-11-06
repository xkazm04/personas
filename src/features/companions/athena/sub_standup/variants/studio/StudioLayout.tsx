/**
 * PROTOTYPE R2 "Studio" (2026-11-06): V1 Ledger's layout (one column grid:
 * Project | Today | Decision | Tonight, pinned machine row, an opened selected
 * row, a gate-only footer) given a flagship-product finish: Geist + JetBrains
 * Mono on a declared ramp, surfaces with depth, designed state badges.
 */
import { CalendarClock, Sparkles } from 'lucide-react';

import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import { FixtureSwitch } from '../../parts/HeaderActions';
import { StandupErrors } from '../BaselineLayout';
import type { StandupLayoutProps } from '../types';
import { Btn } from './controls';
import { StudioFooter } from './StudioFooter';
import { StudioHeader } from './StudioHeader';
import { StudioTable } from './StudioTable';
import './fonts';
import './studio.css';
import './studio-rows.css';
import './studio-detail.css';

export function StudioLayout({ view, source, c, fixture, onFixture, loading, rules }: StandupLayoutProps) {
  const { t } = useTranslation();
  const s = t.athena.standup;
  const body = view.life === 'none' && !loading ? (
    <div className="ss-empty">
      <ScenarioEmptyState
        icon={CalendarClock}
        size="lg"
        title={s.empty_title}
        subtitle={s.placeholder}
        action={{ label: s.actions.open, onClick: () => { void source.actions.open(); } }}
      />
    </div>
  ) : view.life === 'decide' && view.rows.length === 0 && !loading ? (
    <div className="ss-empty">
      <ScenarioEmptyState icon={CalendarClock} size="md" title={s.nothing_title} subtitle={s.nothing_subtitle} />
    </div>
  ) : (
    <StudioTable view={view} source={source} c={c} loading={loading} />
  );
  return (
    <div className="ss-page" data-standup-id={view.id ?? undefined} data-life={view.life} data-source={source.kind}>
      <StudioHeader
        view={view}
        proposing={source.proposing}
        actions={(
          <>
            {view.life === 'decide' && (
              <Btn icon={<Sparkles className="ss-ico" />} loading={source.busy.propose} onClick={() => { void source.actions.propose(); }}>
                {s.actions.propose}
              </Btn>
            )}
            {view.life === 'ended' && (
              <Btn variant="hero" loading={source.busy.open} onClick={() => { void source.actions.open(); }} data-testid="standup-open">
                {s.actions.open}
              </Btn>
            )}
            <FixtureSwitch fixture={fixture} onFixture={onFixture} />
          </>
        )}
      />
      <StandupErrors source={source} />
      {body}
      <StudioFooter
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
