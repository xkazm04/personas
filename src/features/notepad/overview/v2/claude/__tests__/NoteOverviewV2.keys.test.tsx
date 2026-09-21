// The v2 desk driven by the keyboard alone, through the real AppKeyboardProvider:
// the cursor, Find, the typing rule, the Escape rungs, and the verbs that go
// through the host's own props.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DevNote } from '@/lib/bindings/DevNote';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { NoteComment } from '@/lib/bindings/NoteComment';
import type { NoteStatus } from '@/lib/bindings/NoteStatus';
import { AppKeyboardProvider, NOTEPAD_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { useSystemStore } from '@/stores/systemStore';

const api = vi.hoisted(() => ({
  listNoteComments: vi.fn(async () => [] as NoteComment[]),
  noteUnreadCounts: vi.fn(async () => []),
  markNoteCommentsRead: vi.fn(async () => undefined),
}));
vi.mock('@/api/notepad', async (importOriginal) => ({ ...(await importOriginal<object>()), ...api }));

vi.mock('../../../parts/NoteProjectPicker', () => ({
  NoteProjectPicker: ({ note }: { note: DevNote }) => <div data-testid={`picker-${note.id}`} />,
}));
vi.mock('../../../parts/NoteQuickWrite', () => ({
  NoteQuickWrite: ({ note }: { note: DevNote }) => <div data-testid={`quick-${note.id}`} />,
}));

import { __resetNoteThreadStoreForTests } from '../../../../thread/noteThreadStore';
import { __resetCardVisibilityForTests } from '../../../../thread/cardVisibility';
import { NoteOverviewV2 } from '../NoteOverviewV2';

const note = (id: string, title: string, over: Partial<DevNote> = {}): DevNote =>
  ({
    id,
    projectId: 'p1',
    milestoneId: null,
    title,
    bodyMd: `body of ${id}`,
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
    ...over,
  }) as DevNote;

const projects: DevProject[] = [{ id: 'p1', name: 'personas', root_path: '/a' } as DevProject];
const notes = [note('n1', 'Alpha plan'), note('n2', 'Beta refactor'), note('n3', 'Gamma idea', { bodyMd: 'the sweeper moves it' })];

/** Stands in for NotepadOverlayHost: a PARENT registering at the same rung,
 *  whose Escape closes the pad. Parent effects run after the child's, so
 *  without the desk's late arming this handler would see Escape first. */
function Host({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useAppKeyboard(
    (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return false;
      onClose();
      return true;
    },
    { priority: NOTEPAD_LAYER_PRIORITY },
  );
  return <>{children}</>;
}

function desk(hostClose?: () => void) {
  const props = {
    onOpen: vi.fn(),
    onPatch: vi.fn(),
    onCreate: vi.fn(),
    onDelete: vi.fn(),
    onCertify: vi.fn(),
  };
  render(
    <AppKeyboardProvider>
      <Host onClose={hostClose ?? vi.fn()}>
        <NoteOverviewV2
          loading={false}
          notes={notes}
          projects={projects}
          saveStates={{}}
          atCap={false}
          focusNoteId={null}
          {...props}
        />
      </Host>
    </AppKeyboardProvider>,
  );
  return props;
}

const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key, ...init });
  });

const selectedId = () =>
  document.querySelector('[data-selected="true"]')?.getAttribute('data-testid')?.replace('notepad-card-', '') ?? null;

