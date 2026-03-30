import { ArrowLeft, Radar, Globe } from 'lucide-react';
import { IS_MOBILE } from '@/lib/utils/platform/platform';

interface CredentialTypePickerProps {
  onSelectAiGuide: () => void;
  onSelectMcp: () => void;
  onSelectCustom: () => void;
  onSelectDatabase: () => void;
  onSelectDesktop: () => void;
  onWorkspaceConnect: () => void;
  onForage: () => void;
  onBack: () => void;
}

const TYPES = [
  {
    id: 'ai-guide',
    testId: 'vault-pick-ai-connector',
    label: 'AI Guide',
    color: '#8B5CF6',
    illustration: '/vault-icons/ai-guide-nobg.png',
  },
  {
    id: 'mcp',
    testId: 'vault-pick-mcp',
    label: 'MCP',
    color: '#06B6D4',
    illustration: '/vault-icons/mcp-nobg.png',
  },
  {
    id: 'custom',
    testId: 'vault-pick-custom',
    label: 'Custom API',
    color: '#F59E0B',
    illustration: '/vault-icons/custom-api-nobg.png',
  },
  {
    id: 'database',
    testId: 'vault-pick-database',
    label: 'Database',
    color: '#10B981',
    illustration: '/vault-icons/database-nobg.png',
  },
  ...(import.meta.env.DEV ? [{
    id: 'desktop' as const,
    testId: 'vault-pick-desktop',
    label: 'Desktop App',
    color: '#D4A017',
    illustration: '/vault-icons/desktop-nobg.png',
    devOnly: true,
  }] : []),
];

export function CredentialTypePicker({
  onSelectAiGuide,
  onSelectMcp,
  onSelectCustom,
  onSelectDatabase,
  onSelectDesktop,
  onWorkspaceConnect,
  onForage,
  onBack,
}: CredentialTypePickerProps) {
  const handlers: Record<string, () => void> = {
    'ai-guide': onSelectAiGuide,
    'mcp': onSelectMcp,
    'custom': onSelectCustom,
    'database': onSelectDatabase,
    'desktop': onSelectDesktop,
  };

  return (
    <div
      className="animate-fade-slide-in space-y-4"
      data-testid="vault-type-picker"
    >
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          data-testid="vault-back-btn"
          className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground/80 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Add Credential</h3>
          <p className="text-sm text-muted-foreground/60">Choose the type of connection</p>
        </div>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: IS_MOBILE ? '1fr' : 'repeat(auto-fill, minmax(180px, 1fr))' }}>
        {TYPES.filter((t) => !IS_MOBILE || t.id !== 'desktop').map((type) => {
          const isDev = 'devOnly' in type && type.devOnly;
          return (
            <button
              key={type.id}
              data-testid={type.testId}
              onClick={handlers[type.id]}
              className={`group relative text-left border rounded-xl hover:border-primary/25 transition-all overflow-hidden ${isDev ? 'border-amber-400/50 ring-1 ring-amber-400/20' : 'border-primary/15'}`}
              style={{ borderTopColor: type.color, borderTopWidth: 3 }}
            >
              <div className="flex flex-col items-center py-4 px-3 gap-2">
                <img
                  src={type.illustration}
                  alt={type.label}
                  className="w-16 h-16 object-contain opacity-90 group-hover:opacity-100 group-hover:scale-105 transition-all"
                  draggable={false}
                />
                <div className="flex items-center gap-1.5">
                  <h4 className="text-sm font-medium text-foreground">{type.label}</h4>
                  {isDev && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-400 border border-amber-400/25 font-medium">DEV</span>}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Workspace Connect -- full width */}
      <button
        onClick={onWorkspaceConnect}
        data-testid="vault-pick-workspace"
        className="w-full text-left p-4 bg-gradient-to-r from-blue-500/5 to-emerald-500/5 border border-blue-500/15 rounded-xl hover:from-blue-500/10 hover:to-emerald-500/10 hover:border-blue-500/25 transition-all"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center border bg-blue-500/10 border-blue-500/20">
            <Globe className="w-4.5 h-4.5 text-blue-400" />
          </div>
          <div>
            <h4 className="text-sm font-medium text-foreground">Workspace Connect</h4>
            <p className="text-sm text-muted-foreground/60">
              One Google login creates Gmail, Calendar, Drive, and Sheets credentials automatically
            </p>
          </div>
        </div>
      </button>

      {/* Foraging -- full width at bottom (desktop only -- requires filesystem scan) */}
      {!IS_MOBILE && (
        <button
          onClick={onForage}
          data-testid="vault-pick-foraging"
          className="w-full text-left p-4 bg-gradient-to-r from-violet-500/5 to-cyan-500/5 border border-violet-500/15 rounded-xl hover:from-violet-500/10 hover:to-cyan-500/10 hover:border-violet-500/25 transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center border bg-violet-500/10 border-violet-500/20">
              <Radar className="w-4.5 h-4.5 text-violet-400" />
            </div>
            <div>
              <h4 className="text-sm font-medium text-foreground">Auto-Discover Credentials</h4>
              <p className="text-sm text-muted-foreground/60">
                Scan your filesystem for existing API keys, AWS profiles, env vars, and more
              </p>
            </div>
          </div>
        </button>
      )}
    </div>
  );
}
