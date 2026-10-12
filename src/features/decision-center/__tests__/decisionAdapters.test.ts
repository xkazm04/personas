import { describe, expect, it } from 'vitest';

import { chipOf, modalTypeOf } from '../model/decisionModel';
import { decisionTier } from '../model/decisionOrder';
import {
  approvalToDecision,
  councilToDecision,
  incidentToDecision,
  reportToDecision,
} from '../roster/decisionAdapters';
import { COUNCIL_MIN_REASON, DEFAULT_DECISION_COPY as copy } from '../roster/decisionCopy';
import {
  approvalRow,
  councilDetail,
  councilSubject,
  incidentRow,
  reportRow,
} from './rosterFixtures';

describe('incidentToDecision', () => {
  it('is an incident on the incidents chip, tier 1 when high', () => {
    const d = incidentToDecision(incidentRow(), copy);
    expect(d.kind).toBe('incident');
    expect(d.id).toBe('incident:inc-1');
    expect(chipOf(d.kind)).toBe('incidents');
    expect(modalTypeOf(d.kind)).toBe('approval');
    expect(decisionTier(d)).toBe(1);
    expect(d.severity).toBe('high');
    expect(d.verdictLabels).toMatchObject({ accept: copy.resolve, reject: copy.dismiss });
    expect(d.links?.map((l) => l.id)).toEqual(['run']);
    expect(d.payload).toMatchObject({ executionId: 'exec-1', seenStatus: 'open' });
  });

  it('offers only the lifecycle steps valid from its status', () => {
    expect(incidentToDecision(incidentRow({ status: 'open' }), copy).branches.map((b) => b.id)).toEqual([
      'acknowledge',
      'start',
    ]);
    expect(
      incidentToDecision(incidentRow({ status: 'acknowledged' }), copy).branches.map((b) => b.id),
    ).toEqual(['start']);
    expect(incidentToDecision(incidentRow({ status: 'in_progress' }), copy).branches).toEqual([]);
  });

  it('drops to tier 2 at medium severity and renders JSON detail as evidence', () => {
    const d = incidentToDecision(
      incidentRow({ severity: 'medium', detail: '{"code":500}', executionId: null }),
      copy,
    );
    expect(decisionTier(d)).toBe(2);
    expect(d.evidence).toContain('"code": 500');
    expect(d.links).toBeUndefined();
  });
});

describe('reportToDecision', () => {
  it('is a tier-3 report carrying its document', () => {
    const d = reportToDecision(reportRow(), { name: 'Scout' }, copy);
    expect(d.kind).toBe('report');
    expect(chipOf(d.kind)).toBe('reports');
    expect(modalTypeOf(d.kind)).toBe('report');
    expect(decisionTier(d)).toBe(3);
    expect(d.document).toEqual({ format: 'markdown', content: '# Digest\n\nAll good.', mediaScope: 'rep-1' });
    expect(d.branches.map((b) => b.id)).toEqual(['chat']);
  });

  it('maps html content to an html document and never into the markdown body', () => {
    const d = reportToDecision(reportRow({ content_type: 'html', content: '<p>hi</p>' }), null, copy);
    expect(d.document?.format).toBe('html');
    expect(d.body).toBe('');
  });

  it('weighs priority critical > high > normal > low, and names untitled reports', () => {
    const w = (priority: string) => reportToDecision(reportRow({ priority }), null, copy).weight;
    expect(w('critical')).toBeGreaterThan(w('high'));
    expect(w('high')).toBeGreaterThan(w('normal'));
    expect(w('normal')).toBeGreaterThan(w('low'));
    const untitled = reportToDecision(reportRow({ title: null }), { name: 'Scout' }, copy);
    expect(untitled.title).toBe('Report from Scout');
  });
});

describe('councilToDecision', () => {
  it('is a council on its own chip with the run summary as its document', () => {
    const d = councilToDecision(councilSubject(), councilDetail(), copy);
    expect(d.kind).toBe('council');
    expect(chipOf(d.kind)).toBe('council');
    expect(modalTypeOf(d.kind)).toBe('report');
    expect(decisionTier(d)).toBe(2);
    expect(d.document).toMatchObject({
      format: 'markdown',
      content: 'The council found the design sound.',
      mediaScope: 'run-2',
    });
    expect(d.payload).toMatchObject({
      runId: 'run-2',
      sawDigest: 'digest-2',
      isLatest: 'true',
      reasonMin: String(COUNCIL_MIN_REASON),
    });
  });

  it('demands free text on reject and exposes the minimum', () => {
    const prompt = councilToDecision(councilSubject(), councilDetail(), copy).reasonPrompts?.[0];
    expect(prompt).toMatchObject({ on: 'reject', freeText: true, options: [] });
    expect(COUNCIL_MIN_REASON).toBe(12);
  });

  it('still deals a subject whose run failed to load — without a digest', () => {
    const d = councilToDecision(councilSubject(), null, copy);
    expect(d.payload?.sawDigest).toBeUndefined();
    expect(d.payload?.runId).toBe('run-2');
    expect(d.document?.content).toBe(copy.councilNoSummary);
  });
});

describe('approvalToDecision', () => {
  it('is a tier-1 approval on the gates chip, tagged when low risk', () => {
    const d = approvalToDecision(approvalRow(), 'low', copy);
    expect(d.kind).toBe('approval');
    expect(chipOf(d.kind)).toBe('gates');
    expect(modalTypeOf(d.kind)).toBe('approval');
    expect(decisionTier(d)).toBe(1);
    expect(d.tags.map((t) => t.id)).toEqual(['risk']);
    expect(d.evidence).toContain('"fact": "tz=CET"');
    expect(approvalToDecision(approvalRow(), 'elevated', copy).tags).toEqual([]);
  });
});
