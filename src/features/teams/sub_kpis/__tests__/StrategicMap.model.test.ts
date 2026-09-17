import { describe, it, expect } from 'vitest';

import type { KpiBand, KpiGroupRollup, KpiProjectRollup } from '../kpiOverviewModel';
import { UNGROUPED_KEY } from '../kpiOverviewModel';
import { bandCensus, focusGroupId, matchesHighlight, BAND_GLYPH } from '../variants/StrategicMap.model';

function group(band: KpiBand, groupId: string | null = 'g'): KpiGroupRollup {
  return {
    key: `p:${groupId ?? UNGROUPED_KEY}`, projectId: 'p', groupId, label: 'G', domain: null,
    color: null, coverage: 0.5, offTrackShare: null, band, kpis: [],
    total: 2, measured: 1, met: 0, onTrack: 0, offTrack: 0, unpaced: 0,
  };
}

function lane(...groups: KpiGroupRollup[]): KpiProjectRollup {
  return {
    projectId: 'p', label: 'P', groups, groupsUnknown: false, coverage: 0.5,
    offTrackShare: null, band: groups[0]?.band ?? 'unmeasured',
    total: 2, measured: 1, met: 0, onTrack: 0, offTrack: 0, unpaced: 0,
  };
}

describe('bandCensus', () => {
  it('counts every cell across every lane, band by band', () => {
    const overview = [
      lane(group('strained'), group('met'), group('unmeasured')),
      lane(group('met'), group('met')),
    ];
    const { counts, total } = bandCensus(overview);
    expect(total).toBe(5);
    expect(counts.met).toBe(3);
    expect(counts.strained).toBe(1);
    expect(counts.unmeasured).toBe(1);
    expect(counts.mixed).toBe(0);
    expect(counts.healthy).toBe(0);
  });

  it('is all zeros with no lanes, and never omits a band key', () => {
    const { counts, total } = bandCensus([]);
    expect(total).toBe(0);
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
    expect(Object.keys(counts).sort()).toEqual(
      ['healthy', 'met', 'mixed', 'strained', 'unmeasured'],
    );
  });

  it('counts unmeasured cells rather than dropping them', () => {
    expect(bandCensus([lane(group('unmeasured'), group('unmeasured'))]).counts.unmeasured).toBe(2);
  });
});

describe('matchesHighlight', () => {
  it('matches everything when no band is active', () => {
    expect(matchesHighlight('met', null)).toBe(true);
    expect(matchesHighlight('unmeasured', null)).toBe(true);
  });

  it('matches only the active band', () => {
    expect(matchesHighlight('met', 'met')).toBe(true);
    expect(matchesHighlight('healthy', 'met')).toBe(false);
  });
});

describe('focusGroupId', () => {
  it('passes a real group id through and names the ungrouped cell', () => {
    expect(focusGroupId('abc')).toBe('abc');
    expect(focusGroupId(null)).toBe(UNGROUPED_KEY);
  });
});

describe('BAND_GLYPH', () => {
  it('gives every band a non-color channel', () => {
    for (const b of ['met', 'healthy', 'mixed', 'strained', 'unmeasured'] as KpiBand[]) {
      expect(BAND_GLYPH[b]).toBeTruthy();
    }
  });
});