/** The handler is armed one frame after mount (see the component header). */
async function armed() {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

beforeEach(() => {
  __resetNoteThreadStoreForTests();
  __resetCardVisibilityForTests();
  useSystemStore.setState({ fleetSessions: [] });
  document.documentElement.setAttribute('data-motion', 'reduce');
  localStorage.clear();
});

afterEach(() => cleanup());

describe('the v2 desk from the keyboard', () => {
  it('shows the cursor on the first press, then walks with j / k / Home / End', async () => {
    desk();
    await armed();
    expect(selectedId()).toBeNull();
    press('ArrowDown');
    expect(selectedId()).toBe('n1');
    expect(screen.getByTestId('notepad-v2c-cursor')).toBeTruthy();
    press('j');
    expect(selectedId()).toBe('n2');
    press('End');
    expect(selectedId()).toBe('n3');
    press('k');
    expect(selectedId()).toBe('n2');
    press('Home');
    expect(selectedId()).toBe('n1');
    expect(screen.getByTestId('notepad-v2c-announce').textContent).toContain('Alpha plan');
  });

  it('opens and deletes through the host props', async () => {
    const props = desk();
    await armed();
    press('j');
    press('j');
    press('Enter');
    expect(props.onOpen).toHaveBeenCalledWith('n2');
    press('Delete');
    expect(props.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'n2' }));
  });

  it('/ opens Find; typing narrows live; Esc clears first', async () => {
    desk();
    await armed();
    press('/');
    const find = await screen.findByTestId('notepad-v2c-find');
    await waitFor(() => expect(document.activeElement).toBe(find));

    fireEvent.change(find, { target: { value: 'beta' } });
    await waitFor(() => expect(screen.queryByTestId('notepad-card-n1')).toBeNull());
    expect(screen.getByTestId('notepad-card-n2')).toBeTruthy();

    // Body search is substring-only.
    fireEvent.change(find, { target: { value: 'sweeper' } });
    expect(screen.getByTestId('notepad-card-n3')).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId('notepad-card-n2')).toBeNull());

    // The cursor followed the narrowing to the card now standing in its place
    // (the first match takes it on 'beta'; 'sweeper' hands it to n3)...
    expect(selectedId()).toBe('n3');
    // ...and letters typed into the field never move it.
    press('j');
    expect(selectedId()).toBe('n3');

    press('Escape');
    expect((find as HTMLInputElement).value).toBe('');
    expect(screen.getByTestId('notepad-card-n1')).toBeTruthy();
  });

  it('ArrowDown from Find hands the keyboard to the grid, filter intact', async () => {
    const props = desk();
    await armed();
    press('/');
    const find = await screen.findByTestId('notepad-v2c-find');
    await waitFor(() => expect(document.activeElement).toBe(find));
    fireEvent.change(find, { target: { value: 'gam' } });
    press('ArrowDown');
    expect(selectedId()).toBe('n3');
    await waitFor(() => expect(screen.queryByTestId('notepad-card-n1')).toBeNull());
    press('o');
    expect(props.onOpen).toHaveBeenCalledWith('n3');
  });

  it('never acts on a letter while the capture line has focus', async () => {
    const props = desk();
    await armed();
    const capture = screen.getByTestId('notepad-overview-capture');
    act(() => capture.focus());
    press('j');
    press('Delete');
    press('a');
    expect(selectedId()).toBeNull();
    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it('? toggles the keys HUD; Esc closes it BEFORE the host ladder, then steps out', async () => {
    const hostClose = vi.fn();
    desk(hostClose);
    await armed();
    press('?', { shiftKey: true });
    expect(await screen.findByTestId('notepad-v2c-keys')).toBeTruthy();
    press('Escape');
    await waitFor(() => expect(screen.queryByTestId('notepad-v2c-keys')).toBeNull());
    expect(hostClose).not.toHaveBeenCalled();
    // Nothing left on the desk's own rungs: the next Escape is the host's.
    press('Escape');
    expect(hostClose).toHaveBeenCalledTimes(1);
  });

  it('a opens the Ask composer under the selected card', async () => {
    desk();
    await armed();
    press('j');
    press('a');
    expect(await screen.findByTestId('notepad-v2c-composer-n1')).toBeTruthy();
    expect(screen.getByTestId('notepad-v2c-composer-n1').getAttribute('data-mode')).toBe('ask');
  });

  it('number keys switch the status filter', async () => {
    desk();
    await armed();
    press('2');
    // Every fixture note is a draft: the Scoped lens is empty.
    await waitFor(() => expect(screen.queryByTestId('notepad-card-n1')).toBeNull());
    press('3');
    await waitFor(() => expect(screen.getByTestId('notepad-card-n1')).toBeTruthy());
  });
});
