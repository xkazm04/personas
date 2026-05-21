// TriageGridVariant — full-screen dense matrix prototype.
// Mental model: a persona × priority spreadsheet. Each cell holds compact
// tiles, one per review. Click any tile to triage it in a side panel.
// Goal: fit ~100 reviews on a single 1440×900 viewport without scroll.

import { useMemo, useState, useCallback, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, AlertCircle, AlertTriangle, Info, Check, MessageSquare, Clock } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { formatRelativeTime } from '@/lib/utils/formatters';
import type { ManualReviewItem } from '@/lib/types/types';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';
import { stripPersonaPrefix } from '../libs/reviewHelpers';
import { ContextDataPreview } from './ReviewListItem';
import { DebtText, debtText } from '@/i18n/DebtText';


type SeverityBucket = 'critical' | 'warning' | 'info';

interface TriageGridVariantProps {
  reviews: ManualReviewItem[];
  isProcessing: boolean;
  onAction: (id: string, status: ManualReviewStatus, notes?: string) => void;
  onClose: () => void;
}

const SEV_META: Record<SeverityBucket, { label: string; icon: typeof AlertCircle; chip: string; ring: string; glow: string; tile: string }> = {
  critical: {
    label: 'Critical',
    icon: AlertCircle,
    chip: 'bg-red-500/10 text-red-400 border-red-500/30',
    ring: 'ring-red-500/40',
    glow: 'shadow-[0_0_20px_rgba(239,68,68,0.18)]',
    tile: 'bg-red-500/12 border-red-500/30 text-red-100 hover:bg-red-500/20',
  },
  warning: {
    label: 'Warning',
    icon: AlertTriangle,
    chip: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    ring: 'ring-amber-500/30',
    glow: 'shadow-[0_0_16px_rgba(245,158,11,0.14)]',
    tile: 'bg-amber-500/10 border-amber-500/25 text-amber-100 hover:bg-amber-500/18',
  },
  info: {
    label: 'Info',
    icon: Info,
    chip: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    ring: 'ring-blue-500/30',
    glow: '',
    tile: 'bg-blue-500/10 border-blue-500/22 text-blue-100 hover:bg-blue-500/18',
  },
};

function bucket(sev: string): SeverityBucket {
  if (sev === 'critical') return 'critical';
  if (sev === 'warning' || sev === 'high') return 'warning';
  return 'info';
}

interface PersonaRow {
  personaId: string;
  personaName: string;
  personaIcon: string | null;
  personaColor: string | null;
  cells: Record<SeverityBucket, ManualReviewItem[]>;
  total: number;
}

