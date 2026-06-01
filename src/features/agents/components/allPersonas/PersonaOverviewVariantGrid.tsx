// Grid layout for the persona list.
// ---------------------------------------------------------------
// Icon-forward, calm catalogue. Each card surfaces seven facts:
// persona icon (hero), name, connector chips (top-left), status dot
// (top-right), trust tier, trigger count, last run. Selection +
// favourite affordances fade in on hover so the static state stays
// uncluttered. Tooltips are reserved for the meta footer (trust /
// triggers / last run) — connector chips render raw.

import { memo } from 'react';
import { Star, Zap, Clock } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useAgentStore } from '@/stores/agentStore';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { getTrustTier } from '@/lib/personas/personaThresholds';
import { useTranslation } from '@/i18n/useTranslation';
import type { Persona } from '@/lib/bindings/Persona';

interface PersonaOverviewVariantGridProps {
  data: Persona[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string) => void;
  onRowClick: (p: Persona) => void;
  isDraft: (p: Persona) => boolean;
  connectorNamesMap: Map<string, string[]>;
}

const STATUS_DOT_COLOR: Record<string, string> = {
  healthy: 'bg-emerald-400',
  degraded: 'bg-amber-400',
  failing: 'bg-red-400',
};
const MAX_CONNECTORS_VISIBLE = 4;
const EMPTY_CONNECTORS: string[] = [];

// Cap the unvirtualized card grid so a very large fleet can't build thousands of
// DOM nodes on mount. The default table layout (DataGrid) already handles big
// lists; this calm-catalogue variant renders the first N and points the user at
// search/filters. True windowing (a responsive grid virtualizer) is the queued
// follow-up — architect perf scan, Phase E (render-cap guardrail).
const PERSONA_RENDER_CAP = 200;

export function PersonaOverviewVariantGrid({
  data,
  selectedIds,
  onToggleSelect,
  isFavorite,
  toggleFavorite,
  onRowClick,
  isDraft,
  connectorNamesMap,
}: PersonaOverviewVariantGridProps) {
  const { t, tx } = useTranslation();
  const total = data.length;
  const shown = total > PERSONA_RENDER_CAP ? data.slice(0, PERSONA_RENDER_CAP) : data;
  return (
    <div className="flex-1 overflow-y-auto px-3 py-3">
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
        {shown.map((p) => (
          <PersonaGridCard
            key={p.id}
            id={p.id}
            selected={selectedIds.has(p.id)}
            connectors={connectorNamesMap.get(p.id) ?? EMPTY_CONNECTORS}
            onToggleSelect={onToggleSelect}
            isFavorite={isFavorite}
            toggleFavorite={toggleFavorite}
            onRowClick={onRowClick}
            isDraft={isDraft}
          />
        ))}
      </div>
      {total > PERSONA_RENDER_CAP && (
        <p className="mt-3 text-center typo-caption text-foreground">
          {tx(t.agents.persona_list.render_cap_notice, { shown: PERSONA_RENDER_CAP, total })}
        </p>
      )}
    </div>
  );
}

interface PersonaGridCardProps {
  id: string;
  selected: boolean;
  connectors: string[];
  onToggleSelect: (id: string) => void;
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string) => void;
  onRowClick: (p: Persona) => void;
  isDraft: (p: Persona) => boolean;
}

