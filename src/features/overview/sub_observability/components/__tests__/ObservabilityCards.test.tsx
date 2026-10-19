// Layer-1 Observability cards: a card whose own read failed must say so, never paint
// the zeros the read never measured ("0 failed", "0 tools", a success mark).
import { render, screen, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { useOverviewStore } from '@/stores/overviewStore';
import { ObservabilityCards, type ObservabilityCardsProps } from '../ObservabilityCards';
import { useObservabilityWords } from '../../libs/useObservabilityWords';

type Rest = Omit<ObservabilityCardsProps, 'w' | 'open' | 'onOpen'>;

const healthy: Rest = {
  issues: [],
  issuesLoading: false,
  issuesFailed: false,
  peakCost: 1.5,
  failed: 0,
  anomalies: 0,
  metricsLoading: false,
  metricsFailed: false,
  tools: { rows: [], loading: false, failed: false },
  athena: { data: null, loading: false, error: false },
};

function Harness(p: Rest) {
  const w = useObservabilityWords();
  return <ObservabilityCards {...p} w={w} open={null} onOpen={() => {}} />;
}

const card = (id: string) => screen.getByTestId(`obs-card-${id}`);
const failedBand = (id: string) => within(card(id)).queryByText('Failed to load');

describe('ObservabilityCards failed reads', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['overview', 'director', 'agents', 'triggers']);
  });
  beforeEach(() => {
    useOverviewStore.setState({ alertRules: [], alertHistory: [], alertRulesLoading: false, alertRulesError: null });
  });

  it('a healthy page shows no failure band on any card', () => {
    render(<Harness {...healthy} />);
    for (const id of ['health', 'charts', 'alerts', 'tools', 'athena']) expect(failedBand(id)).toBeNull();
  });

  it('every card whose read failed states the failure instead of a zero', () => {
    useOverviewStore.setState({ alertRulesError: 'boom' });
    render(
      <Harness
        {...healthy}
        issuesFailed
        peakCost={null}
        metricsFailed
        tools={{ rows: [], loading: false, failed: true }}
        athena={{ data: null, loading: false, error: true }}
      />,
    );
    for (const id of ['health', 'charts', 'alerts', 'tools', 'athena']) {
      expect(failedBand(id), id).not.toBeNull();
    }
    // The figures a failed read never measured are gone, not drawn as zeros.
    expect(within(card('health')).queryByText('No open issues')).toBeNull();
  });

  it('a failed re-read keeps rows already on screen (law 1)', () => {
    useOverviewStore.setState({
      alertRulesError: 'boom',
      alertRules: [{ id: 'r1' } as never],
    });
    render(<Harness {...healthy} />);
    expect(failedBand('alerts')).toBeNull();
  });
});
