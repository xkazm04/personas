import { useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, Cpu, Bot } from 'lucide-react';
import { STATE_ICON, stateMeta, TerminalStats } from './monitorProtoMeta';
import type { ProtoTerminal } from './mockFleet';

/**
 * Layer 2 of the two-layered UX: the fullscreen terminal a monitor tile
 * expands into on click. Shares a framer-motion `layoutId` with the tile that
 * opened it, so the tile visually GROWS into the fullscreen pane and shrinks
 * back on close — the "smooth transition back and forth" the monitor needs.
 *
 * In production this body is `FleetTerminalPane` (the durable xterm); the
 * mock renders a fake screen so all three variants can demo the transition
 * without spawning anything.
 */
export function FullscreenTerminalMock({ t, onClose }: { t: ProtoTerminal; onClose: () => void }) {
  const meta = stateMeta(t.state);
  const Icon = STATE_ICON[t.state];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Stable fake scrollback derived from the terminal id.
  const lines = useMemo(() => {
    const base = [
      `> claude "${t.label}"`,
      '● Reading src/features/… (3 files)',
      '● Bash: npm run test -- --run  (background)',
      '● Task: explore-context  → subagent started',
      '✻ Thinking…',
      `● Edit: applied 2 hunks`,
      '● Bash: npx tsc --noEmit  ✓ clean',
      t.state === 'awaiting_input' ? '? Which approach should I take? (1/2/3)' : '· turn complete — idle',
    ];
    return base;
  }, [t]);

  return (
    <motion.div
      layoutId={`proto-term-${t.id}`}
      className="absolute inset-0 z-30 flex flex-col rounded-modal border border-primary/25 bg-[#0a0a0c] overflow-hidden shadow-elevation-4"
      transition={{ type: 'spring', stiffness: 320, damping: 32 }}
    >
      {/* Header — same identity row the tile shows, plus the full stat set. */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10 bg-secondary/20 shrink-0">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to monitor"
          className="p-1 rounded-interactive text-foreground hover:bg-secondary/50 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <Icon className={`w-4 h-4 ${meta.text}`} aria-hidden="true" />
        <span className="typo-body font-medium text-foreground truncate">{t.label}</span>
        <span className={`px-1.5 py-0.5 rounded-card typo-caption ${meta.chip} ${meta.text}`}>{t.state}</span>
        <span className="typo-caption text-foreground opacity-60">{t.project}</span>
        <div className="flex-1" />
        <TerminalStats t={t} />
      </div>

      {/* Mock terminal body. */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.12, duration: 0.2 }}
        className="flex-1 min-h-0 overflow-auto px-4 py-3 font-mono text-[13px] leading-6 text-foreground opacity-90"
      >
        {lines.map((l, i) => (
          <div key={i} className={l.startsWith('?') ? 'text-violet-300' : l.startsWith('✻') ? 'opacity-60' : ''}>{l}</div>
        ))}
        <div className="mt-2 text-foreground opacity-50">▌</div>
      </motion.div>

      {/* Sub-work strip — the "below the terminal" surface: live subprocesses
          and subagents this session has fanned out, each individually visible. */}
      {(t.subprocs > 0 || t.subagentsTotal > 0) && (
        <div className="shrink-0 border-t border-primary/10 bg-secondary/10 px-3 py-1.5 flex items-center gap-1.5 overflow-x-auto">
          {Array.from({ length: t.subprocs }, (_, i) => (
            <span key={`p${i}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-card border border-primary/15 bg-secondary/40 typo-caption text-foreground opacity-80">
              <Cpu className="w-3 h-3 text-status-info" aria-hidden="true" /> bg-proc {i + 1}
            </span>
          ))}
          {Array.from({ length: Math.min(t.subagentsTotal, 6) }, (_, i) => (
            <span
              key={`a${i}`}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-card border typo-caption ${
                i < t.subagentsActive
                  ? 'border-status-info/40 bg-status-info/10 text-status-info'
                  : 'border-primary/10 bg-secondary/30 text-foreground opacity-50'
              }`}
            >
              <Bot className="w-3 h-3" aria-hidden="true" /> agent {i + 1}{i < t.subagentsActive ? ' · live' : ''}
            </span>
          ))}
        </div>
      )}
    </motion.div>
  );
}
