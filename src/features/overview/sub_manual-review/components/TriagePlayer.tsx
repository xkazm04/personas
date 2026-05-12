import { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import {
  Check, X, AlertTriangle, Info, AlertCircle,
  ArrowRight, ArrowLeft, MessageSquare, Clock,
  Zap, CheckCircle2, XCircle,
} from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { ContextDataPreview } from './ReviewListItem';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TriageReview {
  id: string;
  title: string;
  description?: string | null;
  severity: string;
  persona_name?: string;
  persona_icon?: string;
  persona_color?: string;
  context_data?: string | null;
  suggested_actions?: string | null;
  created_at: string;
  status: string;
}

interface TriagePlayerProps {
  reviews: TriageReview[];
  onApprove: (id: string, notes?: string) => void;
  onReject: (id: string, notes?: string) => void;
  isProcessing: boolean;
}

const SEVERITY_CONFIG: Record<string, { icon: typeof AlertTriangle; color: string; bg: string; border: string; label: string }> = {
  critical: { icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20', label: 'Critical' },
  warning: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', label: 'Warning' },
  high: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', label: 'High' },
  info: { icon: Info, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20', label: 'Info' },
  low: { icon: Info, color: 'text-foreground', bg: 'bg-secondary/30', border: 'border-primary/15', label: 'Low' },
};

function getSeverity(s: string) {
  return SEVERITY_CONFIG[s] ?? SEVERITY_CONFIG.info!;
}

function parseSuggestedActions(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((a): a is string => typeof a === 'string') : [];
  } catch {
    return raw.split('\n').filter(Boolean);
  }
}

// ---------------------------------------------------------------------------
// Main Component: Swipe center + side queue
// ---------------------------------------------------------------------------

export function TriagePlayer({ reviews, onApprove, onReject, isProcessing }: TriagePlayerProps) {
  const { t } = useTranslation();
  const pending = reviews.filter((r) => r.status === 'pending');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [exitDir, setExitDir] = useState<'left' | 'right' | null>(null);

  const current = pending[currentIdx];
  const total = pending.length;

  // Decision state for multi-decision context_data
  const [decisionStates, setDecisionStates] = useState<Record<string, 'accepted' | 'rejected' | null>>({});
  const toggleDecision = useCallback((id: string, state: 'accepted' | 'rejected') => {
    setDecisionStates((prev) => ({ ...prev, [id]: prev[id] === state ? null : state }));
  }, []);

  const decisions = useMemo<Array<{ id: string; label: string; description?: string; category?: string }>>(() => {
    if (!current?.context_data) return [];
    try {
      const parsed = JSON.parse(current.context_data);
      if (Array.isArray(parsed?.decisions)) return parsed.decisions;
    } catch { /* not JSON */ }
    return [];
  }, [current?.context_data]);

  const hasDecisions = decisions.length > 0;
  const acceptedCount = Object.values(decisionStates).filter((v) => v === 'accepted').length;
  const rejectedCount = Object.values(decisionStates).filter((v) => v === 'rejected').length;

  const handleAction = useCallback((action: 'approve' | 'reject') => {
    if (!current || isProcessing) return;
    const actions = parseSuggestedActions(current.suggested_actions);
    if (action === 'approve' && actions.length > 0 && !selectedAction && !hasDecisions) return;

    setExitDir(action === 'approve' ? 'right' : 'left');

    // Build notes: include selected action + decision states + user notes
    let enrichedNotes = selectedAction
      ? `${selectedAction}${notes ? '\n' + notes : ''}`
      : notes || undefined;

    if (hasDecisions && (acceptedCount > 0 || rejectedCount > 0)) {
      const decisionSummary = decisions
        .filter((d) => decisionStates[d.id])
        .map((d) => `${decisionStates[d.id] === 'accepted' ? '+' : '-'} ${d.label}`)
        .join('\n');
      enrichedNotes = enrichedNotes ? `${enrichedNotes}\n\nDecisions:\n${decisionSummary}` : `Decisions:\n${decisionSummary}`;
    }

    setTimeout(() => {
      if (action === 'approve') onApprove(current.id, enrichedNotes);
      else onReject(current.id, enrichedNotes);
      setNotes('');
      setShowNotes(false);
      setSelectedAction(null);
      setDecisionStates({});
      setExitDir(null);
      setCurrentIdx((i) => Math.min(i, Math.max(0, total - 2)));
    }, 280);
  }, [current, isProcessing, notes, selectedAction, hasDecisions, acceptedCount, rejectedCount, decisions, decisionStates, onApprove, onReject, total]);

  // Keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight') handleAction('approve');
      if (e.key === 'ArrowLeft') handleAction('reject');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleAction]);

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
          <Check className="w-8 h-8 text-emerald-400" />
        </div>
        <p className="typo-body text-foreground">{t.overview.review.all_caught_up}</p>
      </div>
    );
  }

  if (!current) return null;

  const sev = getSeverity(current.severity);
  const SevIcon = sev.icon;
  const actions = parseSuggestedActions(current.suggested_actions);
  const approveDisabled = isProcessing || (actions.length > 0 && !selectedAction);

  return (
    <div className="flex gap-4 h-full min-h-[420px]">
      {/* Left: Queue sidebar */}
      <div className="w-[200px] flex-shrink-0 rounded-modal border border-primary/10 bg-secondary/5 overflow-hidden flex flex-col">
        <div className="px-3 py-2 border-b border-primary/8">
          <span className="typo-label font-semibold text-foreground uppercase tracking-wider">{t.overview.review.queue_label} ({total})</span>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {pending.map((r, i) => {
            const isActive = i === currentIdx;
            return (
              <button
                key={r.id}
                onClick={() => { setCurrentIdx(i); setSelectedAction(null); }}
                className={`w-full text-left px-3 py-2 transition-colors ${
                  isActive ? 'bg-primary/8 border-r-2 border-r-primary' : 'hover:bg-secondary/30'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    r.severity === 'critical' ? 'bg-red-400' :
                    r.severity === 'warning' || r.severity === 'high' ? 'bg-amber-400' : 'bg-blue-400'
                  }`} />
                  <span className={`typo-caption truncate ${isActive ? 'text-foreground font-medium' : 'text-foreground'}`}>
                    {r.title}
                  </span>
                </div>
                <span className="typo-caption text-foreground ml-4 block truncate">{r.persona_name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Center: Review card */}
      <div className="flex-1 flex flex-col items-center gap-4 min-w-0">
        {/* Counter */}
        <div className="flex items-center gap-3">
          <span className="typo-code font-mono text-foreground">{currentIdx + 1} / {total}</span>
          <div className="flex gap-1">
            {pending.slice(0, 20).map((_, i) => (
              <div key={i} className={`w-1.5 h-1.5 rounded-full transition-colors ${
                i === currentIdx ? 'bg-primary' : i < currentIdx ? 'bg-emerald-400/40' : 'bg-primary/15'
              }`} />
            ))}
          </div>
        </div>

        {/* Card */}
        <div
          className={`w-full rounded-2xl border ${sev.border} bg-gradient-to-b from-background to-secondary/10 shadow-elevation-3 overflow-hidden transition-all duration-280 ${
            exitDir === 'right' ? 'translate-x-[110%] rotate-6 opacity-0' :
            exitDir === 'left' ? '-translate-x-[110%] -rotate-6 opacity-0' : ''
          }`}
        >
          {/* Severity bar */}
          <div className={`h-1 ${sev.bg}`} />

          <div className="p-5 space-y-4">
            {/* Header */}
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-modal ${sev.bg} border ${sev.border} flex items-center justify-center flex-shrink-0`}>
                <SevIcon className={`w-5 h-5 ${sev.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="typo-body-lg font-semibold text-foreground leading-tight">{current.title}</h3>
                <div className="flex items-center gap-2 mt-1">
                  {current.persona_name && (
                    <span className="flex items-center gap-1.5 typo-body text-foreground">
                      <PersonaIcon icon={current.persona_icon ?? null} color={current.persona_color ?? null} size="w-4 h-4" />
                      {current.persona_name}
                    </span>
                  )}
                  <Clock className="w-3 h-3 text-foreground" />
                  <span className="typo-body text-foreground">{formatRelativeTime(current.created_at)}</span>
                </div>
              </div>
              <span className={`typo-label px-2 py-0.5 rounded-full font-semibold uppercase ${sev.bg} ${sev.color} border ${sev.border}`}>
                {sev.label}
              </span>
            </div>

            {/* Description — expanded, readable */}
            {current.description && (
              <div className="typo-body text-foreground leading-relaxed whitespace-pre-wrap max-h-[180px] overflow-y-auto">
                {current.description}
              </div>
            )}

            {/* Context — parsed into readable format */}
            {current.context_data && !hasDecisions && (
              <div className="rounded-card bg-secondary/30 border border-primary/10 px-3 py-2">
                <div className="typo-code font-mono text-foreground uppercase mb-1.5">{t.overview.review.technical_context}</div>
                <ContextDataPreview raw={current.context_data} />
              </div>
            )}

            {/* Multi-decision items with accept/reject */}
            {hasDecisions && (
              <div className="rounded-modal border border-primary/10 bg-secondary/20 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-primary/10 bg-secondary/10">
                  <span className="typo-label font-semibold text-foreground uppercase tracking-wider">{t.overview.review.decisions_label} ({decisions.length})</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { const all: Record<string, 'accepted'> = {}; decisions.forEach((d) => { all[d.id] = 'accepted'; }); setDecisionStates(all); }}
                      className="typo-caption text-emerald-400 hover:text-emerald-300 transition-colors"
                    >{t.overview.review.accept_all}</button>
                    <span className="text-foreground">|</span>
                    <button
                      onClick={() => { const all: Record<string, 'rejected'> = {}; decisions.forEach((d) => { all[d.id] = 'rejected'; }); setDecisionStates(all); }}
                      className="typo-caption text-red-400 hover:text-red-300 transition-colors"
                    >{t.overview.review.reject_all_items}</button>
                    <span className="text-foreground">|</span>
                    <button onClick={() => setDecisionStates({})} className="typo-caption text-foreground hover:text-foreground/80 transition-colors">{t.common.clear}</button>
                  </div>
                </div>
                <div className="divide-y divide-primary/5">
                  {decisions.map((d) => {
                    const state = decisionStates[d.id] ?? null;
                    return (
                      <div key={d.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-secondary/20 transition-colors">
                        <div className="flex-1 min-w-0">
                          <span className="typo-body text-foreground">{d.label}</span>
                          {d.description && <p className="typo-caption text-foreground mt-0.5">{d.description}</p>}
                        </div>
                        {d.category && (
                          <span className="typo-caption text-foreground px-1.5 py-0.5 rounded bg-secondary/40 flex-shrink-0">{d.category}</span>
                        )}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => toggleDecision(d.id, 'accepted')}
                            className={`p-1 rounded-card transition-colors ${state === 'accepted' ? 'bg-emerald-500/15 text-emerald-400' : 'text-foreground hover:text-emerald-400/60 hover:bg-emerald-500/5'}`}
                            title="Accept"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => toggleDecision(d.id, 'rejected')}
                            className={`p-1 rounded-card transition-colors ${state === 'rejected' ? 'bg-red-500/15 text-red-400' : 'text-foreground hover:text-red-400/60 hover:bg-red-500/5'}`}
                            title="Reject"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {(acceptedCount > 0 || rejectedCount > 0) && (
                  <div className="flex items-center gap-3 px-3 py-2 border-t border-primary/10 bg-secondary/10">
                    {acceptedCount > 0 && <span className="typo-caption text-emerald-400">{acceptedCount} {t.overview.review.accepted_label}</span>}
                    {rejectedCount > 0 && <span className="typo-caption text-red-400">{rejectedCount} {t.overview.review.rejected_label}</span>}
                    {decisions.length - acceptedCount - rejectedCount > 0 && <span className="typo-caption text-foreground">{decisions.length - acceptedCount - rejectedCount} {t.overview.review.undecided_label}</span>}
                  </div>
                )}
              </div>
            )}

            {/* Suggested actions — selectable buttons (mandatory before approve) */}
            {actions.length > 0 && !hasDecisions && (
              <div className="space-y-2">
                <span className="typo-label font-semibold text-foreground uppercase tracking-wider flex items-center gap-1">
                  <Zap className="w-3 h-3" /> {t.overview.review.select_action} {actions.length > 0 && <span className="text-primary">{t.overview.review.required}</span>}
                </span>
                <div className="flex flex-wrap gap-2">
                  {actions.map((a, i) => {
                    const isSelected = selectedAction === a;
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setSelectedAction(isSelected ? null : a)}
                        className={`px-3 py-1.5 rounded-card typo-caption font-medium border transition-all ${
                          isSelected
                            ? 'bg-primary/15 text-primary border-primary/30 ring-1 ring-primary/20'
                            : 'bg-secondary/20 text-foreground border-primary/10 hover:border-primary/20 hover:text-foreground'
                        }`}
                      >
                        {a}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Notes toggle */}
            {showNotes && (
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t.overview.review.notes_placeholder}
                rows={2}
                className="w-full px-3 py-2 rounded-card border border-primary/15 bg-secondary/20 typo-body text-foreground placeholder:text-foreground resize-none outline-none focus-visible:border-primary/30"
                autoFocus
              />
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => handleAction('reject')}
            disabled={isProcessing}
            className="group flex items-center gap-2 px-6 py-3 rounded-2xl border border-red-500/25 bg-red-500/5 text-red-400 hover:bg-red-500/10 hover:border-red-500/35 transition-all disabled:opacity-40"
          >
            <X className="w-5 h-5 group-hover:scale-110 transition-transform" />
            <span className="typo-heading font-semibold">{t.overview.review.reject}</span>
          </button>
          <button
            onClick={() => setShowNotes(!showNotes)}
            className="p-2.5 rounded-modal border border-primary/15 text-foreground hover:text-foreground/70 hover:bg-secondary/30 transition-colors"
            title={t.overview.review.add_notes}
          >
            <MessageSquare className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleAction('approve')}
            disabled={approveDisabled}
            title={approveDisabled && actions.length > 0 ? t.overview.review.select_action_first : undefined}
            className="group flex items-center gap-2 px-6 py-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/5 text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500/35 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <span className="typo-heading font-semibold">{t.overview.review.approve}</span>
            <Check className="w-5 h-5 group-hover:scale-110 transition-transform" />
          </button>
        </div>

        {/* Keyboard hint */}
        <div className="flex items-center gap-4 text-[10px] text-foreground">
          <span className="flex items-center gap-1"><ArrowLeft className="w-3 h-3" /> {t.overview.review.reject}</span>
          <span className="flex items-center gap-1"><ArrowRight className="w-3 h-3" /> {t.overview.review.approve}</span>
        </div>
      </div>
    </div>
  );
}
