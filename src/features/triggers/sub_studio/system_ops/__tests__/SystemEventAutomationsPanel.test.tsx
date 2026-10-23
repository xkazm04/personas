import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SystemOpAutomation } from '@/api/systemOps';
import { SystemEventAutomationsPanel } from '../SystemEventAutomationsPanel';

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (select: (s: { projects: never[] }) => unknown) => select({ projects: [] }),
}));

function automation(lastStatus: string | null): SystemOpAutomation {
  return {
    id: 'a1', opKind: 'health_ingest', paramsJson: '{}', triggerKind: 'schedule',
    cron: '0 * * * *', timezone: null, listenEventType: null, sourceFilter: null,
    enabled: true, nextRunAt: null, lastRunAt: '2026-10-20T10:00:00Z', lastStatus,
    lastDetail: null,
  } as SystemOpAutomation;
}

function renderRow(lastStatus: string | null) {
  render(
    <SystemEventAutomationsPanel
      automations={[automation(lastStatus)]}
      onToggle={vi.fn()} onRun={vi.fn()} onDelete={vi.fn()}
    />,
  );
}

describe('SystemEventAutomationsPanel last-run label', () => {
  it.each([
    ['ok', /^ran\b/],
    ['failed', /^failed\b/],
    ['requested', /^requested\b/],
    ['partial', /^partly ran\b/],
    ['held', /^held for approval\b/],
  ])('reads %s truthfully', async (status, expected) => {
    renderRow(status);
    expect(await screen.findByText(expected)).toBeTruthy();
  });
});
