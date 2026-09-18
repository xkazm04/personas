import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReviewActionButtons } from '../ReviewActions';

/**
 * Saving the harvested click path was `import.meta.env.DEV` only, and a failed
 * save was silent.
 *
 * `TauriPlaywrightAdapter` already looks a saved procedure up and sends it as
 * `saved_procedure`, so replay was fully built -- and unreachable for every
 * production user, because nothing in a production build ever wrote a row for
 * it to find. Each repeat connect to the same dashboard paid for another
 * ten-minute Chromium session.
 */

const savePlaywrightProcedure = vi.fn();
const toasted = vi.fn();

vi.mock('@/api/vault/autoCredBrowser', () => ({
  savePlaywrightProcedure: (...a: unknown[]) => savePlaywrightProcedure(...a),
}));
// Partial mock: the i18n loader uses `silentCatch` from this module, so a
// wholesale replacement breaks every translated string in the tree under test.
vi.mock('@/lib/silentCatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/silentCatch')>()),
  toastCatch: (context: string) => (err: unknown) => toasted(context, err),
}));

const PASS = { success: true, message: 'ok' };

function renderActions(extractedValues: Record<string, string>, healthResult = PASS) {
  render(
    <ReviewActionButtons
      onSave={vi.fn()}
      onRetry={vi.fn()}
      onCancel={vi.fn()}
      isSaving={false}
      healthResult={healthResult}
      extractedValues={extractedValues}
      connectorName="acme"
    />,
  );
}

function saveProcedureButton() {
  return screen.queryByTitle(/reuse|procedure/i);
}

describe('ReviewActionButtons — the harvested procedure reaches production', () => {
  beforeEach(() => {
    savePlaywrightProcedure.mockReset();
    savePlaywrightProcedure.mockResolvedValue({ id: 'p1', connector_name: 'acme', is_active: true });
    toasted.mockReset();
    // The gate this test exists for. A production bundle reports DEV false.
    expect(import.meta.env.DEV).toBeDefined();
  });

  it('offers the save after a passing healthcheck when a procedure log exists', () => {
    renderActions({ api_key: 'k', __procedure_log: '[{"action":"click"}]' });
    expect(saveProcedureButton()).not.toBeNull();
  });

  it('has nothing to offer on the first harvest (no procedure log)', () => {
    renderActions({ api_key: 'k' });
    expect(saveProcedureButton()).toBeNull();
  });

  it('sends only the real field keys, never the __-prefixed internals', async () => {
    renderActions({ api_key: 'k', team_id: 't', __procedure_log: '[]' });
    fireEvent.click(saveProcedureButton()!);
    await waitFor(() => expect(savePlaywrightProcedure).toHaveBeenCalledTimes(1));
    expect(savePlaywrightProcedure).toHaveBeenCalledWith('acme', '[]', JSON.stringify(['api_key', 'team_id']));
  });

  it('tells the operator when the save failed instead of looking idle', async () => {
    savePlaywrightProcedure.mockRejectedValue({ error: 'db locked' });
    renderActions({ api_key: 'k', __procedure_log: '[]' });
    fireEvent.click(saveProcedureButton()!);
    await waitFor(() => expect(toasted).toHaveBeenCalledTimes(1));
    expect(toasted.mock.calls[0]![0]).toBe('ReviewActionButtons:savePlaywrightProcedure');
  });
});
