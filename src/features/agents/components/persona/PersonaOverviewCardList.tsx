import { Calendar, Clock, Inbox, Plug, Star, Zap } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { useToastStore } from '@/stores/toastStore';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaHealth } from '@/lib/bindings/PersonaHealth';
import { BuildingBadge, StatusBadge, TrustScoreBar } from './PersonaOverviewBadges';
import { PersonaOverviewRowMenu } from './PersonaOverviewRowMenu';
import { useTranslation } from '@/i18n/useTranslation';

async function copyDescription(text: string, t: { description_copied: string; copy_failed: string }) {
  const addToast = useToastStore.getState().addToast;
  try {
    await navigator.clipboard.writeText(text);
    addToast(t.description_copied, 'success');
  } catch {
    addToast(t.copy_failed, 'error');
  }
}

interface PersonaOverviewCardListProps {
  data: Persona[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string) => void;
  onRowClick: (p: Persona) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
  isBuilding: (id: string) => boolean;
  isDraft: (p: Persona) => boolean;
  healthMap: Record<string, PersonaHealth | undefined>;
  triggerCounts: Record<string, number>;
  lastRunMap: Record<string, string | null>;
  connectorNamesMap: Map<string, string[]>;
}

/**
 * Compact card layout used below the `md` breakpoint where the table grid would
 * truncate to the point of being unreadable. Each card surfaces:
 *  - selection checkbox + favorite star
 *  - persona icon, name, full description (no truncation)
 *  - status, trust, connectors, triggers, last run
 *  - row action menu
 */
export function PersonaOverviewCardList(props: PersonaOverviewCardListProps) {
  const { t } = useTranslation();
  const {
    data, selectedIds, onToggleSelect, isFavorite, toggleFavorite, onRowClick,
    onDelete, onEdit, isBuilding, isDraft, healthMap, triggerCounts, lastRunMap, connectorNamesMap,
  } = props;

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-10 h-10 rounded-modal bg-secondary/30 border border-primary/10 flex items-center justify-center mb-3">
          <Inbox className="w-5 h-5 text-muted-foreground/40" />
        </div>
        <p className="typo-heading text-foreground/70">{t.agents.persona_list.no_personas_match}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
      {data.map((p) => {
        const selected = selectedIds.has(p.id);
        const connectors = connectorNamesMap.get(p.id) ?? [];
        const lastRun = lastRunMap[p.id];
        const accent = isBuilding(p.id) ? 'border-l-violet-400'
          : isDraft(p) ? 'border-l-zinc-400'
          : healthMap[p.id]?.status === 'failing' ? 'border-l-red-400'
          : healthMap[p.id]?.status === 'degraded' ? 'border-l-amber-400'
          : 'border-l-emerald-400/60';
        return (
          <div
            key={p.id}
            className={`rounded-modal border border-primary/15 bg-secondary/20 backdrop-blur-sm border-l-2 ${accent} ${
              selected ? 'ring-1 ring-primary/40 bg-primary/[0.04]' : ''
            }`}
          >
            {/* Header row: select / icon / name / favorite / menu */}
            <div className="flex items-start gap-3 p-3">
              <button
                type="button"
                onClick={() => onToggleSelect(p.id)}
                aria-label={selected ? 'Deselect' : 'Select'}
                className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${
                  selected ? 'bg-primary/80 border-primary/60' : 'border-primary/30'
                }`}
              >
                {selected && (
                  <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                    <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
              <div
                className="icon-frame icon-frame-pop bg-primary/10 border border-primary/15 flex-shrink-0"
                style={p.color ? { borderColor: `${p.color}30`, backgroundColor: `${p.color}15` } : undefined}
              >
                <PersonaIcon icon={p.icon} color={p.color} size="w-4 h-4" framed frameSize="lg" />
              </div>
              <div className="flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() => onRowClick(p)}
                  className="text-md font-medium text-foreground/90 text-left hover:text-primary transition-colors block truncate w-full"
                >
                  {p.name}
                </button>
                {p.description && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void copyDescription(p.description!, t.agents.persona_list);
                    }}
                    title={t.agents.persona_list.click_to_copy}
                    className="text-md text-muted-foreground/70 mt-0.5 leading-snug text-left block w-full cursor-copy hover:text-muted-foreground transition-colors"
                  >
                    {p.description}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); toggleFavorite(p.id); }}
                aria-label={isFavorite(p.id) ? 'Remove from favorites' : 'Add to favorites'}
                className="p-1 rounded hover:bg-amber-500/10 flex-shrink-0"
              >
                <Star className={`w-3.5 h-3.5 ${isFavorite(p.id) ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground/40'}`} />
              </button>
              <PersonaOverviewRowMenu persona={p} onDelete={onDelete} onEdit={onEdit} />
            </div>

            {/* Meta row */}
            <div className="flex items-center justify-between flex-wrap gap-2 px-3 pb-3">
              {isBuilding(p.id)
                ? <BuildingBadge />
                : <StatusBadge enabled={p.enabled} health={healthMap[p.id]} isDraft={isDraft(p)} />}
              {p.enabled && !isDraft(p) && (
                <div className="min-w-[140px] flex-1">
                  <TrustScoreBar score={p.trust_score ?? 0} />
                </div>
              )}
            </div>

            {/* Connectors row */}
            {connectors.length > 0 ? (
              <div className="flex items-center gap-1 px-3 pb-3 flex-wrap">
                {connectors.slice(0, 6).map((name) => {
                  const meta = getConnectorMeta(name);
                  return (
                    <div
                      key={name}
                      title={meta.label}
                      className="w-6 h-6 rounded-input bg-secondary/30 border border-primary/10 flex items-center justify-center"
                    >
                      <ConnectorIcon meta={meta} size="w-3.5 h-3.5" />
                    </div>
                  );
                })}
                {connectors.length > 6 && (
                  <span className="text-md text-muted-foreground/50">+{connectors.length - 6}</span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-3 pb-3 text-md text-muted-foreground/40">
                <Plug className="w-3.5 h-3.5" /> {t.agents.persona_list.no_connectors}
              </div>
            )}

            {/* Footer: triggers + timestamps */}
            <div className="flex items-center gap-3 px-3 pb-3 text-md text-muted-foreground/60 border-t border-primary/5 pt-2">
              <span className="flex items-center gap-1"><Zap className="w-3 h-3" />{triggerCounts[p.id] ?? 0}</span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {lastRun ? formatRelativeTime(lastRun) : t.agents.persona_list.never}
              </span>
              {p.created_at && (
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {formatRelativeTime(p.created_at)}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
