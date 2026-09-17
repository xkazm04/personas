/**
 * TrainingMomentumBand — the two cases the training stage could not answer
 * before this band existed: how many sessions have actually happened, and
 * which topics are thin, both WITHOUT opening the studio.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listCommunications = vi.fn();
const listPendingMemories = vi.fn();

vi.mock('@/api/twin/twin', () => ({
  listCommunications: (...a: unknown[]) => listCommunications(...a),
  listPendingMemories: (...a: unknown[]) => listPendingMemories(...a),
}));

import { TrainingMomentumBand } from '../TrainingMomentumBand';
import { TRAINING_TOPIC_PRESETS } from '../useTrainingSession';

describe('TrainingMomentumBand', () => {
  beforeEach(() => {
    listCommunications.mockReset();
    listPendingMemories.mockReset();
  });

  it('states the baseline on a twin that has never trained', async () => {
    listCommunications.mockResolvedValue([]);
    listPendingMemories.mockResolvedValue([]);

    render(<TrainingMomentumBand twinId="t1" topic={null} onPickTopic={() => {}} />);

    await waitFor(() => expect(listCommunications).toHaveBeenCalled());
    expect(screen.getByTestId('training-momentum-sessions').textContent).toContain('0');
    expect(screen.getByTestId('training-momentum-never')).toBeTruthy();
  });

  it('renders one pill per preset, all thin on an empty approved set', async () => {
    listCommunications.mockResolvedValue([]);
    listPendingMemories.mockResolvedValue([]);

    render(<TrainingMomentumBand twinId="t1" topic={null} onPickTopic={() => {}} />);

    await waitFor(() => expect(listPendingMemories).toHaveBeenCalledWith('t1', 'approved'));
    for (const preset of TRAINING_TOPIC_PRESETS) {
      expect(screen.getByTestId(`training-coverage-${preset.id}`).getAttribute('data-tier')).toBe('thin');
    }
    expect(TRAINING_TOPIC_PRESETS.length).toBe(6);
  });

  it('lifts a covered topic out of thin and hands its prompt to the picker', async () => {
    listCommunications.mockResolvedValue([
      { key_facts_json: '{"kind":"session_summary"}', occurred_at: '2026-09-01T10:00:00Z' },
    ]);
    // Five memories whose text hits the `values` keyword set → "covered".
    listPendingMemories.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({ title: `v${i}`, content: 'what matters is integrity' })),
    );

    const onPickTopic = vi.fn();
    render(<TrainingMomentumBand twinId="t1" topic={null} onPickTopic={onPickTopic} />);

    await waitFor(() =>
      expect(screen.getByTestId('training-coverage-values').getAttribute('data-tier')).toBe('covered'),
    );
    expect(screen.getByTestId('training-coverage-expertise').getAttribute('data-tier')).toBe('thin');
    expect(screen.getByTestId('training-momentum-sessions').textContent).toContain('1');

    fireEvent.click(screen.getByTestId('training-coverage-expertise'));
    expect(onPickTopic).toHaveBeenCalledTimes(1);
    expect(String(onPickTopic.mock.calls[0][0]).length).toBeGreaterThan(0);
  });
});
