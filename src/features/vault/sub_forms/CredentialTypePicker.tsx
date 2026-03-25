import { Sparkles, Server, Link, Database, ArrowLeft, Radar, Monitor, Bot, Globe } from 'lucide-react';
import { IS_MOBILE } from '@/lib/utils/platform/platform';

interface CredentialTypePickerProps {
  onSelectApiTool: () => void;
  onSelectMcp: () => void;
  onSelectCustom: () => void;
  onSelectDatabase: () => void;
  onSelectDesktop: () => void;
  onSelectWizard: () => void;
  onWorkspaceConnect: () => void;
  onForage: () => void;
  onBack: () => void;
}

const TYPES = [
  {
    id: 'api-tool',
    icon: Sparkles,
    title: 'AI-Built Connector',
    description: 'Describe what you want to connect to and AI creates the setup for you -- no configuration needed.',
    color: '#8B5CF6',
    badge: 'Most popular',
    badgeColor: '#8B5CF6',
    useCase: 'Use this for: Slack, GitHub, Notion, Linear, Jira',
  },
  {
    id: 'mcp',
    icon: Server,
    title: 'AI Tool Server',
    description: 'Connect to an AI tool server -- paste the address and you\'re done.',
    color: '#06B6D4',
    badge: null,
    badgeColor: null,
    useCase: 'Use this for: MCP-compatible tool servers and plugins',
  },
  {
    id: 'custom',
    icon: Link,
    title: 'Web Service',
    description: 'Connect to any web service -- we\'ll guide you through the login details step by step.',
    color: '#F59E0B',
    badge: null,
    badgeColor: null,
    useCase: 'Use this for: REST APIs, webhooks, or services not in the catalog',
  },
  {
    id: 'database',
    icon: Database,
    title: 'Database',
    description: 'Connect to your database -- just paste the connection details and pick your tables.',
    color: '#10B981',
    badge: null,
    badgeColor: null,
    useCase: 'Use this for: PostgreSQL, MySQL, SQLite, MongoDB',
  },
  {
    id: 'desktop',
    icon: Monitor,
    title: 'Desktop App',
    description: 'Link apps already on your computer like VS Code, Docker, or Obsidian in one click.',
    color: '#F97316',
    badge: null,
    badgeColor: null,
    useCase: 'Use this for: VS Code, Docker, Obsidian, local CLI tools',
  },
  {
    id: 'wizard',
    icon: Bot,
    title: 'AI Setup Wizard',
    description: 'Let AI find your services and set everything up automatically -- just follow along.',
    color: '#7C3AED',
    badge: 'Recommended for beginners',
    badgeColor: '#7C3AED',
    useCase: 'Use this for: first-time setup or when you\'re not sure what to pick',
  },
] as const;

export function CredentialTypePicker({
  onSelectApiTool,
  onSelectMcp,
  onSelectCustom,
  onSelectDatabase,
  onSelectDesktop,
  onSelectWizard,
  onWorkspaceConnect,
  onForage,
  onBack,
}: CredentialTypePickerProps) {
  const handlers: Record<string, () => void> = {
    'api-tool': onSelectApiTool,
    'mcp': onSelectMcp,
    'custom': onSelectCustom,
    'database': onSelectDatabase,
    'desktop': onSelectDesktop,
    'wizard': onSelectWizard,
  };

  return (
    <div
      className="animate-fade-slide-in space-y-4"
    >
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground/80 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Add Credential</h3>
          <p className="text-sm text-muted-foreground/60">Choose the type of connection</p>
        </div>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: IS_MOBILE ? '1fr' : 'repeat(auto-fill, minmax(200px, 1fr))' }}>
        {TYPES.filter((t) => !IS_MOBILE || t.id !== 'desktop').map((type) => {
          const Icon = type.icon;
          const isWizard = type.id === 'wizard';
          return (
            <button
              key={type.id}
              onClick={handlers[type.id]}
              className={`group text-left p-4 border rounded-xl hover:bg-secondary/50 hover:border-primary/25 transition-all relative ${
                isWizard
                  ? 'bg-secondary/35 border-primary/20 ring-1 ring-violet-500/15'
                  : 'bg-secondary/25 border-primary/15'
              }`}
            >
              {isWizard && (
                <div className="absolute -top-2.5 left-4 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-500/15 text-violet-400 border border-violet-500/20">
                  Not sure? Start here
                </div>
              )}
              <div className="flex items-center gap-2 mb-3">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center border shrink-0"
                  style={{
                    backgroundColor: `${type.color}15`,
                    borderColor: `${type.color}30`,
                  }}
                >
                  <Icon className="w-4.5 h-4.5" style={{ color: type.color }} />
                </div>
                {type.badge && (
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-medium leading-tight"
                    style={{
                      backgroundColor: `${type.badgeColor}15`,
                      color: type.badgeColor,
                    }}
                  >
                    {type.badge}
                  </span>
                )}
              </div>
              <h4 className="text-sm font-medium text-foreground mb-1">{type.title}</h4>
              <p className="text-sm text-muted-foreground/60 leading-relaxed">{type.description}</p>
              <p className="text-xs text-muted-foreground/40 mt-1.5">{type.useCase}</p>
            </button>
          );
        })}
      </div>

      {/* Workspace Connect -- full width */}
      <button
        onClick={onWorkspaceConnect}
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
