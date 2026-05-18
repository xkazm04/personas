/**
 * PersonaOverviewRoster — directional variant 2.
 *
 * Mental model: dense data table. Each persona is one row carrying its
 * decision-grade stats — tier, trust score, budget, turns, last
 * activity, attention flags. The user scans top-to-bottom and picks
 * the one that matters; no orbital math, no decorative SVG.
 *
 * Why this variant: when the user opens the cockpit because they're
 * about to *act* ("which persona should I run for this?"), spatial
 * layout is friction. The roster mirrors the data the editor itself
 * shows in its header — one source of truth, scannable density.
 *
 * Motion discipline: row hover only; no entry animation that would
 * delay a scan-driven decision.
 */
import { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { AlertCircle, Bot, ChevronRight, Pause, ShieldAlert } from 'lucide-react';

import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import type { Persona } from '@/lib/bindings/Persona';

import type { CockpitWidgetProps } from '../widgetRegistry';
import {
  attentionFor,
  budgetLabel,
  modelTierAccent,
  modelTierLabel,
  recentActivity,
  relativeUpdated,
  trustToneFor,
} from './personaStats';

export function PersonaOverviewRoster({ config, title }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const limit = (config?.limit as number) ?? 12;
  const filter = ((config?.filter as string) ?? 'active') === 'all' ? 'all' : 'active';

  const { personas, fetchPersonas } = useAgentStore(
    useShallow((s) => ({ personas: s.personas, fetchPersonas: s.fetchPersonas })),
  );
  useEffect(() => {
    if (!personas || personas.length === 0) {
      fetchPersonas().catch(() => {});
    }
  }, [personas, fetchPersonas]);

  const visible = useMemo(() => {
    const arr = personas ?? [];
    const filtered = filter === 'active' ? arr.filter((p) => p.enabled !== false) : arr;
    // Sort: attention-flagged first (so they pop), then most-recently-updated.
    return [...filtered]
      .sort((a, b) => {
        const aFlag = attentionFor(a) ? 1 : 0;
        const bFlag = attentionFor(b) ? 1 : 0;
        if (aFlag !== bFlag) return bFlag - aFlag;
        return (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
      })
      .slice(0, limit);
  }, [personas, filter, limit]);

  const openPersona = (id: string) => {
    const sys = useSystemStore.getState();
    sys.setSidebarSection('personas');
    useAgentStore.getState().selectPersona(id);
  };

  const attentionCount = visible.filter((p) => attentionFor(p)).length;

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Header strip */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-foreground/8 bg-background/30">
        <div className="flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-[0.2em] text-foreground/55 font-medium">
            {title ?? 'Roster'}
          </span>
          <span className="typo-caption text-foreground/45">
            {visible.length} of {personas?.length ?? 0}
          </span>
        </div>
        {attentionCount > 0 && (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-input border border-amber-500/30 bg-amber-500/10 text-amber-300 typo-caption">
            <AlertCircle className="w-3 h-3" />
            {attentionCount} need{attentionCount === 1 ? 's' : ''} attention
          </span>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-foreground/40">
          <Bot className="w-6 h-6" />
          <div className="typo-caption">{t.plugins.companion.persona_overview_empty}</div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* Column header — invisible at small widths, visible from md up */}
          <div className="hidden md:grid grid-cols-[1.4fr_60px_70px_70px_70px_18px] gap-3 px-4 py-2 border-b border-foreground/5 sticky top-0 bg-background/85 backdrop-blur z-10">
            <ColHead label="Persona" />
            <ColHead label="Tier" />
            <ColHead label="Trust" align="right" />
            <ColHead label="Budget" align="right" />
            <ColHead label="Updated" align="right" />
            <span />
          </div>
          <ul className="divide-y divide-foreground/5">
            {visible.map((p) => (
              <RosterRow key={p.id} persona={p} onOpen={openPersona} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ColHead({ label, align }: { label: string; align?: 'left' | 'right' }) {
  return (
    <span
      className={`text-[10px] uppercase tracking-[0.18em] text-foreground/45 font-medium ${
        align === 'right' ? 'text-right' : ''
      }`}
    >
      {label}
    </span>
  );
}

function RosterRow({ persona, onOpen }: { persona: Persona; onOpen: (id: string) => void }) {
  const tier = modelTierAccent(persona.model_profile);
  const tierLabel = modelTierLabel(persona.model_profile);
  const trustTone = trustToneFor(persona.trust_level, persona.trust_score);
  const flag = attentionFor(persona);
  const isFresh = recentActivity(persona.updated_at);

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(persona.id)}
        className="w-full group grid grid-cols-1 md:grid-cols-[1.4fr_60px_70px_70px_70px_18px] gap-3 px-4 py-2.5 items-center text-left hover:bg-foreground/[0.03] transition-colors"
        data-testid={`roster-row-${persona.id}`}
      >
        {/* Persona — name + activity dot + flag */}
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className={`relative w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              isFresh ? 'bg-emerald-400' : 'bg-foreground/25'
            }`}
            aria-hidden
          >
            {isFresh && (
              <span className="absolute inset-0 rounded-full bg-emerald-400 opacity-40 animate-ping" />
            )}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="typo-body font-medium text-foreground/95 truncate group-hover:text-foreground">
                {persona.name}
              </span>
              {flag && <FlagPill flag={flag} />}
            </div>
            {persona.description && (
              <span className="typo-caption text-foreground/55 truncate block">
                {persona.description}
              </span>
            )}
          </div>
        </div>
        {/* Tier */}
        <div className="text-right md:text-left">
          <span
            className={`inline-flex items-center px-1.5 py-0.5 rounded-input typo-caption font-medium ${tier.bgSoftClass} ${tier.borderClass} border ${tier.textClass}`}
          >
            {tierLabel}
          </span>
        </div>
        {/* Trust */}
        <div className="text-right">
          <TrustBar score={persona.trust_score} tone={trustTone} />
        </div>
        {/* Budget */}
        <div className="text-right typo-caption text-foreground/80 font-mono">
          {budgetLabel(persona.max_budget_usd)}
        </div>
        {/* Updated */}
        <div className="text-right typo-caption text-foreground/55">
          {relativeUpdated(persona.updated_at)}
        </div>
        <ChevronRight className="hidden md:block w-3.5 h-3.5 text-foreground/30 group-hover:text-foreground/65" />
      </button>
    </li>
  );
}

function TrustBar({ score, tone }: { score: number; tone: 'good' | 'warn' | 'bad' }) {
  const pct = Math.max(0, Math.min(100, Math.round(score * 100)));
  const fillClass =
    tone === 'good'
      ? 'bg-emerald-400/80'
      : tone === 'warn'
        ? 'bg-amber-400/80'
        : 'bg-rose-400/80';
  const trackClass = 'bg-foreground/[0.06]';
  return (
    <div className="inline-flex items-center gap-1.5">
      <span className={`relative w-10 h-1 rounded-full overflow-hidden ${trackClass}`}>
        <span
          className={`absolute inset-y-0 left-0 ${fillClass}`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span
        className={`typo-caption font-mono ${
          tone === 'good'
            ? 'text-emerald-300'
            : tone === 'warn'
              ? 'text-amber-300'
              : 'text-rose-300'
        }`}
      >
        {pct}
      </span>
    </div>
  );
}

function FlagPill({ flag }: { flag: ReturnType<typeof attentionFor> }) {
  if (!flag) return null;
  const tone = flag.tone === 'bad' ? 'rose' : 'amber';
  const Icon = flag.kind === 'disabled' ? Pause : flag.kind === 'low_trust' ? ShieldAlert : AlertCircle;
  const cls =
    tone === 'rose'
      ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
      : 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-input border typo-caption ${cls}`}
    >
      <Icon className="w-3 h-3" />
      {flag.label}
    </span>
  );
}
