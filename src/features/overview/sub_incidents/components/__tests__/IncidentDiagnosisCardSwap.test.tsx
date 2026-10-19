import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { en } from '@/i18n/en';

let resolveRun: (value: unknown) => void = () => {};

vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: vi.fn((cmd: string) =>
    cmd === 'diagnose_audit_incident'
      ? new Promise((r) => { resolveRun = r; })
      : Promise.resolve(null),
  ),
}));

import { IncidentDiagnosisCard } from '../IncidentDiagnosisCard';

describe('IncidentDiagnosisCard incident swap', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['overview']);
  });

  it("a diagnosis started on one incident never lands on the next", async () => {
    const { rerender } = render(<IncidentDiagnosisCard incidentId="inc-a" />);
    const run = await screen.findByRole('button', { name: en.overview.incidents.noc_diagnose_action });
    fireEvent.click(run);
    rerender(<IncidentDiagnosisCard incidentId="inc-b" />);
    await screen.findByText(en.overview.incidents.noc_no_diagnosis);
    await act(async () => {
      resolveRun({
        id: 'd1', incidentId: 'inc-a', summary: 'Root cause of A', evidence: [], proposedAction: null,
        proposedRationale: null, approvalId: null, confidence: 0.9, diagnosedAt: new Date().toISOString(),
      });
    });
    await waitFor(() => expect(screen.queryByText('Root cause of A')).toBeNull());
    expect(screen.getByText(en.overview.incidents.noc_no_diagnosis)).toBeTruthy();
  });
});
