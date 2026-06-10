/**
 * StudioComposer — directional variant B: a sentence-builder mental model.
 * The chain reads as prose — "When Schedule fires → run Athena → then run
 * Support Bot" — built one decision at a time. Picking opens a large inline
 * palette (search + category chips + hero option cards with full persona
 * stats) directly in the flow, not in a modal. Optimized for focus: one
 * choice on screen, everything searchable, big readable cards.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDown, Plus, Search, Trash2, Workflow, X, Zap, Bot } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { TRIGGER_BLOCK_TEMPLATES } from './libs/triggerStudioConstants';
import {
  loadDraft, saveDraft, newLinkId, findTrigger, groupIntoChains,
  LINK_CONDITION_PRESETS,
  type ChainDraft, type DraftLink, type DraftSource,
} from './libs/studioDraftModel';
import { TriggerOptionCard, PersonaOptionCard } from './StudioOptionCards';

/** What the open palette is currently picking. */
type PickerIntent =
  | { kind: 'new-source' }                                 // start a new chain: pick trigger OR persona-completion
  | { kind: 'target'; source: DraftSource }                // pick the persona a source routes to
  | { kind: 'extend'; afterPersonaId: string };            // append "then run …" after a chain's tail

export function StudioComposer() {
  const personas = useAgentStore((s) => s.personas);
  const [draft, setDraft] = useState<ChainDraft>(() => loadDraft());
  const [intent, setIntent] = useState<PickerIntent | null>(null);

  useEffect(() => { saveDraft(draft); }, [draft]);

  const chains = useMemo(() => groupIntoChains(draft.links), [draft.links]);

  const addLink = (source: DraftSource, targetPersonaId: string) => {
    setDraft((d) => ({
      ...d,
      links: [...d.links, { id: newLinkId(), source, targetPersonaId, condition: null }],
    }));
    setIntent(null);
  };

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
    <div className="flex-1 overflow-y-auto min-h-0">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        {chains.length === 0 && !intent && (
          <div className="text-center pt-16">
            <Workflow className="w-10 h-10 text-foreground mx-auto mb-4" />
            <h3 className="typo-heading-lg text-foreground mb-2">Compose a chain</h3>
            <p className="typo-body text-foreground max-w-md mx-auto mb-6">
              A chain is a sentence: something happens, a persona runs, more personas follow.
              Build it one word at a time.
            </p>
            <button
              type="button"
              onClick={() => setIntent({ kind: 'new-source' })}
              className="px-4 py-2.5 typo-body font-medium rounded-interactive bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
            >
              When something happens…
            </button>
          </div>
        )}

        {chains.map((chain, ci) => (
          <ChainSentence
            key={chain[0]?.id ?? ci}
            chain={chain}
            personas={personas}
            onRemove={removeLink}
            onCycleCondition={cycleCondition}
            onExtend={(afterPersonaId) => setIntent({ kind: 'extend', afterPersonaId })}
          />
        ))}

        {chains.length > 0 && !intent && (
          <button
            type="button"
            onClick={() => setIntent({ kind: 'new-source' })}
            className="flex items-center gap-2 px-4 py-2.5 typo-body rounded-interactive border border-dashed border-border text-foreground hover:border-primary/40 hover:text-primary transition-colors"
          >
            <Plus className="w-4 h-4" /> New chain
          </button>
        )}

        <AnimatePresence>
          {intent && (
            <InlinePalette
              key="palette"
              intent={intent}
              personas={personas}
              onClose={() => setIntent(null)}
              onPickSource={(source) => setIntent({ kind: 'target', source })}
              onPickTarget={(targetId) => {
                if (intent.kind === 'target') addLink(intent.source, targetId);
                else if (intent.kind === 'extend') addLink({ kind: 'persona', personaId: intent.afterPersonaId }, targetId);
              }}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Chain rendered as a sentence ─────────────────────────────────────────

function ChainSentence({ chain, personas, onRemove, onCycleCondition, onExtend }: {
  chain: DraftLink[];
  personas: ReturnType<typeof useAgentStore.getState>['personas'];
  onRemove: (id: string) => void;
  onCycleCondition: (id: string) => void;
  onExtend: (afterPersonaId: string) => void;
}) {
  const head = chain[0];
  const tail = chain[chain.length - 1];
  if (!head || !tail) return null;
  const tailPersonaId = tail.targetPersonaId;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="rounded-card border border-border bg-card/40 p-5 space-y-1"
    >
      {chain.map((link, i) => (
        <div key={link.id} className="group">
          {i > 0 && <ArrowDown className="w-3.5 h-3.5 text-foreground ml-5 my-1" />}
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="typo-body-lg text-foreground">{i === 0 ? 'When' : 'then'}</span>
            {i === 0 && <SourceWord source={link.source} personas={personas} />}
            {i === 0 && <span className="typo-body-lg text-foreground">{link.source.kind === 'trigger' ? 'fires' : 'completes'}</span>}
            <button
              type="button"
              onClick={() => onCycleCondition(link.id)}
              title="Click to cycle the run condition"
              className={`typo-caption px-2 py-0.5 rounded-input border transition-colors ${
                link.condition
                  ? 'border-amber-500/40 text-amber-400 bg-amber-500/10'
                  : 'border-transparent text-foreground/70 hover:border-border'
              }`}
            >
              {link.condition ?? 'always'}
            </button>
            <span className="typo-body-lg text-foreground">run</span>
            <PersonaWord personaId={link.targetPersonaId} personas={personas} />
            <button
              type="button"
              onClick={() => onRemove(link.id)}
              className="p-1 rounded-interactive text-foreground opacity-0 group-hover:opacity-100 hover:text-status-error hover:bg-status-error/10 transition-all"
              aria-label="Remove step"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}
      <div className="pt-2">
        <button
          type="button"
          onClick={() => onExtend(tailPersonaId)}
          className="flex items-center gap-1.5 typo-caption text-foreground hover:text-primary transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> and then…
        </button>
      </div>
    </motion.div>
  );
}

function SourceWord({ source, personas }: { source: DraftSource; personas: ReturnType<typeof useAgentStore.getState>['personas'] }) {
  if (source.kind === 'trigger') {
    const tpl = findTrigger(source.triggerType);
    const Icon = tpl?.icon ?? Zap;
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-input bg-secondary/60 border border-border ${tpl?.color ?? 'text-amber-400'}`}>
        <Icon className="w-4 h-4" />
        <span className="typo-body font-medium text-foreground">{tpl?.label ?? source.triggerType}</span>
      </span>
    );
  }
  return <PersonaWord personaId={source.personaId} personas={personas} />;
}

function PersonaWord({ personaId, personas }: { personaId: string; personas: ReturnType<typeof useAgentStore.getState>['personas'] }) {
  const p = personas.find((x) => x.id === personaId);
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-input bg-secondary/60 border border-border">
      <PersonaIcon icon={p?.icon} color={p?.color} display="framed" frameSize="xs" />
      <span className="typo-body font-medium text-foreground">{p?.name ?? 'Unknown'}</span>
    </span>
  );
}

// ── Inline palette ───────────────────────────────────────────────────────

function InlinePalette({ intent, personas, onClose, onPickSource, onPickTarget }: {
  intent: PickerIntent;
  personas: ReturnType<typeof useAgentStore.getState>['personas'];
  onClose: () => void;
  onPickSource: (s: DraftSource) => void;
  onPickTarget: (personaId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'all' | 'signals' | 'personas'>('all');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, [intent]);
  useEffect(() => { setQuery(''); }, [intent]);

  const pickingSource = intent.kind === 'new-source';
  const q = query.trim().toLowerCase();

  const triggers = useMemo(
    () => (pickingSource && category !== 'personas'
      ? TRIGGER_BLOCK_TEMPLATES.filter((t) => !q || t.label.toLowerCase().includes(q) || t.description.toLowerCase().includes(q))
      : []),
    [pickingSource, category, q],
  );
  const personaOptions = useMemo(
    () => (category !== 'signals'
      ? personas.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q))
      : []),
    [personas, category, q],
  );

  const heading = intent.kind === 'new-source'
    ? 'When what happens?'
    : intent.kind === 'target'
      ? 'Run which persona?'
      : 'Then run which persona?';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.18 }}
      className="rounded-card border border-primary/30 bg-card/60 shadow-elevation-2 p-5 space-y-4"
    >
      <div className="flex items-center gap-3">
        <h4 className="typo-heading-lg text-foreground">{heading}</h4>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto p-1.5 rounded-interactive text-foreground hover:bg-secondary/60 transition-colors"
          aria-label="Close palette"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
            placeholder={pickingSource ? 'Search signals and personas…' : 'Search personas…'}
            className="w-full pl-9 pr-3 py-2.5 typo-body-lg rounded-input bg-background/60 border border-border focus:border-primary/40 focus:outline-none text-foreground placeholder:text-foreground/60"
          />
        </div>
        {pickingSource && (
          <div className="flex items-center gap-1">
            {([['all', 'All', null], ['signals', 'Signals', Zap], ['personas', 'Personas', Bot]] as const).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setCategory(id)}
                className={`flex items-center gap-1.5 px-3 py-2 typo-caption font-medium rounded-interactive border transition-colors ${
                  category === id
                    ? 'bg-primary/10 border-primary/40 text-primary'
                    : 'border-border text-foreground hover:border-foreground/30'
                }`}
              >
                {Icon && <Icon className="w-3.5 h-3.5" />}{label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 max-h-[420px] overflow-y-auto pr-1">
        {triggers.map((tpl) => (
          <TriggerOptionCard
            key={tpl.id}
            template={tpl}
            onPick={() => onPickSource({ kind: 'trigger', triggerType: tpl.triggerType })}
          />
        ))}
        {personaOptions.map((p) => (
          <PersonaOptionCard
            key={p.id}
            persona={p}
            hint={pickingSource ? 'fires when this persona finishes' : undefined}
            onPick={() => {
              if (pickingSource) onPickSource({ kind: 'persona', personaId: p.id });
              else onPickTarget(p.id);
            }}
          />
        ))}
        {triggers.length === 0 && personaOptions.length === 0 && (
          <p className="typo-body text-foreground col-span-2 py-4 text-center">Nothing matches "{query}"</p>
        )}
      </div>
    </motion.div>
  );
}
