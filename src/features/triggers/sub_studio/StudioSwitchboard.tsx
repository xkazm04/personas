/**
 * StudioSwitchboard — directional variant A: a telephone-switchboard /
 * patch-bay mental model. Everything visible at once: sources rail on the
 * left (9 signal types + persona completions), targets rail on the right
 * (personas with live stats), and the routes ledger in the middle. Arm a
 * source, click a target — the route patches in. Order-agnostic: arming a
 * target first works too. Both rails are type-to-filter.
 */
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Search, Trash2, X, Zap, Bot, Filter } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { TRIGGER_BLOCK_TEMPLATES } from './libs/triggerStudioConstants';
import {
  loadDraft, saveDraft, newLinkId, findTrigger, personaName,
  LINK_CONDITION_PRESETS,
  type ChainDraft, type DraftSource,
} from './libs/studioDraftModel';
import { TriggerOptionCard, PersonaOptionCard } from './StudioOptionCards';

export function StudioSwitchboard() {
  const personas = useAgentStore((s) => s.personas);
  const [draft, setDraft] = useState<ChainDraft>(() => loadDraft());
  const [armedSource, setArmedSource] = useState<DraftSource | null>(null);
  const [armedTarget, setArmedTarget] = useState<string | null>(null);
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
    () => TRIGGER_BLOCK_TEMPLATES.filter((t) => !sq || t.label.toLowerCase().includes(sq) || t.description.toLowerCase().includes(sq)),
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
    <div className="flex-1 flex min-h-0">
      {/* ── Sources rail ─────────────────────────────────────────────── */}
      <div className="w-80 border-r border-border flex flex-col min-h-0 bg-card/30">
        <RailHeader icon={<Zap className="w-4 h-4 text-amber-400" />} title="Sources" subtitle="What starts the chain" query={sourceQuery} onQuery={setSourceQuery} />
        <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5">
          <RailGroupLabel label="Signals" />
          {filteredTriggers.map((tpl) => (
            <TriggerOptionCard
              key={tpl.id}
              template={tpl}
              dense
              active={armedSource?.kind === 'trigger' && armedSource.triggerType === tpl.triggerType}
              onPick={() => setArmedSource((s) => (s?.kind === 'trigger' && s.triggerType === tpl.triggerType ? null : { kind: 'trigger', triggerType: tpl.triggerType }))}
            />
          ))}
          <RailGroupLabel label="After a persona completes" />
          {filteredSourcePersonas.map((p) => (
            <PersonaOptionCard
              key={p.id}
              persona={p}
              dense
              hint="fires when this persona finishes"
              active={armedSource?.kind === 'persona' && armedSource.personaId === p.id}
              onPick={() => setArmedSource((s) => (s?.kind === 'persona' && s.personaId === p.id ? null : { kind: 'persona', personaId: p.id }))}
            />
          ))}
          {filteredTriggers.length === 0 && filteredSourcePersonas.length === 0 && (
            <p className="typo-caption text-foreground px-1 py-2">No sources match "{sourceQuery}"</p>
          )}
        </div>
      </div>

      {/* ── Routes ledger ────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-5 py-3 border-b border-border flex items-center gap-3">
          <h3 className="typo-heading text-foreground">Routes</h3>
          <span className="typo-data text-foreground">{draft.links.length}</span>
          <div className="ml-auto flex items-center gap-2">
            {draft.links.length > 0 && (
              <button
                type="button"
                onClick={() => setDraft({ version: 1, links: [] })}
                className="flex items-center gap-1.5 px-2.5 py-1.5 typo-caption rounded-interactive text-foreground hover:text-status-error hover:bg-status-error/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Clear all
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
              <PatchEndChip source={armedSource} personas={personas} placeholder="pick a source" />
              <ArrowRight className="w-4 h-4 text-primary shrink-0" />
              <PatchEndChip targetId={armedTarget} personas={personas} placeholder="pick a target" />
              <button
                type="button"
                onClick={() => { setArmedSource(null); setArmedTarget(null); }}
                className="ml-auto p-1 rounded-interactive text-foreground hover:bg-secondary/60 transition-colors"
                aria-label="Cancel pending route"
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
              title="No routes yet"
              description="Arm a source on the left, then click a target persona on the right. The route patches in here."
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
              <SourceChip source={link.source} personas={personas} />
              <div className="flex items-center gap-1.5 shrink-0">
                <div className="h-px w-6 bg-border" />
                <button
                  type="button"
                  onClick={() => cycleCondition(link.id)}
                  title="Click to cycle the run condition"
                  className={`typo-caption px-2 py-0.5 rounded-input border transition-colors ${
                    link.condition
                      ? 'border-amber-500/40 text-amber-400 bg-amber-500/10'
                      : 'border-border text-foreground hover:border-foreground/30'
                  }`}
                >
                  {link.condition ?? 'always'}
                </button>
                <div className="h-px w-6 bg-border" />
                <ArrowRight className="w-3.5 h-3.5 text-foreground" />
              </div>
              <TargetChip targetId={link.targetPersonaId} personas={personas} />
              <button
                type="button"
                onClick={() => removeLink(link.id)}
                className="ml-auto p-1.5 rounded-interactive text-foreground opacity-0 group-hover:opacity-100 hover:text-status-error hover:bg-status-error/10 transition-all"
                aria-label="Remove route"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          ))}
        </div>
      </div>

      {/* ── Targets rail ─────────────────────────────────────────────── */}
      <div className="w-80 border-l border-border flex flex-col min-h-0 bg-card/30">
        <RailHeader icon={<Bot className="w-4 h-4 text-emerald-400" />} title="Targets" subtitle="Which persona runs" query={targetQuery} onQuery={setTargetQuery} />
        <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5">
          {filteredTargets.map((p) => (
            <PersonaOptionCard
              key={p.id}
              persona={p}
              dense
              active={armedTarget === p.id}
              onPick={() => setArmedTarget((t) => (t === p.id ? null : p.id))}
            />
          ))}
          {filteredTargets.length === 0 && (
            <p className="typo-caption text-foreground px-1 py-2">No personas match "{targetQuery}"</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Rail + chip primitives ───────────────────────────────────────────────

function RailHeader({ icon, title, subtitle, query, onQuery }: {
  icon: React.ReactNode; title: string; subtitle: string;
  query: string; onQuery: (v: string) => void;
}) {
  return (
    <div className="px-3 pt-3 pb-2 space-y-2">
      <div className="flex items-center gap-2">
        {icon}
        <span className="typo-heading text-foreground">{title}</span>
        <span className="typo-caption text-foreground">{subtitle}</span>
      </div>
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Filter…"
          className="w-full pl-8 pr-2.5 py-1.5 typo-body rounded-input bg-background/60 border border-border focus:border-primary/40 focus:outline-none text-foreground placeholder:text-foreground/60"
        />
      </div>
    </div>
  );
}

function RailGroupLabel({ label }: { label: string }) {
  return <div className="typo-label text-foreground pt-2 pb-0.5 px-1">{label}</div>;
}

function SourceChip({ source, personas }: { source: DraftSource; personas: ReturnType<typeof useAgentStore.getState>['personas'] }) {
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
      <span className="typo-body font-medium text-foreground truncate">{p?.name ?? 'Unknown'}</span>
      <span className="typo-caption text-foreground shrink-0">completes</span>
    </span>
  );
}

function TargetChip({ targetId, personas }: { targetId: string; personas: ReturnType<typeof useAgentStore.getState>['personas'] }) {
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
  personas: ReturnType<typeof useAgentStore.getState>['personas'];
  placeholder: string;
}) {
  if (source) return <SourceChip source={source} personas={personas} />;
  if (targetId) return <TargetChip targetId={targetId} personas={personas} />;
  return <span className="typo-body text-foreground/70 italic">{placeholder}</span>;
}
