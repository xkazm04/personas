// The archive drawer is mounted behind `archiveOpen`; the only setter to true
// lived in the note tab strip, deleted in 050e58866f. Archiving was then a
// one-way door. This pins that the pad's header has a control that opens it.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/devTools/devTools', () => ({ listProjects: vi.fn(async () => []) }));
vi.mock('../useNotepad', () => ({
  useOpenNotes: () => [],
  useArchivedNotes: () => [],
  useShippedNotes: () => [],
  useNotepadPlanSummaries: () => ({}),
  useNotepadPlanLive: () => undefined,
  useNotepadSaveStates: () => ({}),
  useNotepadStatus: () => ({ loading: false, loaded: true, loadError: null }),
}));
vi.mock('../notepadStore', () => ({
  archivedNotes: () => [],
  shippedNotes: () => [],
  atCap: () => false,
  createNote: vi.fn(),
  deleteNote: vi.fn(),
  flush: vi.fn(),
  forkNote: vi.fn(),
  load: vi.fn(async () => undefined),
  patchNote: vi.fn(),
  restoreNote: vi.fn(),
  setProject: vi.fn(),
}));
vi.mock('../NoteArchiveModal', () => ({
  NoteArchiveModal: () => <div data-testid="archive-modal" />,
}));
vi.mock('../overview/NoteOverview', () => ({ NoteOverview: () => <div /> }));
vi.mock('../athena/noteSuggestions', () => ({ useNoteSuggestions: () => [] }));
vi.mock('../thread/noteThreadStore', () => ({ loadThreadUnread: vi.fn() }));
vi.mock('../thread/NoteThreadButton', () => ({ NoteThreadButton: () => null }));

import NotepadOverlayHost from '../NotepadOverlayHost';

afterEach(cleanup);

describe('notepad archive door', () => {
  it('opens the archive drawer from the pad header', async () => {
    render(<NotepadOverlayHost />);
    expect(screen.queryByTestId('archive-modal')).toBeNull();
    fireEvent.click(screen.getByTestId('notepad-open-archive'));
    expect(await screen.findByTestId('archive-modal')).toBeTruthy();
  });
});
