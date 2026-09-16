// The tab strip's STATE reading, which is one 14px glyph.
//
// There is no room for a badge in a 200px tab, so the glyph is all a tab says
// about where a note is. Three of the four plan glyphs are shared with a
// brainstorm status by design (`FileText` for draft AND scoped, `Rocket` for
// published AND cut, `CircleCheck` for completed AND shipped), which means shape
// alone cannot tell the two rails apart — the tone has to. These pin that every
// plan status resolves through `noteStatusMeta` and reaches the DOM, because the
// failure mode is a tab that renders a perfectly plausible wrong glyph.
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { DevNote } from '@/lib/bindings/DevNote';
import type { NoteStatus } from '@/lib/bindings/NoteStatus';

import { NOTE_STATUS_META } from '../noteStatusMeta';
import { NoteTabStrip } from '../NoteTabStrip';

const note = (id: string, status: NoteStatus, milestoneId: string | null = null): DevNote =>
  ({
    id,
    projectId: 'p1',
    milestoneId,
    title: `Note ${id}`,
    bodyMd: '',
    status,
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
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  }) as DevNote;

function strip(notes: DevNote[]) {
  render(
    <NoteTabStrip
      notes={notes}
      activeId={notes[0]?.id ?? null}
      saveStates={{}}
      atCap={false}
      onSelect={vi.fn()}
      onRename={vi.fn()}
      onCreate={vi.fn()}
      onFork={vi.fn()}
      onArchive={vi.fn()}
      onDelete={vi.fn()}
      onOpenArchive={vi.fn()}
    />,
  );
}

describe('NoteTabStrip — plan status glyphs', () => {
  const plan: NoteStatus[] = ['scoped', 'cut', 'shipped'];

  it('renders a glyph for every plan status, in that status tone', () => {
    strip(plan.map((s) => note(s, s, `ms-${s}`)));

    for (const status of plan) {
      const tab = screen.getByTestId(`notepad-tab-${status}`);
      expect(tab).toHaveAttribute('data-status', status);

      const glyph = screen.getByTestId(`notepad-tab-glyph-${status}`);
      // The tone comes from the ONE presentation table — asserting against
      // `NOTE_STATUS_META` rather than a literal class means a future re-tone
      // moves the test with the table instead of breaking it.
      expect(glyph.getAttribute('class')).toContain(NOTE_STATUS_META[status].tone.text);
    }
  });

  // The three plan tones are distinct, which is the only reason the glyph can
  // carry the rail at all. If two of them ever collapsed to the same token the
  // strip would silently stop distinguishing two states.
  it('gives scoped, cut and shipped three different tones', () => {
    const tones = new Set(plan.map((s) => NOTE_STATUS_META[s].tone.text));
    expect(tones.size).toBe(3);
  });

  // A brainstorm note keeps the quiet ink it has always had — colouring every
  // tab would make the strip a stripe and the plan tones would stop standing out.
  it('leaves an unlinked note untinted', () => {
    strip([note('plain', 'draft')]);
    const glyph = screen.getByTestId('notepad-tab-glyph-plain');
    expect(glyph.getAttribute('class')).toContain('opacity-70');
    expect(glyph.getAttribute('class')).not.toContain('text-primary');
  });

  // A note LINKED while still a draft is already on the plan rail — the link is
  // the fork, not the status (`noteLifecycleFor`).
  it('tints a linked draft', () => {
    strip([note('linked', 'draft', 'ms-1')]);
    const glyph = screen.getByTestId('notepad-tab-glyph-linked');
    expect(glyph.getAttribute('class')).toContain(NOTE_STATUS_META.draft.tone.text);
  });
});
