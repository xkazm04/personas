/**
 * StudioRails — the left (source) and right (target) compose rails of the
 * Chain Studio unified ledger (`StudioPatchbay`). Each rail owns only its
 * local tab + search-query UI state; all arming state + persona/system-op
 * data comes from the shared composer.
 */
import { useMemo, useState } from 'react';
import { Search, Zap, Bot, Cog, Store, Globe } from 'lucide-react';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import type { SystemOpKindMeta } from '@/api/systemOps';
import type { SharedEventCatalogEntry } from '@/lib/bindings/SharedEventCatalogEntry';
import { TRIGGER_BLOCK_TEMPLATES } from './libs/triggerStudioConstants';
import { TriggerOptionCard, PersonaOptionCard } from './StudioOptionCards';
import { SystemOpOptionCard } from './system_ops/SystemOpOptionCard';
import { useSubscribedFeeds } from '@/features/triggers/sub_shared/useSubscribedFeeds';
import { FeedIcon } from '@/features/triggers/sub_shared/sharedEventsUi';
import type { StudioComposer } from './useStudioComposer';

/** A subscribed Marketplace feed as a source card — arms an event_listener on `shared:<slug>`. */
function MarketplaceSourceCard({ feed, hint, active, onPick }: {
  feed: SharedEventCatalogEntry; hint: string; active: boolean; onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-input border text-left transition-colors ${
        active ? 'border-primary/50 bg-primary/10' : 'border-border bg-background/40 hover:border-foreground/25 hover:bg-secondary/40'
      }`}
    >
      <FeedIcon entry={feed} className="w-7 h-7" iconSize="w-4 h-4" />
      <span className="min-w-0 flex-1">
        <span className="typo-body font-medium text-foreground truncate block">{feed.name}</span>
        <span className="typo-caption text-foreground/60 truncate block">{hint}</span>
      </span>
    </button>
  );
}

function SearchField({ query, onQuery, placeholder }: { query: string; onQuery: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <Search className="w-3.5 h-3.5 text-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
      <input
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-8 pr-2.5 py-1.5 typo-body rounded-input bg-background/60 border border-border focus:border-primary/40 focus:outline-none text-foreground placeholder:text-muted-foreground"
      />
    </div>
  );
}

export function StudioSourceRail({ c }: { c: StudioComposer }) {
  const { tx, st } = c;
  const [sourceKind, setSourceKind] = useState<'signals' | 'personas'>('signals');
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const subscribedFeeds = useSubscribedFeeds();
  const filteredTriggers = useMemo(
    () => TRIGGER_BLOCK_TEMPLATES.filter((tpl) => !q || tpl.label.toLowerCase().includes(q) || tpl.description.toLowerCase().includes(q)),
    [q],
  );
  const filteredFeeds = useMemo(
    () => subscribedFeeds.filter((f) => !q || f.name.toLowerCase().includes(q) || f.slug.toLowerCase().includes(q)),
    [subscribedFeeds, q],
  );
  // Local-scraper pipeline Signals get their own group; everything else is a
  // curated Marketplace feed. Both wire in identically (event_listener on
  // `shared:<slug>`) — the split is purely for legibility on the rail.
  const marketplaceFeeds = useMemo(() => filteredFeeds.filter((f) => f.category !== 'scraper'), [filteredFeeds]);
  const scraperFeeds = useMemo(() => filteredFeeds.filter((f) => f.category === 'scraper'), [filteredFeeds]);
  const filteredPersonas = useMemo(
    () => c.healthyPersonas.filter((p) => !q || p.name.toLowerCase().includes(q)),
    [c.healthyPersonas, q],
  );

  return (
    <div className="w-72 border-r border-border flex flex-col min-h-0 bg-card/30">
      <div className="px-3 pt-2.5 pb-2 space-y-1.5">
        <SegmentedTabs<'signals' | 'personas'>
          tabs={[
            { id: 'signals', label: <><Zap className="w-3.5 h-3.5 text-amber-400" />{st.group_signals}</> },
            { id: 'personas', label: <><Bot className="w-3.5 h-3.5 text-emerald-400" />{st.group_personas}</> },
          ]}
          activeTab={sourceKind}
          onTabChange={setSourceKind}
          ariaLabel={st.sources_title}
          size="sm"
        />
        <p className="typo-body opacity-80 text-foreground px-1">
          {sourceKind === 'signals' ? st.sources_subtitle : st.group_after_persona}
        </p>
        <SearchField query={query} onQuery={setQuery} placeholder={st.filter_placeholder} />
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5">
        {sourceKind === 'signals' && filteredTriggers.map((tpl) => (
          <TriggerOptionCard
            key={tpl.id}
            template={tpl}
            dense
            active={c.armedSource?.kind === 'trigger' && c.armedSource.triggerType === tpl.triggerType}
            onPick={() => c.setArmedSource((s) => (s?.kind === 'trigger' && s.triggerType === tpl.triggerType ? null : { kind: 'trigger', triggerType: tpl.triggerType }))}
          />
        ))}
        {/* Marketplace category — subscribed feeds wire in as event listeners */}
        {sourceKind === 'signals' && marketplaceFeeds.length > 0 && (
          <div className="pt-2.5 pb-1 px-1 flex items-center gap-1.5">
            <Store className="w-3 h-3 text-sky-400" />
            <span className="typo-caption uppercase tracking-wide text-foreground/70">{st.group_marketplace}</span>
          </div>
        )}
        {sourceKind === 'signals' && marketplaceFeeds.map((f) => (
          <MarketplaceSourceCard
            key={f.slug}
            feed={f}
            hint={st.marketplace_source_hint}
            active={c.armedSource?.kind === 'marketplace' && c.armedSource.slug === f.slug}
            onPick={() => c.setArmedSource((s) => (s?.kind === 'marketplace' && s.slug === f.slug ? null : { kind: 'marketplace', slug: f.slug, label: f.name }))}
          />
        ))}
        {/* Scraper category — local-scraper pipeline change/error Signals */}
        {sourceKind === 'signals' && scraperFeeds.length > 0 && (
          <div className="pt-2.5 pb-1 px-1 flex items-center gap-1.5">
            <Globe className="w-3 h-3 text-teal-400" />
            {/* eslint-disable-next-line custom/no-hardcoded-jsx-text -- feature name, matches sidebar 'Scraper' */}
            <span className="typo-caption uppercase tracking-wide text-foreground/70">Scraper</span>
          </div>
        )}
        {sourceKind === 'signals' && scraperFeeds.map((f) => (
          <MarketplaceSourceCard
            key={f.slug}
            feed={f}
            hint={st.marketplace_source_hint}
            active={c.armedSource?.kind === 'marketplace' && c.armedSource.slug === f.slug}
            onPick={() => c.setArmedSource((s) => (s?.kind === 'marketplace' && s.slug === f.slug ? null : { kind: 'marketplace', slug: f.slug, label: f.name }))}
          />
        ))}
        {sourceKind === 'signals' && subscribedFeeds.length === 0 && (
          <p className="typo-caption text-foreground/60 px-1 py-1">{st.marketplace_empty}</p>
        )}
        {sourceKind === 'personas' && filteredPersonas.map((p) => (
          <PersonaOptionCard
            key={p.id}
            persona={p}
            dense
            hint={st.source_persona_hint}
            active={c.armedSource?.kind === 'persona' && c.armedSource.personaId === p.id}
            onPick={() => c.setArmedSource((s) => (s?.kind === 'persona' && s.personaId === p.id ? null : { kind: 'persona', personaId: p.id }))}
          />
        ))}
        {sourceKind === 'signals' && q && filteredTriggers.length === 0 && filteredFeeds.length === 0 && (
          <p className="typo-body opacity-80 text-foreground px-1 py-2">{tx(st.no_sources_match, { query })}</p>
        )}
        {sourceKind === 'personas' && filteredPersonas.length === 0 && (
          <p className="typo-body opacity-80 text-foreground px-1 py-2">{tx(st.no_targets_match, { query })}</p>
        )}
      </div>
    </div>
  );
}

export function StudioTargetRail({ c }: { c: StudioComposer }) {
  const { tx, st } = c;
  const [targetKind, setTargetKind] = useState<'personas' | 'system'>('personas');
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const filteredTargets = useMemo(
    () => c.healthyPersonas.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q)),
    [c.healthyPersonas, q],
  );

  return (
    <div className="w-72 border-l border-border flex flex-col min-h-0 bg-card/30">
      <div className="px-3 pt-2.5 pb-2 space-y-1.5">
        <SegmentedTabs<'personas' | 'system'>
          tabs={[
            { id: 'personas', label: <><Bot className="w-3.5 h-3.5 text-emerald-400" />{st.targets_title}</> },
            { id: 'system', label: <><Cog className="w-3.5 h-3.5 text-violet-400" />{st.group_system_events}</> },
          ]}
          activeTab={targetKind}
          onTabChange={setTargetKind}
          ariaLabel={st.targets_title}
          size="sm"
        />
        <p className="typo-body opacity-80 text-foreground px-1">
          {targetKind === 'personas' ? st.targets_subtitle : st.system_events_subtitle}
        </p>
        {targetKind === 'personas' && <SearchField query={query} onQuery={setQuery} placeholder={st.filter_placeholder} />}
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5">
        {targetKind === 'personas' && filteredTargets.map((p) => (
          <PersonaOptionCard
            key={p.id}
            persona={p}
            dense
            active={c.armedTarget === p.id}
            onPick={() => { c.setArmedSystemOp(null); c.setArmedTarget((cur) => (cur === p.id ? null : p.id)); }}
          />
        ))}
        {targetKind === 'personas' && filteredTargets.length === 0 && (
          <p className="typo-body opacity-80 text-foreground px-1 py-2">{tx(st.no_targets_match, { query })}</p>
        )}
        {targetKind === 'system' && c.systemOpKinds.map((k: SystemOpKindMeta) => (
          <SystemOpOptionCard
            key={k.kind}
            kind={k}
            active={c.armedSystemOp === k.kind}
            onPick={() => { c.setArmedTarget(null); c.setArmedSystemOp((cur) => (cur === k.kind ? null : k.kind)); }}
          />
        ))}
        {targetKind === 'system' && c.systemOpKinds.length === 0 && (
          <p className="typo-body opacity-80 text-foreground px-1 py-2">{st.system_events_empty}</p>
        )}
      </div>
    </div>
  );
}
