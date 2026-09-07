import { describe, it, expect } from 'vitest';
import { sparklineSeries } from './DeploymentHealthSparkline';

const day = (date: string, count: number, successRate: number | null) => ({ date, count, successRate, cost: 0 });

describe('sparklineSeries', () => {
  it('leaves an unreported day out of the rate and error series instead of plotting 100% / 0', () => {
    const daily = [
      day('09-01', 0, null),
      day('09-02', 4, 0.5),
      day('09-03', 0, null),
      day('09-04', 2, 0),
    ];
    const s = sparklineSeries(daily);
    expect(s.successRates).toEqual([50, 0]);
    expect(s.errorCounts).toEqual([2, 2]);
    // Volume is reported for every day and stays complete.
    expect(s.volumes).toEqual([0, 4, 0, 2]);
  });

  it('a window with a single reported day yields a single point, which the renderer shows as no trend', () => {
    const s = sparklineSeries([day('09-01', 0, null), day('09-02', 1, 0), day('09-03', 0, null)]);
    expect(s.successRates).toEqual([0]);
  });
});
