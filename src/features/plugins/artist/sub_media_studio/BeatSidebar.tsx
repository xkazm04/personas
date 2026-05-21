import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Type } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { formatMMSS } from '../utils/format';
import type { TextItem } from './types';
import type { PlaybackEngine } from './hooks/useTimelinePlayback';

interface BeatSidebarProps {
  beats: TextItem[];
  engine: PlaybackEngine;
  onSeek: (time: number) => void;
  onSelect?: (id: string) => void;
}

/**
 * Right-rail list of every text beat in start-time order. The active beat is
 * the latest one whose startTime is <= the current playhead, refreshed via
 * imperative engine.subscribe so the list re-renders only when the active
 * beat actually changes — not 60 times a second. Single click seeks to that
 * beat; double click (delegates to onSelect when provided) selects the beat
 * on the timeline so the user can edit its description through the toolbar.
 */
export default function BeatSidebar({
  beats,
  engine,
  onSeek,
  onSelect,
}: BeatSidebarProps) {
  const { t, tx } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...beats].sort((a, b) => a.startTime - b.startTime),
    [beats],
  );

  useEffect(() => {
    return engine.subscribe((time) => {
      let active: string | null = null;
      for (const b of sorted) {
        if (b.startTime <= time + 0.01) active = b.id;
        else break;
      }
      setActiveId((prev) => (prev === active ? prev : active));
    });
  }, [sorted, engine]);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="w-6 flex-shrink-0 self-stretch flex flex-col items-center justify-center gap-2 border-l border-primary/10 bg-card/30 hover:bg-card/60 transition-colors"
        title={t.media_studio.beat_sidebar_expand}
        aria-label={t.media_studio.beat_sidebar_expand}
      >
        <ChevronLeft className="w-3.5 h-3.5 text-foreground" />
        <Type className="w-3.5 h-3.5 text-amber-400" />
        {sorted.length > 0 && (
          <span className="text-[11px] text-foreground tabular-nums">{sorted.length}</span>
        )}
      </button>
    );
  }

  return (
    <div className="w-56 flex-shrink-0 self-stretch flex flex-col border-l border-primary/10 bg-card/30 min-h-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-primary/10">
        <div className="flex items-center gap-2">
          <Type className="w-3.5 h-3.5 text-amber-400" />
          <span className="typo-label text-foreground">{t.media_studio.beat_sidebar_title}</span>
          <span className="text-[11px] text-foreground tabular-nums">
            {tx(t.media_studio.beat_sidebar_count, { count: sorted.length })}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="p-1 rounded hover:bg-secondary/40 text-foreground"
          title={t.media_studio.beat_sidebar_collapse}
          aria-label={t.media_studio.beat_sidebar_collapse}
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-3 text-center">
          <p className="text-md text-foreground">{t.media_studio.beat_sidebar_empty}</p>
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto py-1">
          {sorted.map((beat) => {
            const active = beat.id === activeId;
            return (
              <li key={beat.id}>
                <button
                  type="button"
                  onClick={() => onSeek(beat.startTime)}
                  onDoubleClick={() => onSelect?.(beat.id)}
                  className={`w-full text-left px-3 py-1.5 flex items-baseline gap-2 transition-colors ${
                    active
                      ? 'bg-amber-500/10 border-l-2 border-amber-400'
                      : 'border-l-2 border-transparent hover:bg-secondary/30'
                  }`}
                  title={beat.text || beat.label}
                >
                  <span className="text-[11px] text-foreground font-mono tabular-nums w-10 flex-shrink-0">
                    {formatMMSS(beat.startTime)}
                  </span>
                  <span className={`text-md truncate ${active ? 'text-amber-300' : 'text-foreground'}`}>
                    {beat.label || beat.text || t.media_studio.beat_sidebar_untitled}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
