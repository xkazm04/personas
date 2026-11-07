import { PressSurface } from '@/features/shared/components/buttons/PressSurface';
import { useState } from 'react';
import { WifiOff, Wifi, Globe, ChevronDown } from 'lucide-react';
import type { NetworkAccessScope } from '@/api/network/bundle';
import { useTranslation } from '@/i18n/useTranslation';

const SCOPE_STYLES = {
  none: {
    icon: WifiOff,
    labelKey: 'scope_none_label' as const,
    descKey: 'scope_none_desc' as const,
    borderClass: 'border-status-success/20',
    bgClass: 'bg-status-success/5',
    iconClass: 'text-status-success',
    badgeClass: 'bg-status-success/10 text-status-success',
  },
  restricted: {
    icon: Wifi,
    labelKey: 'scope_restricted_label' as const,
    descKey: 'scope_restricted_desc' as const,
    borderClass: 'border-status-warning/20',
    bgClass: 'bg-status-warning/5',
    iconClass: 'text-status-warning',
    badgeClass: 'bg-status-warning/10 text-status-warning',
  },
  unrestricted: {
    icon: Globe,
    labelKey: 'scope_unrestricted_label' as const,
    descKey: 'scope_unrestricted_desc' as const,
    borderClass: 'border-status-error/20',
    bgClass: 'bg-status-error/5',
    iconClass: 'text-status-error',
    badgeClass: 'bg-status-error/10 text-status-error',
  },
} as const;

export function NetworkAccessScopeBadge({ scope }: { scope: NetworkAccessScope }) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation();
  const st = t.sharing;
  // Fail closed: the wire carries a bare string (ts-rs `level: string`), and a
  // level this build does not know must never borrow the green "no network
  // access" verdict. Show it as the broadest scope until the UI learns it.
  const styles = SCOPE_STYLES[scope.level] ?? SCOPE_STYLES.unrestricted;
  const Icon = styles.icon;
  const config = { ...styles, label: (st as Record<string, string>)[styles.labelKey] ?? scope.level, description: (st as Record<string, string>)[styles.descKey] ?? '' };
  const hasDetails = scope.domains.length > 0 || scope.tool_integrations.length > 0 || scope.api_endpoints.length > 0;

  return (
    <div className={`rounded-card border ${styles.borderClass} ${styles.bgClass}`}>
      <PressSurface onPress={() => hasDetails && setExpanded((v) => !v)} aria-expanded={hasDetails ? expanded : undefined} className="flex w-full items-center gap-2 px-3 py-2">
        <Icon className={`w-4 h-4 flex-shrink-0 ${styles.iconClass}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`typo-label px-1.5 py-0.5 rounded-full ${styles.badgeClass}`}>
              {config.label}
            </span>
          </div>
          <div className="typo-caption text-foreground mt-0.5">
            {config.description}
          </div>
        </div>
        {hasDetails && (
          <ChevronDown
            className={`w-3.5 h-3.5 text-foreground transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}
          />
        )}
      </PressSurface>

      {expanded && hasDetails && (
        <div className="px-3 pb-2.5 space-y-1.5 border-t border-border/30 pt-2">
          {scope.domains.length > 0 && (
            <div>
              <div className="typo-label text-foreground mb-0.5">{st.domains}</div>
              <div className="flex flex-wrap gap-1">
                {scope.domains.map((d) => (
                  <span key={d} className="typo-caption px-1.5 py-0.5 rounded-interactive bg-surface-1 text-foreground font-mono">
                    {d}
                  </span>
                ))}
              </div>
            </div>
          )}
          {scope.tool_integrations.length > 0 && (
            <div>
              <div className="typo-label text-foreground mb-0.5">{st.integrations}</div>
              <div className="flex flex-wrap gap-1">
                {scope.tool_integrations.map((t) => (
                  <span key={t} className="typo-caption px-1.5 py-0.5 rounded-interactive bg-surface-1 text-foreground">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
          {scope.api_endpoints.length > 0 && (
            <div>
              <div className="typo-label text-foreground mb-0.5">{st.api_endpoints}</div>
              <div className="space-y-0.5 max-h-20 overflow-y-auto">
                {scope.api_endpoints.map((ep) => (
                  <div key={ep} className="typo-caption text-foreground font-mono truncate">
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
