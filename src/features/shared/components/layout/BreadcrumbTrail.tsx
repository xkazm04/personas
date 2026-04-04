import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { useBreadcrumbTrail, type BreadcrumbSegment } from '@/hooks/navigation/useBreadcrumbTrail';
import { useSystemStore } from '@/stores/systemStore';

/** Renders a single breadcrumb segment (clickable or current). */
function Segment({ segment, isCurrent }: { segment: BreadcrumbSegment; isCurrent: boolean }) {
  if (isCurrent) {
    return (
      <span className="text-foreground/90 typo-caption select-none truncate max-w-[180px]">
        {segment.label}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={segment.onClick}
      className="typo-caption text-muted-foreground/60 hover:text-foreground/80 transition-colors cursor-pointer truncate max-w-[140px] focus-ring rounded-sm"
    >
      {segment.label}
    </button>
  );
}

/** Chevron separator between breadcrumb segments. */
function Separator() {
  return <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />;
}

/** Dropdown for collapsed middle segments on narrow viewports. */
function EllipsisDropdown({ segments }: { segments: BreadcrumbSegment[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="typo-caption text-muted-foreground/60 hover:text-foreground/80 transition-colors cursor-pointer p-0.5 rounded-sm focus-ring"
        aria-label="Show hidden breadcrumbs"
        aria-expanded={open}
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-md shadow-elevation-3 py-1 min-w-[140px]">
          {segments.map((seg, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                seg.onClick?.();
                setOpen(false);
              }}
              className="block w-full text-left px-3 py-1.5 typo-caption text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              {seg.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Breadcrumb trail component for nested feature navigation.
 *
 * Renders the navigation path derived from the current sidebar section,
 * active sub-tab, and detail view. On narrow viewports (below md breakpoint),
 * middle segments collapse into an ellipsis dropdown.
 */
export default function BreadcrumbTrail() {
  const sidebarSection = useSystemStore((s) => s.sidebarSection);
  const trail = useBreadcrumbTrail();

  // Never show breadcrumbs for plugin or home pages
  if (sidebarSection === 'plugins' || sidebarSection === 'home') return null;

  // Responsive: measure container width and collapse middle segments if needed
  const containerRef = useRef<HTMLElement>(null);
  const [isNarrow, setIsNarrow] = useState(false);

  const checkWidth = useCallback(() => {
    if (!containerRef.current) return;
    setIsNarrow(containerRef.current.offsetWidth < 480);
  }, []);

  useEffect(() => {
    checkWidth();
    const observer = new ResizeObserver(checkWidth);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [checkWidth]);

  // Don't render for single-segment trails (root views)
  if (trail.length <= 1) return null;

  // Determine which segments to show vs collapse
  let visibleSegments: Array<{ type: 'segment'; segment: BreadcrumbSegment; isCurrent: boolean } | { type: 'ellipsis'; segments: BreadcrumbSegment[] }>;

  if (isNarrow && trail.length > 2) {
    // Collapse middle segments into ellipsis
    const first = trail[0]!;
    const last = trail[trail.length - 1]!;
    const middle = trail.slice(1, -1);
    visibleSegments = [
      { type: 'segment', segment: first, isCurrent: false },
      { type: 'ellipsis', segments: middle },
      { type: 'segment', segment: last, isCurrent: true },
    ];
  } else {
    visibleSegments = trail.map((seg, i) => ({
      type: 'segment' as const,
      segment: seg,
      isCurrent: i === trail.length - 1,
    }));
  }

  return (
    <nav
      ref={containerRef}
      aria-label="Breadcrumb"
      className="flex items-center gap-1 px-4 py-1.5 min-h-[28px] border-b border-primary/5"
    >
      <LayoutGroup id="breadcrumb">
        <AnimatePresence mode="popLayout" initial={false}>
          {visibleSegments.map((item, i) => {
            const key = item.type === 'ellipsis'
              ? 'ellipsis'
              : `seg-${item.segment.label}`;

            return (
              <motion.div
                key={key}
                layoutId={key}
                className="flex items-center gap-1"
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 6 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
              >
                {i > 0 && <Separator />}
                {item.type === 'ellipsis' ? (
                  <EllipsisDropdown segments={item.segments} />
                ) : (
                  <Segment segment={item.segment} isCurrent={item.isCurrent} />
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </LayoutGroup>
    </nav>
  );
}
