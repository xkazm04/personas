// QuickAnswerPopover — the header surface for things waiting on a human.
//
// ⚠️ PROTOTYPE SCAFFOLD (/prototype round 1, 2026-07-29). This file currently
// hosts an A/B switcher between three surfaces:
//   • Baseline  — the shipped 576px anchored popover (build questions + reviews)
//   • Deck      — app-size swipe deck over the UNIFIED triage queue
//   • Cockpit   — app-size 3-pane keyboard-first surface over the same queue
// The switcher and the losing variants are deleted at consolidation; consumers
// (TrayOverlays) never see any of it — the exported name and props are unchanged.
//
// The variants triage FOUR queues at once (persona reviews · backlog ideas ·
// workspace practices · build questions) through `triage/useUnifiedTriage`.
//
// Hook mounting is deliberately split across component boundaries: the baseline
// mounts `usePendingInteractions`, the variants mount `useUnifiedTriage` (which
// mounts it internally). Only ONE is ever rendered, so we never double-mount the
// polling loops — the mistake this file's history already records once.

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Activity } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { usePendingInteractions } from './usePendingInteractions';
import { QuickAnswerBodyView } from './QuickAnswerBody';
import { useUnifiedTriage } from './triage/useUnifiedTriage';

const TriageDeckVariant = lazy(() =>
  import('./triage/TriageDeckVariant').then((m) => ({ default: m.TriageDeckVariant })),
);
const TriageCockpitVariant = lazy(() =>
  import('./triage/TriageCockpitVariant').then((m) => ({ default: m.TriageCockpitVariant })),
);

interface QuickAnswerPopoverProps {
  onClose: () => void;
  onOpenMonitor: () => void;
}

/* -- throwaway switcher ---------------------------------------------------- */

type QuickAnswerVariant = 'baseline' | 'deck' | 'cockpit';

const VARIANTS: { id: QuickAnswerVariant; label: string; hint: string }[] = [
  { id: 'baseline', label: 'Baseline', hint: 'Shipped popover' },
  { id: 'deck', label: 'Deck', hint: 'Swipe one at a time' },
  { id: 'cockpit', label: 'Cockpit', hint: 'Read the whole queue' },
];

function VariantSwitcher({
  value,
  onChange,
}: {
  value: QuickAnswerVariant;
  onChange: (v: QuickAnswerVariant) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 p-0.5 rounded-interactive border border-primary/15 bg-secondary/30">
      {VARIANTS.map((v) => (
        <button
          key={v.id}
          type="button"
          onClick={() => onChange(v.id)}
          title={v.hint}
          aria-pressed={value === v.id}
          className={`px-2.5 py-1 rounded-interactive typo-caption transition-colors ${
            value === v.id
              ? 'bg-primary/15 text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
          }`}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

/* -- variant host ---------------------------------------------------------- */

/** Mounts the unified queue and renders whichever app-size variant is active.
 *  Separate component so the queue hook only exists while a variant is shown. */
function TriageVariantHost({
  variant,
  onClose,
  switcher,
}: {
  variant: Exclude<QuickAnswerVariant, 'baseline'>;
  onClose: () => void;
  switcher: React.ReactNode;
}) {
  const selectPersona = useAgentStore((s) => s.selectPersona);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setEditorTab = useSystemStore((s) => s.setEditorTab);

  // Deep-link for questions that need the full builder (connector picker /
  // file attach) — mirrors QuickAnswerBody's openBuilder.
  const openBuilder = (personaId: string) => {
    setSidebarSection('personas');
    setEditorTab('matrix' as Parameters<typeof setEditorTab>[0]);
    selectPersona(personaId);
    onClose();
  };

  const queue = useUnifiedTriage(undefined, openBuilder);
  const Variant = variant === 'deck' ? TriageDeckVariant : TriageCockpitVariant;

  return (
    <Suspense fallback={null}>
      <Variant queue={queue} onClose={onClose} switcher={switcher} />
    </Suspense>
  );
}

/* -- baseline (shipped surface, unchanged behaviour) ----------------------- */

function QuickAnswerBaseline({
  onClose,
  onOpenMonitor,
  switcher,
}: QuickAnswerPopoverProps & { switcher: React.ReactNode }) {
  const { t, tx } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  // Single data mount for the whole popover: header chip AND body share this
  // instance. Calling usePendingInteractions here and again inside
  // QuickAnswerBody double-mounted four polling loops per open popover.
  const interactions = usePendingInteractions();
  const { total } = interactions;

  // Esc closes; click-outside closes. (Route nav / Back already clear the
  // header overlay centrally in uiSlice.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      // Ignore clicks on the titlebar trigger — it toggles the overlay itself,
      // so closing here would race the re-click into a close-then-reopen.
      if (target?.closest?.('[data-quick-answer-trigger]')) return;
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    // Defer click-outside so the opening click on the titlebar button doesn't
    // immediately close the just-opened popover.
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(id);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  return (
    <motion.div
      ref={panelRef}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.14 }}
      aria-label={tx(t.monitor.quick_aria, { count: total })}
      data-testid="quick-answer-popover"
      className="fixed top-[var(--titlebar-height,40px)] right-2 z-50 w-[576px] max-w-[calc(100vw-1rem)] max-h-[80vh] flex flex-col rounded-modal border border-primary/15 bg-background shadow-elevation-4 overflow-hidden"
    >
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between gap-2 px-4 h-12 border-b border-primary/10 bg-secondary/15">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="typo-heading-lg font-semibold text-foreground">{t.monitor.quick_title}</span>
          {total > 0 && <span className="typo-caption text-foreground tabular-nums">{total}</span>}
        </div>
        <div className="flex items-center gap-1">
          {switcher}
          <button
            type="button"
            onClick={onOpenMonitor}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/15 bg-secondary/20 typo-caption text-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
            data-testid="quick-answer-open-monitor"
          >
            <Activity className="w-3.5 h-3.5" />
            {t.monitor.quick_open_monitor}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.monitor.quick_close}
            className="p-1.5 rounded-modal border border-primary/15 text-foreground hover:text-foreground hover:bg-secondary/30 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-4">
        <QuickAnswerBodyView interactions={interactions} onAfterBuilderNav={onClose} />
      </div>
    </motion.div>
  );
}

/* -- exported surface ------------------------------------------------------ */

export function QuickAnswerPopover(props: QuickAnswerPopoverProps) {
  const [variant, setVariant] = useState<QuickAnswerVariant>('baseline');
  const switcher = <VariantSwitcher value={variant} onChange={setVariant} />;

  if (variant === 'baseline') {
    return <QuickAnswerBaseline {...props} switcher={switcher} />;
  }
  return <TriageVariantHost variant={variant} onClose={props.onClose} switcher={switcher} />;
}

export default QuickAnswerPopover;
