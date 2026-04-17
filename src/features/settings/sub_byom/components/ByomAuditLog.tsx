import type { ProviderAuditEntry } from '@/api/system/byom';
import { ENGINE_LABELS } from '../libs/byomHelpers';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { useTranslation } from '@/i18n/useTranslation';

interface ByomAuditLogProps {
  auditLog: ProviderAuditEntry[];
}

export function ByomAuditLog({ auditLog }: ByomAuditLogProps) {
  const { t } = useTranslation();
  const s = t.settings.byom;
  return (
    <div className="space-y-4">
      <div className="rounded-modal border border-primary/10 bg-card-bg p-4 space-y-3">
        <SectionHeading title={s.audit_title} />
        <p className="text-sm text-muted-foreground/60">
          {s.audit_hint}
        </p>

        {auditLog.length === 0 ? (
          <p className="text-sm text-muted-foreground/50 text-center py-6">
            {s.audit_empty}
          </p>
        ) : (
          <div className="border border-primary/10 rounded-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-primary/10 bg-secondary/30">
                  <th className="text-left p-2.5 text-muted-foreground/70 font-medium">{s.audit_provider}</th>
                  <th className="text-left p-2.5 text-muted-foreground/70 font-medium">{s.audit_model}</th>
                  <th className="text-left p-2.5 text-muted-foreground/70 font-medium">{s.audit_persona}</th>
                  <th className="text-left p-2.5 text-muted-foreground/70 font-medium">{s.audit_status}</th>
                  <th className="text-right p-2.5 text-muted-foreground/70 font-medium">{s.audit_cost}</th>
                  <th className="text-right p-2.5 text-muted-foreground/70 font-medium">{s.audit_time}</th>
                </tr>
              </thead>
              <tbody>
                {auditLog.map((entry) => (
                  <tr key={entry.id} className="border-b border-primary/5 hover:bg-secondary/20">
                    <td className="p-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-foreground">
                          {ENGINE_LABELS[entry.engine_kind] || entry.engine_kind}
                        </span>
                        {entry.was_failover && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/25">
                            {s.failover}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-2.5 text-muted-foreground/70">
                      {entry.model_used || '-'}
                    </td>
                    <td className="p-2.5 text-muted-foreground/70">
                      {entry.persona_name}
                    </td>
                    <td className="p-2.5">
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                        entry.status === 'completed'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : entry.status === 'failed'
                            ? 'bg-red-500/15 text-red-400'
                            : 'bg-secondary/50 text-muted-foreground/70'
                      }`}>
                        {entry.status}
                      </span>
                    </td>
                    <td className="p-2.5 text-right text-muted-foreground/70">
                      {entry.cost_usd != null ? `$${entry.cost_usd.toFixed(4)}` : '-'}
                    </td>
                    <td className="p-2.5 text-right text-muted-foreground/70">
                      {entry.duration_ms != null ? `${Math.round(entry.duration_ms / 1000)}s` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
