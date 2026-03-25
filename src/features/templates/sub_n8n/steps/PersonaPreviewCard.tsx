import { Wrench, Zap, Link, ChevronDown, ChevronRight, AlertTriangle, Brain, Activity, ShieldCheck } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useState } from 'react';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { ConnectorHealthRail } from './confirm/ConnectorHealthRail';
import type { ConnectorRailItem } from '../edit/connectorHealth';

interface ProtocolCapability {
  type: string;
  label: string;
  context: string;
}

interface ToolWithCredential {
  name: string;
  requires_credential_type?: string | null;
}

interface TagItem {
  key: string;
  label: string;
  title?: string;
}

interface PersonaPreviewCardProps {
  name: string | null;
  description: string | null;
  icon: string | null;
  color: string | null;
  systemPrompt: string | null;
  toolCount: number;
  triggerCount: number;
  connectorCount: number;
  reviewCount: number;
  memoryCount: number;
  eventCount: number;
  toolTags: TagItem[];
  triggerTags: TagItem[];
  connectorRailItems: ConnectorRailItem[];
  readyConnectorCount: number;
  capabilities: ProtocolCapability[];
  toolsNeedingCredentials: ToolWithCredential[];
}

export function PersonaPreviewCard({
  name,
  description,
  icon,
  color,
  systemPrompt,
  toolCount,
  triggerCount,
  connectorCount,
  reviewCount,
  memoryCount,
  eventCount,
  toolTags,
  triggerTags,
  connectorRailItems,
  readyConnectorCount,
  capabilities,
  toolsNeedingCredentials,
}: PersonaPreviewCardProps) {
  const [showPrompt, setShowPrompt] = useState(false);

  return (
    <div className="bg-secondary/20 border border-primary/10 rounded-xl p-4">
      <p className="text-sm font-semibold text-muted-foreground/55 uppercase tracking-wider mb-3">
        Persona Preview
      </p>

      <div className="flex items-center gap-4 mb-4">
        <div
          className="animate-fade-scale-in w-14 h-14 rounded-xl flex items-center justify-center text-xl border shadow-lg"
          style={{
            backgroundColor: `${color ?? '#8b5cf6'}18`,
            borderColor: `${color ?? '#8b5cf6'}30`,
            boxShadow: `0 4px 24px ${color ?? '#8b5cf6'}15`,
          }}
        >
          {icon ?? '\u2728'}
        </div>
        <div>
          <p className="text-base font-semibold text-foreground/90">
            {name ?? 'Unnamed Persona'}
          </p>
          <p className="text-sm text-muted-foreground/65 mt-0.5">
            {description ?? 'No description provided'}
          </p>
        </div>
      </div>

      {/* Entity summary grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6 md:gap-2 mb-4">
        <EntityCard icon={Wrench} count={toolCount} label="Tools" color="blue" />
        <EntityCard icon={Zap} count={triggerCount} label="Triggers" color="amber" />
        <EntityCard icon={Link} count={connectorCount} label="Connectors" color="emerald" />
        <EntityCard icon={ShieldCheck} count={reviewCount} label="Reviews" color="rose" />
        <EntityCard icon={Brain} count={memoryCount} label="Memory" color="cyan" />
        <EntityCard icon={Activity} count={eventCount} label="Events" color="orange" />
      </div>

      {/* Items breakdown */}
      {toolTags.length > 0 && <TagList items={toolTags} color="blue" />}
      {triggerTags.length > 0 && <TagList items={triggerTags} color="amber" />}

      {/* Connector health rail */}
      <ConnectorHealthRail
        connectorRailItems={connectorRailItems}
        readyConnectorCount={readyConnectorCount}
      />

      {/* Protocol capability badges */}
      {capabilities.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {capabilities.map((cap) => {
            const styles: Record<string, string> = {
              manual_review: 'bg-rose-500/10 text-rose-400/60 border-rose-500/15',
              user_message: 'bg-amber-500/10 text-amber-400/60 border-amber-500/15',
              agent_memory: 'bg-cyan-500/10 text-cyan-400/60 border-cyan-500/15',
              emit_event: 'bg-violet-500/10 text-violet-400/60 border-violet-500/15',
            };
            return (
              <span
                key={cap.type}
                className={`px-2 py-0.5 text-sm font-mono rounded border ${styles[cap.type] ?? ''}`}
                title={cap.context}
              >
                {cap.label.toLowerCase()}
              </span>
            );
          })}
        </div>
      )}

      {/* Tool-credential validation warning */}
      {toolsNeedingCredentials.length > 0 && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/5 border border-amber-500/15 mb-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400/60 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-400/60">
            <p className="font-medium">
              {toolsNeedingCredentials.length} tool{toolsNeedingCredentials.length !== 1 ? 's' : ''} require credentials not yet configured:
            </p>
            <p className="mt-0.5 font-mono">
              {toolsNeedingCredentials.map((t) => `${t.name} (${t.requires_credential_type})`).join(', ')}
            </p>
          </div>
        </div>
      )}

      {/* Collapsible system prompt */}
      {systemPrompt && (
        <div className="mt-3 border-t border-primary/10 pt-3">
          <Button
            variant="ghost"
            size="sm"
            icon={showPrompt ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            onClick={() => setShowPrompt(!showPrompt)}
            className="text-muted-foreground/65 hover:text-muted-foreground w-full justify-start"
          >
            System Prompt Preview
          </Button>
          {showPrompt && (
            <div
              className="animate-fade-slide-in mt-2 p-3 rounded-lg bg-background/40 border border-primary/10 overflow-hidden"
            >
              <div className="text-sm max-h-48 overflow-y-auto leading-relaxed">
                <MarkdownRenderer content={systemPrompt} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---- Local helper components ---- */

type ColorKey = 'blue' | 'amber' | 'emerald' | 'rose' | 'cyan' | 'orange';

const colorMap: Record<ColorKey, string> = {
  blue: 'bg-blue-500/5 border-blue-500/10 text-blue-400/60',
  amber: 'bg-amber-500/5 border-amber-500/10 text-amber-400/60',
  emerald: 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400/60',
  rose: 'bg-rose-500/5 border-rose-500/10 text-rose-400/60',
  cyan: 'bg-cyan-500/5 border-cyan-500/10 text-cyan-400/60',
  orange: 'bg-orange-500/5 border-orange-500/10 text-orange-400/60',
};

function EntityCard({ icon: Icon, count, label, color }: {
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  label: string;
  color: ColorKey;
}) {
  return (
    <div className={`px-2 py-3 rounded-xl border text-center ${colorMap[color]}`}>
      <Icon className="w-3.5 h-3.5 mx-auto mb-1" />
      <p className="text-base font-semibold text-foreground/80 tabular-nums">{count}</p>
      <p className="text-sm text-muted-foreground/55 uppercase tracking-wider">{label}</p>
    </div>
  );
}

const tagColorMap: Record<string, string> = {
  blue: 'bg-blue-500/10 text-blue-400/60 border-blue-500/15',
  amber: 'bg-amber-500/10 text-amber-400/60 border-amber-500/15',
};

function TagList({ items, color }: {
  items: { key: string; label: string; title?: string }[];
  color: string;
}) {
  return (
    <div className="flex flex-wrap gap-1 mb-2">
      {items.map((item) => (
        <span
          key={item.key}
          className={`px-2 py-0.5 text-sm font-mono rounded border ${tagColorMap[color] ?? ''}`}
          title={item.title}
        >
          {item.label}
        </span>
      ))}
    </div>
  );
}
