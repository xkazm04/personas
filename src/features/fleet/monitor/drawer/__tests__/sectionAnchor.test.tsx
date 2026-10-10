// `initialSection` is the badge the operator clicked to open the drawer, and
// since the tabbed readings were retired `useSectionAnchor` is the ONLY thing
// that still honours it. The tabs used to answer it by selecting one; nothing
// answers it now except this scroll, so it is worth a test of its own.
//
// It replaces `drawerModel.test.ts`, which went with the variant switcher it
// tested. jsdom implements no layout, so `scrollIntoView` does not exist on an
// element unless a test provides it — which is also what makes it observable.

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sectionAnchorId, useSectionAnchor } from '../useSectionAnchor';
import type { DrawerSection } from '../../monitorModel';

const SECTIONS: DrawerSection[] = ['reviews', 'messages', 'activity', 'capabilities'];

/** One anchor per section, each recording whether it was scrolled to. */
function mountAnchors(): Map<DrawerSection, ReturnType<typeof vi.fn>> {
  const spies = new Map<DrawerSection, ReturnType<typeof vi.fn>>();
  for (const s of SECTIONS) {
    const el = document.createElement('div');
    el.id = sectionAnchorId(s);
    const spy = vi.fn();
    // jsdom has no layout engine and so no scrollIntoView; assigning it is both
    // the stub and the probe.
    (el as unknown as { scrollIntoView: unknown }).scrollIntoView = spy;
    document.body.appendChild(el);
    spies.set(s, spy);
  }
  return spies;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useSectionAnchor', () => {
  it('brings the clicked badge’s section into view, and only that one', () => {
    const spies = mountAnchors();
    renderHook(() => useSectionAnchor('activity', true));

    expect(spies.get('activity')).toHaveBeenCalledTimes(1);
    for (const s of SECTIONS.filter((x) => x !== 'activity')) {
      expect(spies.get(s)).not.toHaveBeenCalled();
    }
  });

  it('scrolls instantly, because the sheet is already springing down as it runs', () => {
    const spies = mountAnchors();
    renderHook(() => useSectionAnchor('reviews', true));

    expect(spies.get('reviews')).toHaveBeenCalledWith({ block: 'nearest', behavior: 'instant' });
  });

  it('waits for ready, then lands once the content exists', () => {
    const spies = mountAnchors();
    const { rerender } = renderHook(({ ready }) => useSectionAnchor('messages', ready), {
      initialProps: { ready: false },
    });
    // Scrolling to a region that has not rendered its rows yet would land on an
    // empty box and then be wrong the moment the rows arrive.
    expect(spies.get('messages')).not.toHaveBeenCalled();

    rerender({ ready: true });
    expect(spies.get('messages')).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the section has no anchor in the DOM', () => {
    // A reading that does not render every region is legal; the hook must no-op
    // rather than break the drawer's open.
    expect(() => renderHook(() => useSectionAnchor('capabilities', true))).not.toThrow();
  });

  it('every DrawerSection has a distinct anchor id', () => {
    const ids = SECTIONS.map(sectionAnchorId);
    expect(new Set(ids).size).toBe(SECTIONS.length);
    expect(ids).toEqual([
      'drawer-sec-reviews',
      'drawer-sec-messages',
      'drawer-sec-activity',
      'drawer-sec-capabilities',
    ]);
  });
});
