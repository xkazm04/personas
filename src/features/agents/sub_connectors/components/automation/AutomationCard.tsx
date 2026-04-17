import {
  Zap, CheckCircle2, XCircle,
  ExternalLink, Activity, ShieldCheck,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { PersonaAutomation } from '@/lib/bindings/PersonaAutomation';
import { PLATFORM_CONFIG } from '../../libs/automationTypes';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { AutomationCardActions } from './AutomationCardActions';
import { AutomationStatusBadge } from './AutomationStatusBadge';
import { TOOLS_BTN_STANDARD, TOOLS_BTN_COMPACT, TOOLS_SECTION_GAP } from '@/lib/utils/designTokens';
import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import { useTranslation } from '@/i18n/useTranslation';

interface AutomationCardProps {
  automation: PersonaAutomation;
  onTest: (id: string) => void;
  onEdit: (id: string) => void;
  onToggleStatus: (id: string, newStatus: 'active' | 'paused') => void;
  onDelete: (id: string) => void;
  isTesting?: boolean;
  isTransitioning?: boolean;
  testResult?: { success: boolean; message: string } | null;
}

export function AutomationCard({
  automation, onTest, onEdit, onToggleStatus, onDelete, isTesting, isTransitioning, testResult,
}: AutomationCardProps) {
  const { t } = useTranslation();
  const platformConfig = PLATFORM_CONFIG[automation.platform] ?? PLATFORM_CONFIG.custom;

  return (
    <SectionCard size="md">
      <div className="relative flex items-center gap-3">
        {/* Loading overlay during status transition */}
        <AnimatePresence>
          {isTransitioning && (
            <motion.div
              className="absolute inset-0 z-10 flex items-center justify-center rounded-modal bg-background/60 backdrop-blur-[1px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <LoadingSpinner size="sm" />
            </motion.div>
          )}
        </AnimatePresence>
        <div className="w-8 h-8 rounded-card bg-accent/10 border border-accent/20 flex items-center justify-center flex-shrink-0">
          <Zap className="w-3.5 h-3.5 text-accent/60" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground truncate" title={automation.name}>{automation.name}</p>
            <AutomationStatusBadge automationId={automation.id} status={automation.deploymentStatus} />
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`inline-flex items-center px-1.5 py-0 text-sm font-medium rounded border ${platformConfig.bg} ${platformConfig.color}`}>{platformConfig.label}</span>
            {automation.lastTriggeredAt && <span className="text-sm text-foreground">{t.agents.connectors.auto_last_run.replace('{time}', formatRelativeTime(automation.lastTriggeredAt))}</span>}
            {!automation.lastTriggeredAt && automation.deploymentStatus !== 'draft' && <span className="text-sm text-foreground">{t.agents.connectors.auto_never_triggered}</span>}
            {automation.deploymentStatus === 'draft' && <span className="text-sm text-foreground">{t.agents.connectors.auto_not_deployed}</span>}
            {automation.fallbackMode === 'connector' && (
              <span className="inline-flex items-center gap-0.5 text-sm text-foreground" title="Falls back to direct connector on failure">
                <ShieldCheck className="w-3 h-3" /> {t.agents.connectors.auto_fallback}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {automation.deploymentStatus === 'active' && (
            <button onClick={() => onTest(automation.id)} disabled={isTesting}
              title={isTesting ? 'Test is already running' : undefined}
              className={`flex items-center gap-1.5 ${TOOLS_BTN_STANDARD} text-sm rounded-modal border border-border text-foreground hover:bg-secondary/50 hover:text-foreground transition-colors disabled:opacity-40`}>
              {isTesting ? <LoadingSpinner size="xs" /> : <Activity className="w-3 h-3" />} {t.agents.connectors.auto_test}
            </button>
          )}
          {automation.deploymentStatus === 'draft' && (
            <button onClick={() => onEdit(automation.id)}
              className={`flex items-center gap-1.5 ${TOOLS_BTN_STANDARD} text-sm rounded-modal border border-accent/25 text-foreground bg-accent/10 hover:bg-accent/20 transition-colors`}>{t.common.configure}</button>
          )}
          {sanitizeExternalUrl(automation.platformUrl) && (
            <a href={sanitizeExternalUrl(automation.platformUrl)!} target="_blank" rel="noopener noreferrer"
              className={`flex items-center gap-1 ${TOOLS_BTN_COMPACT} text-sm rounded-card border border-border text-foreground hover:bg-secondary/50 hover:text-foreground transition-colors`}
              title={`Open in ${platformConfig.label}`}><ExternalLink className="w-3 h-3" /></a>
          )}
          <AutomationCardActions automation={automation} onEdit={onEdit} onToggleStatus={onToggleStatus} onDelete={onDelete} />
        </div>
      </div>
      {testResult && !isTesting && (
        <div className={`${TOOLS_SECTION_GAP} px-3 py-2 rounded-modal text-sm ${testResult.success ? 'bg-brand-emerald/5 border border-brand-emerald/15 text-brand-emerald' : 'bg-brand-rose/5 border border-brand-rose/15 text-brand-rose'}`}>
          <div className="flex items-center gap-1.5">
            {testResult.success ? <CheckCircle2 className="w-3 h-3 flex-shrink-0" /> : <XCircle className="w-3 h-3 flex-shrink-0" />}
            <span>{testResult.message}</span>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
