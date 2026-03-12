import { useState, useEffect, useCallback } from 'react';
import { X, AlertTriangle, Wrench, CheckCircle, Copy, ClipboardCheck, Zap, RefreshCw, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { BaseModal } from '@/lib/ui/BaseModal';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';
import { SEVERITY_COLORS, HEALING_CATEGORY_COLORS } from '@/lib/utils/formatters';
import { SEVERITY_STYLES } from '@/lib/utils/designTokens';

interface HealingIssueModalProps {
  issue: PersonaHealingIssue;
  onResolve: (id: string) => void;
  onClose: () => void;
}

export default function HealingIssueModal({ issue, onResolve, onClose }: HealingIssueModalProps) {
  const [resolved, setResolved] = useState(false);
  const defaultSev = { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' };
  const defaultCat = { bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'border-violet-500/20' };
  const sev = SEVERITY_COLORS[issue.severity] ?? defaultSev;
  const cat = HEALING_CATEGORY_COLORS[issue.category] ?? defaultCat;
  const isAutoFixed = issue.auto_fixed && issue.status === 'resolved';
  const isAutoFixPending = issue.status === 'auto_fix_pending';
  const isCircuitBreaker = issue.is_circuit_breaker;

  useEffect(() => {
    if (!resolved) return;
    const timer = setTimeout(onClose, 800);
    return () => clearTimeout(timer);
  }, [resolved, onClose]);

  const [copied, setCopied] = useState(false);

  const handleResolve = useCallback(() => {
    onResolve(issue.id);
    setResolved(true);
  }, [onResolve, issue.id]);

  const handleCopyFix = useCallback(() => {
    if (!issue.suggested_fix) return;
    navigator.clipboard.writeText(issue.suggested_fix);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [issue.suggested_fix]);

  return (
    <BaseModal
      isOpen={true}
      onClose={onClose}
      titleId="healing-issue-title"
      maxWidthClass="max-w-lg"
      panelClassName="bg-background border border-primary/20 rounded-2xl shadow-2xl overflow-hidden"
    >
      <AnimatePresence mode="wait">
        {resolved ? (
          <ResolvedAnimation />
        ) : (
          <ModalContent
            issue={issue}
            sev={sev}
            cat={cat}
            isAutoFixed={isAutoFixed}
            isAutoFixPending={isAutoFixPending}
            isCircuitBreaker={isCircuitBreaker}
            copied={copied}
            onClose={onClose}
            onResolve={handleResolve}
            onCopyFix={handleCopyFix}
          />
        )}
      </AnimatePresence>
    </BaseModal>
  );
}

function ResolvedAnimation() {
  return (
    <motion.div
      key="success"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="flex flex-col items-center justify-center py-16 px-8"
    >
      <div className="relative">
        <motion.div
          initial={{ scale: 0, opacity: 0.8 }}
          animate={{ scale: 2.5, opacity: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="absolute inset-0 rounded-full border-2 border-emerald-400/40"
          style={{ width: 48, height: 48, top: -4, left: -4 }}
        />
        <motion.div
          initial={{ scale: 0, opacity: 0.5 }}
          animate={{ scale: 3, opacity: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut', delay: 0.05 }}
          className="absolute inset-0 rounded-full border border-emerald-400/20"
          style={{ width: 48, height: 48, top: -4, left: -4 }}
        />
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', damping: 15, stiffness: 300 }}
        >
          <CheckCircle className="w-10 h-10 text-emerald-400" strokeWidth={1.5} />
        </motion.div>
      </div>
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.3 }}
        className="mt-4 text-sm font-medium text-emerald-400"
      >
        Issue Resolved
      </motion.p>
    </motion.div>
  );
}

function ModalContent({ issue, sev, cat, isAutoFixed, isAutoFixPending, isCircuitBreaker, copied, onClose, onResolve, onCopyFix }: {
  issue: PersonaHealingIssue;
  sev: { bg: string; text: string; border: string };
  cat: { bg: string; text: string; border: string };
  isAutoFixed: boolean;
  isAutoFixPending: boolean;
  isCircuitBreaker: boolean;
  copied: boolean;
  onClose: () => void;
  onResolve: () => void;
  onCopyFix: () => void;
}) {
  return (
    <motion.div key="content" exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.15 }}>
      {/* Header */}
      <div className="flex items-start justify-between p-4 border-b border-primary/10">
        <div className="flex-1 min-w-0 pr-4">
          <h3 id="healing-issue-title" className="text-sm font-semibold text-foreground/90 mb-2">{issue.title}</h3>
          <div className="flex items-center gap-2 flex-wrap">
            {isCircuitBreaker ? (
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-sm font-mono uppercase rounded-lg ${SEVERITY_STYLES.error.bg} ${SEVERITY_STYLES.error.text} ${SEVERITY_STYLES.error.border}`}>
                <Zap className="w-3 h-3" /> circuit breaker
              </span>
            ) : isAutoFixPending ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-sm font-mono uppercase rounded-lg border bg-amber-500/10 text-amber-400 border-amber-500/20">
                <Loader2 className="w-3 h-3 animate-spin" /> retrying
              </span>
            ) : isAutoFixed ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-sm font-mono uppercase rounded-lg border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                <CheckCircle className="w-3 h-3" /> auto-fixed
              </span>
            ) : (
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-sm font-mono uppercase rounded-lg border ${sev.bg} ${sev.text} ${sev.border}`}>
                <AlertTriangle className="w-3 h-3" /> {issue.severity}
              </span>
            )}
            {(isAutoFixed || isAutoFixPending) && issue.execution_id && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-sm font-mono rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                <RefreshCw className={`w-2.5 h-2.5 ${isAutoFixPending ? 'animate-spin' : ''}`} /> {isAutoFixPending ? 'retry in progress' : 'healed via retry'}
              </span>
            )}
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-sm font-mono uppercase rounded-lg border ${cat.bg} ${cat.text} ${cat.border}`}>
              {issue.category}
            </span>
            <span className="text-sm text-muted-foreground/80">{new Date(issue.created_at).toLocaleDateString()}</span>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground/90 hover:text-foreground/95 transition-colors" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Description */}
      <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
        {isCircuitBreaker && (
          <div className={`flex items-start gap-2.5 p-3.5 rounded-xl ${SEVERITY_STYLES.error.bg} ${SEVERITY_STYLES.error.border}`}>
            <Zap className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-red-300/90">Persona auto-disabled</p>
              <p className="text-sm text-red-300/60 mt-1">
                This persona was automatically disabled after 5 consecutive failures. Review the error pattern below and re-enable manually once the root cause is resolved.
              </p>
            </div>
          </div>
        )}
        <div>
          <h4 className="text-sm font-mono uppercase text-muted-foreground/90 mb-2">Analysis</h4>
          <div className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{issue.description}</div>
        </div>
        {issue.suggested_fix && (
          <div className={`p-4 rounded-xl ${SEVERITY_STYLES.success.bg} ${SEVERITY_STYLES.success.border}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Wrench className="w-3.5 h-3.5 text-emerald-400" />
                <h4 className="text-sm font-mono uppercase text-emerald-400/80">Suggested Fix</h4>
              </div>
              <button onClick={onCopyFix} className="flex items-center gap-1 px-2 py-1 text-sm font-medium text-emerald-400/70 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 rounded-lg transition-colors">
                {copied ? <ClipboardCheck className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied ? 'Copied' : 'Copy Fix'}
              </button>
            </div>
            <div className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{issue.suggested_fix}</div>
          </div>
        )}
        {issue.execution_id && (
          <div className="text-sm font-mono text-muted-foreground/80">Execution: {issue.execution_id}</div>
        )}
      </div>

      {/* Footer */}
      {!isAutoFixed && !isAutoFixPending && (
        <div className="px-5 py-4 border-t border-primary/10 space-y-2">
          {(issue.severity === 'high' || issue.severity === 'critical') && (
            <div className="flex items-center gap-1.5 text-sm text-amber-400/60">
              <AlertTriangle className="w-3 h-3 flex-shrink-0" />
              This issue is marked as {issue.severity} severity
            </div>
          )}
          <p className="text-sm text-muted-foreground/80">
            Marking resolved means you have addressed this issue outside the healing system.
          </p>
        </div>
      )}
      <div className="flex items-center justify-end gap-3 px-5 py-4 bg-secondary/20">
        {isAutoFixPending && (
          <div className="flex items-center gap-1.5 mr-auto">
            <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
            <span className="text-sm text-amber-400/60">Retry in progress — status will update when complete</span>
          </div>
        )}
        {isAutoFixed && (
          <div className="flex items-center gap-1.5 mr-auto">
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', damping: 12, stiffness: 300 }}>
              <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
            </motion.div>
            <span className="text-sm text-emerald-400/60">This issue was automatically resolved</span>
          </div>
        )}
        <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-muted-foreground/80 hover:text-foreground/95 rounded-xl hover:bg-secondary/60 transition-colors">
          Close
        </button>
        {!isAutoFixed && !isAutoFixPending && (
          <button
            onClick={onResolve}
            title="Manual fix applied outside the healing system"
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-xl hover:bg-emerald-500/20 transition-colors"
          >
            <CheckCircle className="w-3.5 h-3.5" />
            Mark as Resolved
          </button>
        )}
      </div>
    </motion.div>
  );
}
