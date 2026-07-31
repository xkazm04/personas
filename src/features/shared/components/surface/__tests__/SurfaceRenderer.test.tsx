import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// Real English catalog as `t` so every nested component (UnifiedTable,
// MarkdownRenderer, badge) resolves genuine copy without provider plumbing.
vi.mock('@/i18n/useTranslation', async () => {
  const en = (await import('@/i18n/locales/en.json')).default as Record<string, unknown>;
  const tx = (template: string, vars: Record<string, unknown> = {}) =>
    String(template).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
  return {
    useTranslation: () => ({ t: en, tx }),
    getActiveTranslations: () => en,
  };
});

const executePersonaMock = vi.fn().mockResolvedValue('exec-1');

// The consent surfaces themselves are catalog components with their own
// providers; stub them so this test isolates the renderer's GATING logic —
// nothing may run until these surfaces are explicitly confirmed.
vi.mock('@/features/shared/dispatch/DispatchChooser', () => ({
  DispatchChooserModal: ({ request }: { request: { title: string } }) => (
    <div data-testid="dispatch-chooser">{request.title}</div>
  ),
}));
vi.mock('@/features/shared/components/feedback/ConfirmDialog', () => ({
  ConfirmDialog: ({
    title,
    onConfirm,
  }: {
    title: string;
    onConfirm: () => void | Promise<void>;
  }) => (
    <div data-testid="confirm-dialog">
      <span>{title}</span>
      <button type="button" data-testid="confirm-go" onClick={() => void onConfirm()}>
        go
      </button>
    </div>
  ),
}));
vi.mock('@/features/shared/components/terminal/CliOutputPanel', () => ({
  default: ({ lines }: { lines: string[] }) => <pre data-testid="cli-stub">{lines.join('\n')}</pre>,
}));

import { SurfaceRenderer } from '../SurfaceRenderer';
import { parseSurfaceSpec, type SurfaceSpec } from '../surfaceSpec';

function makeSpec(overrides: Partial<Record<string, unknown>> = {}): SurfaceSpec {
  const result = parseSurfaceSpec({
    surface: 'v1',
    title: 'Audit cockpit',
    summary: 'What the run found.',
    blocks: [
      { type: 'stat_row', stats: [{ label: 'Scanned', value: 12, tone: 'info' }] },
      { type: 'markdown', content: 'All findings **verified**.' },
      {
        type: 'decisions',
        items: [
          {
            id: 'd1',
            title: 'Bump left-pad',
            summary: 'Patch available.',
            actions: [
              { id: 'fix', label: 'Dispatch fix', tone: 'accept', kind: 'dispatch', prompt: 'Bump left-pad' },
              { id: 'again', label: 'Re-run audit', tone: 'neutral', kind: 'execute_persona', prompt: 'Audit again' },
            ],
          },
        ],
      },
      { type: 'gauge', label: 'Confidence', value: 82 },
      { type: 'terminal', lines: ['npm audit', 'done'] },
    ],
    ...overrides,
  });
  if (!result.ok) throw new Error('fixture spec invalid');
  return result.spec;
}

const target = { projectId: 'p1', projectName: 'Demo', rootPath: 'C:/repo' };

beforeEach(() => {
  executePersonaMock.mockClear();
});

describe('SurfaceRenderer', () => {
  it('renders every block through the catalog vocabulary with provenance', () => {
    render(<SurfaceRenderer spec={makeSpec()} context={{ personaId: 'per-1', onExecutePersona: executePersonaMock, dispatchTarget: target }} />);
    expect(screen.getByText('Audit cockpit')).toBeTruthy();
    expect(screen.getByText('Agent-composed')).toBeTruthy(); // provenance badge
    expect(screen.getByText('Scanned')).toBeTruthy(); // StatCard
    expect(screen.getByText('verified')).toBeTruthy(); // markdown strong
    expect(screen.getByText('Bump left-pad')).toBeTruthy(); // DecisionRow
    expect(screen.getByText('Confidence')).toBeTruthy(); // gauge
    expect(screen.getByTestId('cli-stub').textContent).toContain('npm audit');
  });

  it('surfaces the repaired-block count honestly', () => {
    render(<SurfaceRenderer spec={makeSpec()} dropped={2} />);
    expect(screen.getByTestId('surface-dropped-note').textContent).toContain('2');
  });

  it('never auto-runs: dispatch opens the chooser only after an explicit click', () => {
    render(<SurfaceRenderer spec={makeSpec()} context={{ personaId: 'per-1', onExecutePersona: executePersonaMock, dispatchTarget: target }} />);
    expect(screen.queryByTestId('dispatch-chooser')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dispatch fix' }));
    expect(screen.getByTestId('dispatch-chooser')).toBeTruthy();
    expect(executePersonaMock).not.toHaveBeenCalled();
  });

  it('disables dispatch actions when the host view has no project target', () => {
    render(<SurfaceRenderer spec={makeSpec()} context={{ personaId: 'per-1', onExecutePersona: executePersonaMock }} />);
    const button = screen.getByRole('button', { name: 'Dispatch fix' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(screen.queryByTestId('dispatch-chooser')).toBeNull();
  });

  it('gates execute_persona behind confirmation, then runs with the prepared input', async () => {
    render(<SurfaceRenderer spec={makeSpec()} context={{ personaId: 'per-1', onExecutePersona: executePersonaMock }} />);
    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Re-run audit' }));
    expect(screen.getByTestId('confirm-dialog')).toBeTruthy();
    expect(executePersonaMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('confirm-go'));
    await vi.waitFor(() => expect(executePersonaMock).toHaveBeenCalledWith('per-1', { message: 'Audit again' }));
  });
});
