import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { DevScan } from '@/lib/bindings/DevScan';

// Bypass IPC token wait.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

vi.mock('@/api/devTools/devTools', () => ({ listContexts: vi.fn().mockResolvedValue([]) }));

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));

import { IdeaScanPopover, agentsOfScan } from '../lib/IdeaScanPopover';

function scan(scan_type: string): DevScan {
  return {
    id: 's1', project_id: 'p1', scan_type, status: 'completed', idea_count: 4,
    input_tokens: null, output_tokens: null, duration_ms: null, error: null,
    created_at: '2026-09-16 10:00:00',
  } as unknown as DevScan;
}

const props = {
  projectId: 'p1', name: 'Personas', anchor: { x: 10, y: 10 },
  busy: false, onRun: vi.fn(), onClose: vi.fn(),
};

describe('agentsOfScan', () => {
  it('splits the comma-joined scan_type and drops unknown keys', () => {
    expect([...agentsOfScan(scan('code-optimizer,security-auditor'))].sort())
      .toEqual(['code-optimizer', 'security-auditor']);
    expect([...agentsOfScan(scan('code-optimizer, retired-agent'))]).toEqual(['code-optimizer']);
    expect(agentsOfScan(undefined).size).toBe(0);
  });
});

describe('IdeaScanPopover replays the last scan', () => {
  it('prefills the agent chips and enables Run', async () => {
    render(<IdeaScanPopover {...props} scans={[scan('code-optimizer,security-auditor')]} />);
    await waitFor(() => expect(screen.getByTestId('mm-scan-agent-code-optimizer')).toBeTruthy());

    expect(screen.getByTestId('mm-scan-agent-code-optimizer').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('mm-scan-agent-security-auditor').getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByTestId('mm-scan-run') as HTMLButtonElement).disabled).toBe(false);
  });

  it('runs with exactly the replayed agents', async () => {
    const onRun = vi.fn();
    render(<IdeaScanPopover {...props} onRun={onRun} scans={[scan('code-optimizer')]} />);
    await waitFor(() => expect(screen.getByTestId('mm-scan-run')).toBeTruthy());

    fireEvent.click(screen.getByTestId('mm-scan-run'));
    expect(onRun).toHaveBeenCalledWith({ agentKeys: ['code-optimizer'], contextIds: [], targetCount: null });
  });

  it('a never-scanned project still opens empty with Run disabled', async () => {
    render(<IdeaScanPopover {...props} scans={[]} />);
    await waitFor(() => expect(screen.getByTestId('mm-scan-run')).toBeTruthy());

    expect((screen.getByTestId('mm-scan-run') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('mm-scan-agent-code-optimizer').getAttribute('aria-pressed')).toBe('false');
  });
});
