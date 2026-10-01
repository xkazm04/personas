/**
 * What every L3 section of the Twin Detail drawer shares (spark
 * twin-portable-blueprint): its props, the stored-list reader, and the
 * coverage bar.
 */
import { Numeric } from '@/features/shared/components/display/Numeric';

import type { TwinBlueprintModel } from '../blueprintContract';
import type { BlueprintSources } from '../blueprintModel';

export interface SectionDetailProps {
  model: TwinBlueprintModel;
  sources: BlueprintSources;
  /** The item the blueprint was pressed on (a channel, topic or goal id); shown first. */
  itemKey?: string;
}

/** The items of a stored JSON-array column; legacy free text is one item. */
export function storedItems(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    // INVARIANT: examples_json / constraints_json hold a JSON array of strings
    // (twin_upsert_tone); anything else predates that and reads as one item.
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
    return [raw.trim()];
  } catch {
    return [raw.trim()];
  }
}

/** `item` first, then the rest in their order. */
export function itemFirst<T>(list: readonly T[], isItem: (x: T) => boolean): T[] {
  const hit = list.filter(isItem);
  return hit.length === 0 ? [...list] : [...hit, ...list.filter((x) => !isItem(x))];
}

/** A 0..1 share drawn as a bar (`scaleX`, never a pasted percentage), its figure beside it. */
export function CoverageBar({ value, label, testId }: { value: number; label: string; testId?: string }) {
  const share = Math.min(1, Math.max(0, value));
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className="block h-1.5 flex-1 rounded-pill bg-foreground/10 overflow-hidden">
        <span
          className="block h-full w-full origin-left bg-primary"
          style={{ transform: `scaleX(${share})` }}
          data-testid={testId}
        />
      </span>
      <span className="sr-only">{label}</span>
      <Numeric value={share} unit="ratio" precision={0} className="typo-data" />
    </span>
  );
}
