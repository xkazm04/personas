import { Check, Key, Globe, Laptop, Plug, Shield, Zap } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';

const FEATURED_CATEGORIES = [
  { id: 'ai', label: 'AI', icon: Zap, color: '#6C3AEF' },
  { id: 'messaging', label: 'Messaging', icon: Globe, color: '#6366f1' },
  { id: 'database', label: 'Database', icon: Shield, color: '#06b6d4' },
  { id: 'devops', label: 'DevOps', icon: Plug, color: '#8b5cf6' },
  { id: 'cloud', label: 'Cloud', icon: Globe, color: '#3b82f6' },
  { id: 'productivity', label: 'Productivity', icon: Key, color: '#eab308' },
  { id: 'analytics', label: 'Analytics', icon: Zap, color: '#7856FF' },
  { id: 'finance', label: 'Finance', icon: Shield, color: '#10b981' },
];

const CONNECTION_TYPES = [
  { type: 'api-key', labelKey: 'conn_api_key', descKey: 'conn_api_key_desc', icon: Key },
  { type: 'oauth', labelKey: 'conn_oauth', descKey: 'conn_oauth_desc', icon: Shield },
  { type: 'mcp', labelKey: 'conn_mcp', descKey: 'conn_mcp_desc', icon: Plug },
  { type: 'desktop', labelKey: 'conn_desktop', descKey: 'conn_desktop_desc', icon: Laptop },
] as const;

interface Props {
  subStepIndex: number;
}

export default function CredentialsTourContent({ subStepIndex }: Props) {
  const { t, tx } = useTranslation();
  const recordInteraction = useSystemStore((s) => s.recordCredentialInteraction);
  const interactions = useSystemStore((s) => s.tourCredentialInteractions);
  const browsedCount = interactions.categoriesBrowsed.length;

  return (
    <div className="space-y-4" data-testid="tour-cred-root">
      {/* Connector count */}
      <div className="flex items-center gap-3 p-3 rounded-modal bg-amber-500/5 border border-amber-500/15">
        <div className="w-10 h-10 rounded-modal bg-amber-500/15 border border-amber-500/25 flex items-center justify-center">
          <Key className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <p className="typo-heading text-foreground/90" data-testid="tour-cred-stat-count">{t.onboarding.connector_count_stat}</p>
          <p className="text-[11px] text-muted-foreground/60">{t.onboarding.connector_count_hint}</p>
        </div>
      </div>

      {/* Category grid */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-foreground/80">{t.onboarding.categories_label}</span>
          <span className="text-[11px] text-muted-foreground/50" data-testid="tour-cred-progress">
            {tx(t.onboarding.browsed_progress, { count: browsedCount })}
            {browsedCount >= 2 && <Check className="inline w-3 h-3 text-emerald-400 ml-1" />}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {FEATURED_CATEGORIES.map((cat) => {
            const isBrowsed = interactions.categoriesBrowsed.includes(cat.id);
            return (
              <button
                key={cat.id}
                onClick={() => recordInteraction('category', cat.id)}
                data-testid={`tour-cred-category-${cat.id}`}
                className={`flex flex-col items-center gap-1 p-2 rounded-modal border transition-all ${
                  isBrowsed
                    ? 'bg-emerald-500/5 border-emerald-500/20'
                    : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
                }`}
              >
                <div
                  className="w-6 h-6 rounded-card flex items-center justify-center"
                  style={{ backgroundColor: `${cat.color}20` }}
                >
                  <cat.icon className="w-3 h-3" style={{ color: cat.color }} />
                </div>
                <span className="text-[10px] text-muted-foreground/70 truncate w-full text-center">{cat.label}</span>
                {isBrowsed && <Check className="w-2.5 h-2.5 text-emerald-400" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Connection types */}
      <div className="space-y-2">
        <span className="text-sm font-medium text-foreground/80">{t.onboarding.connection_types_label}</span>
        <div className="space-y-1.5">
          {CONNECTION_TYPES.map((ct) => (
            <div
              key={ct.type}
              data-testid={`tour-cred-type-${ct.type}`}
              className={`flex items-start gap-2.5 p-2.5 rounded-modal border transition-all ${
                subStepIndex >= 2
                  ? 'border-amber-500/15 bg-amber-500/5'
                  : 'border-primary/8 bg-secondary/10'
              }`}
            >
              <div className="w-7 h-7 rounded-card bg-amber-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <ct.icon className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground/80">{t.onboarding[ct.labelKey]}</p>
                <p className="text-[11px] text-muted-foreground/50 leading-relaxed">{t.onboarding[ct.descKey]}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Benefits callout */}
      <div className="rounded-modal bg-amber-500/5 border border-amber-500/15 p-3">
        <p className="text-sm text-amber-300/80 font-medium">{t.onboarding.connect_once}</p>
        <p className="text-[11px] text-muted-foreground/50 mt-1">
          {t.onboarding.connect_once_hint}
        </p>
      </div>
    </div>
  );
}
