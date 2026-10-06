/**
 * Fusion · the attention signal (Filament's beads, restyled per the owner):
 * the FIRST thing waiting on you is a larger glowing circle with the glyph of
 * its kind inside it and a warm warning-yellow glow where Filament drew a
 * black knock-out border; it breathes while it waits (gated on reduced
 * motion). The rest queue under it as small beads in their kind's colour.
 * Each bead opens its own item; the big one opens the first. With nothing
 * waiting, the circle goes hollow and still with a check inside. When the
 * rail reads out loud, each one grows in place and says its kind and a short
 * label of its title beside it (that label replaces the old tooltip).
 *
 * TODO(prototype, 2026-10-07): athena chat fusion - consolidate after the owner picks.
 */

import { Check } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { NEXT_COPY as N } from '../../../nextCopy';
import { KIND_VAR } from '../../../tones';
import type { WorkItem } from '../../../useWorkforce';
import { KIND_GLYPH } from './kindGlyph';
import { FUSION_COPY as F } from './copy';
import { plainWords } from './text';

const SHOWN = 5;
/** Words a short label never ends on: a cut there reads as a cut sentence. */
const DANGLING = new Set(['a', 'an', 'the', 'of', 'to', 'for', 'in', 'on', 'at', 'with', 'and', 'or', 'by', 'from', 'into']);

/**
 * A title as a rail label: its first clause when that is already short,
 * otherwise the words that fit the budget, never cut mid-word and never
 * ending on a joining word, with an ellipsis so the shortening is honest.
 */
export function shortLabel(title: string, budget = 26): string {
  const text = plainWords(title).replace(/\s+/g, ' ').trim();
  const clause = text.split(/[?.!:;]\s|\s[-–—]\s|,\s/)[0]!.replace(/[?.!:;,]$/, '');
  if (clause.length <= budget) return clause;
  const kept: string[] = [];
  for (const w of clause.split(' ')) {
    if ([...kept, w].join(' ').length > budget - 1) break;
    kept.push(w);
  }
  while (kept.length > 1 && DANGLING.has(kept[kept.length - 1]!.toLowerCase())) kept.pop();
  // One word longer than the budget (a path, an identifier) is shown whole: never cut mid-word.
  return kept.length ? `${kept.join(' ')}…` : clause;
}

function Tag({ kind, title }: { kind: string; title: string }) {
  return (
    <span className="fu-tag" aria-hidden>
      <span className="typo-label fu-tag-main">{kind}</span>
      <span className="typo-label fu-tag-meta">{shortLabel(title)}</span>
    </span>
  );
}

export function AttentionBeads({ items, onOpen }: { items: WorkItem[]; onOpen: (id: string | null) => void }) {
  const { shouldAnimate } = useMotion();
  const first = items[0] ?? null;
  const rest = items.slice(1, SHOWN);
  const over = items.length - 1 - rest.length;
  const Glyph = first ? KIND_GLYPH[first.kind] : Check;

  return (
    <div className="fu-beads" data-testid="companion-fusion-beads">
      <Button
        variant="ghost"
        className={`fu-attn${first ? '' : ' is-quiet'}${first && shouldAnimate ? ' is-moving' : ''}`}
        style={first ? { ['--c' as string]: KIND_VAR[first.kind] } : undefined}
        onClick={() => onOpen(first?.id ?? null)}
        aria-label={first ? `${N.kind[first.kind]}: ${first.title}. ${F.openQueue}` : F.noneWaiting}
        data-testid="companion-fusion-attention"
        data-fusion-anchor=""
      >
        <Glyph aria-hidden />
        {first ? (
          <Tag kind={N.kind[first.kind]} title={first.title} />
        ) : (
          <span className="fu-tag" aria-hidden>
            <span className="typo-label fu-tag-meta">{F.noneWaiting}</span>
          </span>
        )}
      </Button>
      {rest.map((it) => (
        <Button
          key={it.id}
          variant="ghost"
          className="fu-bead"
          style={{ ['--c' as string]: KIND_VAR[it.kind] }}
          onClick={() => onOpen(it.id)}
          aria-label={`${N.kind[it.kind]}: ${it.title}`}
        >
          <i aria-hidden />
          <Tag kind={N.kind[it.kind]} title={it.title} />
        </Button>
      ))}
      {over > 0 && (
        <span className="typo-caption fu-over">
          {F.more(over)}
          <span className="fu-tag" aria-hidden>
            <span className="typo-label fu-tag-meta">{F.moreLabel(over)}</span>
          </span>
        </span>
      )}
    </div>
  );
}
