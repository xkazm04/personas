/**
 * Unit tests for `useSimpleSummary` — the Phase 07 summary selector that
 * feeds the Mosaic (and later Console/Inbox) header stats.
 *
 * Seeding strategy: we call `setState` on each store directly rather than
 * using the real async actions. This isolates the selector from IPC / network
 * and keeps the tests deterministic. `vi.useFakeTimers` + `vi.setSystemTime`
 * pin the clock so `greetingKind` is predictable.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import type { Persona } from '@/lib/bindings/Persona';
import type { AuthUser } from '@/lib/bindings/AuthUser';
import type { CredentialMetadata } from '@/lib/types/types';
import type { ExecutionDashboardData } from '@/lib/bindings/ExecutionDashboardData';
import type { DashboardDailyPoint } from '@/lib/bindings/DashboardDailyPoint';
import type { ManualReviewItem } from '@/lib/types/types';
import type { PersonaMessage } from '@/lib/bindings/PersonaMessage';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';

import { useAgentStore } from '@/stores/agentStore';
import { useAuthStore } from '@/stores/authStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useVaultStore } from '@/stores/vaultStore';

import { useSimpleSummary } from './useSimpleSummary';

// ---------------------------------------------------------------------------
// Fixture factories. Each one narrows the backend-generated shape to the few
// fields `useSimpleSummary` actually reads; the rest is filled with harmless
// defaults via cast-through-unknown.
// ---------------------------------------------------------------------------

function personaRecord(o: Partial<Persona> = {}): Persona {
  return {
    id: 'p-1',
    name: 'Weather Bot',
    icon: '🌦',
    color: '#abcdef',
    description: null,
    enabled: true,
    ...o,
  } as unknown as Persona;
}

function credentialRecord(o: Partial<CredentialMetadata> = {}): CredentialMetadata {
  return {
    id: 'c-1',
    name: 'Gmail',
    service_type: 'gmail',
    metadata: null,
    healthcheck_last_success: true,
    healthcheck_last_message: null,
    healthcheck_last_tested_at: null,
    healthcheck_last_success_at: null,
    oauth_refresh_count: 0,
    oauth_last_refresh_at: null,
    oauth_token_expires_at: null,
    usage_count: 0,
    last_used_at: null,
    created_at: '2026-04-20T00:00:00.000Z',
    updated_at: '2026-04-20T00:00:00.000Z',
    ...o,
  };
}

function dailyPoint(o: Partial<DashboardDailyPoint> = {}): DashboardDailyPoint {
  return {
    date: '2026-04-20',
    total_cost: 0,
    total_executions: 0,
    completed: 0,
    failed: 0,
    success_rate: 0,
    p50_duration_ms: 0,
    p95_duration_ms: 0,
    p99_duration_ms: 0,
    total_tokens: 0,
    persona_costs: [],
    ...o,
  };
}

function dashboard(points: DashboardDailyPoint[] = []): ExecutionDashboardData {
  return {
    daily_points: points,
    top_personas: [],
    cost_anomalies: [],
    total_executions: 0,
    successful_executions: 0,
    failed_executions: 0,
    total_cost: 0,
    overall_success_rate: 0,
    avg_latency_ms: 0,
    active_personas: 0,
    projected_monthly_cost: null,
    burn_rate: null,
  };
}

function approvalRecord(o: Partial<ManualReviewItem> = {}): ManualReviewItem {
  return {
    id: 'rev-1',
    persona_id: 'p-1',
    execution_id: 'exec-1',
    review_type: 'build_output',
    content: 'Approval body',
    severity: 'warning',
    status: 'pending',
    reviewer_notes: null,
    context_data: null,
    suggested_actions: null,
    title: 'Approve?',
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
    title: 'Hello',
    content: 'Body',
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
    title: 'Disk full',
    description: 'Cleanup logs',
    is_circuit_breaker: false,
    severity: 'critical',
    category: 'infra',
    suggested_fix: null,
    auto_fixed: false,
    status: 'open',
    created_at: '2026-04-20T09:00:00.000Z',
    resolved_at: null,
    ...o,
  };
}

/**
 * Reset every store the hook depends on so each test starts from a clean
 * slate. Run inside `beforeEach`.
 */
