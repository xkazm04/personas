import { useCallback, useEffect, useMemo, useState } from 'react';

import type { AwayRules } from '@/lib/bindings/AwayRules';
import type { StandupItemPatch } from '@/lib/bindings/StandupItemPatch';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import type { FixtureData, FixtureScenario } from '../fixture/standupFixture';
import { applyPatch } from '../model/patch';
import type { StandupSource } from './types';

type Builder = (scenario: FixtureScenario) => FixtureData;

const NO_LOADING = { standup: false, events: false, machine: false } as const;

/**
 * Loads the fixture module only in a DEV build and only once the toggle asks
 * for it: production replaces `import.meta.env.DEV` with false, so the branch
 * and its chunk are dropped from the bundle.
 */
export function useFixtureBuilder(wanted: boolean): Builder | null {
  const [builder, setBuilder] = useState<Builder | null>(null);
  useEffect(() => {
    if (!import.meta.env.DEV || !wanted || builder) return;
    let alive = true;
    import('../fixture/standupFixture')
      .then((m) => { if (alive) setBuilder(() => m.buildFixture); })
      .catch(silentCatch('StandupPanel.fixture'));
    return () => { alive = false; };
  }, [wanted, builder]);
  return wanted ? builder : null;
}

/**
 * The DEV fixture as a source: the same wire shapes, mutated locally by the
 * same patches the backend applies. Arm, amend and end move between the lives.
 */
export function useStandupFixture(build: Builder | null, scenario: FixtureScenario, onScenario: (s: FixtureScenario) => void): StandupSource | null {
  const { t } = useTranslation();
  const [data, setData] = useState<{ key: string; value: FixtureData } | null>(null);
  const [actionError, setActionError] = useState<string>();
  // A new scenario (or the module arriving) rebuilds the record: a render-time reset, no effect.
  if (build && data?.key !== scenario) setData({ key: scenario, value: build(scenario) });

  const update = useCallback((fn: (v: FixtureData) => FixtureData) => setData((d) => (d ? { ...d, value: fn(d.value) } : d)), []);

  const actions = useMemo<StandupSource['actions']>(() => ({
    open: async () => onScenario('decide'),
    propose: async () => setActionError(t.athena.standup.fixture_no_backend),
    patch: async (patch: StandupItemPatch) => update((v) => ({ ...v, standup: v.standup && applyPatch(v.standup, patch) })),
    setRules: async (rules: AwayRules) => update((v) => ({ ...v, standup: v.standup && { ...v.standup, awayRules: rules } })),
    arm: async () => onScenario('armed'),
    end: async () => onScenario('return'),
    discuss: async () => {
      setActionError(t.athena.standup.fixture_no_backend);
      return null;
    },
    clearError: () => setActionError(undefined),
  }), [onScenario, update, t]);

  if (!build || !data || data.key !== scenario) return null;
  return {
    kind: 'fixture',
    input: data.value,
    utilizationLong: data.value.utilization,
    loading: NO_LOADING,
    errors: { action: actionError },
    busy: {},
    proposing: false,
    actions,
  };
}
