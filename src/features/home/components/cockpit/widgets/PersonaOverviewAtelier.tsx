/**
 * PersonaOverviewAtelier — directional variant 3.
 *
 * Mental model: a single hero persona card + supporting roster strip +
 * story trail aside. Follows the Twin-Atelier pattern that the rest of
 * the app rewards (TwinHeaderBand, numbered story aside, KpiPanel
 * primitives). Optimized for Athena composing an answer like "here's
 * the persona I think we should look at first, and here's why".
 *
 * Why this variant: the cockpit is at its best when Athena uses it to
 * *lead* the user somewhere — not when it's a generic listing. The
 * hero card frames a single recommendation; the strip below carries
 * the rest of the roster as low-key thumbnails; the story aside is
 * room for Athena's prose explanation if she wants to use the
 * `text_callout` widget alongside this one.
 *
 * Motion discipline: header halo pulse only (consistent with
 * TwinHeaderBand). No row entry animations.
 */
import { useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { ArrowRight, Bot, Coins, Compass, Gauge, Shield, Sparkles } from 'lucide-react';

import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { useIllustration } from '@/features/plugins/companion/inbox/hooks/useIllustration';
import { firstGrapheme } from '@/features/plugins/companion/inbox/_shared/grapheme';
import type { Persona } from '@/lib/bindings/Persona';

import type { CockpitWidgetProps } from '../widgetRegistry';
import {
  attentionFor,
  budgetLabel,
  modelTierAccent,
  modelTierKey,
  modelTierLabel,
  recentActivity,
  relativeUpdated,
  trustToneFor,
} from './personaStats';

export function PersonaOverviewAtelier({ config, title }: CockpitWidgetProps) {
  const limit = (config?.limit as number) ?? 6;
  const filter = ((config?.filter as string) ?? 'active') === 'all' ? 'all' : 'active';
  const heroId = config?.hero as string | undefined;

  const { personas, fetchPersonas } = useAgentStore(
    useShallow((s) => ({ personas: s.personas, fetchPersonas: s.fetchPersonas })),
  );
  useEffect(() => {
    if (!personas || personas.length === 0) {
      fetchPersonas().catch(() => {});
    }
  }, [personas, fetchPersonas]);

  const ranked = useMemo(() => {
    const arr = personas ?? [];
    const filtered = filter === 'active' ? arr.filter((p) => p.enabled !== false) : arr;
    // Pick hero: explicit > most-recently-touched ready persona > first
    return [...filtered].sort((a, b) => {
      if (heroId && a.id === heroId) return -1;
      if (heroId && b.id === heroId) return 1;
      const aReady = a.setup_status === 'ready' ? 1 : 0;
      const bReady = b.setup_status === 'ready' ? 1 : 0;
      if (aReady !== bReady) return bReady - aReady;
      return (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
    });
  }, [personas, filter, heroId]);

  const hero = ranked[0];
  const rest = ranked.slice(1, limit);

  const openPersona = (id: string) => {
    const sys = useSystemStore.getState();
    sys.setSidebarSection('personas');
    useAgentStore.getState().selectPersona(id);
  };

  if (!hero) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-foreground/40 p-6">
        <Bot className="w-6 h-6" />
        <div className="typo-caption">No personas yet</div>
      </div>
    );
  }

  const heroTierK = modelTierKey(hero.model_profile);
  const heroTier = modelTierAccent(hero.model_profile);
  const heroTierLabel = modelTierLabel(hero.model_profile);
  const heroTrustTone = trustToneFor(hero.trust_level, hero.trust_score);

  const heroBandGradient =
    heroTierK === 'opus'
      ? 'from-violet-500/15 via-fuchsia-500/8'
      : heroTierK === 'sonnet'
        ? 'from-cyan-500/15 via-sky-500/8'
        : heroTierK === 'haiku'
          ? 'from-amber-500/15 via-orange-500/8'
          : 'from-foreground/[0.04] via-foreground/[0.02]';

  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden">
      {/* Header band — mirrors TwinHeaderBand vocabulary */}
      <div className="flex-shrink-0 relative overflow-hidden border-b border-foreground/8">
        <div className={`absolute inset-0 bg-gradient-to-r ${heroBandGradient} to-transparent`} />
        <div className="relative px-4 py-3 flex items-center gap-3">
          <div
            className={`relative w-10 h-10 rounded-full ${heroTier.bgSoftClass} border ${heroTier.borderClass} flex items-center justify-center flex-shrink-0`}
          >
            <Compass className={`w-4 h-4 ${heroTier.textClass}`} />
            <motion.span
              aria-hidden
              className={`absolute inset-0 rounded-full border ${heroTier.borderClass}`}
              initial={{ scale: 1, opacity: 0.5 }}
              animate={{ scale: [1, 1.4, 1], opacity: [0.5, 0, 0.5] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeOut' }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-[10px] uppercase tracking-[0.22em] ${heroTier.textClass} font-medium opacity-80`}>
              {title ?? 'Featured persona'}
            </p>
            <h1 className="typo-heading-sm text-foreground/95 truncate font-semibold">
              {hero.name}
            </h1>
          </div>
          <button
            type="button"
            onClick={() => openPersona(hero.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-input typo-caption font-medium ${heroTier.btnClass} transition-colors`}
          >
            Open <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Body — hero card grid + side strip */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-3 p-3">
          {/* Hero card */}
          <HeroCard
            persona={hero}
            tierLabel={heroTierLabel}
            tierAccent={heroTier}
            trustTone={heroTrustTone}
            onOpen={openPersona}
          />
          {/* Side: story trail + roster thumbnails */}
          <aside className="flex flex-col gap-3 min-w-0">
            <StoryStrip />
            {rest.length > 0 && (
              <div className="rounded-card border border-foreground/8 bg-background/30 p-2.5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-foreground/55 font-medium mb-2 px-1">
                  Also in your roster
                </p>
                <ul className="flex flex-col gap-1">
                  {rest.map((p) => (
                    <li key={p.id}>
                      <RosterThumb persona={p} onOpen={openPersona} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function HeroCard({
  persona,
  tierLabel,
  tierAccent,
  trustTone,
  onOpen,
}: {
  persona: Persona;
  tierLabel: string;
  tierAccent: ReturnType<typeof modelTierAccent>;
  trustTone: 'good' | 'warn' | 'bad';
  onOpen: (id: string) => void;
}) {
  const illustration = useIllustration(persona);
  const trustPct = Math.round(persona.trust_score * 100);
  const flag = attentionFor(persona);

  return (
    <section
      className={`relative rounded-card border ${tierAccent.borderClass} bg-gradient-to-br ${tierAccent.bgSoftClass} to-transparent p-4 overflow-hidden flex flex-col gap-3`}
    >
      <div
        aria-hidden
        className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-gradient-to-br from-foreground/[0.06] to-transparent blur-3xl pointer-events-none"
      />
      <div className="relative flex items-start gap-3">
        <div
          className="w-16 h-16 rounded-card bg-cover bg-center flex-shrink-0 border border-foreground/10"
          style={{ backgroundImage: `url(${illustration.url})` }}
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded-input typo-caption font-medium ${tierAccent.bgSoftClass} ${tierAccent.borderClass} border ${tierAccent.textClass}`}>
              {tierLabel}
            </span>
            {flag && (
              <span className={`typo-caption ${flag.tone === 'bad' ? 'text-rose-300' : 'text-amber-300'}`}>
                · {flag.label}
              </span>
            )}
            {recentActivity(persona.updated_at) && (
              <span className="typo-caption text-emerald-300">· active {relativeUpdated(persona.updated_at)}</span>
            )}
          </div>
          {persona.description && (
            <p className="typo-body text-foreground/85 mt-1 line-clamp-3">{persona.description}</p>
          )}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-2">
        <KpiPanel icon={Shield} label="Trust" value={`${trustPct}%`} tone={trustTone} />
        <KpiPanel icon={Coins} label="Budget" value={budgetLabel(persona.max_budget_usd)} />
        <KpiPanel icon={Gauge} label="Max turns" value={persona.max_turns?.toString() ?? '—'} />
      </div>

      {/* Footer — secondary action */}
      <div className="flex items-center justify-end gap-2 pt-1 border-t border-foreground/5">
        <button
          type="button"
          onClick={() => onOpen(persona.id)}
          className="typo-caption text-foreground/65 hover:text-foreground transition-colors inline-flex items-center gap-1"
        >
          View full persona <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </section>
  );
}

function KpiPanel({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Shield;
  label: string;
  value: string;
  tone?: 'good' | 'warn' | 'bad';
}) {
  const valueClass =
    tone === 'good'
      ? 'text-emerald-300'
      : tone === 'warn'
        ? 'text-amber-300'
        : tone === 'bad'
          ? 'text-rose-300'
          : 'text-foreground/95';
  return (
    <div className="rounded-input border border-foreground/8 bg-background/40 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-foreground/55">
        <Icon className="w-3 h-3" />
        <span className="text-[10px] uppercase tracking-[0.16em] font-medium">{label}</span>
      </div>
      <div className={`typo-data-md font-semibold mt-0.5 ${valueClass}`}>{value}</div>
    </div>
  );
}

function RosterThumb({ persona, onOpen }: { persona: Persona; onOpen: (id: string) => void }) {
  const tier = modelTierAccent(persona.model_profile);
  const tierLabel = modelTierLabel(persona.model_profile);
  const initial = firstGrapheme(persona.icon ?? persona.name ?? '?');
  const flag = attentionFor(persona);
  return (
    <button
      type="button"
      onClick={() => onOpen(persona.id)}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-input hover:bg-foreground/[0.04] transition-colors text-left group"
    >
      <span
        className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 typo-caption font-semibold ${tier.bgSoftClass} ${tier.borderClass} border ${tier.textClass}`}
      >
        {initial}
      </span>
      <span className="flex-1 min-w-0">
        <span className="typo-caption text-foreground/85 truncate block group-hover:text-foreground">
          {persona.name}
        </span>
        <span className={`text-[10px] ${flag ? 'text-amber-300' : 'text-foreground/45'}`}>
          {flag ? flag.label : tierLabel}
        </span>
      </span>
      <ArrowRight className="w-3 h-3 text-foreground/30 group-hover:text-foreground/65" />
    </button>
  );
}

function StoryStrip() {
  // Lightweight 3-step trail framing what the user can do from the
  // cockpit. Static copy; the value is in giving the surface narrative
  // weight, not in tracking real progress.
  const steps = [
    { label: 'Pick', body: 'Tap a persona to open it in the editor.' },
    { label: 'Tune', body: 'Adjust model tier, budget, or trust score.' },
    { label: 'Run', body: 'Send a real input from the play surface.' },
  ];
  return (
    <div className="rounded-card border border-foreground/8 bg-background/30 p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Sparkles className="w-3 h-3 text-primary/70" />
        <p className="text-[10px] uppercase tracking-[0.18em] text-foreground/55 font-medium">
          Next steps
        </p>
      </div>
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span className="w-4 h-4 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center font-mono text-[9px] text-primary/85 flex-shrink-0 mt-0.5">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="typo-caption text-foreground/95 font-medium leading-snug">{s.label}</p>
              <p className="text-[11px] text-foreground/55 leading-snug">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
