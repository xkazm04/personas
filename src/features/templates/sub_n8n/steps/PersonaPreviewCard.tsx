import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useState } from 'react';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { PersonaEntitySummary } from './PersonaEntitySummary';
import { ConnectorHealthRail } from './confirm/ConnectorHealthRail';
import type { ConnectorRailItem } from '../edit/connectorHealth';
import { useTranslation } from '@/i18n/useTranslation';

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
  const { t } = useTranslation();
  const [showPrompt, setShowPrompt] = useState(false);

  return (
    <div className="bg-secondary/20 border border-primary/10 rounded-modal p-4">
      <p className="typo-heading font-semibold text-foreground uppercase tracking-wider mb-3">
        {t.templates.n8n.persona_preview}
      </p>

      <div className="flex items-center gap-4 mb-4">
        <div
          className="animate-fade-scale-in w-14 h-14 rounded-modal flex items-center justify-center typo-heading-lg border shadow-elevation-3"
          style={{
            backgroundColor: `${color ?? '#8b5cf6'}18`,
            borderColor: `${color ?? '#8b5cf6'}30`,
            boxShadow: `0 4px 24px ${color ?? '#8b5cf6'}15`,
          }}
        >
          {icon ?? '\u2728'}
        </div>
        <div>
          <p className="typo-body-lg font-semibold text-foreground/90">
            {name ?? t.templates.n8n.unnamed_persona}
          </p>
          <p className="typo-body text-foreground mt-0.5">
            {description ?? t.templates.n8n.no_description}
          </p>
        </div>
      </div>

      {/* Entity summary grid */}
      <PersonaEntitySummary
        toolCount={toolCount}
        triggerCount={triggerCount}
        connectorCount={connectorCount}
        reviewCount={reviewCount}
        memoryCount={memoryCount}
        eventCount={eventCount}
        className="mb-4"
      />

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
                className={`px-2 py-0.5 typo-code font-mono rounded border ${styles[cap.type] ?? ''}`}
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
        <div className="flex items-start gap-2 p-3 rounded-modal bg-amber-500/5 border border-amber-500/15 mb-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400/60 flex-shrink-0 mt-0.5" />
          <div className="typo-body text-amber-400/60">
            <p className="font-medium">
              {t.templates.n8n.tools_require_credentials.replace('{count}', String(toolsNeedingCredentials.length))}
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
            className="text-foreground hover:text-muted-foreground w-full justify-start"
          >
            {t.templates.n8n.system_prompt_preview}
          </Button>
          {showPrompt && (
            <div
              className="animate-fade-slide-in mt-2 p-3 rounded-card bg-background/40 border border-primary/10 overflow-hidden"
            >
              <div className="typo-body max-h-48 overflow-y-auto leading-relaxed">
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
          className={`px-2 py-0.5 typo-code font-mono rounded border ${tagColorMap[color] ?? ''}`}
          title={item.title}
        >
          {item.label}
        </span>
      ))}
    </div>
  );
}
