import { useState } from 'react';
import { WifiOff, Wifi, Globe, ChevronDown } from 'lucide-react';
import type { NetworkAccessScope } from '@/api/network/bundle';
import { useTranslation } from '@/i18n/useTranslation';

const SCOPE_STYLES = {
  none: {
    icon: WifiOff,
    labelKey: 'scope_none_label' as const,
    descKey: 'scope_none_desc' as const,
    borderClass: 'border-emerald-500/20',
    bgClass: 'bg-emerald-500/5',
    iconClass: 'text-emerald-400',
    badgeClass: 'bg-emerald-500/10 text-emerald-400',
  },
  restricted: {
    icon: Wifi,
    labelKey: 'scope_restricted_label' as const,
    descKey: 'scope_restricted_desc' as const,
    borderClass: 'border-amber-500/20',
    bgClass: 'bg-amber-500/5',
    iconClass: 'text-amber-400',
    badgeClass: 'bg-amber-500/10 text-amber-400',
  },
  unrestricted: {
    icon: Globe,
    labelKey: 'scope_unrestricted_label' as const,
    descKey: 'scope_unrestricted_desc' as const,
    borderClass: 'border-red-500/20',
    bgClass: 'bg-red-500/5',
    iconClass: 'text-red-400',
    badgeClass: 'bg-red-500/10 text-red-400',
  },
} as const;

export function NetworkAccessScopeBadge({ scope }: { scope: NetworkAccessScope }) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation();
  const st = t.sharing;
  const styles = SCOPE_STYLES[scope.level] ?? SCOPE_STYLES.none;
  const Icon = styles.icon;
  const config = { ...styles, label: (st as Record<string, string>)[styles.labelKey] ?? scope.level, description: (st as Record<string, string>)[styles.descKey] ?? '' };
  const hasDetails = scope.domains.length > 0 || scope.tool_integrations.length > 0 || scope.api_endpoints.length > 0;

  return (
    <div className={`rounded-lg border ${styles.borderClass} ${styles.bgClass}`}>
      <button
        type="button"
        onClick={() => hasDetails && setExpanded((v) => !v)}
        className={`flex w-full items-center gap-2 px-3 py-2 text-left ${hasDetails ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <Icon className={`w-4 h-4 flex-shrink-0 ${styles.iconClass}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${styles.badgeClass}`}>
              {config.label}
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {config.description}
          </div>
        </div>
        {hasDetails && (
          <ChevronDown
            className={`w-3.5 h-3.5 text-muted-foreground transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {expanded && hasDetails && (
        <div className="px-3 pb-2.5 space-y-1.5 border-t border-border/30 pt-2">
          {scope.domains.length > 0 && (
            <div>
              <div className="text-[10px] text-muted-foreground font-medium mb-0.5">{st.domains}</div>
              <div className="flex flex-wrap gap-1">
                {scope.domains.map((d) => (
                  <span key={d} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary/30 text-foreground/80 font-mono">
                    {d}
                  </span>
                ))}
              </div>
            </div>
          )}
          {scope.tool_integrations.length > 0 && (
            <div>
              <div className="text-[10px] text-muted-foreground font-medium mb-0.5">{st.integrations}</div>
              <div className="flex flex-wrap gap-1">
                {scope.tool_integrations.map((t) => (
                  <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary/30 text-foreground/80">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
          {scope.api_endpoints.length > 0 && (
            <div>
              <div className="text-[10px] text-muted-foreground font-medium mb-0.5">{st.api_endpoints}</div>
              <div className="space-y-0.5 max-h-20 overflow-y-auto">
                {scope.api_endpoints.map((ep) => (
                  <div key={ep} className="text-[10px] text-foreground/70 font-mono truncate">
                    {ep}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
