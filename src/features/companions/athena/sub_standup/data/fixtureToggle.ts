import { useCallback, useState } from 'react';

import { safeLocalGet, safeLocalSet } from '@/lib/safeLocalStorage';
import type { FixtureScenario } from '../fixture/standupFixture';

export type FixtureChoice = 'off' | FixtureScenario;

const KEY = 'personas.athena.standup.fixture';
const CHOICES: readonly FixtureChoice[] = ['off', 'decide', 'armed', 'return'];

/**
 * The explicit DEV toggle for the fixture (never on by itself): remembered per
 * browser profile so a reload keeps it. Always 'off' outside a DEV build.
 */
export function useFixtureChoice(): [FixtureChoice, (c: FixtureChoice) => void] {
  const [choice, setChoice] = useState<FixtureChoice>(() => {
    if (!import.meta.env.DEV) return 'off';
    const saved = safeLocalGet(KEY, 'standup fixture read') as FixtureChoice | null;
    return saved && CHOICES.includes(saved) ? saved : 'off';
  });
  const set = useCallback((c: FixtureChoice) => {
    setChoice(c);
    safeLocalSet(KEY, c, 'standup fixture write');
  }, []);
  return [import.meta.env.DEV ? choice : 'off', set];
}

export const FIXTURE_CHOICES = CHOICES;