function resetStores() {
  useAgentStore.setState({ personas: [] });
  useVaultStore.setState({ credentials: [] });
  useOverviewStore.setState({
    executionDashboard: null,
    manualReviews: [],
    messages: [],
    healingIssues: [],
  });
  useAuthStore.setState({ user: null });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSimpleSummary', () => {
  beforeEach(() => {
    resetStores();
    // Pin clock to 10:00 local so greetingKind === 'morning' by default.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 20, 10, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns all-zero counters and null name on fresh stores', () => {
    const { result } = renderHook(() => useSimpleSummary());
    expect(result.current).toEqual({
      greetingName: null,
      greetingKind: 'morning',
      runsToday: 0,
      activePersonaCount: 0,
      totalPersonaCount: 0,
      connectedOk: 0,
      connectedTotal: 0,
      needsMeCount: 0,
      inboxCount: 0,
      isHydrated: true,
    });
  });

  it('derives greetingKind buckets from the current hour', () => {
    // morning: 10:00 already covered above. Test afternoon + evening here.
    vi.setSystemTime(new Date(2026, 3, 20, 14, 0, 0));
    const a = renderHook(() => useSimpleSummary());
    expect(a.result.current.greetingKind).toBe('afternoon');

    vi.setSystemTime(new Date(2026, 3, 20, 20, 0, 0));
    const e = renderHook(() => useSimpleSummary());
    expect(e.result.current.greetingKind).toBe('evening');

    vi.setSystemTime(new Date(2026, 3, 20, 0, 0, 0));
    const m = renderHook(() => useSimpleSummary());
    expect(m.result.current.greetingKind).toBe('morning');
  });

  it('uses display_name when the user has one', () => {
    useAuthStore.setState({
      user: {
        id: 'u-1',
        email: 'klara@example.com',
        display_name: 'Klára',
        avatar_url: null,
      } as AuthUser,
    });
    const { result } = renderHook(() => useSimpleSummary());
    expect(result.current.greetingName).toBe('Klára');
  });

  it('falls back to email local-part when display_name is null', () => {
    useAuthStore.setState({
      user: {
        id: 'u-1',
        email: 'alex@example.com',
        display_name: null,
        avatar_url: null,
      } as AuthUser,
    });
    const { result } = renderHook(() => useSimpleSummary());
    expect(result.current.greetingName).toBe('alex');
  });

  it('counts active vs total personas correctly with a mix of enabled flags', () => {
    useAgentStore.setState({
      personas: [
        personaRecord({ id: 'p-a', enabled: true }),
        personaRecord({ id: 'p-b', enabled: true }),
        personaRecord({ id: 'p-c', enabled: false }),
      ],
    });
    const { result } = renderHook(() => useSimpleSummary());
    expect(result.current.totalPersonaCount).toBe(3);
    expect(result.current.activePersonaCount).toBe(2);
  });

  it('counts only strictly-ok credentials (null/false are NOT connected)', () => {
    useVaultStore.setState({
      credentials: [
        credentialRecord({ id: 'c-a', healthcheck_last_success: true }),
        credentialRecord({ id: 'c-b', healthcheck_last_success: true }),
        credentialRecord({ id: 'c-c', healthcheck_last_success: true }),
        credentialRecord({ id: 'c-d', healthcheck_last_success: false }),
        credentialRecord({ id: 'c-e', healthcheck_last_success: null }),
      ],
    });
    const { result } = renderHook(() => useSimpleSummary());
    expect(result.current.connectedTotal).toBe(5);
    expect(result.current.connectedOk).toBe(3);
  });

  it('reads runsToday from the last daily_points bucket', () => {
    useOverviewStore.setState({
      executionDashboard: dashboard([
        dailyPoint({ date: '2026-04-19', total_executions: 7 }),
        dailyPoint({ date: '2026-04-20', total_executions: 14 }),
      ]),
    });
    const { result } = renderHook(() => useSimpleSummary());
    expect(result.current.runsToday).toBe(14);
  });

  it('falls back to 0 when executionDashboard is null', () => {
    useOverviewStore.setState({ executionDashboard: null });
    const { result } = renderHook(() => useSimpleSummary());
    expect(result.current.runsToday).toBe(0);
  });

  it('falls back to 0 when daily_points is empty', () => {
    useOverviewStore.setState({ executionDashboard: dashboard([]) });
    const { result } = renderHook(() => useSimpleSummary());
    expect(result.current.runsToday).toBe(0);
  });

  it('counts needsMe as approvals + critical items (not double-counted)', () => {
    useAgentStore.setState({ personas: [personaRecord()] });
    useOverviewStore.setState({
      manualReviews: [approvalRecord({ id: 'rev-a', severity: 'warning' })],
      messages: [messageRecord({ id: 'msg-info', priority: 'normal', is_read: false })],
      healingIssues: [
        healingRecord({ id: 'heal-crit', severity: 'critical', status: 'open', auto_fixed: false }),
      ],
    });
    const { result } = renderHook(() => useSimpleSummary());
    // 1 approval + 1 critical-healing + 1 info-message =
    //   inboxCount = 3, needsMe = 2 (approval + critical)
    expect(result.current.inboxCount).toBe(3);
    expect(result.current.needsMeCount).toBe(2);
  });

  it('does not crash when source stores are transiently undefined (pre-hydration)', () => {
    // Simulate the first-paint race where a Zustand slice has not yet run its
    // initializer: the hook must fall back to empty arrays instead of calling
    // `.filter` on `undefined`, and must signal `isHydrated: false` so the
    // variant renders its skeleton/empty state.
    useAgentStore.setState({ personas: undefined as unknown as never });
    useVaultStore.setState({ credentials: undefined as unknown as never });
    const { result } = renderHook(() => useSimpleSummary());
    expect(result.current.inboxCount).toBe(0);
    expect(result.current.activePersonaCount).toBe(0);
    expect(result.current.totalPersonaCount).toBe(0);
    expect(result.current.connectedOk).toBe(0);
    expect(result.current.connectedTotal).toBe(0);
    expect(result.current.isHydrated).toBe(false);
  });

  it('does not double-count a critical approval toward needsMe', () => {
    useAgentStore.setState({ personas: [personaRecord()] });
    useOverviewStore.setState({
      manualReviews: [approvalRecord({ id: 'rev-crit', severity: 'critical' })],
    });
    const { result } = renderHook(() => useSimpleSummary());
    // Single item is both an approval AND critical; filter uses OR so item
    // passes once. Count must be 1, not 2.
    expect(result.current.inboxCount).toBe(1);
    expect(result.current.needsMeCount).toBe(1);
  });
});
