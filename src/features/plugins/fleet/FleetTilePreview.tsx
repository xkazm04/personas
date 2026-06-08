import { useTranslation } from '@/i18n/useTranslation';

interface Props {
  /** Cooked last-N lines from the backend ring, or undefined before first poll. */
  lines: string[] | undefined;
}

/**
 * Cheap, non-interactive "what's on screen" preview for an *unwatched* grid
 * tile — cooked last-N-lines from the backend output ring, polled at a low rate
 * (see `useFleetTilePreviews`). No xterm, no live stream, no VT parse: this is
 * the tier that lets the grid show 16 sessions without rendering 16 realtime
 * terminals. Bottom-aligned like a terminal so the most recent line is visible.
 * `pointer-events-none` so a click lands on the tile (which promotes it to a
 * live terminal via the parent's select handler).
 */
export function FleetTilePreview({ lines }: Props) {
  const { t } = useTranslation();
  const hasOutput = !!lines && lines.length > 0;
  return (
    <div
      data-testid="fleet-tile-preview"
      className="pointer-events-none flex h-full w-full flex-col justify-end overflow-hidden bg-[#0a0a0c] px-2 py-1.5"
    >
      {hasOutput ? (
        <pre className="m-0 whitespace-pre-wrap break-words font-mono typo-caption leading-snug text-foreground/90">
          {lines!.join('\n')}
        </pre>
      ) : (
        <span className="typo-caption text-foreground/90">{t.plugins.fleet.preview_idle}</span>
      )}
    </div>
  );
}
