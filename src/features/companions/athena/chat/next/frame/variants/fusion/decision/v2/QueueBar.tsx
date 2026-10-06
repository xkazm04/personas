/**
 * Fusion · decision v2 - the queue on the hero tile's head: one small icon
 * tile per waiting item (the kind's glyph, lit in its ink when current),
 * "3 of 8" as a figure, the walk keys, and the fold key. Every key shown is
 * the key the stage listens for (←/→ in `DecisionStage`, Esc on the layer).
 * On a strip (no model) "Set aside" rides here too, so the strip stays one band.
 *
 * TODO(prototype, 2026-10-07): athena decision surface round 6 - consolidate after the owner picks.
 */

import type { ReactNode } from 'react';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { NEXT_COPY as N } from '../../../../../nextCopy';
import { KIND_VAR } from '../../../../../tones';
import { FUSION_COPY as F } from '../../copy';
import type { QueueNav } from '../../DecisionStage';
import { KIND_GLYPH } from '../../kindGlyph';

export function QueueBar({ nav, aside }: { nav: QueueNav; aside?: ReactNode }) {
  const at = nav.items.findIndex((i) => i.id === nav.activeId);
  return (
    <div className="d2-queue">
      {aside}
      <nav className="d2-pips" aria-label={F.queue} data-testid="companion-fusion-d2-queue">
        {nav.items.map((it) => {
          const Glyph = KIND_GLYPH[it.kind];
          return (
            <Tooltip key={it.id} content={`${N.kind[it.kind]} · ${it.project ?? F.athena}`}>
              <Button
                variant="ghost"
                className="d2-pip focus-ring"
                style={{ ['--c' as string]: KIND_VAR[it.kind] }}
                aria-current={it.id === nav.activeId}
                aria-label={N.kind[it.kind]}
                onClick={() => nav.onPick(it.id)}
              >
                <Glyph aria-hidden />
              </Button>
            </Tooltip>
          );
        })}
      </nav>
      <span className="d2-of">
        <span className="typo-data text-foreground">{F.itemOf(at + 1, nav.items.length)}</span>
        {nav.items.length > 1 && (
          <span className="d2-keys" aria-hidden>
            <kbd className="d2-key typo-code">←</kbd>
            <kbd className="d2-key typo-code">→</kbd>
          </span>
        )}
      </span>
      <Tooltip content={F.keys.fold}>
        <Button
          variant="ghost"
          size="xs"
          className="d2-keybtn focus-ring"
          onClick={nav.onFold}
          aria-label={F.keys.fold}
          aria-keyshortcuts="Escape"
          data-testid="companion-fusion-d2-fold"
        >
          <kbd className="d2-key typo-code">Esc</kbd>
        </Button>
      </Tooltip>
    </div>
  );
}

/** "Set aside" with its key, on the hero's foot (or the strip, for a native card). */
export function AsideButton({ nav }: { nav: QueueNav }) {
  return (
    <Button variant="ghost" size="sm" className="d2-keybtn focus-ring" onClick={nav.onAside} aria-keyshortcuts="Space" data-testid="companion-fusion-d2-aside">
      {F.keys.aside}
      <kbd className="d2-key typo-code">Space</kbd>
    </Button>
  );
}
