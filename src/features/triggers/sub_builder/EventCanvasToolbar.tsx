import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PanelLeft, PanelLeftClose, RotateCcw, LayoutGrid,
  StickyNote, FlaskConical, Sparkles, MoreHorizontal,
} from 'lucide-react';
import { SystemEventsToolbar } from './palettes/EventSourcePalette';
import { useTranslation } from '@/i18n/useTranslation';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ToolbarProps {
  paletteCollapsed: boolean;
  dryRunActive: boolean;
  assistantOpen: boolean;
  onCanvasEventTypes: Set<string>;
  onTogglePalette: () => void;
  onRefresh: () => void;
  onAutoLayout: () => void;
  onAddNote: () => void;
  onToggleDryRun: () => void;
  onToggleAssistant: () => void;
  onStartPointerDrag: (type: 'event' | 'persona', value: string, label: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const BTN = 'flex items-center gap-1 px-2 py-1.5 rounded-input border transition-colors text-foreground';
const BTN_DEFAULT = `${BTN} bg-card border-primary/10 hover:bg-secondary/60`;
const DIVIDER = 'w-px h-5 bg-primary/10 mx-0.5 shrink-0';
const COLLAPSE_THRESHOLD = 520; // px — below this, secondary groups collapse

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function EventCanvasToolbar({
  paletteCollapsed, dryRunActive, assistantOpen, onCanvasEventTypes,
  onTogglePalette, onRefresh, onAutoLayout, onAddNote,
  onToggleDryRun, onToggleAssistant, onStartPointerDrag,
}: ToolbarProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  // Observe available width
  useEffect(() => {
    const el = containerRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setCollapsed(entry.contentRect.width < COLLAPSE_THRESHOLD);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Close "More" dropdown on outside click
  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [moreOpen]);

  const closeMore = useCallback(() => setMoreOpen(false), []);

  /* ---- Shared button renderers ---- */

  const layoutBtn = (inDropdown?: boolean) => (
    <button
      key="layout"
      onClick={() => { onAutoLayout(); closeMore(); }}
      className={inDropdown ? dropdownItemCls : BTN_DEFAULT}
      title={t.triggers.toolbar_title_auto_layout}
    >
      <LayoutGrid className="w-3.5 h-3.5" />
      <span className="text-[10px]">Layout</span>
    </button>
  );

  const noteBtn = (inDropdown?: boolean) => (
    <button
      key="note"
      onClick={() => { onAddNote(); closeMore(); }}
      className={inDropdown ? dropdownItemCls : BTN_DEFAULT}
      title={t.triggers.toolbar_title_add_note}
    >
      <StickyNote className={`w-3.5 h-3.5 ${inDropdown ? 'text-amber-400' : 'text-amber-400'}`} />
      <span className="text-[10px] text-foreground">Note</span>
    </button>
  );

  const dryRunBtn = (inDropdown?: boolean) => (
    <button
      key="dryrun"
      onClick={() => { onToggleDryRun(); closeMore(); }}
      className={inDropdown
        ? dropdownItemCls + (dryRunActive ? ' text-amber-400' : '')
        : `${BTN} ${dryRunActive ? 'bg-amber-500/15 border-amber-500/30 text-amber-400' : 'bg-card border-primary/10 hover:bg-secondary/60'}`}
      title={dryRunActive ? t.triggers.toolbar_title_stop_dry_run : t.triggers.toolbar_title_start_dry_run}
    >
      <FlaskConical className="w-3.5 h-3.5" />
      <span className="text-[10px]">{t.triggers.toolbar_dry_run}</span>
    </button>
  );

  const assistantBtn = (inDropdown?: boolean) => (
    <button
      key="assistant"
      onClick={() => { onToggleAssistant(); closeMore(); }}
      className={inDropdown
        ? dropdownItemCls + (assistantOpen ? ' text-indigo-400' : '')
        : `${BTN} ${assistantOpen ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-400' : 'bg-card border-primary/10 hover:bg-secondary/60'}`}
      title={t.triggers.toolbar_title_assistant}
    >
      <Sparkles className="w-3.5 h-3.5" />
      <span className="text-[10px]">Assistant</span>
    </button>
  );

  /* ---- Render ---- */

  return (
    <div ref={containerRef} className="absolute top-2 left-2 z-30 flex items-center gap-1">
      {/* Group 1 — Navigation (always visible) */}
      <button
        onClick={onTogglePalette}
        className="p-1.5 rounded-input bg-card border border-primary/10 hover:bg-secondary/60 transition-colors"
        title={paletteCollapsed ? 'Show sidebar' : 'Hide sidebar'}
      >
        {paletteCollapsed
          ? <PanelLeft className="w-3.5 h-3.5 text-foreground" />
          : <PanelLeftClose className="w-3.5 h-3.5 text-foreground" />}
      </button>

      <button
        onClick={onRefresh}
        className={BTN_DEFAULT}
        title="Refresh"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        <span className="text-[10px]">Refresh</span>
      </button>

      <div className={DIVIDER} />

      {/* When NOT collapsed — show all groups inline */}
      {!collapsed && (
        <>
          {/* Group 2 — Layout */}
          {layoutBtn()}
          {noteBtn()}

          <div className={DIVIDER} />

          {/* Group 3 — Debug / AI */}
          {dryRunBtn()}
          {assistantBtn()}

          <div className={DIVIDER} />
        </>
      )}

      {/* When collapsed — "More" overflow dropdown */}
      {collapsed && (
        <>
          <div ref={moreRef} className="relative">
            <button
              onClick={() => setMoreOpen(v => !v)}
              className={`p-1.5 rounded-input border transition-colors ${moreOpen ? 'bg-secondary/80 border-primary/20' : 'bg-card border-primary/10 hover:bg-secondary/60'}`}
              title={t.triggers.more_tools_title}
            >
              <MoreHorizontal className="w-3.5 h-3.5 text-foreground" />
            </button>

            {moreOpen && (
              <div className="absolute top-full left-0 mt-1.5 z-[60] min-w-[150px] rounded-card bg-card border border-primary/10 shadow-elevation-3 py-1">
                <div className="px-2.5 py-1 text-[9px] uppercase tracking-wider text-foreground font-medium">Layout</div>
                {layoutBtn(true)}
                {noteBtn(true)}
                <div className="h-px bg-primary/10 my-1" />
                <div className="px-2.5 py-1 text-[9px] uppercase tracking-wider text-foreground font-medium">Tools</div>
                {dryRunBtn(true)}
                {assistantBtn(true)}
              </div>
            )}
          </div>

          <div className={DIVIDER} />
        </>
      )}

      {/* Group 4 — Events (always visible) */}
      <SystemEventsToolbar
        onCanvasEventTypes={onCanvasEventTypes}
        onStartPointerDrag={onStartPointerDrag}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Dropdown item style                                                */
/* ------------------------------------------------------------------ */

const dropdownItemCls = 'flex items-center gap-2 w-full px-3 py-2 typo-caption text-foreground hover:bg-secondary/60 transition-colors cursor-pointer';
