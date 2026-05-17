import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, ExternalLink, EyeOff, Music, Radio } from 'lucide-react';
import { openExternalUrl } from '@/api/system/system';
import { silentCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import type { StationSourceKind } from '@/stores/slices/system/radioSlice';
import type { Station } from '@/lib/bindings/Station';

interface StationPickerProps {
  stations: Station[];
  currentStationId: string | null | undefined;
  onPick: (stationId: string) => void;
  onClose: () => void;
}

export default function StationPicker({
  stations,
  currentStationId,
  onPick,
  onClose,
}: StationPickerProps) {
  const { t, tx } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const disabledStationIds = useSystemStore((s) => s.disabledStationIds);
  const collapsedSourceKinds = useSystemStore((s) => s.collapsedSourceKinds);
  const setSourceKindCollapsed = useSystemStore((s) => s.setSourceKindCollapsed);
  const setStationDisabled = useSystemStore((s) => s.setStationDisabled);
  /**
   * When non-null, a small actions menu floats at viewport (clientX,
   * clientY) for the named station. Right-click opens it; click-outside
   * or any action closes it. We render it as a portal-less sibling of
   * the picker so it can paint over the picker's own bounds.
   */
  const [contextMenu, setContextMenu] = useState<{
    stationId: string;
    x: number;
    y: number;
  } | null>(null);

  // Hide stations the user has disabled in Settings → Account. Currently
  // playing stations stay playing even if disabled — the picker just hides
  // them; user can stop manually or re-enable in settings.
  const visibleStations = useMemo(() => {
    if (disabledStationIds.length === 0) return stations;
    const disabled = new Set(disabledStationIds);
    return stations.filter((s) => !disabled.has(s.id));
  }, [stations, disabledStationIds]);

  const { youtube, streams } = useMemo(() => {
    const yt: Station[] = [];
    const st: Station[] = [];
    for (const s of visibleStations) {
      if (s.source.kind === 'youtubeTracks') yt.push(s);
      else st.push(s);
    }
    return { youtube: yt, streams: st };
  }, [visibleStations]);

  // Only group when both kinds have visible entries; one-kind catalogs
  // get the flat list back so the heading doesn't feel decorative.
  const showGrouping = youtube.length > 0 && streams.length > 0;
  const collapsedSet = new Set(collapsedSourceKinds);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      // Close the context menu first if open — clicking outside it
      // shouldn't also close the underlying picker in one go.
      if (contextMenu) {
        setContextMenu(null);
        return;
      }
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (contextMenu) {
          setContextMenu(null);
          return;
        }
        onClose();
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, contextMenu]);

  const onRowContextMenu = (e: React.MouseEvent, stationId: string) => {
    e.preventDefault();
    setContextMenu({ stationId, x: e.clientX, y: e.clientY });
  };

  const contextStation = contextMenu
    ? visibleStations.find((s) => s.id === contextMenu.stationId) ?? null
    : null;

  const renderStation = (station: Station) => {
    const active = station.id === currentStationId;
    const isYt = station.source.kind === 'youtubeTracks';
    const trackCount =
      station.source.kind === 'youtubeTracks' ? station.source.tracks.length : null;
    return (
      <li key={station.id}>
        <button
          type="button"
          onClick={() => onPick(station.id)}
          onContextMenu={(e) => onRowContextMenu(e, station.id)}
          className={`w-full flex items-center gap-3 px-3 py-2 typo-body text-left transition-colors ${
            active ? 'bg-secondary/40' : 'hover:bg-secondary/20'
          }`}
        >
          <span
            aria-hidden
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ background: station.accentColor }}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <p className="typo-body font-medium truncate">{station.name}</p>
              {station.sourceLabel && (
                <span className="ml-auto shrink-0 typo-caption text-foreground/60 px-1.5 py-0.5 rounded bg-secondary/30 flex items-center gap-1">
                  {isYt ? (
                    <Music className="w-3 h-3 text-foreground/55" />
                  ) : (
                    <Radio className="w-3 h-3 text-foreground/55" />
                  )}
                  {station.sourceLabel}
                </span>
              )}
            </div>
            <p className="typo-caption text-foreground/60 truncate">
              {station.description}
              {trackCount !== null && (
                <span className="text-foreground/45"> · {trackCount}</span>
              )}
            </p>
          </div>
          {active && <Check className="w-4 h-4 text-foreground/80 shrink-0" />}
        </button>
      </li>
    );
  };

  const renderGroup = (
    kind: StationSourceKind,
    label: string,
    Icon: typeof Music,
    list: Station[],
  ) => {
    if (list.length === 0) return null;
    const collapsed = collapsedSet.has(kind);
    return (
      <div key={kind}>
        <button
          type="button"
          onClick={() => setSourceKindCollapsed(kind, !collapsed)}
          className="w-full flex items-center gap-2 px-3 py-1.5 typo-caption text-foreground/65 hover:text-foreground/90 hover:bg-secondary/15 transition-colors"
          aria-label={t.radio.group_toggle_label}
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <ChevronRight className="w-3 h-3 shrink-0" />
          ) : (
            <ChevronDown className="w-3 h-3 shrink-0" />
          )}
          <Icon className="w-3 h-3 shrink-0 text-foreground/55" />
          <span className="font-medium uppercase tracking-wide">{label}</span>
          <span className="ml-auto text-foreground/45 tabular-nums">
            {tx(t.radio.group_count, { count: list.length })}
          </span>
        </button>
        {!collapsed && <ul className="py-1">{list.map(renderStation)}</ul>}
      </div>
    );
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t.radio.stations_label}
      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-80 rounded-card border border-primary/10 bg-background shadow-elevation-3 overflow-hidden"
    >
      <div className="px-3 py-2 border-b border-primary/8 flex items-center gap-2">
        <Radio className="w-3.5 h-3.5 text-foreground/60" />
        <span className="typo-caption font-medium text-foreground/85">
          {t.radio.stations_label}
        </span>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {visibleStations.length === 0 && (
          <p className="px-3 py-3 typo-caption text-foreground/55 text-center">
            {t.radio.picker_empty}
          </p>
        )}
        {!showGrouping && visibleStations.length > 0 && (
          <ul className="py-1">{visibleStations.map(renderStation)}</ul>
        )}
        {showGrouping && (
          <div className="divide-y divide-primary/5">
            {renderGroup('youtubeTracks', t.radio.group_youtube, Music, youtube)}
            {renderGroup('stream', t.radio.group_stream, Radio, streams)}
          </div>
        )}
      </div>
      {contextMenu && contextStation && (
        <div
          role="menu"
          aria-label={t.radio.row_menu_label}
          className="fixed z-50 min-w-44 rounded-card border border-primary/10 bg-background shadow-elevation-3 py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className="w-full flex items-center gap-2 px-3 py-1.5 typo-caption text-left text-foreground/85 hover:bg-secondary/30 transition-colors"
            onClick={() => {
              setStationDisabled(contextStation.id, true);
              setContextMenu(null);
            }}
          >
            <EyeOff className="w-3.5 h-3.5 text-foreground/55" />
            {t.radio.row_menu_hide}
          </button>
          {contextStation.sourceUrl && (
            <button
              type="button"
              role="menuitem"
              className="w-full flex items-center gap-2 px-3 py-1.5 typo-caption text-left text-foreground/85 hover:bg-secondary/30 transition-colors"
              onClick={() => {
                if (contextStation.sourceUrl) {
                  openExternalUrl(contextStation.sourceUrl).catch(
                    silentCatch('radio:open-source'),
                  );
                }
                setContextMenu(null);
              }}
            >
              <ExternalLink className="w-3.5 h-3.5 text-foreground/55" />
              {t.radio.row_menu_open_source}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
