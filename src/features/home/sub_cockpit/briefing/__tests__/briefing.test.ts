import { describe, expect, it } from 'vitest';

import type { SessionDelta } from '@/api/companion/briefing';

import { actionNeedsConfirm, parseWidgetActions } from '../actionTypes';
import {
  buildSessionDelta,
  composeFallbackBriefing,
  composeQuietBriefing,
  deltaIsTrivial,
  type BriefingLabels,
} from '../sessionDelta';

const labels: BriefingLabels = {
  title: 'Morning briefing',
  calloutTitle: 'While you were away',
  quietTitle: 'Quiet night',
  quietBody: 'Nothing needs you.',
  stat: {
    runs: 'Runs',
    failed: 'Failed',
    alerts: 'Alerts',
    approvals: 'Approvals waiting',
    incidents: 'Open incidents',
  },
  attentionTitle: 'Failing personas',
  failedSublabel: (count) => `${count} failed`,
  approvalTitle: 'Waiting on you',
  approvalHeadline: 'A proposal is waiting',
  actions: { rerun: 'Rerun', pause: 'Pause', approve: 'Approve', decline: 'Decline' },
};

function emptyDelta(): SessionDelta {
  return {
    since: new Date(0).toISOString(),
    runs: 0,
    failedRuns: 0,
    alerts: 0,
    approvalsWaiting: 0,
    openIncidents: 0,
    failedPersonas: [],
    alertSummaries: [],
    pendingApprovals: [],
  };
}

describe('parseWidgetActions', () => {
  it('keeps valid enum actions and preserves labels', () => {
    const out = parseWidgetActions([
      { kind: 'rerun_persona', personaId: 'p1', label: 'Rerun Alpha' },
      { kind: 'approve_approval', approvalId: 'a1' },
    ]);
    expect(out).toEqual([
      { kind: 'rerun_persona', personaId: 'p1', label: 'Rerun Alpha' },
      { kind: 'approve_approval', approvalId: 'a1', label: undefined },
    ]);
  });

  it('drops unknown kinds, missing targets, and non-objects', () => {
    const out = parseWidgetActions([
      { kind: 'delete_everything', personaId: 'p1' },
      { kind: 'rerun_persona' },
      { kind: 'pause_persona', personaId: '' },
      'nonsense',
      null,
      42,
    ]);
    expect(out).toEqual([]);
  });

  it('returns empty for non-array input and caps at 3', () => {
    expect(parseWidgetActions(undefined)).toEqual([]);
    expect(parseWidgetActions({ kind: 'rerun_persona' })).toEqual([]);
    const many = Array.from({ length: 6 }, (_, i) => ({
      kind: 'rerun_persona',
      personaId: `p${i}`,
    }));
    expect(parseWidgetActions(many)).toHaveLength(3);
  });

  it('requires confirm only for spendy/destructive kinds', () => {
    expect(actionNeedsConfirm('rerun_persona')).toBe(true);
    expect(actionNeedsConfirm('pause_persona')).toBe(true);
    expect(actionNeedsConfirm('approve_approval')).toBe(false);
    expect(actionNeedsConfirm('decline_approval')).toBe(false);
  });
});

