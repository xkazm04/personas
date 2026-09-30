// The error dot says "click to retry". The lifecycle rail covers the metadata
// row whenever the card is selected, so the control has to sit outside that
// row or the click the copy names is unreachable on the card you are editing.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DevNote } from '@/lib/bindings/DevNote';
import type { NoteStatus } from '@/lib/bindings/NoteStatus';

import * as notepadStore from '../../notepadStore';
import { NoteCardFooter } from '../parts/NoteCardBits';

const retrySave = vi.spyOn(notepadStore, 'retrySave').mockResolvedValue(undefined);

const note = {
  id: 'n1',
  projectId: null,
  milestoneId: null,
  title: 'Dock',
  bodyMd: 'hello',
  status: 'draft' as NoteStatus,
  orderIndex: 0,
  dispatchTarget: null,
  dispatchKey: null,
  fleetSessionId: null,
  agentId: null,
  resultJson: null,
  publishedAt: null,
  startedAt: null,
  completedAt: null,
  archivedAt: null,
  createdAt: '2026-09-15T00:00:00Z',
  updatedAt: '2026-09-15T00:00:00Z',
} as DevNote;

function footer(saveState: 'clean' | 'dirty' | 'saving' | 'error', railShown = false) {
  return render(
    <NoteCardFooter
      note={note}
      saveState={saveState}
      onOpen={() => {}}
      rail={<span data-testid="rail" />}
      railShown={railShown}
    />,
  );
}

describe('the card save dot', () => {
  afterEach(() => {
    cleanup();
    retrySave.mockClear();
  });

  it('retries a failed save from the error dot, even while the rail covers the metadata', () => {
    footer('error', true);
    const retry = screen.getByRole('button', { name: 'Save failed — click to retry' });
    expect(retry.closest('[aria-hidden="true"]')).toBeNull();
    fireEvent.click(retry);
    expect(retrySave).toHaveBeenCalledTimes(1);
    expect(retrySave).toHaveBeenCalledWith('n1');
  });

  it('leaves a dirty or in-flight save as a status mark, not a second control', () => {
    footer('dirty');
    expect(screen.queryByRole('button', { name: 'Unsaved changes' })).toBeNull();
    expect(screen.getByTestId('notepad-save-dirty')).toBeInTheDocument();
    cleanup();
    footer('saving');
    expect(screen.queryByRole('button', { name: 'Saving…' })).toBeNull();
    expect(retrySave).not.toHaveBeenCalled();
  });
});
