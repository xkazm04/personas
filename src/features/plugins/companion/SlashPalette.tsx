import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Slash-command palette — opens above the composer when the user types
 * `/` as the first character of an empty draft. Filters the preset list
 * by the text after `/` (case-insensitive substring match on label). Pick
 * an item via click, ↑/↓ + Enter, or close with Esc.
 *
 * Presets are i18n'd so non-English users get prompts in their locale —
 * the messages are sent to Athena verbatim, and she handles all 14
 * supported languages in chat.
 */

export interface SlashPreset {
  key: string;
  /** Localized label shown in the palette. */
  label: string;
  /** Localized message that gets pushed into the composer draft on pick. */
  message: string;
}

interface Props {
  query: string;
  selectedIndex: number;
  onSelect: (preset: SlashPreset) => void;
  onHoverIndex: (idx: number) => void;
  presets: SlashPreset[];
}

export function SlashPalette({
  query,
  selectedIndex,
  onSelect,
  onHoverIndex,
  presets,
}: Props) {
  const { t } = useTranslation();
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return presets;
    return presets.filter(
      (p) =>
        p.label.toLowerCase().includes(q) || p.key.toLowerCase().includes(q),
    );
  }, [query, presets]);

  // Keep the active row in view when arrow-key navigation lands on it.
  // Guarded against environments where scrollIntoView is missing (jsdom).
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    const el = itemRefs.current[selectedIndex];
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (filtered.length === 0) {
    return (
      <div
        className="rounded-card border border-foreground/10 bg-secondary/95 backdrop-blur-sm shadow-elevation-3 px-3 py-2 typo-caption text-foreground"
        data-testid="companion-slash-palette"
      >
        {t.plugins.companion.slash_palette_empty}
      </div>
    );
  }

  return (
    <div
      className="rounded-card border border-foreground/10 bg-secondary/95 backdrop-blur-sm shadow-elevation-3 overflow-hidden"
      data-testid="companion-slash-palette"
    >
      <div className="px-3 py-1.5 typo-caption text-foreground border-b border-foreground/10">
        {t.plugins.companion.slash_palette_heading}
      </div>
      <ul className="max-h-60 overflow-y-auto">
        {filtered.map((preset, idx) => {
          const active = idx === Math.min(selectedIndex, filtered.length - 1);
          return (
            <li key={preset.key}>
              <button
                ref={(el) => {
                  itemRefs.current[idx] = el;
                }}
                type="button"
                onClick={() => onSelect(preset)}
                onMouseEnter={() => onHoverIndex(idx)}
                className={`w-full text-left px-3 py-1.5 typo-caption transition-colors flex flex-col gap-0.5 ${
                  active
                    ? 'bg-primary/10 text-foreground'
                    : 'text-foreground hover:bg-foreground/[0.04]'
                }`}
                data-testid="companion-slash-item"
                data-key={preset.key}
                data-active={active ? 'true' : 'false'}
              >
                <span className="font-medium">{preset.label}</span>
                <span className="text-foreground typo-caption line-clamp-1">
                  {preset.message}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Resolve the visible filtered list given a query — same algorithm the
 * palette uses internally. Exposed so the Composer can mirror the
 * selection-bound logic when arrow-keying / Enter-selecting from above.
 */
export function filterSlashPresets(
  presets: SlashPreset[],
  query: string,
): SlashPreset[] {
  const q = query.trim().toLowerCase();
  if (!q) return presets;
  return presets.filter(
    (p) => p.label.toLowerCase().includes(q) || p.key.toLowerCase().includes(q),
  );
}
