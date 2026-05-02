import { type ReactNode, type ComponentType } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';

/**
 * Per-lane theme. All values must be **literal** Tailwind class strings —
 * Tailwind 4 JIT scans source for literals and never compiles dynamic
 * `bg-${color}-500/10` template strings. Each lane component (AudioLane,
 * VideoLane, ImageLane) declares its own constant of this shape.
 */
export interface LaneTheme {
  headerBg: string;
  headerBorder: string;
  headerText: string;
  countBadgeBg: string;
  countBadgeText: string;
  iconText: string;
  laneBg: string;
  emptyHintBorder: string;
  emptyHintText: string;
}

/**
 * Per-lane layout. Audio + Video share the standard size; Image is the
 * shorter `compact` variant. Add new layouts here if a future lane needs one.
 */
export interface LaneLayout {
  /** Tailwind height class for the clips area (e.g. 'h-14' or 'h-12'). */
  laneHeight: string;
  /** Tailwind class for the empty-hint inset (e.g. 'inset-1' or 'inset-0.5'). */
  emptyHintInset: string;
  /** Tailwind classes for the absolute-positioned add button container. */
  addButtonTop: string;
  addButtonHeight: string;
}

export const STANDARD_LANE_LAYOUT: LaneLayout = {
  laneHeight: 'h-14',
  emptyHintInset: 'inset-1',
  addButtonTop: 'top-1',
  addButtonHeight: 'h-12',
};

export const COMPACT_LANE_LAYOUT: LaneLayout = {
  laneHeight: 'h-12',
  emptyHintInset: 'inset-0.5',
  addButtonTop: 'top-0.5',
  addButtonHeight: 'h-11',
};

interface MediaLaneShellProps {
  itemCount: number;
  hideHeader?: boolean;
  hideAdd?: boolean;
  onAdd: () => void;
  Icon: ComponentType<{ className?: string }>;
  /** i18n labels — pre-translated by the parent. */
  labelText: string;
  emptyText: string;
  addButtonText: string;
  /** Add-button x-coordinate in lane pixels (parent computes from items + zoom + scrollX). */
  addButtonLeftPx: number;
  theme: LaneTheme;
  layout: LaneLayout;
  /** Clip nodes (mapped TimelineClip elements) plus any lane-specific overlays
   *  (e.g. VideoLane's transition indicator pucks). */
  children: ReactNode;
}

/**
 * Shared structural shell for the four media-studio lanes (Text / Image /
 * Video / Audio). Owns: the colored header bar (icon + label + count),
 * the dashed empty-lane hint, the absolute-positioned add button, and the
 * outer container with the lane-color background. Per-lane behavior — trim
 * semantics, clip body components, transition indicators — stays in the
 * lane component that wraps this shell.
 *
 * Note: TextLane has its own pin-marker shape and does not consume this
 * shell today. The shell is consumed by AudioLane, VideoLane, and ImageLane.
 */
export default function MediaLaneShell({
  itemCount,
  hideHeader,
  hideAdd,
  onAdd,
  Icon,
  labelText,
  emptyText,
  addButtonText,
  addButtonLeftPx,
  theme,
  layout,
  children,
}: MediaLaneShellProps) {
  return (
    <div className="flex flex-col">
      {/* Lane header */}
      {!hideHeader && (
        <div className={`flex items-center gap-2 px-3 py-1.5 ${theme.headerBg} border-b ${theme.headerBorder}`}>
          <Icon className={`w-3.5 h-3.5 ${theme.iconText}`} />
          <span className={`typo-label ${theme.headerText}`}>{labelText}</span>
          {itemCount > 0 && (
            <span className={`ml-auto text-md ${theme.countBadgeText} ${theme.countBadgeBg} rounded-full px-1.5 py-0.5 tabular-nums`}>
              {itemCount}
            </span>
          )}
        </div>
      )}

      {/* Clips area */}
      <div className={`relative ${layout.laneHeight} ${theme.laneBg} border-b border-primary/10`}>
        {itemCount === 0 && (
          <div className={`absolute ${layout.emptyHintInset} rounded-card border border-dashed ${theme.emptyHintBorder} flex items-center justify-center`}>
            <span className={`text-md ${theme.emptyHintText}`}>{emptyText}</span>
          </div>
        )}

        {children}

        {/* Add button — positioned after the last clip */}
        {!hideAdd && (
          <div
            className={`absolute ${layout.addButtonTop} ${layout.addButtonHeight} flex items-center`}
            style={{ left: `${addButtonLeftPx}px` }}
          >
            <Button variant="ghost" size="xs" onClick={onAdd}>
              <Plus className="w-3.5 h-3.5" />
              {addButtonText}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Compute the x-coordinate (in lane pixels) where the add button should sit. */
export function addButtonLeftPx<T extends { startTime: number; duration: number }>(
  items: T[],
  zoom: number,
  scrollX: number,
): number {
  if (items.length === 0) return 8;
  return Math.max(...items.map((c) => (c.startTime + c.duration) * zoom - scrollX)) + 8;
}