describe('buildSessionDelta', () => {
  const anchor = Date.parse('2026-07-30T06:00:00Z');

  it('counts only activity after the anchor and aggregates failures per persona', () => {
    const delta = buildSessionDelta({
      lastSeen: anchor,
      runs: [
        { persona_id: 'p1', status: 'failed', created_at: '2026-07-30T07:00:00Z' },
        { persona_id: 'p1', status: 'failed', created_at: '2026-07-30T08:00:00Z' },
        { persona_id: 'p2', status: 'completed', created_at: '2026-07-30T07:30:00Z' },
        // Before the anchor — must not count.
        { persona_id: 'p3', status: 'failed', created_at: '2026-07-30T05:00:00Z' },
        // Unparseable — skipped.
        { persona_id: 'p4', status: 'failed', created_at: 'not-a-date' },
      ],
      alerts: [
        {
          id: 'al1',
          rule_id: 'r1',
          rule_name: 'Error rate',
          metric: 'error_rate',
          severity: 'warning',
          message: 'above threshold',
          value: 1,
          threshold: 0.5,
          persona_id: 'p1',
          fired_at: '2026-07-30T07:15:00Z',
          dismissed: false,
        } as never,
        {
          id: 'al2',
          rule_id: 'r2',
          rule_name: 'Old alert',
          metric: 'error_rate',
          severity: 'warning',
          message: 'old',
          value: 1,
          threshold: 0.5,
          persona_id: null,
          fired_at: '2026-07-29T07:15:00Z',
          dismissed: false,
        } as never,
      ],
      approvals: [
        {
          id: 'ap1',
          action: 'run_persona',
          rationale: 'retry the sync',
          paramsJson: '{}',
          humanReviewId: null,
          createdAt: '2026-07-30T07:00:00Z',
        },
      ],
      personas: [
        { id: 'p1', name: 'Alpha', enabled: true } as never,
        { id: 'p2', name: 'Beta', enabled: false } as never,
      ],
      openIncidents: 2,
    });

    expect(delta.runs).toBe(3);
    expect(delta.failedRuns).toBe(2);
    expect(delta.alerts).toBe(1);
    expect(delta.approvalsWaiting).toBe(1);
    expect(delta.openIncidents).toBe(2);
    expect(delta.failedPersonas).toEqual([
      { id: 'p1', name: 'Alpha', failedCount: 2, enabled: true },
    ]);
    expect(delta.alertSummaries).toEqual([
      { ruleName: 'Error rate', severity: 'warning', message: 'above threshold', personaId: 'p1' },
    ]);
    expect(delta.pendingApprovals).toEqual([
      { id: 'ap1', action: 'run_persona', rationale: 'retry the sync' },
    ]);
  });

  it('gates: trivial when nothing happened, even with open incidents', () => {
    const d = emptyDelta();
    d.openIncidents = 3;
    expect(deltaIsTrivial(d)).toBe(true);
    expect(deltaIsTrivial({ ...d, failedRuns: 1, runs: 1 })).toBe(false);
    expect(deltaIsTrivial({ ...d, approvalsWaiting: 1 })).toBe(false);
  });
});

describe('deterministic compositions', () => {
  it('quiet briefing is a single honest callout', () => {
    const spec = composeQuietBriefing(labels);
    expect(spec.widgets).toHaveLength(1);
    expect(spec.widgets[0].kind).toBe('text_callout');
    expect(spec.widgets[0].config?.body).toBe('Nothing needs you.');
    expect(spec.widgets[0].actions).toBeUndefined();
  });

  it('fallback carries stats, failing personas with actions, and the approval verdict', () => {
    const delta: SessionDelta = {
      ...emptyDelta(),
      runs: 5,
      failedRuns: 2,
      alerts: 1,
      approvalsWaiting: 1,
      failedPersonas: [{ id: 'p1', name: 'Alpha', failedCount: 2, enabled: true }],
      pendingApprovals: [{ id: 'ap1', action: 'run_persona', rationale: 'why' }],
    };
    const spec = composeFallbackBriefing(delta, labels);
    const kinds = spec.widgets.map((w) => w.kind);
    expect(kinds).toEqual(['stat_grid', 'issue_list', 'verdict']);

    const issue = spec.widgets[1];
    expect(parseWidgetActions(issue.actions)).toEqual([
      { kind: 'rerun_persona', personaId: 'p1', label: 'Rerun · Alpha' },
      { kind: 'pause_persona', personaId: 'p1', label: 'Pause · Alpha' },
    ]);

    const verdict = spec.widgets[2];
    expect(parseWidgetActions(verdict.actions)).toEqual([
      { kind: 'approve_approval', approvalId: 'ap1', label: 'Approve' },
      { kind: 'decline_approval', approvalId: 'ap1', label: 'Decline' },
    ]);
  });

  it('fallback omits pause for an already-paused persona and skips empty sections', () => {
    const delta: SessionDelta = {
      ...emptyDelta(),
      runs: 1,
      failedRuns: 1,
      failedPersonas: [{ id: 'p1', name: 'Alpha', failedCount: 1, enabled: false }],
    };
    const spec = composeFallbackBriefing(delta, labels);
    expect(spec.widgets.map((w) => w.kind)).toEqual(['stat_grid', 'issue_list']);
    expect(parseWidgetActions(spec.widgets[1].actions)).toEqual([
      { kind: 'rerun_persona', personaId: 'p1', label: 'Rerun · Alpha' },
    ]);
  });
});
