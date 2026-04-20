/**
 * Unit tests for the Simple-mode inbox normalization layer.
 *
 * Covers:
 *  - normalizeSeverity() parametric cases
 *  - each adapter's output shape
 *  - useUnifiedInbox() merge / filter / sort / cap behavior
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

import type { PersonaMessage } from '@/lib/bindings/PersonaMessage';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';
import type { Persona } from '@/lib/bindings/Persona';
import type { ManualReviewItem } from '@/lib/types/types';
import { useAgentStore } from '@/stores/agentStore';
import { useOverviewStore } from '@/stores/overviewStore';

import { normalizeSeverity } from '../types';
import { adaptApproval, adaptMessage, adaptHealing } from './adapters';
import { useUnifiedInbox } from './useUnifiedInbox';

// ---------------------------------------------------------------------------
// Fixture factories -- minimal records containing only the fields the
// adapters/hook read. Cast-through-unknown keeps the rest of each record
// undefined without TypeScript errors; the production hook never touches
// those fields.
// ---------------------------------------------------------------------------

const PERSONA_SUMMARY = {
  personaName: 'Weather Bot',
  personaIcon: '🌦',
  personaColor: '#abcdef',
};

function approvalRecord(o: Partial<ManualReviewItem> = {}): ManualReviewItem {
  return {
    id: 'rev-1',
    persona_id: 'p-1',
    execution_id: 'exec-1',
    review_type: 'build_output',
    content: 'Body of the approval',
    severity: 'warning',
    status: 'pending',
    reviewer_notes: null,
    context_data: null,
    suggested_actions: null,
    title: 'Approve deployment?',
    created_at: '2026-04-20T10:00:00.000Z',
    resolved_at: null,
    source: 'local',
    persona_name: 'Weather Bot',
    persona_icon: '🌦',
    persona_color: '#abcdef',
    ...o,
  } as ManualReviewItem;
}

function messageRecord(o: Partial<PersonaMessage> = {}): PersonaMessage {
  return {
    id: 'msg-1',
    persona_id: 'p-1',
    execution_id: 'exec-1',
    title: 'Hello there',
    content: 'Message body',
    content_type: 'text',
    priority: 'normal',
    is_read: false,
    metadata: null,
    created_at: '2026-04-20T11:00:00.000Z',
    read_at: null,
    thread_id: null,
    use_case_id: null,
    ...o,
  };
}

function healingRecord(o: Partial<PersonaHealingIssue> = {}): PersonaHealingIssue {
  return {
    id: 'heal-1',
    persona_id: 'p-1',
    execution_id: null,
    title: 'Disk nearly full',
    description: 'Cleanup old logs',
    is_circuit_breaker: false,
    severity: 'critical',
    category: 'infra',
    suggested_fix: 'Delete logs older than 7 days',
    auto_fixed: false,
    status: 'open',
    created_at: '2026-04-20T09:00:00.000Z',
    resolved_at: null,
    ...o,
  };
}

function personaRecord(o: Partial<Persona> = {}): Persona {
  return {
    id: 'p-1',
    name: 'Weather Bot',
    icon: '🌦',
    color: '#abcdef',
    // The rest of the Persona shape is irrelevant for the inbox hook.
    // Cast through unknown to keep the fixture tight.
    ...o,
  } as unknown as Persona;
}

// ---------------------------------------------------------------------------
// normalizeSeverity
// ---------------------------------------------------------------------------

describe('normalizeSeverity', () => {
  const cases: Array<[string | null | undefined, 'critical' | 'warning' | 'info']> = [
    ['critical', 'critical'],
    ['CRITICAL', 'critical'],
    ['error', 'critical'],
    ['ERROR', 'critical'],
    ['fatal', 'critical'],
    ['warning', 'warning'],
    ['WARN', 'warning'],
    ['warn', 'warning'],
    ['high', 'warning'],
    ['info', 'info'],
    ['INFO', 'info'],
    ['debug', 'info'],
    ['unknown', 'info'],
    ['', 'info'],
    [null, 'info'],
    [undefined, 'info'],
  ];

  it.each(cases)('maps %p -> %p', (input, expected) => {
    expect(normalizeSeverity(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// adaptApproval
// ---------------------------------------------------------------------------

describe('adaptApproval', () => {
  it('produces a kind=approval item with id prefix and mapped fields', () => {
    const out = adaptApproval(approvalRecord(), PERSONA_SUMMARY);
    expect(out.kind).toBe('approval');
    expect(out.id).toBe('approval:rev-1');
    expect(out.source).toBe('rev-1');
    expect(out.personaId).toBe('p-1');
    expect(out.personaName).toBe('Weather Bot');
    expect(out.severity).toBe('warning');
    expect(out.title).toBe('Approve deployment?');
    expect(out.body).toBe('Body of the approval');
    expect(out.data.executionId).toBe('exec-1');
    expect(out.data.reviewType).toBe('build_output');
    expect(out.data.origin).toBe('local');
  });

  it('normalizes severity=critical raw strings', () => {
    const out = adaptApproval(approvalRecord({ severity: 'fatal' }), PERSONA_SUMMARY);
    expect(out.severity).toBe('critical');
  });

  it('defaults origin to local when source is undefined', () => {
    const out = adaptApproval(approvalRecord({ source: undefined }), PERSONA_SUMMARY);
    expect(out.data.origin).toBe('local');
  });

  it('preserves origin=cloud when source is cloud', () => {
    const out = adaptApproval(approvalRecord({ source: 'cloud' }), PERSONA_SUMMARY);
    expect(out.data.origin).toBe('cloud');
  });
});

// ---------------------------------------------------------------------------
// adaptMessage
// ---------------------------------------------------------------------------

describe('adaptMessage', () => {
  it('produces a kind=message item with id prefix', () => {
    const out = adaptMessage(messageRecord(), PERSONA_SUMMARY);
    expect(out.kind).toBe('message');
    expect(out.id).toBe('message:msg-1');
    expect(out.source).toBe('msg-1');
    expect(out.title).toBe('Hello there');
    expect(out.body).toBe('Message body');
    expect(out.data.priority).toBe('normal');
    expect(out.data.contentType).toBe('text');
  });

  it('maps priority=high -> severity=warning', () => {
    const out = adaptMessage(messageRecord({ priority: 'high' }), PERSONA_SUMMARY);
    expect(out.severity).toBe('warning');
  });

  it('maps priority=normal -> severity=info', () => {
    const out = adaptMessage(messageRecord({ priority: 'normal' }), PERSONA_SUMMARY);
    expect(out.severity).toBe('info');
  });

  it('maps priority=low -> severity=info', () => {
    const out = adaptMessage(messageRecord({ priority: 'low' }), PERSONA_SUMMARY);
    expect(out.severity).toBe('info');
  });

  it('falls back to personaName-based title when msg.title is null', () => {
    const out = adaptMessage(messageRecord({ title: null }), PERSONA_SUMMARY);
    expect(out.title).toBe('Weather Bot sent you a message');
  });
});

// ---------------------------------------------------------------------------
// adaptHealing
// ---------------------------------------------------------------------------

describe('adaptHealing', () => {
  it('produces a kind=health item with id prefix and category payload', () => {
    const out = adaptHealing(healingRecord(), PERSONA_SUMMARY);
    expect(out.kind).toBe('health');
    expect(out.id).toBe('health:heal-1');
    expect(out.source).toBe('heal-1');
    expect(out.severity).toBe('critical');
    expect(out.title).toBe('Disk nearly full');
    expect(out.body).toBe('Cleanup old logs');
    expect(out.data.category).toBe('infra');
    expect(out.data.suggestedFix).toBe('Delete logs older than 7 days');
    expect(out.data.isCircuitBreaker).toBe(false);
  });

  it('normalizes severity=warning for raw "warn"', () => {
    const out = adaptHealing(healingRecord({ severity: 'warn' }), PERSONA_SUMMARY);
    expect(out.severity).toBe('warning');
  });
});

// ---------------------------------------------------------------------------
// useUnifiedInbox
// ---------------------------------------------------------------------------

describe('useUnifiedInbox', () => {
  beforeEach(() => {
    useOverviewStore.setState({
      manualReviews: [],
      messages: [],
      healingIssues: [],
    });
    useAgentStore.setState({ personas: [personaRecord()] });
  });

  it('returns an empty array when all three sources are empty', () => {
    const { result } = renderHook(() => useUnifiedInbox());
    expect(result.current).toEqual([]);
  });

  it('merges three sources into one array (approvals + messages + healing)', () => {
    useOverviewStore.setState({
      manualReviews: [approvalRecord({ id: 'rev-1' })],
      messages: [messageRecord({ id: 'msg-1' })],
      healingIssues: [healingRecord({ id: 'heal-1' })],
    });
    const { result } = renderHook(() => useUnifiedInbox());
    expect(result.current).toHaveLength(3);
    const kinds = result.current.map((x) => x.kind).sort();
    expect(kinds).toEqual(['approval', 'health', 'message']);
  });

  it('filters out non-pending approvals', () => {
    useOverviewStore.setState({
      manualReviews: [
        approvalRecord({ id: 'rev-pending', status: 'pending' }),
        approvalRecord({ id: 'rev-approved', status: 'approved' }),
        approvalRecord({ id: 'rev-rejected', status: 'rejected' }),
      ],
    });
    const { result } = renderHook(() => useUnifiedInbox());
    expect(result.current).toHaveLength(1);
    expect(result.current[0]?.source).toBe('rev-pending');
  });

  it('filters out read messages', () => {
    useOverviewStore.setState({
      messages: [
        messageRecord({ id: 'msg-unread', is_read: false }),
        messageRecord({ id: 'msg-read', is_read: true }),
      ],
    });
    const { result } = renderHook(() => useUnifiedInbox());
    expect(result.current).toHaveLength(1);
    expect(result.current[0]?.source).toBe('msg-unread');
  });

  it('filters out resolved and auto-fixed healing issues', () => {
    useOverviewStore.setState({
      healingIssues: [
        healingRecord({ id: 'heal-open', status: 'open', auto_fixed: false }),
        healingRecord({ id: 'heal-resolved', status: 'resolved', auto_fixed: false }),
        healingRecord({ id: 'heal-auto', status: 'open', auto_fixed: true }),
      ],
    });
    const { result } = renderHook(() => useUnifiedInbox());
    expect(result.current).toHaveLength(1);
    expect(result.current[0]?.source).toBe('heal-open');
  });

  it('sorts items newest-first by createdAt', () => {
    useOverviewStore.setState({
      manualReviews: [approvalRecord({ id: 'old', created_at: '2026-04-18T00:00:00.000Z' })],
      messages: [messageRecord({ id: 'mid', created_at: '2026-04-19T00:00:00.000Z' })],
      healingIssues: [healingRecord({ id: 'new', created_at: '2026-04-20T00:00:00.000Z' })],
    });
    const { result } = renderHook(() => useUnifiedInbox());
    expect(result.current.map((x) => x.source)).toEqual(['new', 'mid', 'old']);
  });

  it('caps the merged result at 50 items when given 100', () => {
    // 40 approvals + 40 messages + 20 healing = 100, each with a unique timestamp
    const approvals = Array.from({ length: 40 }, (_, i) =>
      approvalRecord({
        id: `rev-${i}`,
        created_at: `2026-04-01T00:00:${i.toString().padStart(2, '0')}.000Z`,
      }),
    );
    const msgs = Array.from({ length: 40 }, (_, i) =>
      messageRecord({
        id: `msg-${i}`,
        created_at: `2026-04-02T00:00:${i.toString().padStart(2, '0')}.000Z`,
      }),
    );
    const healing = Array.from({ length: 20 }, (_, i) =>
      healingRecord({
        id: `heal-${i}`,
        created_at: `2026-04-03T00:00:${i.toString().padStart(2, '0')}.000Z`,
      }),
    );
    useOverviewStore.setState({
      manualReviews: approvals,
      messages: msgs,
      healingIssues: healing,
    });
    const { result } = renderHook(() => useUnifiedInbox());
    expect(result.current).toHaveLength(50);
    // Newest 50 should all be from the healing (newest day) + top messages.
    // The 20 newest must all be healing items (all dated 2026-04-03).
    const top20Kinds = result.current.slice(0, 20).map((x) => x.kind);
    expect(top20Kinds.every((k) => k === 'health')).toBe(true);
  });

  it('resolves persona name/icon/color from the agent store', () => {
    useAgentStore.setState({
      personas: [personaRecord({ id: 'p-1', name: 'Storm Caller', icon: '⚡', color: '#ff0000' })],
    });
    useOverviewStore.setState({
      manualReviews: [approvalRecord({ persona_id: 'p-1' })],
    });
    const { result } = renderHook(() => useUnifiedInbox());
    expect(result.current[0]?.personaName).toBe('Storm Caller');
    expect(result.current[0]?.personaIcon).toBe('⚡');
    expect(result.current[0]?.personaColor).toBe('#ff0000');
  });

  it('falls back to "Unknown assistant" when persona is missing', () => {
    useAgentStore.setState({ personas: [] });
    useOverviewStore.setState({
      manualReviews: [approvalRecord({ persona_id: 'p-missing' })],
    });
    const { result } = renderHook(() => useUnifiedInbox());
    expect(result.current[0]?.personaName).toBe('Unknown assistant');
    expect(result.current[0]?.personaIcon).toBeNull();
    expect(result.current[0]?.personaColor).toBeNull();
  });
});
