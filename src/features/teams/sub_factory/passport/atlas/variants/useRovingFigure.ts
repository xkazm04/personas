// The ONE keyboard model every portfolio figure obeys.
//
// The matrix owned this outright, which meant any second figure had to
// re-author it and the operator's key map would then depend on which drawing
// he was looking at. Extracting it was the one piece of the 2026-10-06
// concept bench worth keeping after the concepts themselves were deleted: a
// project is always the vertical axis, a dimension always the horizontal one,
// Enter always opens the cell and P always opens the passport.
//
// What a figure still owns is which element carries `data-cell="pi:di"`. The
// hook moves DOM focus there and nothing else, so a figure is free to draw
// that element as a square, a lamina or a mark.
import { useCallback, useEffect, useRef, type FocusEvent, type KeyboardEvent } from 'react';
import type { AppPassport } from '../../passportModel';
import type { AtlasCoord } from '../atlasFigure';

export interface RovingFigure {
  ref: React.RefObject<HTMLDivElement | null>;
  onKeyDown: (e: KeyboardEvent) => void;
  onFocus: () => void;
  onBlur: (e: FocusEvent) => void;
}

export function useRovingFigure({ projects, dims, at, onMove, onOpenCell, onOpenProject }: {
  projects: AppPassport[];
  dims: number;
  at: AtlasCoord;
  onMove: (c: AtlasCoord) => void;
  onOpenCell: (c: AtlasCoord) => void;
  onOpenProject: (slug: string) => void;
}): RovingFigure {
  const ref = useRef<HTMLDivElement>(null);
  const focusWithin = useRef(false);

  // Keep DOM focus on the roving cell while the figure owns focus.
  useEffect(() => {
    if (!focusWithin.current) return;
    ref.current?.querySelector<HTMLElement>(`[data-cell="${at.pi}:${at.di}"]`)?.focus();
  }, [at]);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    const last = { pi: projects.length - 1, di: dims - 1 };
    const move = (pi: number, di: number) => {
      e.preventDefault();
      onMove({ pi: Math.max(0, Math.min(last.pi, pi)), di: Math.max(0, Math.min(last.di, di)) });
    };
    switch (e.key) {
      case 'ArrowDown': return move(at.pi + 1, at.di);
      case 'ArrowUp': return move(at.pi - 1, at.di);
      case 'ArrowRight': return move(at.pi, at.di + 1);
      case 'ArrowLeft': return move(at.pi, at.di - 1);
      case 'Home': return move(at.pi, 0);
      case 'End': return move(at.pi, last.di);
      case 'Enter': case ' ': e.preventDefault(); return onOpenCell(at);
      case 'p': case 'P': {
        const p = projects[at.pi];
        if (p) { e.preventDefault(); onOpenProject(p.identity.slug); }
        return;
      }
    }
  }, [projects, dims, at, onMove, onOpenCell, onOpenProject]);

  return {
    ref,
    onKeyDown,
    onFocus: useCallback(() => { focusWithin.current = true; }, []),
    onBlur: useCallback((e: FocusEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) focusWithin.current = false;
    }, []),
  };
}