export function TriageGridVariant({ reviews, isProcessing, onAction, onClose }: TriageGridVariantProps) {
  const pending = useMemo(() => reviews.filter((r) => r.status === 'pending'), [reviews]);

  const personaRows = useMemo<PersonaRow[]>(() => {
    const byPersona = new Map<string, PersonaRow>();
    for (const r of pending) {
      const key = r.persona_id || 'unassigned';
      if (!byPersona.has(key)) {
        byPersona.set(key, {
          personaId: key,
          personaName: r.persona_name || 'Unassigned',
          personaIcon: r.persona_icon ?? null,
          personaColor: r.persona_color ?? null,
          cells: { critical: [], warning: [], info: [] },
          total: 0,
        });
      }
      const row = byPersona.get(key)!;
      row.cells[bucket(r.severity)].push(r);
      row.total += 1;
    }
    return Array.from(byPersona.values()).sort((a, b) => {
      const aCrit = a.cells.critical.length;
      const bCrit = b.cells.critical.length;
      if (aCrit !== bCrit) return bCrit - aCrit;
      return b.total - a.total;
    });
  }, [pending]);

  const counts = useMemo(() => {
    let c = 0, w = 0, i = 0;
    for (const r of pending) {
      const b = bucket(r.severity);
      if (b === 'critical') c++;
      else if (b === 'warning') w++;
      else i++;
    }
    return { critical: c, warning: w, info: i, total: pending.length };
  }, [pending]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);

  const activeReview = useMemo(() => pending.find((r) => r.id === activeId) ?? null, [pending, activeId]);

  useEffect(() => { setNotes(''); setShowNotes(false); }, [activeId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (activeId) setActiveId(null);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeId, onClose]);

  const handle = useCallback((status: ManualReviewStatus) => {
    if (!activeReview || isProcessing) return;
    onAction(activeReview.id, status, notes || undefined);
    setActiveId(null);
  }, [activeReview, isProcessing, notes, onAction]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-[80] bg-background/98 backdrop-blur-xl flex flex-col"
    >
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between gap-4 px-6 h-14 border-b border-primary/10 bg-secondary/15">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-modal bg-primary/10 border border-primary/20 flex items-center justify-center">
            <span className="typo-code font-mono text-primary text-xs">▦</span>
          </div>
          <div className="min-w-0">
            <h2 className="typo-heading font-semibold text-foreground leading-tight"><DebtText k="auto_triage_grid_caecd585" /></h2>
            <p className="typo-caption text-foreground leading-tight"><DebtText k="auto_persona_priority_matrix_ad3a7fcf" /> {personaRows.length} <DebtText k="auto_personas_275792d2" /> {counts.total} pending</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border typo-caption ${SEV_META.critical.chip}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-red-400" /> {counts.critical} critical
          </span>
          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border typo-caption ${SEV_META.warning.chip}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> {counts.warning} warning
          </span>
          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border typo-caption ${SEV_META.info.chip}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400" /> {counts.info} info
          </span>
          <button
            onClick={onClose}
            className="ml-2 p-1.5 rounded-modal border border-primary/15 text-foreground hover:text-foreground hover:bg-secondary/30 transition-colors"
            title={debtText("auto_close_esc_6ae84e4a")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Body — grid + detail */}
      <div className="flex-1 min-h-0 flex">
        {/* Matrix */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Column headers */}
          <div className="grid grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-px px-4 pt-3 pb-2">
            <div className="typo-caption text-foreground uppercase tracking-wider">Persona</div>
            {(['critical', 'warning', 'info'] as SeverityBucket[]).map((sev) => {
              const M = SEV_META[sev];
              const Icon = M.icon;
              return (
                <div key={sev} className="flex items-center gap-1.5 typo-caption uppercase tracking-wider">
                  <Icon className={`w-3 h-3 ${sev === 'critical' ? 'text-red-400' : sev === 'warning' ? 'text-amber-400' : 'text-blue-400'}`} />
                  <span className={sev === 'critical' ? 'text-red-400' : sev === 'warning' ? 'text-amber-400' : 'text-blue-400'}>{M.label}</span>
                </div>
              );
            })}
          </div>

          {/* Rows — single viewport, no scroll on outer container; cells handle overflow via flex-wrap */}
          <div className="flex-1 min-h-0 px-4 pb-3 overflow-y-auto">
            <div className="grid grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-px bg-primary/5 border border-primary/10 rounded-modal overflow-hidden">
              {personaRows.map((row) => (
                <PersonaGridRow
                  key={row.personaId}
                  row={row}
                  activeId={activeId}
                  onPick={setActiveId}
                />
              ))}
              {personaRows.length === 0 && (
                <div className="col-span-4 px-6 py-10 text-center typo-body text-foreground bg-secondary/10">
                  <DebtText k="auto_no_pending_reviews_the_queue_is_clear_11b3831a" />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Detail panel — slides in from right */}
        <AnimatePresence>
          {activeReview && (
            <motion.aside
              key={activeReview.id}
              initial={{ x: 460, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 460, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              className="w-[460px] flex-shrink-0 border-l border-primary/10 bg-secondary/15 flex flex-col"
            >
              <DetailHeader review={activeReview} onClose={() => setActiveId(null)} />
              <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
                <h3 className="typo-body font-semibold text-foreground leading-tight">
                  {stripPersonaPrefix(activeReview.title, activeReview.persona_name)}
                </h3>
                {activeReview.content && (
                  <p className="typo-body text-foreground/85 whitespace-pre-wrap leading-relaxed">{activeReview.content}</p>
                )}
                {activeReview.context_data && (
                  <div className="rounded-card border border-primary/10 bg-secondary/30 px-3 py-2.5">
                    <div className="typo-caption font-mono uppercase text-foreground mb-1.5">Context</div>
                    <ContextDataPreview raw={activeReview.context_data} />
                  </div>
                )}
                {showNotes && (
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={debtText("auto_notes_optional_dbde2edd")}
                    rows={3}
                    autoFocus
                    className="w-full px-3 py-2 rounded-card border border-primary/15 bg-secondary/25 typo-body text-foreground placeholder:text-foreground/40 resize-none outline-none focus-visible:border-primary/40"
                  />
                )}
              </div>
              <div className="flex-shrink-0 border-t border-primary/10 p-3 grid grid-cols-3 gap-2 bg-secondary/10">
                <button
                  onClick={() => handle('rejected' as ManualReviewStatus)}
                  disabled={isProcessing}
                  className="flex items-center justify-center gap-1.5 py-2 rounded-modal border border-red-500/25 bg-red-500/8 text-red-400 hover:bg-red-500/15 transition-colors disabled:opacity-40"
                >
                  <X className="w-4 h-4" />
                  <span className="typo-heading font-medium">Reject</span>
                </button>
                <button
                  onClick={() => setShowNotes((s) => !s)}
                  className={`flex items-center justify-center gap-1.5 py-2 rounded-modal border transition-colors ${showNotes ? 'border-primary/30 bg-primary/15 text-primary' : 'border-primary/15 bg-secondary/20 text-foreground hover:text-foreground'}`}
                  title={debtText("auto_toggle_notes_e84e3c00")}
                >
                  <MessageSquare className="w-4 h-4" />
                  <span className="typo-heading font-medium">Notes</span>
                </button>
                <button
                  onClick={() => handle('approved' as ManualReviewStatus)}
                  disabled={isProcessing}
                  className="flex items-center justify-center gap-1.5 py-2 rounded-modal border border-emerald-500/25 bg-emerald-500/8 text-emerald-400 hover:bg-emerald-500/15 transition-colors disabled:opacity-40"
                >
                  <Check className="w-4 h-4" />
                  <span className="typo-heading font-medium">Approve</span>
                </button>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      {/* Footer hint */}
      <div className="flex-shrink-0 h-9 px-6 flex items-center justify-between border-t border-primary/8 bg-secondary/10 typo-caption text-foreground">
        <span><DebtText k="auto_click_any_tile_to_triage_67061019" /> <kbd className="px-1 py-0.5 rounded bg-foreground/8 font-mono text-foreground">Esc</kbd> close</span>
        <span>{personaRows.length} <DebtText k="auto_personas_275792d2" /> {counts.total} <DebtText k="auto_pending_reviews_ba24020b" /></span>
      </div>
    </motion.div>
  );
}

interface PersonaGridRowProps {
  row: PersonaRow;
  activeId: string | null;
  onPick: (id: string) => void;
}

function PersonaGridRow({ row, activeId, onPick }: PersonaGridRowProps) {
  return (
    <>
      <div className="bg-secondary/20 px-3 py-2 flex items-center gap-2 min-w-0">
        <PersonaIcon icon={row.personaIcon} color={row.personaColor} display="framed" frameSize="lg" />
        <div className="min-w-0">
          <div className="typo-body text-foreground/90 truncate font-medium">{row.personaName}</div>
          <div className="typo-caption text-foreground">{row.total} review{row.total === 1 ? '' : 's'}</div>
        </div>
      </div>
      {(['critical', 'warning', 'info'] as SeverityBucket[]).map((sev) => (
        <GridCell
          key={sev}
          severity={sev}
          items={row.cells[sev]}
          activeId={activeId}
          onPick={onPick}
        />
      ))}
    </>
  );
}

interface GridCellProps {
  severity: SeverityBucket;
  items: ManualReviewItem[];
  activeId: string | null;
  onPick: (id: string) => void;
}

const CELL_VISIBLE_CAP = 5;

function GridCell({ severity, items, activeId, onPick }: GridCellProps) {
  const M = SEV_META[severity];
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) {
    return <div className="bg-background/40 px-2 py-2 flex items-center justify-center typo-caption text-foreground">—</div>;
  }
  const visible = expanded ? items : items.slice(0, CELL_VISIBLE_CAP);
  const overflow = items.length - visible.length;
  return (
    <div className="bg-background/40 px-2 py-2 flex flex-wrap content-start gap-1">
      {visible.map((r) => {
        const isActive = r.id === activeId;
        return (
          <button
            key={r.id}
            onClick={() => onPick(r.id)}
            title={r.title}
            className={`group inline-flex items-center gap-1.5 px-2 py-0.5 rounded-card border transition-all ${M.tile} ${isActive ? `ring-2 ${M.ring} ${M.glow}` : ''}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${severity === 'critical' ? 'bg-red-400' : severity === 'warning' ? 'bg-amber-400' : 'bg-blue-400'}`} />
            <span className="typo-caption max-w-[120px] truncate text-foreground/90 group-hover:text-foreground">
              {stripPersonaPrefix(r.title, r.persona_name) || 'Untitled'}
            </span>
          </button>
        );
      })}
      {overflow > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="inline-flex items-center px-2 py-0.5 rounded-card border border-primary/20 bg-secondary/30 text-foreground hover:text-foreground hover:bg-secondary/50 typo-caption transition-colors"
          title={`Show ${overflow} more`}
        >
          +{overflow}
        </button>
      )}
      {expanded && items.length > CELL_VISIBLE_CAP && (
        <button
          onClick={() => setExpanded(false)}
          className="inline-flex items-center px-2 py-0.5 rounded-card border border-primary/15 text-foreground hover:text-foreground typo-caption transition-colors"
          title="Collapse"
        >
          collapse
        </button>
      )}
    </div>
  );
}

function DetailHeader({ review, onClose }: { review: ManualReviewItem; onClose: () => void }) {
  const sevBucket = bucket(review.severity);
  const M = SEV_META[sevBucket];
  const Icon = M.icon;
  return (
    <div className="flex-shrink-0 px-5 py-3 border-b border-primary/10 flex items-start gap-3 bg-secondary/20">
      <div className={`w-9 h-9 rounded-modal border flex items-center justify-center flex-shrink-0 ${M.chip}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {review.persona_name && (
            <>
              <PersonaIcon icon={review.persona_icon ?? null} color={review.persona_color ?? null} size="w-3.5 h-3.5" />
              <span className="typo-caption text-foreground">{review.persona_name}</span>
              <span className="typo-caption text-foreground">·</span>
            </>
          )}
          <span className={`typo-caption font-medium uppercase ${sevBucket === 'critical' ? 'text-red-400' : sevBucket === 'warning' ? 'text-amber-400' : 'text-blue-400'}`}>
            {M.label}
          </span>
          <span className="typo-caption text-foreground">·</span>
          <Clock className="w-3 h-3 text-foreground" />
          <span className="typo-caption text-foreground">{formatRelativeTime(review.created_at)}</span>
        </div>
      </div>
      <button onClick={onClose} className="p-1 rounded text-foreground hover:text-foreground hover:bg-secondary/40 transition-colors">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export default TriageGridVariant;
