import {
  Check, Key, Globe, Laptop, Plug, Shield, Zap,
  MessageSquare, Database, Boxes, FolderOpen, Clock, Brain,
} from 'lucide-react';
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

/**
 * Local tooling Personas wires up out of the box — no credential needed.
 * Labels are product-domain nouns (kept inline, mirroring FEATURED_CATEGORIES).
 */
const BUILT_IN_TOOLING = [
  { id: 'messaging', label: 'Messaging', icon: MessageSquare },
  { id: 'database', label: 'Database', icon: Database },
  { id: 'vector', label: 'Vector', icon: Boxes },
  { id: 'filesystem', label: 'Filesystem', icon: FolderOpen },
  { id: 'schedule', label: 'Schedule', icon: Clock },
  { id: 'memory', label: 'Memory', icon: Brain },
] as const;

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
      {/* Category grid */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="typo-body font-medium text-foreground">{t.onboarding.categories_label}</span>
          <span className="text-[11px] text-foreground" data-testid="tour-cred-progress">
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
                <span className="text-[10px] text-foreground truncate w-full text-center">{cat.label}</span>
                {isBrowsed && <Check className="w-2.5 h-2.5 text-emerald-400" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Built-in local tooling — connected from the start, no credential needed */}
      <div className="space-y-2" data-testid="tour-cred-builtin">
        <span className="typo-body font-medium text-foreground">{t.onboarding.local_tooling_label}</span>
        <p className="text-[11px] text-foreground leading-relaxed">{t.onboarding.local_tooling_sentence}</p>
        <div className="grid grid-cols-3 gap-1.5">
          {BUILT_IN_TOOLING.map((tool) => (
            <div
              key={tool.id}
              data-testid={`tour-cred-builtin-${tool.id}`}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-card border border-primary/8 bg-secondary/10"
            >
              <tool.icon className="w-3.5 h-3.5 text-foreground flex-shrink-0" />
              <span className="text-[10px] text-foreground truncate">{tool.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Connection types */}
      <div className="space-y-2">
        <span className="typo-body font-medium text-foreground">{t.onboarding.connection_types_label}</span>
        <div className="space-y-1.5">
          {CONNECTION_TYPES.map((ct) => (
            <div
              key={ct.type}
              data-testid={`tour-cred-type-${ct.type}`}
              className={`flex items-start gap-2.5 p-2.5 rounded-modal border transition-all ${
                subStepIndex >= 2
                  ? 'border-primary/15 bg-secondary/20'
                  : 'border-primary/8 bg-secondary/10'
              }`}
            >
              <div className="w-7 h-7 rounded-card bg-secondary/40 flex items-center justify-center flex-shrink-0 mt-0.5">
                <ct.icon className="w-3.5 h-3.5 text-foreground" />
              </div>
              <div className="min-w-0">
                <p className="typo-body font-medium text-foreground">{t.onboarding[ct.labelKey]}</p>
                <p className="text-[11px] text-foreground leading-relaxed">{t.onboarding[ct.descKey]}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
