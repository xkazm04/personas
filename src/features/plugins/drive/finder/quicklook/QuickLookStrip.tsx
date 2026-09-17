import { useEffect, useRef } from "react";

import type { DriveEntry } from "@/api/drive";
import { Tooltip } from "@/features/shared/components/display/Tooltip";
import { visualForEntry } from "../../designTokens";
import { useThumbnail } from "../views/useThumbnail";

interface StripProps {
  entries: DriveEntry[];
  index: number;
  onSelect: (index: number) => void;
}

/**
 * Filmstrip of 96px thumbnails under the stage. Thumbs come from the views'
 * `useThumbnail` (lazy, IntersectionObserver-gated by its `ref`), so a folder
 * of hundreds of images never holds every blob at once. The active tile is
 * kept scrolled into view as the user steps.
 */
export function QuickLookStrip({ entries, index, onSelect }: StripProps) {
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const active = stripRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView?.({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [index]);

  if (entries.length <= 1) return null;

  return (
    <div
      ref={stripRef}
      data-testid="quicklook-strip"
      className="flex items-center gap-2 px-4 py-2 border-t border-card-border bg-card-bg overflow-x-auto"
      onClick={(e) => e.stopPropagation()}
    >
      {entries.map((entry, i) => (
        <StripTile key={entry.path} entry={entry} active={i === index} onClick={() => onSelect(i)} />
      ))}
    </div>
  );
}

function StripTile({
  entry,
  active,
  onClick,
}: {
  entry: DriveEntry;
  active: boolean;
  onClick: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const { url, failed } = useThumbnail(entry, 96, ref);
  const visual = visualForEntry(entry);
  const Icon = visual.Icon;

  return (
    <Tooltip content={entry.name}>
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        data-active={active ? "true" : undefined}
        aria-current={active}
        // The filename is user content, not copy — it rides as the label.
        aria-label={entry.name}
        className={`relative flex-shrink-0 w-14 h-14 rounded-input overflow-hidden border transition-colors focus-ring ${
          active
            ? "border-primary ring-2 ring-primary/50"
            : "border-card-border opacity-70 hover:opacity-100 hover:border-primary/40"
        }`}
      >
        {url && !failed ? (
          <img src={url} alt="" draggable={false} className="w-full h-full object-cover" />
        ) : (
          <span
            className={`w-full h-full flex items-center justify-center bg-gradient-to-br ${visual.gradient}`}
          >
            <Icon className={`w-5 h-5 ${visual.text}`} />
          </span>
        )}
      </button>
    </Tooltip>
  );
}
