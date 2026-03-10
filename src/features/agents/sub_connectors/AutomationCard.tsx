import { useState } from 'react';
import {
  Zap, CheckCircle2, XCircle, AlertCircle, Loader2,
  ExternalLink, Activity, MoreHorizontal, Pause, Play, Trash2, Pencil, ShieldCheck,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { PersonaAutomation } from '@/lib/bindings/PersonaAutomation';
import { AUTOMATION_STATUS_CONFIG, PLATFORM_CONFIG, formatRelativeTime } from './automationTypes';
import { SectionCard } from '@/features/shared/components/SectionCard';

interface AutomationCardProps {
  automation: PersonaAutomation;
  onTest: (id: string) => void;
  onEdit: (id: string) => void;
  onToggleStatus: (id: string, newStatus: 'active' | 'paused') => void;
  onDelete: (id: string) => void;
  isTesting?: boolean;
  testResult?: { success: boolean; message: string } | null;
}

const STATUS_ICON = {
  active: CheckCircle2,
  draft: AlertCircle,
  paused: Pause,
  error: XCircle,
} as const;

export function AutomationCard({
  automation,
  onTest,
  onEdit,
  onToggleStatus,
  onDelete,
  isTesting,
  testResult,
}: AutomationCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const statusConfig = AUTOMATION_STATUS_CONFIG[automation.deploymentStatus] ?? AUTOMATION_STATUS_CONFIG.draft;
  const platformConfig = PLATFORM_CONFIG[automation.platform] ?? PLATFORM_CONFIG.custom;
  const StatusIcon = STATUS_ICON[automation.deploymentStatus] ?? AlertCircle;

  const handleDelete = () => {
    if (confirmDelete) {
      onDelete(automation.id);
      setConfirmDelete(false);
      setMenuOpen(false);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  return (
    <SectionCard size="md">
      <div className="flex items-center gap-3">
        {/* Lightning bolt icon */}
        <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center flex-shrink-0">
          <Zap className="w-3.5 h-3.5 text-accent/60" />
        </div>

        {/* Name + metadata */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground/80 truncate" title={automation.name}>{automation.name}</p>

            {/* Status badge */}
            <motion.span
              layout
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-sm font-medium rounded-full border ${statusConfig.bg} ${statusConfig.color}`}
            >
              <StatusIcon className="w-2.5 h-2.5" />
              {statusConfig.label}
            </motion.span>
          </div>

          <div className="flex items-center gap-2 mt-0.5">
            {/* Platform pill */}
            <span className={`inline-flex items-center px-1.5 py-0 text-sm font-medium rounded border ${platformConfig.bg} ${platformConfig.color}`}>
              {platformConfig.label}
            </span>

            {/* Last run + duration */}
            {automation.lastTriggeredAt && (
              <span className="text-sm text-muted-foreground/60">
                Last run: {formatRelativeTime(automation.lastTriggeredAt)}
              </span>
            )}
            {!automation.lastTriggeredAt && automation.deploymentStatus !== 'draft' && (
              <span className="text-sm text-muted-foreground/50">Never triggered</span>
            )}
            {automation.deploymentStatus === 'draft' && (
              <span className="text-sm text-muted-foreground/50">Not deployed</span>
            )}

            {/* Fallback indicator */}
            {automation.fallbackMode === 'connector' && (
              <span className="inline-flex items-center gap-0.5 text-sm text-muted-foreground/60" title="Falls back to direct connector on failure">
                <ShieldCheck className="w-3 h-3" />
                Fallback
              </span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {automation.deploymentStatus === 'active' && (
            <button
              onClick={() => onTest(automation.id)}
              disabled={isTesting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-xl border border-border text-muted-foreground hover:bg-secondary/50 hover:text-foreground transition-colors disabled:opacity-40"
            >
              {isTesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
              Test
            </button>
          )}

          {automation.deploymentStatus === 'draft' && (
            <button
              onClick={() => onEdit(automation.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-xl border border-accent/25 text-foreground/80 bg-accent/10 hover:bg-accent/20 transition-colors"
            >
              Configure
            </button>
          )}

          {automation.platformUrl && (
            <a
              href={automation.platformUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2 py-1.5 text-sm rounded-lg border border-border text-muted-foreground hover:bg-secondary/50 hover:text-foreground transition-colors"
              title={`Open in ${platformConfig.label}`}
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          )}

          {/* Overflow menu */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center justify-center w-7 h-7 rounded-lg text-muted-foreground hover:bg-secondary/50 hover:text-foreground transition-colors"
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>

            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.1 }}
                  className="absolute right-0 top-full mt-1 z-[100] w-40 rounded-lg border border-border bg-background shadow-lg py-1"
                >
                  <button
                    onClick={() => { onEdit(automation.id); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground/80 hover:bg-secondary/50"
                  >
                    <Pencil className="w-3 h-3" /> Edit
                  </button>

                  {automation.deploymentStatus === 'active' && (
                    <button
                      onClick={() => { onToggleStatus(automation.id, 'paused'); setMenuOpen(false); }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground/80 hover:bg-secondary/50"
                    >
                      <Pause className="w-3 h-3" /> Pause
                    </button>
                  )}

                  {(automation.deploymentStatus === 'paused' || automation.deploymentStatus === 'draft') && (
                    <button
                      onClick={() => { onToggleStatus(automation.id, 'active'); setMenuOpen(false); }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground/80 hover:bg-secondary/50"
                    >
                      <Play className="w-3 h-3" /> Activate
                    </button>
                  )}

                  <div className="border-t border-border/40 my-1" />

                  <button
                    onClick={handleDelete}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-brand-rose hover:bg-brand-rose/10"
                  >
                    <Trash2 className="w-3 h-3" />
                    {confirmDelete ? 'Confirm?' : 'Delete'}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Test result */}
      {testResult && !isTesting && (
        <div className={`mt-2.5 px-3 py-2 rounded-xl text-sm ${
          testResult.success
            ? 'bg-brand-emerald/5 border border-brand-emerald/15 text-brand-emerald'
            : 'bg-brand-rose/5 border border-brand-rose/15 text-brand-rose'
        }`}>
          <div className="flex items-center gap-1.5">
            {testResult.success
              ? <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
              : <XCircle className="w-3 h-3 flex-shrink-0" />}
            <span>{testResult.message}</span>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
