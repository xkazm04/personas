import { motion } from 'framer-motion';
import { Sparkles, Server, Link, Database, ArrowLeft, Radar, Monitor, Bot, Globe } from 'lucide-react';

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
    title: 'API Tool',
    description: 'AI-designed credential for any API service. Describe the tool and Claude generates the exact fields.',
    color: '#8B5CF6',
  },
  {
    id: 'mcp',
    icon: Server,
    title: 'MCP Server',
    description: 'Connect to an MCP server via stdio command or SSE URL with environment variables.',
    color: '#06B6D4',
  },
  {
    id: 'custom',
    icon: Link,
    title: 'Custom Connection',
    description: 'URL + auth template (API key, Bearer, Basic) with optional OpenAPI definition.',
    color: '#F59E0B',
  },
  {
    id: 'database',
    icon: Database,
    title: 'Database',
    description: 'PostgreSQL, Supabase, Convex, or MongoDB with optional schema specification.',
    color: '#10B981',
  },
  {
    id: 'desktop',
    icon: Monitor,
    title: 'Desktop App',
    description: 'Connect to local apps like VS Code, Docker, Terminal, Obsidian, or import Claude Desktop MCP servers.',
    color: '#F97316',
  },
  {
    id: 'wizard',
    icon: Bot,
    title: 'AI Setup Wizard',
    description: 'Auto-detect services and set up credentials with AI-guided browser automation.',
    color: '#7C3AED',
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
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-4"
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

      <div className="grid grid-cols-2 gap-3">
        {TYPES.map((type) => {
          const Icon = type.icon;
          return (
            <button
              key={type.id}
              onClick={handlers[type.id]}
              className="group text-left p-4 bg-secondary/25 border border-primary/15 rounded-xl hover:bg-secondary/50 hover:border-primary/25 transition-all"
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center border mb-3"
                style={{
                  backgroundColor: `${type.color}15`,
                  borderColor: `${type.color}30`,
                }}
              >
                <Icon className="w-4.5 h-4.5" style={{ color: type.color }} />
              </div>
              <h4 className="text-sm font-medium text-foreground mb-1">{type.title}</h4>
              <p className="text-sm text-muted-foreground/60 leading-relaxed">{type.description}</p>
            </button>
          );
        })}
      </div>

      {/* Workspace Connect — full width */}
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

      {/* Foraging — full width at bottom */}
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
    </motion.div>
  );
}
