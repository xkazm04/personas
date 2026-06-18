/**
 * StudioSwitchboard — the Chain Studio surface. A patch-bay mental model:
 * sources rail on the left (9 signal types + persona completions), target
 * personas on the right, and the routes ledger in the middle. Arm a source,
 * click a target — the route patches in. Order-agnostic: arming a target
 * first works too. Both rails are type-to-filter.
 */
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Search, Trash2, X, Zap, Bot, Filter, Cog } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from '@/stores/agentStore';
import { useToastStore } from '@/stores/toastStore';
import type { Persona } from '@/lib/bindings/Persona';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { attentionFor } from '@/features/home/sub_cockpit/widgets/personaStats';
import { TRIGGER_BLOCK_TEMPLATES } from './libs/triggerStudioConstants';
import {
  loadDraft, saveDraft, newLinkId, findTrigger, personaName,
  LINK_CONDITION_PRESETS,
  type ChainDraft, type DraftSource, type LinkCondition,
} from './libs/studioDraftModel';
import { TriggerOptionCard, PersonaOptionCard } from './StudioOptionCards';
import { useSystemOpStudio } from './system_ops/useSystemOpStudio';
import { SystemOpOptionCard } from './system_ops/SystemOpOptionCard';
import { SystemEventCommitModal } from './system_ops/SystemEventCommitModal';
import { SystemEventAutomationsPanel } from './system_ops/SystemEventAutomationsPanel';
import type { SystemOpKindMeta } from '@/api/systemOps';

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
type TargetRailKind = 'personas' | 'system';

