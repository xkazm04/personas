import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import en from '@/i18n/locales/en.json';

// Overseer > Reviews with no agent in the coaching scope still lists his
// watched pipelines: a pipeline is not a persona, so the empty scope's hero
// must not hide them.

const director = vi.hoisted(() => ({
  ready: true, refreshing: false, director: undefined, personas: [],
  portfolio: { rollup: null, roster: [], scoreDistribution: [], inScope: 0, reviewed: 0, unreviewed: 0, avgScore: null, periodDays: 30 },
  verdicts: [], lastReport: null, portfolioError: false, verdictsError: false,
  brainEnabled: false, vaultConfigured: false, period: null,
  setPeriod: () => {}, refresh: () => {}, runBatch: async () => ({}), runOnPersona: async () => {},
  setStarred: async () => {}, setBrainEnabled: () => {}, openDirector: () => {},
}));

vi.mock('../useDirector', () => ({ useDirector: () => director }));
vi.mock('../components/WatchedPipelines', () => ({ WatchedPipelines: () => <div data-testid="watched-stub" /> }));
vi.mock('../components/CampaignReportPanel', () => ({ CampaignReportPanel: () => null }));
vi.mock('@/i18n/useTranslation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/useTranslation')>();
  return { ...actual, useTranslation: () => ({ t: en, tx: actual.interpolate, language: 'en' }) };
});

import DirectorCoachingTab from '../DirectorCoachingTab';

describe('Overseer > Reviews with an empty coaching scope', () => {
  it('renders the empty scope AND the watched pipelines', () => {
    render(<DirectorCoachingTab />);
    expect(screen.getByText(en.director.empty_title)).toBeTruthy();
    expect(screen.getByTestId('watched-stub')).toBeTruthy();
  });
});
