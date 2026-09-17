import { Check, Minus } from "lucide-react";

import type { DriveTag, DriveTagColor } from "@/api/drive";
import { useTranslation } from "@/i18n/useTranslation";
import { tagColorClass, tagRingClass } from "./tagColor";

export type SwatchState = "on" | "off" | "mixed";

interface Props {
  tags: DriveTag[];
  stateOf: (tagId: string) => SwatchState;
  onToggle: (tagId: string) => void;
  disabled?: boolean;
}

/** The translated name of a colour label. */
export function colorName(t: ReturnType<typeof useTranslation>["t"], color: DriveTagColor): string {
  const f = t.plugins.drive.finder;
  switch (color) {
    case "red": return f.tag_red;
    case "orange": return f.tag_orange;
    case "yellow": return f.tag_yellow;
    case "green": return f.tag_green;
    case "blue": return f.tag_blue;
    case "purple": return f.tag_purple;
    default: return f.tag_gray;
  }
}

/**
 * Row of colour-label toggles. Each is a native button with checkbox
 * semantics (`aria-checked`, `mixed` when only part of a multi-selection
 * carries it) so Space / Enter toggle without extra key handling.
 */
export function TagSwatches({ tags, stateOf, onToggle, disabled = false }: Props) {
  const { t } = useTranslation();
  return (
    <div role="group" aria-label={t.plugins.drive.finder.insp_tags} className="flex items-center gap-1.5">
      {tags.map((tag) => {
        const state = stateOf(tag.id);
        const label = tag.builtin ? colorName(t, tag.color) : tag.name;
        return (
          <button
            key={tag.id}
            type="button"
            role="checkbox"
            aria-checked={state === "mixed" ? "mixed" : state === "on"}
            aria-label={label}
            title={label}
            disabled={disabled}
            onClick={() => onToggle(tag.id)}
            className={`w-5 h-5 rounded-full flex items-center justify-center transition-transform motion-reduce:transition-none hover:scale-110 focus-ring disabled:opacity-50 disabled:cursor-not-allowed ${tagColorClass(tag.color)} ${
              state === "off" ? "opacity-60 hover:opacity-100" : `ring-2 ring-offset-2 ring-offset-background ${tagRingClass(tag.color)}`
            }`}
          >
            {state === "on" && <Check className="w-3 h-3 text-background" strokeWidth={3} />}
            {state === "mixed" && <Minus className="w-3 h-3 text-background" strokeWidth={3} />}
          </button>
        );
      })}
    </div>
  );
}
