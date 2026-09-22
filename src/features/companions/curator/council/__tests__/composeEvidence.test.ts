// The evidence well is composed by the app, deterministically. These tests
// pin that: every evidence kind maps to a widget, an unknown kind keeps its
// fact instead of being dropped, and a member with nothing staged composes
// nothing rather than an empty-looking tile.
import { describe, expect, it } from 'vitest';

import { composeEvidence, type EvidenceLabels } from '../table/composeEvidence';
import type { EvidenceItem, Seat } from '../table/runModel';

const labels: EvidenceLabels = {
  metricTitle: 'Measured',
  urlTitle: 'A source on the web',
  fileTitle: 'A file in the repository',
  findingsTitle: 'What it found',
  comparisonTitle: 'Against the named rivals',
  mediaTitle: 'Recorded evidence',
  severity: (s) => s,
};

function seat(over: Partial<Seat> = {}): Seat {
  return {
    name: 'value',
    weight: 0.3,
    floor: 0.4,
    kind: 'judged',
    threshold: 0.7,
    state: 'measured',
    score: 0.75,
    confidence: 'med',
    floorHit: false,
    advisory: true,
    findings: [],
    evidence: [],
    techniques: [],
    delta: null,
    ...over,
  };
}

const ev = (kind: EvidenceItem['kind'], ref: string, caption = 'c'): EvidenceItem => ({
  kind,
  ref,
  caption,
});

describe('composeEvidence', () => {
  it('composes nothing for a member that staged nothing', () => {
    expect(composeEvidence(seat(), labels)).toEqual([]);
  });

  it('composes nothing for an unmeasured member that staged nothing', () => {
    expect(composeEvidence(seat({ state: 'not_run', score: null }), labels)).toEqual([]);
  });

  it('turns a metric with several figures into a stat grid', () => {
    const [w] = composeEvidence(
      seat({ evidence: [ev('metric', 'by hand 40, with app 6')] }),
      labels,
    );
    expect(w.kind).toBe('stat_grid');
    expect((w.config?.stats as unknown[]).length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to one figure when a metric carries only a reference', () => {
    const [w] = composeEvidence(seat({ evidence: [ev('metric', 'see the ledger')] }), labels);
    expect(w.kind).toBe('metric_spark');
  });

  it('turns a url into a followable row', () => {
    const [w] = composeEvidence(seat({ evidence: [ev('url', 'https://example.test/x')] }), labels);
    expect(w.kind).toBe('issue_list');
    const items = w.config?.items as { href: string }[];
    expect(items[0].href).toBe('https://example.test/x');
  });

  it('turns a file into an excerpt carrying its path', () => {
    const [w] = composeEvidence(seat({ evidence: [ev('file', 'src/lib/x.ts:12')] }), labels);
    expect(w.kind).toBe('log_excerpt');
    expect(w.config?.lines).toEqual(['src/lib/x.ts:12']);
  });

  it.each(['screenshot', 'video'] as const)('turns a %s into council_media', (kind) => {
    const [w] = composeEvidence(seat({ evidence: [ev(kind, 'evidence/a.png')] }), labels);
    expect(w.kind).toBe('council_media');
    expect(w.config?.relPath).toBe('evidence/a.png');
    expect(w.config?.media).toBe(kind);
    // The run id is the app's to supply; the composer never invents one.
    expect(w.config?.runId).toBeUndefined();
  });

  it('keeps an unknown kind as a named fact rather than dropping it', () => {
    const unknown = { kind: 'telemetry', ref: 'x', caption: 'c' } as unknown as EvidenceItem;
    const [w] = composeEvidence(seat({ evidence: [unknown] }), labels);
    expect(w.kind).toBe('text_callout');
    expect(String(w.config?.body)).toContain('x');
  });

  it('puts findings first, and carries their severity', () => {
    const widgets = composeEvidence(
      seat({
        findings: [{ id: 'f1', severity: 'high', title: 'T', detail: 'D', recurrence: 2 }],
        evidence: [ev('file', 'a.ts')],
      }),
      labels,
    );
    expect(widgets.map((w) => w.kind)).toEqual(['issue_list', 'log_excerpt']);
    const items = widgets[0].config?.items as { severity: string }[];
    expect(items[0].severity).toBe('bad');
  });

  it('gives rivalry a comparison instead of a list of refs', () => {
    const widgets = composeEvidence(
      seat({ name: 'rivalry', evidence: [ev('url', 'https://rival.test')] }),
      { ...labels, rivalsSummary: '2 of 4 named rivals are ahead' },
    );
    expect(widgets.map((w) => w.kind)).toEqual(['comparison_cards']);
  });

  it('is deterministic: the same seat composes the same spec', () => {
    const s = seat({ evidence: [ev('file', 'a.ts'), ev('url', 'https://b.test')] });
    expect(composeEvidence(s, labels)).toEqual(composeEvidence(s, labels));
  });
});
