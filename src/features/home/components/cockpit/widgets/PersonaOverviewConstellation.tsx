/**
 * PersonaOverviewConstellation — directional variant 1.
 *
 * Mental model: personas as orbital nodes around a central health
 * indicator. Each node is sized by trust score, tinted by model tier,
 * and ringed by a halo if recently active. Click a node to open the
 * persona. Hover lifts a stat-card with name + tier + trust + last-run.
 *
 * Why this variant: today's baseline answers "what personas exist" but
 * not "which matter right now". A spatial layout encodes relationships
 * (how many tiers, who's outsized, who's drifting) that a flat grid
 * obscures.
 *
 * Motion discipline: entry stagger only on mount (no infinite rotations),
 * halo pulse only on hovered/active nodes.
 */
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { Bot, Sparkles } from 'lucide-react';

import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { firstGrapheme } from '@/features/plugins/companion/inbox/_shared/grapheme';
import type { Persona } from '@/lib/bindings/Persona';

import type { CockpitWidgetProps } from '../widgetRegistry';
import { modelTierAccent, modelTierLabel, recentActivity, trustToneFor } from './personaStats';

export function PersonaOverviewConstellation({ config, title }: CockpitWidgetProps) {
  const limit = (config?.limit as number) ?? 9;
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
    return filtered.slice(0, limit);
  }, [personas, filter, limit]);

  const total = personas?.length ?? 0;
  const ready = useMemo(
    () => (personas ?? []).filter((p) => p.enabled !== false && p.setup_status === 'ready').length,
    [personas],
  );
  const needsSetup = useMemo(
    () => (personas ?? []).filter((p) => p.setup_status === 'needs_credentials').length,
    [personas],
  );

  const [hoverId, setHoverId] = useState<string | null>(null);
  const hovered = visible.find((p) => p.id === hoverId) ?? null;

  const openPersona = (id: string) => {
    const sys = useSystemStore.getState();
    sys.setSidebarSection('personas');
    useAgentStore.getState().selectPersona(id);
  };

  return (
    <div className="h-full flex min-h-0">
      {/* Constellation stage */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        <ConstellationBackdrop />
        {visible.length === 0 ? (
          <ConstellationEmpty />
        ) : (
          <svg
            viewBox="-100 -100 200 200"
            preserveAspectRatio="xMidYMid meet"
            className="absolute inset-0 w-full h-full"
            role="img"
            aria-label={`${visible.length} persona${visible.length === 1 ? '' : 's'} arranged in constellation`}
          >
            {/* Concentric guide rings — purely visual scaffolding */}
            {[28, 52, 78].map((r) => (
              <circle
                key={r}
                cx={0}
                cy={0}
                r={r}
                fill="none"
                stroke="currentColor"
                strokeWidth={0.4}
                strokeDasharray="2 3"
                className="text-foreground/10"
              />
            ))}

            {/* Center — aggregate health */}
            <g>
              <circle cx={0} cy={0} r={18} className="fill-primary/15 stroke-primary/40" strokeWidth={0.8} />
              <text
                x={0}
                y={-1}
                textAnchor="middle"
                className="fill-foreground typo-data-lg font-semibold"
                style={{ fontSize: 11 }}
              >
                {ready}
              </text>
              <text
                x={0}
                y={7}
                textAnchor="middle"
                className="fill-foreground/55"
                style={{ fontSize: 4.2, letterSpacing: '0.18em' }}
              >
                ACTIVE
              </text>
            </g>

            {/* Persona nodes — polar layout. Inner ring (≤4 fit there), outer ring spillover. */}
            {visible.map((p, i) => {
              const inner = visible.length <= 4;
              const ringR = inner ? 52 : i < 4 ? 38 : 72;
              const slice = inner ? visible.length : i < 4 ? 4 : Math.max(1, visible.length - 4);
              const localI = inner ? i : i < 4 ? i : i - 4;
              const angle = (localI / slice) * Math.PI * 2 - Math.PI / 2;
              const px = Math.cos(angle) * ringR;
              const py = Math.sin(angle) * ringR;

              const tier = modelTierAccent(p.model_profile);
              const trustTone = trustToneFor(p.trust_level, p.trust_score);
              const isHover = p.id === hoverId;
              const recently = recentActivity(p.updated_at);

              return (
                <motion.g
                  key={p.id}
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.05 * i, duration: 0.4, ease: 'easeOut' }}
                >
                  {/* Halo for recently-active personas */}
                  {recently && (
                    <motion.circle
                      cx={px}
                      cy={py}
                      r={11}
                      fill="none"
                      stroke={tier.haloHex}
                      strokeWidth={0.6}
                      animate={{ opacity: isHover ? [0.6, 0.2, 0.6] : [0.35, 0.12, 0.35] }}
                      transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  )}
                  {/* Trust dot — small annotation outside the node */}
                  <circle
                    cx={px + 6}
                    cy={py - 6}
                    r={1.6}
                    className={trustTone === 'good' ? 'fill-emerald-400' : trustTone === 'warn' ? 'fill-amber-400' : 'fill-rose-400'}
                  />
                  {/* The node itself */}
                  <motion.g
                    onMouseEnter={() => setHoverId(p.id)}
                    onMouseLeave={() => setHoverId((curr) => (curr === p.id ? null : curr))}
                    onClick={() => openPersona(p.id)}
                    style={{ cursor: 'pointer' }}
                    whileHover={{ scale: 1.08 }}
                  >
                    <circle
                      cx={px}
                      cy={py}
                      r={7}
                      className={`${tier.fillClass} ${isHover ? tier.strokeHoverClass : tier.strokeClass}`}
                      strokeWidth={isHover ? 1.4 : 0.8}
                    />
                    <text
                      x={px}
                      y={py + 1.6}
                      textAnchor="middle"
                      className="fill-foreground/95 font-semibold pointer-events-none select-none"
                      style={{ fontSize: 5.8 }}
                    >
                      {firstGrapheme(p.icon ?? p.name ?? '?')}
                    </text>
                  </motion.g>
                </motion.g>
              );
            })}
          </svg>
        )}

        {/* Top-left legend chips */}
        <div className="absolute left-3 top-3 flex items-center gap-1.5">
          <span className="typo-caption text-foreground/55 uppercase tracking-[0.2em]">
            {title ?? 'Constellation'}
          </span>
        </div>
        <div className="absolute left-3 bottom-3 flex flex-wrap items-center gap-1.5">
          <LegendDot accent="violet" label="Opus" />
          <LegendDot accent="cyan" label="Sonnet" />
          <LegendDot accent="amber" label="Haiku" />
          {needsSetup > 0 && (
            <span className="typo-caption px-2 py-0.5 rounded-input border border-amber-500/30 bg-amber-500/10 text-amber-300">
              {needsSetup} need{needsSetup === 1 ? 's' : ''} setup
            </span>
          )}
        </div>
      </div>

      {/* Side rail — hovered or summary */}
      <aside className="hidden md:flex w-[180px] flex-shrink-0 border-l border-foreground/8 bg-background/30 p-3 flex-col gap-3">
        {hovered ? (
          <PersonaDetail persona={hovered} onOpen={openPersona} />
        ) : (
          <ConstellationSummary total={total} ready={ready} needsSetup={needsSetup} />
        )}
      </aside>
    </div>
  );
}

