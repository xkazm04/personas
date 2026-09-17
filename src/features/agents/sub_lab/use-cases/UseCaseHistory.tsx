import { useState, useEffect, useRef } from 'react';
import { RotateCw, CheckCircle2, XCircle, AlertTriangle, Pause, Clock, Play } from 'lucide-react';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import { listExecutionsForUseCase } from '@/api/agents/executions';
import { formatRelativeTime, formatDuration } from '@/lib/utils/formatters';
import { createLogger } from "@/lib/log";
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { silentCatch } from '@/lib/silentCatch';

const logger = createLogger("use-case-history");

const HISTORY_GHOST_WIDTHS = ['w-[78%]', 'w-[52%]', 'w-[91%]', 'w-[41%]', 'w-[67%]'];

const STATUS_ICONS: Record<string, { Icon: typeof CheckCircle2; className: string }> = {
  completed:  { Icon: CheckCircle2,  className: 'text-emerald-400' },
  failed:     { Icon: XCircle,       className: 'text-red-400' },
  cancelled:  { Icon: Pause,         className: 'text-amber-400' },
  incomplete: { Icon: AlertTriangle, className: 'text-orange-400' },
  running:    { Icon: Clock,         className: 'text-primary' },
  queued:     { Icon: Clock,         className: 'text-foreground' },
};

interface UseCaseHistoryProps {
  personaId: string;
  useCaseId: string;
  onRerun: (inputData: string) => void;
  refreshKey?: number;
}

export function UseCaseHistory({ personaId, useCaseId, onRerun, refreshKey }: UseCaseHistoryProps) {
  const { t } = useTranslation();
  const [executions, setExecutions] = useState<PersonaExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Sequence counter to discard stale responses when persona/useCase changes
  // or a new refreshKey arrives while a fetch is still in-flight.
  const fetchSeqRef = useRef(0);

  const identityRef = useRef(`${personaId}:${useCaseId}`);

  useEffect(() => {
    const seq = ++fetchSeqRef.current;
    const identity = `${personaId}:${useCaseId}`;
    if (identityRef.current !== identity) {
      identityRef.current = identity;
      setExecutions([]);
      setExpandedId(null);
    }
    setLoading(true);

    listExecutionsForUseCase(personaId, useCaseId, 10)
      .then((data) => {
        if (fetchSeqRef.current !== seq) return; // stale
        setExecutions(data);
      })
      .catch((err) => {
        silentCatch('UseCaseHistory:listExecutionsForUseCase')(err);
        logger.warn('Failed to load executions', { error: err });
        if (fetchSeqRef.current !== seq) return;
        setExecutions([]);
      })
      .finally(() => {
        if (fetchSeqRef.current === seq) setLoading(false);
      });
  }, [personaId, useCaseId, refreshKey]);

  if (loading && executions.length === 0) {
    return (
      <div
        role="status"
        aria-label={t.shared.use_cases_extra.loading_history}
        className="divide-y divide-primary/5"
      >
        {HISTORY_GHOST_WIDTHS.map((width, i) => (
          <div key={i} className="px-4 py-2 flex items-center gap-3 animate-fade-in" style={{ animationDelay: `${120 + i * 35}ms` }}>
            <div aria-hidden="true" className="w-3.5 h-3.5 rounded-full bg-primary/[0.06] flex-shrink-0" />
            <div aria-hidden="true" className={`h-3 rounded bg-primary/[0.06] ${width}`} />
          </div>
        ))}
      </div>
    );
  }

  if (!loading && executions.length === 0) {
    return (
      <div className="flex flex-col items-center py-8 space-y-3">
        <div className="w-10 h-10 rounded-xl bg-primary/5 border border-primary/10 flex items-center justify-center">
          <Clock className="w-5 h-5 text-primary/30" />
        </div>
        <h4 className="typo-heading text-foreground">{t.shared.use_cases_extra.no_executions}</h4>
        <p className="typo-body text-foreground text-center max-w-xs">
          {t.shared.use_cases_extra.run_to_see_history}
        </p>
        <button
          type="button"
          onClick={() => onRerun('')}
          className="mt-1 inline-flex items-center gap-2 px-4 py-2 typo-heading rounded-xl bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
        >
          <Play className="w-3.5 h-3.5" />
          {t.shared.use_cases_extra.run_use_case}
        </button>
      </div>
    );
  }

  return (
    <div className="divide-y divide-primary/5">
      {executions.map((exec) => {
        const statusInfo = (STATUS_ICONS[exec.status] ?? STATUS_ICONS.queued)!;
        const StatusIcon = statusInfo.Icon;
        const isExpanded = expandedId === exec.id;

        return (
          <div key={exec.id} className="px-4 py-2">
            <button
              type="button"
              onClick={() => setExpandedId(isExpanded ? null : exec.id)}
              className="w-full flex items-center gap-3 text-left"
            >
              <StatusIcon className={`w-3.5 h-3.5 flex-shrink-0 ${statusInfo.className}`} />
              <span className="typo-heading text-foreground capitalize w-20 flex-shrink-0">
                {exec.status}
              </span>
              <span className="typo-data text-foreground w-14 flex-shrink-0">
                {formatDuration(exec.duration_ms)}
              </span>
              <span className="typo-body text-foreground flex-1 truncate">
                {formatRelativeTime(exec.created_at)}
              </span>
              {exec.cost_usd != null && exec.cost_usd > 0 && (
                <span className="typo-data text-foreground flex-shrink-0">
                  $<Numeric value={exec.cost_usd} precision={4} />
                </span>
              )}
              {exec.input_data && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRerun(exec.input_data!);
                  }}
                  className="p-1 rounded hover:bg-primary/10 text-foreground hover:text-primary/70 transition-colors flex-shrink-0"
                  title={t.shared.use_cases_extra.rerun_input}
                >
                  <RotateCw className="w-3 h-3" />
                </button>
              )}
            </button>

            {/* Expanded detail */}
            {isExpanded && (
              <div className="mt-2 ml-6 space-y-1.5 typo-body">
                {exec.input_data && (
                  <div>
                    <span className="text-foreground font-medium">{t.shared.use_cases_extra.input_prefix}</span>
                    <code className="text-foreground typo-code break-all">
                      {exec.input_data.length > 200 ? exec.input_data.slice(0, 200) + '...' : exec.input_data}
                    </code>
                  </div>
                )}
                {exec.error_message && (
                  <div>
                    <span className="text-red-400/70 font-medium">{t.shared.use_cases_extra.error_prefix}</span>
                    <span className="text-red-400/60">{exec.error_message}</span>
                  </div>
                )}
                {exec.output_data && (
                  <div>
                    <span className="text-foreground font-medium">{t.shared.use_cases_extra.output_prefix}</span>
                    <code className="text-foreground typo-code break-all">
                      {exec.output_data.length > 300 ? exec.output_data.slice(0, 300) + '...' : exec.output_data}
                    </code>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
