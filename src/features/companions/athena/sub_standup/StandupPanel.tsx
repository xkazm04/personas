import { useCallback, useMemo, useState } from 'react';
import { CalendarClock } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { KitHost } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { useFixtureChoice, type FixtureChoice } from './data/fixtureToggle';
import type { StandupSource } from './data/types';
import { useFixtureBuilder, useStandupFixture } from './data/useStandupFixture';
import { useStandupLive } from './data/useStandupLive';
import { buildView } from './model/buildView';
import { INITIAL_UI, type UiState } from './model/keymap';
import { AwayRulesSheet } from './parts/AwayRulesSheet';
import { DossierDrawer } from './parts/DossierDrawer';
import { FixtureSwitch, HeaderActions } from './parts/HeaderActions';
import { KeyLegend } from './parts/KeyLegend';
import { MachineBand } from './parts/MachineBand';
import { SinceLastStrip } from './parts/SinceLastStrip';
import { StandupFooter } from './parts/StandupFooter';
import { StandupHeader } from './parts/StandupHeader';
import { StandupTable } from './parts/StandupTable';
import { useStandupController } from './useStandupController';
import './standup.css';

/** Hatches the band and the rows reference by id (one definition per page). */
function SvgDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" className="absolute">
      <defs>
        <pattern id="su-run-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect className="su-hatch-b" width="8" height="8" />
          <rect className="su-hatch-a" width="4" height="8" />
        </pattern>
        <pattern id="su-gap-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line className="su-gap-line" x1="0" y1="0" x2="0" y2="6" />
        </pattern>
      </defs>
    </svg>
  );
}

/** Inline errors (Athena's two-surface doctrine: the page never speaks in toasts). */
function Errors({ source }: { source: StandupSource }) {
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

/**
 * Athena > Standup (spark app-standup, WP4): the contest winner B/1
 * "Timetable" on the app's own material. Every project is one line through
 * today (the away log), NOW (the decision) and tonight (the forecast); the
 * operator decides at the NOW column and arms the plan at the go-gate.
 * Data: live IPC (`src/api/companion/standup.ts`), or in a DEV build the
 * explicit fixture switch.
 */
export default function StandupPanel() {
  const { t } = useTranslation();
  const [choice, setChoice] = useFixtureChoice();
  const [ui, setUi] = useState<UiState>(INITIAL_UI);
  const fixtureOn = choice !== 'off';
  const live = useStandupLive(!fixtureOn, ui.zoom === '12d');
  const onScenario = useCallback((c: FixtureChoice) => setChoice(c), [setChoice]);
  const fixture = useStandupFixture(useFixtureBuilder(fixtureOn), fixtureOn ? choice : 'decide', onScenario);
  const source = fixtureOn && fixture ? fixture : live;
  const view = useMemo(() => buildView(source.input), [source.input]);
  const c = useStandupController(view, source, ui, setUi);
  const row = view.rows[c.ui.sel];
  const rules = source.input.standup?.awayRules ?? null;
  const loading = fixtureOn ? !fixture : source.loading.standup;

  return (
    <KitHost testId="athena-standup-panel">
      <div className="su-page" data-standup-id={view.id ?? undefined} data-life={view.life} data-source={source.kind}>
        <SvgDefs />
        <StandupHeader
          view={view}
          proposing={source.proposing}
          actions={(
            <>
              <HeaderActions view={view} busy={source.busy} onOpen={source.actions.open} onPropose={source.actions.propose} />
              <FixtureSwitch fixture={choice} onFixture={setChoice} />
            </>
          )}
        />
        <Errors source={source} />
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
      <DossierDrawer row={row} open={c.ui.dossier} onClose={() => c.set({ dossier: false })} />
      {rules && (
        <AwayRulesSheet
          open={c.ui.rules}
          rules={rules}
          editable={view.life === 'decide'}
          projectNames={source.input.projectNames}
          onClose={() => c.set({ rules: false })}
          onChange={(r) => { void source.actions.setRules(r); }}
        />
      )}
      <KeyLegend open={c.ui.keys} onClose={() => c.set({ keys: false })} />
    </KitHost>
  );
}