function PersonaDetail({ persona, onOpen }: { persona: Persona; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const tier = modelTierAccent(persona.model_profile);
  const tierLabel = modelTierLabel(persona.model_profile);
  const trustTone = trustToneFor(persona.trust_level, persona.trust_score);
  return (
    <>
      <div>
        <p className="text-[10px] uppercase tracking-[0.18em] text-foreground/55 font-medium">
          {tierLabel}
        </p>
        <h3 className="typo-body font-semibold text-foreground/95 mt-0.5 break-words">{persona.name}</h3>
        {persona.description && (
          <p className="typo-caption text-foreground/65 mt-1 line-clamp-3">{persona.description}</p>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-y-2 gap-x-2 text-[11px]">
        <div>
          <dt className="text-foreground/50">Tier</dt>
          <dd className={`font-medium ${tier.textClass}`}>{tierLabel}</dd>
        </div>
        <div>
          <dt className="text-foreground/50">Trust</dt>
          <dd className={trustTone === 'good' ? 'text-emerald-300' : trustTone === 'warn' ? 'text-amber-300' : 'text-rose-300'}>
            {Math.round(persona.trust_score * 100)}%
          </dd>
        </div>
        <div>
          <dt className="text-foreground/50">Budget</dt>
          <dd className="text-foreground/85">
            {persona.max_budget_usd != null ? `$${persona.max_budget_usd.toFixed(2)}` : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-foreground/50">Turns</dt>
          <dd className="text-foreground/85">{persona.max_turns ?? '—'}</dd>
        </div>
      </dl>
      <button
        type="button"
        onClick={() => onOpen(persona.id)}
        className={`mt-auto inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-input typo-caption font-medium ${tier.btnClass}`}
      >
        {t.plugins.companion.persona_overview_open_in_editor}
      </button>
    </>
  );
}

function ConstellationSummary({
  total,
  ready,
  needsSetup,
}: {
  total: number;
  ready: number;
  needsSetup: number;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex items-center gap-1.5 text-foreground/65">
        <Sparkles className="w-3.5 h-3.5 text-primary/70" />
        <p className="text-[10px] uppercase tracking-[0.18em] font-medium">Roster</p>
      </div>
      <div>
        <p className="typo-data-lg font-semibold text-foreground/95">{total}</p>
        <p className="typo-caption text-foreground/55">persona{total === 1 ? '' : 's'} total</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <SummaryRow label="Active" value={ready} tone="good" />
        <SummaryRow label="Needs setup" value={needsSetup} tone="warn" />
      </div>
      <p className="typo-caption text-foreground/45 mt-auto leading-snug">
        {t.plugins.companion.persona_overview_hover_hint}
      </p>
    </>
  );
}

function SummaryRow({ label, value, tone }: { label: string; value: number; tone: 'good' | 'warn' }) {
  return (
    <div className="flex items-center justify-between">
      <span className="typo-caption text-foreground/65">{label}</span>
      <span
        className={`typo-caption font-medium ${
          tone === 'good' ? 'text-emerald-300' : 'text-amber-300'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function LegendDot({ accent, label }: { accent: 'violet' | 'cyan' | 'amber'; label: string }) {
  const dot =
    accent === 'violet'
      ? 'bg-violet-400'
      : accent === 'cyan'
        ? 'bg-cyan-400'
        : 'bg-amber-400';
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-input bg-background/60 border border-foreground/8 typo-caption text-foreground/65">
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function ConstellationBackdrop() {
  return (
    <svg
      aria-hidden
      className="absolute inset-0 w-full h-full opacity-[0.18] pointer-events-none"
      viewBox="0 0 200 200"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <radialGradient id="cockpit-bg" cx="50%" cy="50%" r="65%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="200" height="200" fill="url(#cockpit-bg)" className="text-primary" />
    </svg>
  );
}

function ConstellationEmpty() {
  const { t } = useTranslation();
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-foreground/40">
      <Bot className="w-6 h-6" />
      <div className="typo-caption">{t.plugins.companion.persona_overview_empty}</div>
    </div>
  );
}
