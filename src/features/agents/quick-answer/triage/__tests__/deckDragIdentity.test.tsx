/**
 * The card says which card it is.
 *
 * A drag was the only path in the deck that wrote without carrying the identity
 * of what it was writing about: `TriageCard` reported a direction, and
 * `useDeckControls` resolved that against whatever happened to be top when the
 * report arrived — 200ms later, and after a poll may have replaced the queue
 * wholesale. The verdict landed on a card the reviewer never saw.
 *
 * `useDeckControls.test.ts` covers the deck's half (a mismatched report is
 * DROPPED, never redirected). This is the other half: the id genuinely travels
 * from the card that flew, and it is read at LAUNCH rather than at report, so a
 * re-render mid-flight cannot change whose verdict it is.
 */
import { describe, it, expect, vi } from 'vitest';
import { createRef } from 'react';
import { render } from '@testing-library/react';

vi.mock('@/features/shared/components/editors/MarkdownRenderer', () => ({
  MarkdownRenderer: (props: { content: string }) => <div>{props.content}</div>,
}));

import { TriageCard, type FlingDirection, type TriageCardHandle } from '../deck/TriageCard';
import type { TriageItem } from '../triageTypes';
import { makeItem } from './triageFixtures';

function renderCard(item: TriageItem, onCommit: (dir: FlingDirection, itemId: string) => void) {
  const ref = createRef<TriageCardHandle>();
  const view = render(
    <TriageCard item={item} index={0} draggable reduced cycle={0} cardRef={ref} onCommit={onCommit} />,
  );
  return { ...view, ref };
}

describe('a thrown card names itself', () => {
  it('reports its own id alongside the direction', () => {
    const item = makeItem('idea');
    const onCommit = vi.fn();
    const { ref } = renderCard(item, onCommit);

    // `onDragEnd` and the action bar reach the same `launch`; this is the one
    // funnel every throw goes through.
    ref.current!.launch('right');

    expect(onCommit).toHaveBeenCalledWith('right', item.id);
  });

  it('reports the card it was thrown WITH, not the one it was re-rendered into', () => {
    // The stack is keyed by id, but a poll can hand the same slot a new object
    // — and, for the two cards behind the top one, a different item entirely.
    // The id is read when the throw starts, so nothing arriving afterwards can
    // change whose verdict this is.
    const thrown = makeItem('review');
    const onCommit = vi.fn();
    const { ref } = renderCard(thrown, onCommit);

    ref.current!.launch('left');
    // A second launch is refused outright (`launchedRef`), so one gesture can
    // only ever produce one report.
    ref.current!.launch('left');

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('left', thrown.id);
  });
});
