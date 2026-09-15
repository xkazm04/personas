import { describe, it, expect } from 'vitest';

import { createNotepadSlice, type NotepadSlice } from '../notepadSlice';

/** Minimal zustand-shaped harness around the slice creator — same shape as
 *  `devToolsProjectSlice.test.ts`, which is the house pattern for a slice that
 *  needs no store around it. */
function harness() {
  let state = {} as NotepadSlice;
  const set = (partial: unknown) => {
    const patch = typeof partial === 'function'
      ? (partial as (s: typeof state) => object)(state)
      : partial;
    state = { ...state, ...(patch as object) };
  };
  const get = () => state;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state = { ...(createNotepadSlice as any)(set, get, {}) };
  return { get: () => state, set };
}

describe('notepadSlice — the project deep link', () => {
  it('starts with no pending project and the pad shut', () => {
    const h = harness();
    expect(h.get().notepadOpen).toBe(false);
    expect(h.get().notepadPendingProject).toBeNull();
  });

  it('opens the pad AND records the project in one write', () => {
    // Both fields in one `set` is the contract `NotepadOverlayHost` depends on:
    // it reads the pending project at mount, and the mount is caused by
    // `notepadOpen` flipping. A two-step write could mount the host before the
    // project landed and paint an unfiltered desk for a frame.
    const h = harness();

    h.get().notepadOpenForProject('proj-7');

    expect(h.get().notepadOpen).toBe(true);
    expect(h.get().notepadPendingProject).toBe('proj-7');
  });

  it('CONSUMES the pending project once — the host clears it, the pad stays up', () => {
    // The clear must not close the pad: the host clears in an effect that runs
    // while the operator is looking at the desk.
    const h = harness();
    h.get().notepadOpenForProject('proj-7');

    h.get().notepadClearPendingProject();

    expect(h.get().notepadPendingProject).toBeNull();
    expect(h.get().notepadOpen).toBe(true);
  });

  it('does not re-seed the filter on the next open', () => {
    // A second raise through the footer icon (`notepadSetOpen`) must land on
    // the whole desk, not on last week's project.
    const h = harness();
    h.get().notepadOpenForProject('proj-7');
    h.get().notepadClearPendingProject();
    h.get().notepadSetOpen(false);

    h.get().notepadSetOpen(true);

    expect(h.get().notepadPendingProject).toBeNull();
  });
});
