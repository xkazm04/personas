/**
 * PROTOTYPE (2026-11-06) V2 "Focus": a standup is a queue of decisions, so the
 * page is a review queue. The queue on the left (grouped, one line each), the
 * one selected line in front of the operator on the right, and Athena's line,
 * the progress and the go-gate across the top. Presentation only: data, view
 * and keyboard come from StandupPanel through `StandupLayoutProps`.
 */
import { CalendarClock } from 'lucide-react';

import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import { FixtureSwitch, HeaderActions } from '../../parts/HeaderActions';
import { StandupErrors } from '../BaselineLayout';
import type { StandupLayoutProps } from '../types';
import { FocusPane } from './FocusPane';
import { GoGate } from './GoGate';
import { progressOf } from './model';
import { QueueRail } from './QueueRail';
import { RailFoot } from './RailFoot';
import { SinceCard } from './SinceCard';
import { TopBar } from './TopBar';
import { useRowActions } from './useRowActions';
import './focus.css';

export function FocusLayout({ view, source, c, fixture, onFixture, loading, rules }: StandupLayoutProps) {
  const { t } = useTranslation();
  const s = t.athena.standup;
  const a = useRowActions(view, source, c);
  const progress = progressOf(view);
  const row = view.rows[c.ui.sel];
  const empty = view.life === 'none' && !loading;
  const nothing = view.life === 'decide' && view.rows.length === 0 && !loading;
  return (
    <div className="sf-page" data-standup-id={view.id ?? undefined} data-life={view.life} data-source={source.kind}>
      <TopBar
        view={view}
        proposing={source.proposing}
        progress={progress}
        actions={(
          <>
            <HeaderActions view={view} busy={source.busy} onOpen={source.actions.open} onPropose={source.actions.propose} />
            <FixtureSwitch fixture={fixture} onFixture={onFixture} />
          </>
        )}
        gate={(
          <GoGate
            view={view}
            progress={progress}
            selKey={row?.key}
            busy={source.busy}
            onArm={() => { void c.arm(); }}
            onAmend={() => { void c.amend(); }}
            onEnd={() => { void c.end(); }}
          />
        )}
      />
      <StandupErrors source={source} />
      {empty || nothing ? (
        <div className="sf-empty">
          <ScenarioEmptyState
            icon={CalendarClock}
            size={empty ? 'lg' : 'md'}
            title={empty ? s.empty_title : s.nothing_title}
            subtitle={empty ? s.placeholder : s.nothing_subtitle}
            action={empty ? { label: s.actions.open, onClick: () => { void source.actions.open(); } } : undefined}
          />
        </div>
      ) : (
        <div className="sf-main">
          <aside className="sf-rail">
            <QueueRail
              view={view}
              sel={c.ui.sel}
              proposing={source.proposing}
              loading={loading}
              onSelect={c.select}
              before={view.life === 'return' && view.sinceLast ? <SinceCard since={view.sinceLast} /> : null}
            />
            <RailFoot view={view} rules={rules} onRules={() => c.set({ rules: true })} onKeys={() => c.set({ keys: true })} />
          </aside>
          <FocusPane view={view} row={row} typing={Boolean(row) && c.ui.typing === row?.key} proposing={source.proposing} a={a} />
        </div>
      )}
    </div>
  );
}
