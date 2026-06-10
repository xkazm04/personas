/**
 * StudioSwitchboard — the Chain Studio surface. A patch-bay mental model:
 * sources rail on the left (9 signal types + persona completions), target
 * personas on the right, and the routes ledger in the middle. Arm a source,
 * click a target — the route patches in. Order-agnostic: arming a target
 * first works too. Both rails are type-to-filter.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Search, Trash2, X, Zap, Bot, Filter } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from '@/stores/agentStore';
import type { Persona } from '@/lib/bindings/Persona';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { TRIGGER_BLOCK_TEMPLATES } from './libs/triggerStudioConstants';
import {
  loadDraft, saveDraft, newLinkId, findTrigger, personaName,
  LINK_CONDITION_PRESETS,
  type ChainDraft, type DraftSource, type LinkCondition,
} from './libs/studioDraftModel';
import { TriggerOptionCard, PersonaOptionCard } from './StudioOptionCards';

type T = ReturnType<typeof useTranslation>['t'];

function conditionLabel(t: T, condition: LinkCondition): string {
  switch (condition) {
    case 'on_success': return t.triggers.studio.condition_on_success;
    case 'on_failure': return t.triggers.studio.condition_on_failure;
    case 'output_match': return t.triggers.studio.condition_output_match;
    default: return t.triggers.studio.condition_always;
  }
}

type SourceRailKind = 'signals' | 'personas';

export function StudioSwitchboard() {
  const { t, tx } = useTranslation();
  const personas = useAgentStore((s) => s.personas);
  const [draft, setDraft] = useState<ChainDraft>(() => loadDraft());
  const [armedSource, setArmedSource] = useState<DraftSource | null>(null);
  const [armedTarget, setArmedTarget] = useState<string | null>(null);
  const [sourceKind, setSourceKind] = useState<SourceRailKind>('signals');
  const [sourceQuery, setSourceQuery] = useState('');
  const [targetQuery, setTargetQuery] = useState('');

  useEffect(() => { saveDraft(draft); }, [draft]);

  // Arming both sides completes a route.
  useEffect(() => {
    if (armedSource && armedTarget) {
      setDraft((d) => ({
        ...d,
        links: [...d.links, { id: newLinkId(), source: armedSource, targetPersonaId: armedTarget, condition: null }],
      }));
      setArmedSource(null);
      setArmedTarget(null);
    }
  }, [armedSource, armedTarget]);

  const sq = sourceQuery.trim().toLowerCase();
  const filteredTriggers = useMemo(
    () => TRIGGER_BLOCK_TEMPLATES.filter((tpl) => !sq || tpl.label.toLowerCase().includes(sq) || tpl.description.toLowerCase().includes(sq)),
    [sq],
  );
  const filteredSourcePersonas = useMemo(
    () => personas.filter((p) => !sq || p.name.toLowerCase().includes(sq)),
    [personas, sq],
  );
  const tq = targetQuery.trim().toLowerCase();
  const filteredTargets = useMemo(
    () => personas.filter((p) => !tq || p.name.toLowerCase().includes(tq) || (p.description ?? '').toLowerCase().includes(tq)),
    [personas, tq],
  );

  const removeLink = (id: string) =>
    setDraft((d) => ({ ...d, links: d.links.filter((l) => l.id !== id) }));

  const cycleCondition = (id: string) =>
    setDraft((d) => ({
      ...d,
      links: d.links.map((l) => {
        if (l.id !== id) return l;
        const i = LINK_CONDITION_PRESETS.indexOf(l.condition);
        return { ...l, condition: LINK_CONDITION_PRESETS[(i + 1) % LINK_CONDITION_PRESETS.length] ?? null };
      }),
    }));

  return (
    <div className="flex-1 flex min-h-0" data-testid="studio-switchboard">
      {/* ── Sources rail ─────────────────────────────────────────────── */}
      <div className="w-80 border-r border-border flex flex-col min-h-0 bg-card/30">
        <div className="px-3 pt-3 pb-2 space-y-2">
          <SegmentedTabs<SourceRailKind>
            tabs={[
              { id: 'signals', label: <><Zap className="w-3.5 h-3.5 text-amber-400" />{t.triggers.studio.group_signals}</> },
              { id: 'personas', label: <><Bot className="w-3.5 h-3.5 text-emerald-400" />{t.triggers.studio.group_personas}</> },
            ]}
            activeTab={sourceKind}
            onTabChange={setSourceKind}
            ariaLabel={t.triggers.studio.sources_title}
          />
          <p className="typo-caption text-foreground px-1">
            {sourceKind === 'signals' ? t.triggers.studio.sources_subtitle : t.triggers.studio.group_after_persona}
          </p>
          <SearchField query={sourceQuery} onQuery={setSourceQuery} />
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5">
          {sourceKind === 'signals' && filteredTriggers.map((tpl) => (
            <TriggerOptionCard
              key={tpl.id}
              template={tpl}
              dense
              active={armedSource?.kind === 'trigger' && armedSource.triggerType === tpl.triggerType}
              onPick={() => setArmedSource((s) => (s?.kind === 'trigger' && s.triggerType === tpl.triggerType ? null : { kind: 'trigger', triggerType: tpl.triggerType }))}
            />
          ))}
          {sourceKind === 'personas' && filteredSourcePersonas.map((p) => (
            <PersonaOptionCard
              key={p.id}
              persona={p}
              dense
              hint={t.triggers.studio.source_persona_hint}
              active={armedSource?.kind === 'persona' && armedSource.personaId === p.id}
              onPick={() => setArmedSource((s) => (s?.kind === 'persona' && s.personaId === p.id ? null : { kind: 'persona', personaId: p.id }))}
            />
          ))}
          {sourceKind === 'signals' && filteredTriggers.length === 0 && (
            <p className="typo-caption text-foreground px-1 py-2">{tx(t.triggers.studio.no_sources_match, { query: sourceQuery })}</p>
          )}
          {sourceKind === 'personas' && filteredSourcePersonas.length === 0 && (
            <p className="typo-caption text-foreground px-1 py-2">{tx(t.triggers.studio.no_targets_match, { query: sourceQuery })}</p>
          )}
        </div>
      </div>

      {/* ── Routes ledger ────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-5 py-3 border-b border-border flex items-center gap-3">
          <h3 className="typo-heading text-foreground">{t.triggers.studio.routes_title}</h3>
          <span className="typo-data text-foreground">{draft.links.length}</span>
          <div className="ml-auto flex items-center gap-2">
            {draft.links.length > 0 && (
              <button
                type="button"
                onClick={() => setDraft({ version: 1, links: [] })}
                className="flex items-center gap-1.5 px-2.5 py-1.5 typo-caption rounded-interactive text-foreground hover:text-status-error hover:bg-status-error/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> {t.triggers.studio.clear_all}
              </button>
            )}
          </div>
        </div>

        {/* Pending patch strip */}
        <AnimatePresence>
          {(armedSource || armedTarget) && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
              className="mx-5 mt-3 px-4 py-2.5 rounded-card border border-primary/30 bg-primary/5 flex items-center gap-3"
            >
              <PatchEndChip source={armedSource} personas={personas} placeholder={t.triggers.studio.pick_a_source} />
              <ArrowRight className="w-4 h-4 text-primary shrink-0" />
              <PatchEndChip targetId={armedTarget} personas={personas} placeholder={t.triggers.studio.pick_a_target} />
              <button
                type="button"
                onClick={() => { setArmedSource(null); setArmedTarget(null); }}
                className="ml-auto p-1 rounded-interactive text-foreground hover:bg-secondary/60 transition-colors"
                aria-label={t.triggers.studio.cancel_pending_route}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {draft.links.length === 0 && !armedSource && !armedTarget && (
            <EmptyState
              icon={Filter}
              title={t.triggers.studio.no_routes_title}
              description={t.triggers.studio.no_routes_desc}
            />
          )}
          {draft.links.map((link, i) => (
            <motion.div
              key={link.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: Math.min(i * 0.02, 0.2) }}
              className="group flex items-center gap-3 px-4 py-3 rounded-card border border-border bg-background/80 hover:border-foreground/20 transition-colors"
            >
              <SourceChip source={link.source} personas={personas} completesLabel={t.triggers.studio.persona_completes} />
              <div className="flex items-center gap-1.5 shrink-0">
                <div className="h-px w-6 bg-border" />
                <button
                  type="button"
                  onClick={() => cycleCondition(link.id)}
                  title={t.triggers.studio.cycle_condition_hint}
                  className={`typo-caption px-2 py-0.5 rounded-input border transition-colors ${
                    link.condition
                      ? 'border-status-warning/40 text-status-warning bg-status-warning/10'
                      : 'border-border text-foreground hover:border-foreground/30'
                  }`}
                >
                  {conditionLabel(t, link.condition)}
                </button>
                <div className="h-px w-6 bg-border" />
                <ArrowRight className="w-3.5 h-3.5 text-foreground" />
              </div>
              <TargetChip targetId={link.targetPersonaId} personas={personas} />
              <button
                type="button"
                onClick={() => removeLink(link.id)}
                className="ml-auto p-1.5 rounded-interactive text-foreground opacity-0 group-hover:opacity-100 hover:text-status-error hover:bg-status-error/10 transition-all"
                aria-label={t.triggers.studio.remove_route}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          ))}
        </div>
      </div>

      {/* ── Targets rail ─────────────────────────────────────────────── */}
      <div className="w-80 border-l border-border flex flex-col min-h-0 bg-card/30">
        <RailHeader
          icon={<Bot className="w-4 h-4 text-emerald-400" />}
          title={t.triggers.studio.targets_title}
          subtitle={t.triggers.studio.targets_subtitle}
          query={targetQuery}
          onQuery={setTargetQuery}
        />
        <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5">
          {filteredTargets.map((p) => (
            <PersonaOptionCard
              key={p.id}
              persona={p}
              dense
              active={armedTarget === p.id}
              onPick={() => setArmedTarget((cur) => (cur === p.id ? null : p.id))}
            />
          ))}
          {filteredTargets.length === 0 && (
            <p className="typo-caption text-foreground px-1 py-2">{tx(t.triggers.studio.no_targets_match, { query: targetQuery })}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Rail + chip primitives ───────────────────────────────────────────────

function RailHeader({ icon, title, subtitle, query, onQuery }: {
  icon: ReactNode; title: string; subtitle: string;
  query: string; onQuery: (v: string) => void;
}) {
  return (
    <div className="px-3 pt-3 pb-2 space-y-2">
      <div className="flex items-center gap-2">
        {icon}
        <span className="typo-heading text-foreground">{title}</span>
        <span className="typo-caption text-foreground">{subtitle}</span>
      </div>
      <SearchField query={query} onQuery={onQuery} />
    </div>
  );
}

function SearchField({ query, onQuery }: { query: string; onQuery: (v: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="relative">
      <Search className="w-3.5 h-3.5 text-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
      <input
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder={t.triggers.studio.filter_placeholder}
        className="w-full pl-8 pr-2.5 py-1.5 typo-body rounded-input bg-background/60 border border-border focus:border-primary/40 focus:outline-none text-foreground placeholder:text-muted-foreground"
      />
    </div>
  );
}

function SourceChip({ source, personas, completesLabel }: { source: DraftSource; personas: Persona[]; completesLabel: string }) {
  if (source.kind === 'trigger') {
    const tpl = findTrigger(source.triggerType);
    const Icon = tpl?.icon ?? Zap;
    return (
      <span className="flex items-center gap-2 min-w-0 shrink">
        <span className={`w-7 h-7 rounded-input flex items-center justify-center bg-secondary/60 shrink-0 ${tpl?.color ?? 'text-amber-400'}`}>
          <Icon className="w-3.5 h-3.5" />
        </span>
        <span className="typo-body font-medium text-foreground truncate">{tpl?.label ?? source.triggerType}</span>
      </span>
    );
  }
  const p = personas.find((x) => x.id === source.personaId);
  return (
    <span className="flex items-center gap-2 min-w-0 shrink">
      <PersonaIcon icon={p?.icon} color={p?.color} display="framed" frameSize="sm" />
      <span className="typo-body font-medium text-foreground truncate">{p?.name ?? personaName(source.personaId, personas)}</span>
      <span className="typo-caption text-foreground shrink-0">{completesLabel}</span>
    </span>
  );
}

function TargetChip({ targetId, personas }: { targetId: string; personas: Persona[] }) {
  const p = personas.find((x) => x.id === targetId);
  return (
    <span className="flex items-center gap-2 min-w-0 shrink">
      <PersonaIcon icon={p?.icon} color={p?.color} display="framed" frameSize="sm" />
      <span className="typo-body font-medium text-foreground truncate">{p?.name ?? personaName(targetId, personas)}</span>
    </span>
  );
}

function PatchEndChip({ source, targetId, personas, placeholder }: {
  source?: DraftSource | null; targetId?: string | null;
  personas: Persona[];
  placeholder: string;
}) {
  const { t } = useTranslation();
  if (source) return <SourceChip source={source} personas={personas} completesLabel={t.triggers.studio.persona_completes} />;
  if (targetId) return <TargetChip targetId={targetId} personas={personas} />;
  return <span className="typo-body text-foreground italic">{placeholder}</span>;
}
