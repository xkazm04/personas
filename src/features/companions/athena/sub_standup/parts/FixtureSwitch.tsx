import { Segmented } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { FIXTURE_CHOICES, type FixtureChoice } from '../data/fixtureToggle';

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
