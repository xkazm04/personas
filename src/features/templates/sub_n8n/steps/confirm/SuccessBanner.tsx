import { CheckCircle2, RefreshCw, AlertTriangle, XCircle } from 'lucide-react';
import type { ConfirmResult } from './n8nConfirmTypes';
import { useTranslation } from '@/i18n/useTranslation';

interface SuccessBannerProps {
  personaName: string | null;
  confirmResult: ConfirmResult | null;
  onReset: () => void;
}

export function SuccessBanner({ personaName, confirmResult, onReset }: SuccessBannerProps) {
  const { t } = useTranslation();
  return (
    <div
      className="animate-fade-slide-in p-4 rounded-modal bg-emerald-500/10 border border-emerald-500/20 text-center"
    >
      <div
        className="animate-fade-scale-in w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto mb-3"
      >
        <CheckCircle2 className="w-8 h-8 text-emerald-400" />
      </div>
      <p
        className="animate-fade-slide-in typo-heading font-semibold text-emerald-400 mb-1"
      >
        {t.templates.n8n.persona_created}
      </p>
      <p
        className="animate-fade-slide-in typo-body text-emerald-400/60 mb-2"
      >
        {t.templates.n8n.persona_ready.replace('{name}', personaName ?? 'Your persona')}
      </p>
      {confirmResult && (confirmResult.triggersCreated > 0 || confirmResult.toolsCreated > 0) && (
        <p
          className="animate-fade-slide-in typo-body text-emerald-400/50 mb-2"
        >
          Created {confirmResult.triggersCreated > 0 ? `${confirmResult.triggersCreated} trigger${confirmResult.triggersCreated !== 1 ? 's' : ''}` : ''}
          {confirmResult.triggersCreated > 0 && confirmResult.toolsCreated > 0 ? ' + ' : ''}
          {confirmResult.toolsCreated > 0 ? `${confirmResult.toolsCreated} tool${confirmResult.toolsCreated !== 1 ? 's' : ''}` : ''}
        </p>
      )}
      {confirmResult && confirmResult.entityErrors.length > 0 && (
        <div
          className="animate-fade-slide-in typo-body text-red-400/70 mb-2 space-y-1"
        >
          <div className="flex items-center gap-1.5 justify-center">
            <XCircle className="w-3 h-3" />
            <span>
              {confirmResult.entityErrors.length} {confirmResult.entityErrors.length === 1 ? 'entity' : 'entities'} failed
            </span>
          </div>
          <div className="typo-body text-red-400/50 max-h-24 overflow-y-auto">
            {confirmResult.entityErrors.map((e, i) => (
              <div key={i}>{e.entity_type} &lsquo;{e.entity_name}&rsquo;: {e.error}</div>
            ))}
          </div>
        </div>
      )}
      {confirmResult && confirmResult.connectorsNeedingSetup.length > 0 && (
        <div
          className="animate-fade-slide-in flex items-center gap-2 justify-center typo-body text-amber-400/60 mb-2"
        >
          <AlertTriangle className="w-3 h-3" />
          {t.templates.n8n.configure_connectors.replace('{names}', confirmResult.connectorsNeedingSetup.join(', '))}
        </div>
      )}
      <div
        className="animate-fade-slide-in flex items-center justify-center gap-3"
      >
        <button
          onClick={onReset}
          className="flex items-center gap-2 px-4 py-2 typo-body rounded-modal border border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/15 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {t.templates.n8n.import_another}
        </button>
      </div>
    </div>
  );
}
