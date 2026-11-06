/**
 * PROTOTYPE (2026-11-06) V3 "Briefing": the standup read as a memo Athena
 * wrote for the operator. One centred reading column: masthead and her opening
 * paragraph, then what needs him, the directions (decided ones fold to a line,
 * so the document shrinks as he decides), agents, fill and held, and tonight
 * as one figure on one axis; a slim go-gate stays under the column.
 */
import { CalendarClock } from 'lucide-react';

import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { GhostRows, Surface } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { FixtureSwitch, HeaderActions } from '../../parts/HeaderActions';
import { StandupErrors } from '../BaselineLayout';
import type { StandupLayoutProps } from '../types';
import { Document } from './Document';
import { GateBar } from './GateBar';
import type { ItemCtx } from './itemTypes';
import { Masthead } from './Masthead';
import { Tonight } from './Tonight';
import { useBriefing } from './useBriefing';
import './briefing.css';

export function BriefingLayout({ view, source, c, fixture, onFixture, loading, rules }: StandupLayoutProps) {
  const { t } = useTranslation();
  const api = useBriefing(view, source, c);
  const ctx: ItemCtx = { view, c, api, editable: view.life === 'decide', proposing: source.proposing };
  const s = t.athena.standup;
  const nothing = view.life === 'decide' && view.rows.length === 0 && !loading;
  return (
    <div className="sb-page" data-standup-id={view.id ?? undefined} data-life={view.life} data-source={source.kind}>
      <div className="sb-scroll">
        <div className="sb-col">
          <Masthead
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
          {view.life === 'none' && !loading ? (
            <div className="sb-empty">
              <ScenarioEmptyState
                icon={CalendarClock}
                size="lg"
                title={s.empty_title}
                subtitle={s.placeholder}
                action={{ label: s.actions.open, onClick: () => { void source.actions.open(); } }}
              />
            </div>
          ) : (
            <Surface fluid>
              {loading && view.rows.length === 0 && <div className="sb-ghost"><GhostRows count={6} size="l" label={s.loading} /></div>}
              {nothing && <div className="sb-empty"><ScenarioEmptyState icon={CalendarClock} size="md" title={s.nothing_title} subtitle={s.nothing_subtitle} /></div>}
              <Document ctx={ctx} />
              <Tonight view={view} zoom={c.ui.zoom} utilizationLong={source.utilizationLong} loading={source.loading.machine} error={source.errors.machine} />
            </Surface>
          )}
        </div>
      </div>
      <div className="sb-col sb-col--gate">
        <GateBar
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
    </div>
  );
}
