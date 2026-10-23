import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import type { ScraperConfig } from '@/api/scraper';
import { ScrapeEditorModal } from '../ScrapeEditorModal';

// `useScraperData.save` toasts a failure and resolves `null`. The modal closed
// on any resolution, so a refused save threw away every wizard step the user
// had filled in. The wizard and form are stubbed: the subject is the modal's
// save-then-close decision, not the steps.

vi.mock('@/lib/ui/BaseModal', () => ({
  BaseModal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div>{children}</div> : null,
}));

vi.mock('../useScrapeForm', () => ({
  useScrapeForm: () => ({ canSave: true, toInput: () => ({ name: 'n', urls: ['https://x'], rules: {}, dataset: 'd' }) }),
}));

vi.mock('../ScrapeEditorWizard', () => ({
  ScrapeEditorWizard: ({ onSave }: { onSave: () => void }) => (
    <button type="button" onClick={onSave}>save</button>
  ),
}));

const SAVED = { id: 's1' } as ScraperConfig;

describe('ScrapeEditorModal save', () => {
  const onClose = vi.fn();
  beforeEach(() => { onClose.mockReset(); });

  it('stays open when the save failed', async () => {
    const onSave = vi.fn(async () => null);
    render(<ScrapeEditorModal isOpen onClose={onClose} onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes once the save landed', async () => {
    const onSave = vi.fn(async () => SAVED);
    render(<ScrapeEditorModal isOpen onClose={onClose} onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
