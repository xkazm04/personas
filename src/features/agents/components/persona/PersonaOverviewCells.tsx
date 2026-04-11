import { Plug, Star } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { extractConnectorNames } from '@/lib/personas/utils';
import { useToastStore } from '@/stores/toastStore';
import type { Persona } from '@/lib/bindings/Persona';
import { useTranslation } from '@/i18n/useTranslation';

/** Copy `text` to the clipboard and surface a short-lived success/error toast. */
async function copyDescriptionToClipboard(text: string, labels: { description_copied: string; copy_failed: string }) {
  const addToast = useToastStore.getState().addToast;
  try {
    await navigator.clipboard.writeText(text);
    addToast(labels.description_copied, 'success');
  } catch {
    addToast(labels.copy_failed, 'error');
  }
}

/* -- Select checkbox cell -------------------------------------------- */

export function SelectCell({
  persona,
  selected,
  onToggle,
}: {
  persona: Persona;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onToggle(persona.id);
      }}
      className="flex items-center justify-center"
    >
      <div
        className={`w-4 h-4 rounded border transition-all flex items-center justify-center cursor-pointer ${
          selected ? 'bg-primary/80 border-primary/60' : 'border-primary/25 hover:border-primary/50'
        }`}
      >
        {selected && (
          <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
    </div>
  );
}

/* -- Favorite star cell ---------------------------------------------- */

export function FavoriteCell({
  persona,
  isFavorite,
  onToggle,
}: {
  persona: Persona;
  isFavorite: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <Tooltip content={isFavorite ? 'Remove from favorites' : 'Add to favorites'}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle(persona.id);
        }}
        className="flex items-center justify-center p-0.5 rounded transition-colors hover:bg-amber-500/10"
      >
        <Star
          className={`w-3.5 h-3.5 transition-colors ${
            isFavorite ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground/25 hover:text-amber-400/50'
          }`}
        />
      </button>
    </Tooltip>
  );
}

/* -- Persona identity cell (icon + name + description tooltip) ------- */

export function NameCell({ persona, onClick }: { persona: Persona; onClick: (p: Persona) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 min-w-0 w-full">
      <div
        className="icon-frame icon-frame-pop bg-primary/10 border border-primary/15 flex-shrink-0"
        style={persona.color ? { borderColor: `${persona.color}30`, backgroundColor: `${persona.color}15` } : undefined}
      >
        <PersonaIcon icon={persona.icon} color={persona.color} size="w-4 h-4" framed frameSize="lg" />
      </div>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClick(persona);
          }}
          className="text-md font-medium text-foreground/90 truncate block max-w-full text-left hover:text-primary transition-colors"
        >
          {persona.name}
        </button>
        {persona.description && (
          <Tooltip content={`${persona.description}\n\nClick to copy`} placement="bottom">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void copyDescriptionToClipboard(persona.description!, t.agents.persona_list);
              }}
              className="text-md text-muted-foreground/50 truncate cursor-copy text-left block max-w-full hover:text-muted-foreground/80 transition-colors"
            >
              {persona.description}
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

/* -- Connector chips cell -------------------------------------------- */

const MAX_VISIBLE_CONNECTORS = 4;

export function ConnectorsCell({
  persona,
  connectorNamesMap,
}: {
  persona: Persona;
  connectorNamesMap: Map<string, string[]>;
}) {
  const { t } = useTranslation();
  const connectors = connectorNamesMap.get(persona.id) ?? extractConnectorNames(persona);

  if (connectors.length === 0) {
    return (
      <Tooltip content={t.agents.persona_list.no_connectors_configured}>
        <span className="text-muted-foreground/30">
          <Plug className="w-3.5 h-3.5" />
        </span>
      </Tooltip>
    );
  }

  return (
    <div className="flex items-center gap-1 min-w-0">
      {connectors.slice(0, MAX_VISIBLE_CONNECTORS).map((name) => {
        const meta = getConnectorMeta(name);
        return (
          <Tooltip key={name} content={meta.label}>
            <div className="w-6 h-6 rounded-md bg-secondary/30 border border-primary/10 flex items-center justify-center flex-shrink-0">
              <ConnectorIcon meta={meta} size="w-3.5 h-3.5" />
            </div>
          </Tooltip>
        );
      })}
      {connectors.length > MAX_VISIBLE_CONNECTORS && (
        <Tooltip content={connectors.slice(MAX_VISIBLE_CONNECTORS).join(', ')}>
          <span className="text-md text-muted-foreground/50 ml-0.5 cursor-help">
            +{connectors.length - MAX_VISIBLE_CONNECTORS}
          </span>
        </Tooltip>
      )}
    </div>
  );
}
