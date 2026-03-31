import { useState, useCallback, useEffect } from 'react';
import {
  Check, X, AlertTriangle, Info, AlertCircle,
  ArrowRight, ArrowLeft, MessageSquare, Clock,
  ChevronDown, Zap,
} from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';

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
  low: { icon: Info, color: 'text-foreground/50', bg: 'bg-secondary/30', border: 'border-primary/15', label: 'Low' },
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
  const pending = reviews.filter((r) => r.status === 'pending');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [exitDir, setExitDir] = useState<'left' | 'right' | null>(null);

  const current = pending[currentIdx];
  const total = pending.length;

  const handleAction = useCallback((action: 'approve' | 'reject') => {
    if (!current || isProcessing) return;
    // For approve, require a suggested action to be selected (if actions exist)
    const actions = parseSuggestedActions(current.suggested_actions);
    if (action === 'approve' && actions.length > 0 && !selectedAction) return;

    setExitDir(action === 'approve' ? 'right' : 'left');
    const enrichedNotes = selectedAction
      ? `${selectedAction}${notes ? '\n' + notes : ''}`
      : notes || undefined;

    setTimeout(() => {
      if (action === 'approve') onApprove(current.id, enrichedNotes);
      else onReject(current.id, enrichedNotes);
      setNotes('');
      setShowNotes(false);
      setSelectedAction(null);
      setExitDir(null);
      setCurrentIdx((i) => Math.min(i, Math.max(0, total - 2)));
    }, 280);
  }, [current, isProcessing, notes, selectedAction, onApprove, onReject, total]);

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
        <p className="text-sm text-foreground/50">All caught up! No pending reviews.</p>
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
      <div className="w-[200px] flex-shrink-0 rounded-xl border border-primary/10 bg-secondary/5 overflow-hidden flex flex-col">
        <div className="px-3 py-2 border-b border-primary/8">
          <span className="text-xs font-semibold text-foreground/40 uppercase tracking-wider">Queue ({total})</span>
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
                  <span className={`text-xs truncate ${isActive ? 'text-foreground/90 font-medium' : 'text-foreground/60'}`}>
                    {r.title}
                  </span>
                </div>
                <span className="text-xs text-foreground/30 ml-4 block truncate">{r.persona_name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Center: Review card */}
      <div className="flex-1 flex flex-col items-center gap-4 min-w-0">
        {/* Counter */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-foreground/35">{currentIdx + 1} / {total}</span>
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
          className={`w-full rounded-2xl border ${sev.border} bg-gradient-to-b from-background to-secondary/10 shadow-xl overflow-hidden transition-all duration-280 ${
            exitDir === 'right' ? 'translate-x-[110%] rotate-6 opacity-0' :
            exitDir === 'left' ? '-translate-x-[110%] -rotate-6 opacity-0' : ''
          }`}
        >
          {/* Severity bar */}
          <div className={`h-1 ${sev.bg}`} />

          <div className="p-5 space-y-4">
            {/* Header */}
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-xl ${sev.bg} border ${sev.border} flex items-center justify-center flex-shrink-0`}>
                <SevIcon className={`w-5 h-5 ${sev.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-foreground/95 leading-tight">{current.title}</h3>
                <div className="flex items-center gap-2 mt-1">
                  {current.persona_name && (
                    <span className="flex items-center gap-1.5 text-sm text-foreground/50">
                      <PersonaIcon icon={current.persona_icon ?? null} color={current.persona_color ?? null} size="w-4 h-4" />
                      {current.persona_name}
                    </span>
                  )}
                  <Clock className="w-3 h-3 text-foreground/25" />
                  <span className="text-xs text-foreground/30">{formatRelativeTime(current.created_at)}</span>
                </div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold uppercase ${sev.bg} ${sev.color} border ${sev.border}`}>
                {sev.label}
              </span>
            </div>

            {/* Description — expanded, readable */}
            {current.description && (
              <div className="text-sm text-foreground/75 leading-relaxed whitespace-pre-wrap max-h-[180px] overflow-y-auto">
                {current.description}
              </div>
            )}

            {/* Context — collapsible, not prominent */}
            {current.context_data && (
              <details className="group">
                <summary className="text-xs font-semibold text-foreground/35 uppercase tracking-wider cursor-pointer hover:text-foreground/50 transition-colors flex items-center gap-1">
                  <ChevronDown className="w-3 h-3 group-open:rotate-180 transition-transform" />
                  Technical Context
                </summary>
                <div className="mt-2 px-3 py-2 rounded-lg bg-black/15 border border-primary/8 font-mono text-xs text-foreground/40 max-h-24 overflow-y-auto">
                  {current.context_data}
                </div>
              </details>
            )}

            {/* Suggested actions — selectable buttons (mandatory before approve) */}
            {actions.length > 0 && (
              <div className="space-y-2">
                <span className="text-xs font-semibold text-foreground/40 uppercase tracking-wider flex items-center gap-1">
                  <Zap className="w-3 h-3" /> Select an action {actions.length > 0 && <span className="text-primary/60">(required)</span>}
                </span>
                <div className="flex flex-wrap gap-2">
                  {actions.map((a, i) => {
                    const isSelected = selectedAction === a;
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setSelectedAction(isSelected ? null : a)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                          isSelected
                            ? 'bg-primary/15 text-primary border-primary/30 ring-1 ring-primary/20'
                            : 'bg-secondary/20 text-foreground/60 border-primary/10 hover:border-primary/20 hover:text-foreground/80'
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
                placeholder="Add review notes..."
                rows={2}
                className="w-full px-3 py-2 rounded-lg border border-primary/15 bg-secondary/20 text-sm text-foreground/80 placeholder:text-foreground/25 resize-none outline-none focus-visible:border-primary/30"
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
            <span className="text-sm font-semibold">Reject</span>
          </button>
          <button
            onClick={() => setShowNotes(!showNotes)}
            className="p-2.5 rounded-xl border border-primary/15 text-foreground/40 hover:text-foreground/70 hover:bg-secondary/30 transition-colors"
            title="Add notes"
          >
            <MessageSquare className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleAction('approve')}
            disabled={approveDisabled}
            title={approveDisabled && actions.length > 0 ? 'Select a suggested action first' : undefined}
            className="group flex items-center gap-2 px-6 py-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/5 text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500/35 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <span className="text-sm font-semibold">Approve</span>
            <Check className="w-5 h-5 group-hover:scale-110 transition-transform" />
          </button>
        </div>

        {/* Keyboard hint */}
        <div className="flex items-center gap-4 text-[10px] text-foreground/25">
          <span className="flex items-center gap-1"><ArrowLeft className="w-3 h-3" /> Reject</span>
          <span className="flex items-center gap-1"><ArrowRight className="w-3 h-3" /> Approve</span>
        </div>
      </div>
    </div>
  );
}
