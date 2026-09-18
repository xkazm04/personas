import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AnomalyScore } from '@/lib/bindings/AnomalyScore';
import type { Remediation } from '@/lib/bindings/Remediation';
import { AnomalyScorePanel } from '../AnomalyScorePanel';

/**
 * The Rust `Remediation` enum carries no `rename_all`, so it serializes
 * PascalCase. The panel used to key its label map on snake_case, which meant
 * every non-Healthy member fell through to the emerald "Healthy" row: a
 * credential the scorer wanted disabled rendered green. These cases pin the
 * generated union to its row.
 */
function makeScore(remediation: Remediation): AnomalyScore {
  return {
    failure_rate_total: 0.4,
    failure_rate_5m: 0.5,
    failure_rate_1h: 0.4,
    failure_rate_24h: 0.3,
    permanent_failure_rate_1h: 0,
    transient_failure_rate_1h: 0,
    remediation,
    sample_count: 12,
    data_stale: false,
  };
}

const CASES: Array<[Remediation, string]> = [
  ['Healthy', 'Healthy'],
  ['BackoffRetry', 'Temporary Issues'],
  ['PreemptiveRotation', 'Getting Worse'],
  ['RotateThenAlert', 'Ongoing Errors'],
  ['Disable', 'Critical'],
];

describe('AnomalyScorePanel remediation labels', () => {
  it.each(CASES)('maps %s to its own row', (remediation, label) => {
    render(<AnomalyScorePanel score={makeScore(remediation)} tolerance={0.1} />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it('does not label a Disable score as healthy', () => {
    render(<AnomalyScorePanel score={makeScore('Disable')} tolerance={0.1} />);
    expect(screen.queryByText('Healthy')).toBeNull();
  });
});
