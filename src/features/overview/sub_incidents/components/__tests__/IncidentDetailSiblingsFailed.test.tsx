import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { en } from '@/i18n/en';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';

vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: vi.fn((cmd: string) =>
    cmd === 'list_audit_incidents'
      ? Promise.reject({ error: 'database is locked', kind: 'Database' })
      : Promise.resolve(null),
  ),
}));

import { IncidentDetailModal } from '../IncidentDetailModal';

const INCIDENT: AuditIncident = {
  id: 'inc-1', sourceTable: 'fired_alerts', sourceId: 's1', dedupKey: 'fired_alerts:s1',
  personaId: 'p1', personaName: 'Agent', executionId: null, severity: 'high', kind: 'alert',
  title: 'Latency alert', detail: null, status: 'resolved', acknowledgedAt: null, acknowledgedBy: null,
  resolvedAt: null, resolutionNote: null, continuedAt: null, createdAt: '2026-10-19T12:00:00.000Z',
};

describe('IncidentDetailModal sibling list', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['overview']);
  });

  it('a failed sibling read is reported, not shown as "no other open incidents"', async () => {
    render(<IncidentDetailModal incident={INCIDENT} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(en.overview.incidents.load_failed)).toBeTruthy());
    expect(screen.queryByText(en.overview.incidents.siblings_none)).toBeNull();
  });
});
