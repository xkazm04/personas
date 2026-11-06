import { Sparkles } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Segmented } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { FIXTURE_CHOICES, type FixtureChoice } from '../data/fixtureToggle';
import type { BusyAction } from '../data/types';
import type { StandupView } from '../model/types';

interface Props {
  view: StandupView;
  busy: Partial<Record<BusyAction, boolean>>;
  onOpen: () => void;
  onPropose: () => void;
}

/** DEV only: the explicit fixture switch, labelled as fixture on screen whenever it is on. */
export function FixtureSwitch({ fixture, onFixture }: { fixture: FixtureChoice; onFixture: (c: FixtureChoice) => void }) {
  if (!import.meta.env.DEV) return null;
  return <FixtureTabs fixture={fixture} onFixture={onFixture} />;
}

function FixtureTabs({ fixture, onFixture }: { fixture: FixtureChoice; onFixture: (c: FixtureChoice) => void }) {
  const { t } = useTranslation();
  const s = t.athena.standup.fixture;
  return (
    <div className="flex items-center gap-2" data-testid="standup-fixture-switch">
      {fixture !== 'off' && <span className="su-chip su-fixture typo-label">{s.badge}</span>}
      <Segmented label={s.label} value={fixture} onChange={onFixture} options={FIXTURE_CHOICES.map((v) => ({ v, label: s[v] }))} />
    </div>
  );
}

/** The presses that start work under the title (with no standup, the empty state carries Open). */
export function HeaderActions({ view, busy, onOpen, onPropose }: Props) {
  const { t } = useTranslation();
  const s = t.athena.standup.actions;
  return (
    <>
      {view.life === 'decide' && (
        <Button variant="secondary" size="sm" loading={busy.propose} onClick={onPropose} icon={<Sparkles className="w-4 h-4" />}>
          {s.propose}
        </Button>
      )}
      {view.life === 'ended' && (
        <Button variant="primary" size="sm" loading={busy.open} onClick={onOpen} data-testid="standup-open">{s.open}</Button>
      )}
    </>
  );
}