const PersonaGridCard = memo(function PersonaGridCard({
  id,
  selected,
  connectors,
  onToggleSelect,
  isFavorite,
  toggleFavorite,
  onRowClick,
  isDraft,
}: PersonaGridCardProps) {
  const { t } = useTranslation();
  const { persona: p, health, triggerCount, lastRun, buildPersonaId, buildPhase } =
    useAgentStore(useShallow((s) => ({
      persona: s.personas.find((x) => x.id === id),
      health: s.personaHealthMap[id],
      triggerCount: s.personaTriggerCounts[id] ?? 0,
      lastRun: s.personaLastRun[id],
      buildPersonaId: s.buildPersonaId,
      buildPhase: s.buildPhase,
    })));

  if (!p) return null;

  const building = id === buildPersonaId && buildPhase !== 'initializing' && buildPhase !== 'promoted';
  const draft = isDraft(p);
  const favorite = isFavorite(id);
  const enabled = p.enabled && !draft;
  const healthStatus = health?.status ?? 'healthy';
  const dotColor = building
    ? 'bg-violet-400'
    : !enabled
      ? 'bg-zinc-500'
      : (STATUS_DOT_COLOR[healthStatus] ?? STATUS_DOT_COLOR.healthy);
  const dotPulse = enabled && !building && healthStatus !== 'healthy' ? 'animate-pulse' : '';

  const tier = enabled ? getTrustTier(p.trust_score ?? 0) : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onRowClick(p)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onRowClick(p);
        }
      }}
      // Drag source for the persona → group assignment flow
      // (cycle 12). The drop targets render in PersonaGroupDropRail at
      // the top of PersonaOverviewPage. Setting effectAllowed to 'move'
      // matches the semantic (a persona belongs to at most one group).
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-personas-persona-id', p.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className={`group relative rounded-modal border bg-secondary/20 backdrop-blur-sm transition-colors duration-150 px-4 pt-10 pb-3.5 flex flex-col items-center text-center gap-2 cursor-pointer min-h-[220px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 ${
        selected
          ? 'border-primary/40 ring-1 ring-primary/30 bg-primary/[0.05]'
          : 'border-primary/15 hover:border-primary/25 hover:bg-secondary/30'
      }`}
    >
      {/* Status dot — top-right corner */}
      <span className={`absolute top-3 right-3 w-2 h-2 rounded-full ${dotColor} ${dotPulse}`} />

      {/* Connector icons — top-left corner, no tooltips */}
      {connectors.length > 0 && (
        <div className="absolute top-2.5 left-2.5 flex items-center gap-1">
          {connectors.slice(0, MAX_CONNECTORS_VISIBLE).map((name) => {
            const meta = getConnectorMeta(name);
            return (
              <div
                key={name}
                className="w-5 h-5 rounded-input bg-secondary/40 border border-primary/10 flex items-center justify-center"
              >
                <ConnectorIcon meta={meta} size="w-3 h-3" />
              </div>
            );
          })}
          {connectors.length > MAX_CONNECTORS_VISIBLE && (
            <span className="text-md text-foreground ml-0.5">
              +{connectors.length - MAX_CONNECTORS_VISIBLE}
            </span>
          )}
        </div>
      )}

      {/* Hero icon — centered, large */}
      <div
        className="icon-frame icon-frame-pop icon-frame-lg bg-primary/10 border border-primary/15"
        style={p.color ? { borderColor: `${p.color}30`, backgroundColor: `${p.color}15` } : undefined}
      >
        <PersonaIcon icon={p.icon} color={p.color} display="pop" frameSize="lg" />
      </div>

      {/* Persona name — centered under icon */}
      <div className="typo-body-lg font-medium text-foreground truncate leading-tight max-w-full mt-2">
        {p.name}
      </div>

      {/* Meta footer: trust + triggers + last run */}
      <div className="flex items-center justify-center gap-3 pt-2 mt-auto w-full border-t border-primary/8">
        {tier ? (
          <Tooltip content={`Trust score ${Math.round(p.trust_score ?? 0)}/100`}>
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-input text-md font-semibold ${tier.bg} ${tier.color} cursor-help`}>
              {tier.label}
            </span>
          </Tooltip>
        ) : (
          <span className="text-md text-foreground">{draft ? t.agents.persona_list.badge_draft : '--'}</span>
        )}

        <Tooltip content={`${triggerCount} active trigger${triggerCount === 1 ? '' : 's'}`}>
          <span className="inline-flex items-center gap-1 text-md text-foreground cursor-help">
            <Zap className="w-3 h-3" />
            {triggerCount}
          </span>
        </Tooltip>

        <Tooltip content={lastRun ?? t.agents.persona_list.never}>
          <span className="inline-flex items-center gap-1 text-md text-foreground cursor-help">
            <Clock className="w-3 h-3" />
            {lastRun ? formatRelativeTime(lastRun) : t.agents.persona_list.never}
          </span>
        </Tooltip>
      </div>

      {/* Favorite star — bottom-left, only visible on hover or when active */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); toggleFavorite(id); }}
        aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
        className={`absolute bottom-2 left-2 p-1 rounded transition-opacity ${
          favorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
        } hover:bg-amber-500/10`}
      >
        <Star
          className={`w-3.5 h-3.5 transition-colors ${
            favorite ? 'text-amber-400 fill-amber-400' : 'text-foreground hover:text-amber-400/80'
          }`}
        />
      </button>

      {/* Selection checkbox — bottom-right, only on hover or when checked */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggleSelect(id); }}
        aria-label={selected ? 'Deselect' : 'Select'}
        className={`absolute bottom-2 right-2 w-4 h-4 rounded border transition-all flex items-center justify-center ${
          selected
            ? 'bg-primary/80 border-primary/60 opacity-100'
            : 'border-primary/30 opacity-0 group-hover:opacity-100 focus:opacity-100'
        }`}
      >
        {selected && (
          <svg className="w-3 h-3 text-foreground" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    </div>
  );
});