export function StudioSwitchboard() {
  const { t, tx } = useTranslation();
  const st = t.triggers.studio;
  const personas = useAgentStore((s) => s.personas);
  const addToast = useToastStore((s) => s.addToast);
  const { kinds: systemOpKinds, automations, refresh: refreshAutomations, toggle, remove, runNow } = useSystemOpStudio();
  const [draft, setDraft] = useState<ChainDraft>(() => loadDraft());
  const [armedSource, setArmedSource] = useState<DraftSource | null>(null);
  const [armedTarget, setArmedTarget] = useState<string | null>(null);
  // System-op target (right rail "System events" tab). Mutually exclusive with
  // armedTarget — arming one clears the other.
  const [armedSystemOp, setArmedSystemOp] = useState<string | null>(null);
  const [sourceKind, setSourceKind] = useState<SourceRailKind>('signals');
  const [targetKind, setTargetKind] = useState<TargetRailKind>('personas');
  const [sourceQuery, setSourceQuery] = useState('');
  const [targetQuery, setTargetQuery] = useState('');
  // Open commit modal: a system-op route awaiting its trigger config.
  const [commit, setCommit] = useState<{ opKind: string; triggerType: string } | null>(null);

  useEffect(() => { saveDraft(draft); }, [draft]);

  // Arming a trigger/persona source + a persona target completes a persona route.
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

  // Arming a source + a system-op target opens the commit modal. System ops are
  // driven by a *trigger* (time/event) — not a persona completion — so a
  // persona source is rejected with a hint.
  useEffect(() => {
    if (armedSource && armedSystemOp) {
      const ok = armedSource.kind === 'trigger'
        && (armedSource.triggerType === 'schedule' || armedSource.triggerType === 'event_listener');
      if (ok && armedSource.kind === 'trigger') {
        setCommit({ opKind: armedSystemOp, triggerType: armedSource.triggerType });
      } else {
        addToast(st.system_event_needs_trigger, 'error');
      }
      setArmedSource(null);
      setArmedSystemOp(null);
    }
  }, [armedSource, armedSystemOp, addToast, st.system_event_needs_trigger]);

  // Both rails offer only healthy personas — enabled, credentials ready,
  // trust above the floor. Unhealthy personas can't reliably run a chain
  // hop, so they don't belong in the patch bay.
  const healthyPersonas = useMemo(() => personas.filter((p) => attentionFor(p) === null), [personas]);

  const sq = sourceQuery.trim().toLowerCase();
  const filteredTriggers = useMemo(
    () => TRIGGER_BLOCK_TEMPLATES.filter((tpl) => !sq || tpl.label.toLowerCase().includes(sq) || tpl.description.toLowerCase().includes(sq)),
    [sq],
  );
  const filteredSourcePersonas = useMemo(
    () => healthyPersonas.filter((p) => !sq || p.name.toLowerCase().includes(sq)),
    [healthyPersonas, sq],
  );
  const tq = targetQuery.trim().toLowerCase();
  const filteredTargets = useMemo(
    () => healthyPersonas.filter((p) => !tq || p.name.toLowerCase().includes(tq) || (p.description ?? '').toLowerCase().includes(tq)),
    [healthyPersonas, tq],
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
          <p className="typo-body opacity-80 text-foreground px-1">
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
            <p className="typo-body opacity-80 text-foreground px-1 py-2">{tx(t.triggers.studio.no_sources_match, { query: sourceQuery })}</p>
          )}
          {sourceKind === 'personas' && filteredSourcePersonas.length === 0 && (
            <p className="typo-body opacity-80 text-foreground px-1 py-2">{tx(t.triggers.studio.no_targets_match, { query: sourceQuery })}</p>
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
                className="flex items-center gap-1.5 px-2.5 py-1.5 typo-body opacity-80 rounded-interactive text-foreground hover:text-status-error hover:bg-status-error/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> {t.triggers.studio.clear_all}
              </button>
            )}
          </div>
        </div>

        {/* Pending patch strip */}
        <AnimatePresence>
          {(armedSource || armedTarget || armedSystemOp) && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
              className="mx-5 mt-3 px-4 py-2.5 rounded-card border border-primary/30 bg-primary/5 flex items-center gap-3"
            >
              <PatchEndChip source={armedSource} personas={personas} kinds={systemOpKinds} placeholder={t.triggers.studio.pick_a_source} />
              <ArrowRight className="w-4 h-4 text-primary shrink-0" />
              <PatchEndChip targetId={armedTarget} systemOpKind={armedSystemOp} personas={personas} kinds={systemOpKinds} placeholder={t.triggers.studio.pick_a_target} />
              <button
                type="button"
                onClick={() => { setArmedSource(null); setArmedTarget(null); setArmedSystemOp(null); }}
                className="ml-auto p-1 rounded-interactive text-foreground hover:bg-secondary/60 transition-colors"
                aria-label={t.triggers.studio.cancel_pending_route}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          <SystemEventAutomationsPanel
            automations={automations}
            onToggle={toggle}
            onRun={runNow}
            onDelete={remove}
          />
          {draft.links.length === 0 && automations.length === 0 && !armedSource && !armedTarget && !armedSystemOp && (
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
                  className={`typo-body opacity-80 px-2 py-0.5 rounded-input border transition-colors ${
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
        <div className="px-3 pt-3 pb-2 space-y-2">
          <SegmentedTabs<TargetRailKind>
            tabs={[
              { id: 'personas', label: <><Bot className="w-3.5 h-3.5 text-emerald-400" />{st.targets_title}</> },
              { id: 'system', label: <><Cog className="w-3.5 h-3.5 text-violet-400" />{st.group_system_events}</> },
            ]}
            activeTab={targetKind}
            onTabChange={setTargetKind}
            ariaLabel={st.targets_title}
          />
          <p className="typo-body opacity-80 text-foreground px-1">
            {targetKind === 'personas' ? st.targets_subtitle : st.system_events_subtitle}
          </p>
          {targetKind === 'personas' && <SearchField query={targetQuery} onQuery={setTargetQuery} />}
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5">
          {targetKind === 'personas' && filteredTargets.map((p) => (
            <PersonaOptionCard
              key={p.id}
              persona={p}
              dense
              active={armedTarget === p.id}
              onPick={() => { setArmedSystemOp(null); setArmedTarget((cur) => (cur === p.id ? null : p.id)); }}
            />
          ))}
          {targetKind === 'personas' && filteredTargets.length === 0 && (
            <p className="typo-body opacity-80 text-foreground px-1 py-2">{tx(st.no_targets_match, { query: targetQuery })}</p>
          )}
          {targetKind === 'system' && systemOpKinds.map((k: SystemOpKindMeta) => (
            <SystemOpOptionCard
              key={k.kind}
              kind={k}
              active={armedSystemOp === k.kind}
              onPick={() => { setArmedTarget(null); setArmedSystemOp((cur) => (cur === k.kind ? null : k.kind)); }}
            />
          ))}
          {targetKind === 'system' && systemOpKinds.length === 0 && (
            <p className="typo-body opacity-80 text-foreground px-1 py-2">{st.system_events_empty}</p>
          )}
        </div>
      </div>

      <SystemEventCommitModal
        open={commit !== null}
        onClose={() => setCommit(null)}
        opKind={commit?.opKind ?? ''}
        triggerType={commit?.triggerType ?? 'schedule'}
        onCreated={() => { void refreshAutomations(); setTargetKind('system'); }}
      />
    </div>
  );
}

// ── Rail + chip primitives ───────────────────────────────────────────────

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
      <span className="typo-body opacity-80 text-foreground shrink-0">{completesLabel}</span>
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

function PatchEndChip({ source, targetId, systemOpKind, personas, kinds, placeholder }: {
  source?: DraftSource | null; targetId?: string | null; systemOpKind?: string | null;
  personas: Persona[];
  kinds?: SystemOpKindMeta[];
  placeholder: string;
}) {
  const { t } = useTranslation();
  if (source) return <SourceChip source={source} personas={personas} completesLabel={t.triggers.studio.persona_completes} />;
  if (targetId) return <TargetChip targetId={targetId} personas={personas} />;
  if (systemOpKind) {
    const k = kinds?.find((x) => x.kind === systemOpKind);
    return (
      <span className="flex items-center gap-2 min-w-0 shrink">
        <span className="w-7 h-7 rounded-input flex items-center justify-center bg-secondary/60 shrink-0 text-violet-400">
          <Cog className="w-3.5 h-3.5" />
        </span>
        <span className="typo-body font-medium text-foreground truncate">{k?.label ?? systemOpKind}</span>
      </span>
    );
  }
  return <span className="typo-body text-foreground italic">{placeholder}</span>;
}
