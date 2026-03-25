import {
  Zap, CheckCircle2, XCircle, AlertCircle,
  ExternalLink, Activity, Pause, ShieldCheck,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { PersonaAutomation } from '@/lib/bindings/PersonaAutomation';
import { AUTOMATION_STATUS_CONFIG, PLATFORM_CONFIG, formatRelativeTime } from '../../libs/automationTypes';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { AutomationCardActions } from './AutomationCardActions';
import { TOOLS_BTN_STANDARD, TOOLS_BTN_COMPACT, TOOLS_SECTION_GAP } from '@/lib/utils/designTokens';
import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';

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
  active: CheckCircle2, draft: AlertCircle, paused: Pause, error: XCircle,
} as const;

export function AutomationCard({
  automation, onTest, onEdit, onToggleStatus, onDelete, isTesting, testResult,
}: AutomationCardProps) {
  const statusConfig = AUTOMATION_STATUS_CONFIG[automation.deploymentStatus] ?? AUTOMATION_STATUS_CONFIG.draft;
  const platformConfig = PLATFORM_CONFIG[automation.platform] ?? PLATFORM_CONFIG.custom;
  const StatusIcon = STATUS_ICON[automation.deploymentStatus] ?? AlertCircle;

  return (
    <SectionCard size="md">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center flex-shrink-0">
          <Zap className="w-3.5 h-3.5 text-accent/60" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground/80 truncate" title={automation.name}>{automation.name}</p>
            <span className={`animate-fade-in inline-flex items-center gap-1 px-2 py-0.5 text-sm font-medium rounded-full border ${statusConfig.bg} ${statusConfig.color}`}>
              <StatusIcon className="w-2.5 h-2.5" /> {statusConfig.label}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`inline-flex items-center px-1.5 py-0 text-sm font-medium rounded border ${platformConfig.bg} ${platformConfig.color}`}>{platformConfig.label}</span>
            {automation.lastTriggeredAt && <span className="text-sm text-muted-foreground/60">Last run: {formatRelativeTime(automation.lastTriggeredAt)}</span>}
            {!automation.lastTriggeredAt && automation.deploymentStatus !== 'draft' && <span className="text-sm text-muted-foreground/50">Never triggered</span>}
            {automation.deploymentStatus === 'draft' && <span className="text-sm text-muted-foreground/50">Not deployed</span>}
            {automation.fallbackMode === 'connector' && (
              <span className="inline-flex items-center gap-0.5 text-sm text-muted-foreground/60" title="Falls back to direct connector on failure">
                <ShieldCheck className="w-3 h-3" /> Fallback
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {automation.deploymentStatus === 'active' && (
            <button onClick={() => onTest(automation.id)} disabled={isTesting}
              title={isTesting ? 'Test is already running' : undefined}
              className={`flex items-center gap-1.5 ${TOOLS_BTN_STANDARD} text-sm rounded-xl border border-border text-muted-foreground hover:bg-secondary/50 hover:text-foreground transition-colors disabled:opacity-40`}>
              {isTesting ? <LoadingSpinner size="xs" /> : <Activity className="w-3 h-3" />} Test
            </button>
          )}
          {automation.deploymentStatus === 'draft' && (
            <button onClick={() => onEdit(automation.id)}
              className={`flex items-center gap-1.5 ${TOOLS_BTN_STANDARD} text-sm rounded-xl border border-accent/25 text-foreground/80 bg-accent/10 hover:bg-accent/20 transition-colors`}>Configure</button>
          )}
          {sanitizeExternalUrl(automation.platformUrl) && (
            <a href={sanitizeExternalUrl(automation.platformUrl)!} target="_blank" rel="noopener noreferrer"
              className={`flex items-center gap-1 ${TOOLS_BTN_COMPACT} text-sm rounded-lg border border-border text-muted-foreground hover:bg-secondary/50 hover:text-foreground transition-colors`}
              title={`Open in ${platformConfig.label}`}><ExternalLink className="w-3 h-3" /></a>
          )}
          <AutomationCardActions automation={automation} onEdit={onEdit} onToggleStatus={onToggleStatus} onDelete={onDelete} />
        </div>
      </div>
      {testResult && !isTesting && (
        <div className={`${TOOLS_SECTION_GAP} px-3 py-2 rounded-xl text-sm ${testResult.success ? 'bg-brand-emerald/5 border border-brand-emerald/15 text-brand-emerald' : 'bg-brand-rose/5 border border-brand-rose/15 text-brand-rose'}`}>
          <div className="flex items-center gap-1.5">
            {testResult.success ? <CheckCircle2 className="w-3 h-3 flex-shrink-0" /> : <XCircle className="w-3 h-3 flex-shrink-0" />}
            <span>{testResult.message}</span>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
