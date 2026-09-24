import { useRef } from "react";
import type { KeyboardEvent } from "react";
import { Eye } from "lucide-react";

import type { DriveEntry } from "@/api/drive";
import { driveFormatBytes } from "@/api/drive";
import { Button } from "@/features/shared/components/buttons";
import { Numeric } from "@/features/shared/components/display/Numeric";
import ScenarioEmptyState from "@/features/shared/components/feedback/ScenarioEmptyState";
import { useTranslation } from "@/i18n/useTranslation";
import { previewKind, type DriveApi, type FinderViewProps } from "../types";
import { FinderGhost } from "./FinderGhost";
import { FINDER_SCENARIO_BOX, finderScenario, finderScenarioTestId, finderEmptyVariant } from "./finderScenario";
import { GalleryStrip } from "./GalleryStrip";
import { kindLabelFor, kindVisual } from "./kindVisual";
import { RecursiveResults } from "./RecursiveResults";
import { firstSelected } from "./selection";
import { useEntryDnD } from "./useEntryDnD";
import { useThumbnail } from "./useThumbnail";

/** Hero: the 1024px thumbnail for images, else the kind icon and a Quick Look affordance. */
function GalleryHero({ entry, onQuickLook }: { entry: DriveEntry; onQuickLook: () => void }) {
  const { t } = useTranslation();
  const f = t.plugins.drive.finder;
  const ref = useRef<HTMLDivElement>(null);
  const { url, failed } = useThumbnail(entry, 1024, ref);
  const { Icon, tint } = kindVisual(entry);
  const kind = previewKind(entry);
  return (
    <div
      ref={ref}
      data-testid="finder-gallery-hero"
      className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 p-6"
    >
      {url ? (
        <img
          src={url}
          alt={entry.name}
          draggable={false}
          className="max-w-full max-h-[70%] object-contain rounded-card shadow-elevation-2"
        />
      ) : (
        <div className="w-32 h-32 rounded-card bg-secondary/30 flex items-center justify-center">
          <Icon className={`w-16 h-16 ${tint}`} aria-hidden />
        </div>
      )}
      <div className="typo-title text-center break-words max-w-full">{entry.name}</div>
      <div className="flex items-center gap-2 typo-caption">
        <span className="text-foreground">{kindLabelFor(t, entry)}</span>
        {entry.kind === "file" && (
          <Numeric className="text-foreground">{driveFormatBytes(entry.size)}</Numeric>
        )}
      </div>
      {kind === "image" && failed && <span className="typo-caption text-foreground">{f.thumb_failed}</span>}
      {kind !== null && kind !== "image" && (
        <Button variant="secondary" size="sm" icon={<Eye className="w-4 h-4" />} onClick={onQuickLook}>
          {f.insp_preview_open}
        </Button>
      )}
      {kind === null && entry.kind === "file" && (
        <span className="typo-caption text-foreground">{f.gallery_no_preview}</span>
      )}
    </div>
  );
}

/** ←/→ step the selection through the folder. */
export function galleryKeyNav(drive: DriveApi, key: string): boolean {
  if (key !== "ArrowLeft" && key !== "ArrowRight") return false;
  const entries = drive.visibleEntries;
  if (entries.length === 0) return false;
  const current = firstSelected(drive, entries);
  const idx = current ? entries.indexOf(current) : -1;
  const next = key === "ArrowRight" ? Math.min(idx + 1, entries.length - 1) : Math.max(idx - 1, 0);
  const target = entries[next];
  if (target) drive.selectOnly(target.path);
  return true;
}

export function GalleryView(props: FinderViewProps) {
  const { drive, pendingCreate } = props;
  const { t, tx } = useTranslation();
  const dnd = useEntryDnD(props);

  if (drive.recursiveResults !== null || drive.recursiveLoading) {
    return <RecursiveResults view={props} />;
  }
  const state = finderEmptyVariant(drive, pendingCreate);
  if (state === "ghost") return <FinderGhost rows={6} rowHeight={56} />;
  if (state !== null) {
    return (
      <div className={FINDER_SCENARIO_BOX} data-testid={finderScenarioTestId(state)}>
        <ScenarioEmptyState {...finderScenario(state, { t, tx, drive, onRequestCreate: props.onRequestCreate })} />
      </div>
    );
  }

  const current = firstSelected(drive, drive.visibleEntries) ?? drive.visibleEntries[0] ?? null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    if (galleryKeyNav(drive, e.key)) e.preventDefault();
  };

  return (
    <div
      tabIndex={0}
      data-testid="finder-view-GalleryView"
      className="flex-1 min-h-0 flex flex-col bg-background outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      onKeyDown={onKeyDown}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onContextMenu(null, e.clientX, e.clientY);
      }}
    >
      {current && <GalleryHero entry={current} onQuickLook={props.onQuickLook} />}
      <GalleryStrip view={props} current={current} dnd={dnd} />
    </div>
  );
}
