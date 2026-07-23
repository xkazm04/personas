// Idea-scan dispatch popover — opened from a project's Ideas dimension cell.
// Mirrors the Idea Scanner's structure (the same SCAN_AGENTS grouped by the
// same categories); picking an agent dispatches ONE scan for this project
// through the canonical recorded pipeline (dev_tools_run_scan — writes the
// DevScan row the freshness colour reads). Positions fixed + window-clamped,
// closes on Esc / outside click, like the wall's popovers.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Lightbulb, X } from 'lucide-react';

import { AGENT_CATEGORIES, SCAN_AGENTS } from '@/features/plugins/dev-tools/constants/scanAgents';
import type { DevScan } from '@/lib/bindings/DevScan';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';

const WIDTH = 316;

export function IdeaScanPopover({ name, scans, anchor, busy, onRun, onClose }: {
  name: string;
  /** Recent DevScan rows for this project (newest first) — header context. */
  scans: DevScan[];
  anchor: { x: number; y: number };
  busy: boolean;
  onRun: (agentKey: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const last = scans[0];

  useLayoutEffect(() => {
    const panelH = panelRef.current?.offsetHeight ?? 320;
    const spaceBelow = window.innerHeight - anchor.y;
    const top = spaceBelow < panelH + 14 && anchor.y > spaceBelow ? Math.max(8, anchor.y - panelH - 6) : anchor.y + 6;
    const left = Math.max(8, Math.min(anchor.x, window.innerWidth - WIDTH - 8));
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => { if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose(); };
    window.addEventListener('keydown', onKey);
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => { window.removeEventListener('keydown', onKey); window.clearTimeout(id); document.removeEventListener('mousedown', onDown); };
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      className="fixed z-50 rounded-card border border-primary/20 bg-secondary/95 shadow-elevation-3 overflow-hidden"
      style={{ width: WIDTH, top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
      data-testid="mm-idea-scan-popover"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-foreground/10">
        <Lightbulb className="w-4 h-4 text-amber-400 shrink-0" aria-hidden />
        <span className="typo-caption font-semibold text-foreground truncate">{t.mastermind.scan_title} — {name}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.common.close}
          className="ml-auto shrink-0 p-1 rounded-interactive text-foreground/60 hover:text-foreground hover:bg-primary/10 transition-colors focus-ring"
        >
          <X className="w-3.5 h-3.5" aria-hidden />
        </button>
      </div>

      <div className="px-3 py-1.5 border-b border-foreground/[0.07] typo-caption text-foreground/55">
        {busy ? t.mastermind.scan_running : last ? (
          <span className="inline-flex items-center gap-1">
            {t.mastermind.scan_last} <RelativeTime timestamp={last.created_at} className="tabular-nums" /> · {last.scan_type.split(',')[0]}{last.scan_type.includes(',') ? '…' : ''}
          </span>
        ) : t.mastermind.scan_never}
      </div>

      <div className="max-h-[340px] overflow-y-auto px-3 py-2 space-y-2.5">
        {AGENT_CATEGORIES.map((cat) => {
          const agents = SCAN_AGENTS.filter((a) => a.categoryGroup === cat.key).sort((a, b) => a.label.localeCompare(b.label));
          if (agents.length === 0) return null;
          return (
            <div key={cat.key}>
              <span className="block typo-label text-foreground/50 uppercase tracking-wider mb-1">{cat.label}</span>
              <div className="flex flex-wrap gap-1">
                {agents.map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    disabled={busy}
                    onClick={() => onRun(a.key)}
                    title={a.description}
                    className="inline-flex items-center gap-1 px-2 py-1 typo-caption rounded-interactive border border-primary/12 text-foreground/85 hover:bg-primary/10 hover:text-foreground disabled:opacity-40 transition-colors focus-ring"
                    data-testid={`mm-scan-agent-${a.key}`}
                  >
                    <span aria-hidden>{a.emoji}</span>
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
