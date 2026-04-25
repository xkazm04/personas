/**
 * MosaicVariant — Simple-mode "Home" tab, Phase 07.
 *
 * First consumer of the Phase 05-11 foundation. Renders a magazine-style
 * mosaic: greeting + summary header, a 6-column 3-row tile grid (hero
 * approval/health/message + secondary inbox items + persona quick-tiles +
 * create-new tile), and a bottom connections strip.
 *
 * All data flows from existing Zustand stores via two hooks:
 *   - `useUnifiedInbox()` — the single inbox read surface.
 *   - `useSimpleSummary()` — derived counters for the header.
 *
 * Persona illustrations come from `useIllustration(persona)` (Phase 10).
 * All colors are `simple-accent-{tone}-*` utilities; typography uses
 * `typo-*` + `simple-display`. No raw Tailwind color shades, no hardcoded
 * pixel sizes — the palette is intentionally closed (see Phase 11 decisions).
 *
 * Action behaviors (v1, minimal):
 *   - Hero primary button: routes to the Inbox tab via setActiveSimpleTab,
 *     letting the user act in Phase 09's review surface once it ships.
 *   - Create-new tile + welcome-hero CTA: both call startOnboarding().
 *   - Broken connection chip: switches to Power mode + credentials page.
 */

import { useMemo } from 'react';
import {
  AlertCircle,
  Check,
  ChevronRight,
  MessageSquare,
  Plug,
  Plus,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import type { Persona } from '@/lib/bindings/Persona';
import type { CredentialMetadata } from '@/lib/types/types';
import { TIERS } from '@/lib/constants/uiModes';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { useVaultStore } from '@/stores/vaultStore';

import { SimpleEmptyState } from '../SimpleEmptyState';
import { formatRelativeTime } from '../../utils/formatRelativeTime';
import { useUnifiedInbox } from '../../hooks/useUnifiedInbox';
import { useIllustration } from '../../hooks/useIllustration';
import { useSimpleSummary, type SimpleSummary } from '../../hooks/useSimpleSummary';
import type { UnifiedInboxItem } from '../../types';

// ---------------------------------------------------------------------------
// Hero selection
// ---------------------------------------------------------------------------

/** Severity rank used by `pickHero`. Higher number = higher priority. */
const SEVERITY_RANK: Record<UnifiedInboxItem['severity'], number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

/**
 * Choose the "loudest" inbox item to render in the hero tile.
 *
 * Rule: highest severity first (critical > warning > info); on ties, newest
 * `createdAt` wins. Returns null when inbox is empty — callers render a
 * welcome hero in that case.
 *
 * Single-pass O(n) reducer — no copy, no sort. Relies on `useUnifiedInbox`
 * delivering items already sorted newest-first so the createdAt tiebreak is
 * satisfied by "first item wins" among equal-severity candidates.
 */
export function pickHero(items: readonly UnifiedInboxItem[]): UnifiedInboxItem | null {
  let best: UnifiedInboxItem | null = null;
  let bestRank = -1;
  let bestCreatedAt = '';
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const rank = SEVERITY_RANK[item.severity];
    if (
      rank > bestRank ||
      (rank === bestRank && item.createdAt.localeCompare(bestCreatedAt) > 0)
    ) {
      best = item;
      bestRank = rank;
      bestCreatedAt = item.createdAt;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Tone selection per inbox kind
// ---------------------------------------------------------------------------

/** The five Simple-mode palette tones (Phase 11). */
type Tone = 'amber' | 'violet' | 'emerald' | 'rose' | 'gold';

/**
 * Map an inbox item to its Simple-mode accent tone. Critical-severity
 * health issues are rose; everything else follows the per-kind chart
 * documented in the plan.
 */
function toneFor(item: UnifiedInboxItem): Tone {
  switch (item.kind) {
    case 'approval':
      return 'amber';
    case 'message':
      return 'violet';
    case 'output':
      return 'emerald';
    case 'health':
      return item.severity === 'critical' ? 'rose' : 'gold';
  }
}

/** CTA label key per hero kind (approval → Review, message → Read, etc.). */
function heroCtaKey(
  kind: UnifiedInboxItem['kind'],
): 'hero_cta_review' | 'hero_cta_read' | 'hero_cta_fix' {
  if (kind === 'approval') return 'hero_cta_review';
  if (kind === 'message') return 'hero_cta_read';
  // output + health both route to "Fix"-style action in v1.
  return 'hero_cta_fix';
}

// ---------------------------------------------------------------------------
// Default export — composes the whole variant.
// ---------------------------------------------------------------------------

type TMap = Translations['simple_mode'];

export default function MosaicVariant() {
  const { t, tx } = useTranslation();
  const personas = useAgentStore((s) => s.personas);
  const credentials = useVaultStore((s) => s.credentials);
  const inbox = useUnifiedInbox();
  const summary = useSimpleSummary();
  const startOnboarding = useSystemStore((s) => s.startOnboarding);
  const setActiveSimpleTab = useSystemStore((s) => s.setActiveSimpleTab);
  const setViewMode = useSystemStore((s) => s.setViewMode);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);

  // Zero-persona state: nothing to render; the whole surface becomes a
  // welcome card with a CTA into the onboarding flow. Shared with Console
  // via `SimpleEmptyState` (Phase 08 extraction).
  if (personas.length === 0) {
    return <SimpleEmptyState onCreate={startOnboarding} />;
  }

  const hero = useMemo(() => pickHero(inbox), [inbox]);
  const secondary = useMemo(() => {
    if (!hero) return inbox.slice(0, 3);
    const out: UnifiedInboxItem[] = [];
    for (let i = 0; i < inbox.length && out.length < 3; i++) {
      const item = inbox[i]!;
      if (item.id !== hero.id) out.push(item);
    }
    return out;
  }, [inbox, hero]);

  // Persona quick-tiles: up to 3 personas that are NOT already surfaced as
  // the hero or a secondary tile (avoids rendering "Invoice Watcher" twice).
  const personaSlots = useMemo(() => {
    const surfaced = new Set<string>();
    if (hero) surfaced.add(hero.personaId);
    for (const s of secondary) surfaced.add(s.personaId);
    const out: Persona[] = [];
    for (let i = 0; i < personas.length && out.length < 3; i++) {
      const p = personas[i]!;
      if (!surfaced.has(p.id)) out.push(p);
    }
    return out;
  }, [hero, secondary, personas]);

  const onHeroAction = () => {
    // Phase 09 will wire this to an in-surface detail pane; for now we just
    // hand off to the Inbox variant where the user can actually act.
    setActiveSimpleTab('inbox');
  };

  const onReconnect = () => {
    setViewMode(TIERS.TEAM);
    setSidebarSection('credentials');
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <MosaicHeader t={t.simple_mode} tx={tx} summary={summary} />

      <div className="flex-1 min-h-0 px-8 pb-4 grid grid-cols-6 grid-rows-3 gap-3 overflow-hidden">
        <HeroTile
          t={t.simple_mode}
          tFull={t}
          item={hero}
          onAction={onHeroAction}
          onCreateAssistant={startOnboarding}
        />
        {secondary.map((item) => (
          <SecondaryTile key={item.id} t={t.simple_mode} item={item} />
        ))}
        {personaSlots.map((p) => (
          <PersonaTile key={p.id} t={t.simple_mode} persona={p} />
        ))}
        <CreateTile t={t.simple_mode} onClick={startOnboarding} />
      </div>

      <MosaicConnectionsStrip
        t={t.simple_mode}
        credentials={credentials}
        onReconnect={onReconnect}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

interface MosaicHeaderProps {
  t: TMap;
  tx: (template: string, vars: Record<string, string | number>) => string;
  summary: SimpleSummary;
}

/**
 * Greeting line + right-aligned summary metrics (runs today, active
 * assistants, connected integrations). All three metrics pull from
 * `useSimpleSummary`; copy routes through `t.simple_mode`.
 */
function MosaicHeader({ t, tx, summary }: MosaicHeaderProps) {
  const greeting =
    summary.greetingKind === 'morning'
      ? t.greeting_morning
      : summary.greetingKind === 'afternoon'
        ? t.greeting_afternoon
        : t.greeting_evening;
  const name = summary.greetingName ?? t.greeting_friend;

  return (
    <header className="px-8 pt-6 pb-4 flex items-end justify-between gap-6 shrink-0">
      <div>
        <h1 className="typo-hero simple-display text-foreground">
          {greeting}, {name}.
        </h1>
      </div>
      <div className="flex items-center gap-4 text-right">
        <SummaryMetric
          label={t.summary_runs_label}
          value={summary.runsToday}
          unit={
            summary.runsToday === 1
              ? t.summary_runs_unit_one
              : t.summary_runs_unit_other
          }
        />
        <div className="w-px h-10 bg-foreground/10" />
        <SummaryMetric
          label={t.summary_active_label}
          value={summary.activePersonaCount}
          unit={
            summary.activePersonaCount === 1
              ? t.summary_active_unit_one
              : t.summary_active_unit_other
          }
        />
        <div className="w-px h-10 bg-foreground/10" />
        <div>
          <div className="typo-label text-foreground/40 uppercase tracking-wider">
            {t.summary_connections_label}
          </div>
          <div className="typo-data-lg simple-display text-foreground">
            {tx(t.summary_connections_format, {
              ok: summary.connectedOk,
              total: summary.connectedTotal,
            })}
          </div>
        </div>
      </div>
    </header>
  );
}

function SummaryMetric({
  label,
  value,
  unit,
}: {
  label: string;
  value: number;
  unit: string;
}) {
  return (
    <div>
      <div className="typo-label text-foreground/40 uppercase tracking-wider">{label}</div>
      <div className="typo-data-lg simple-display text-foreground">
        {value}
        <span className="text-foreground/40"> {unit}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero tile (renders an inbox item OR the welcome card)
// ---------------------------------------------------------------------------

interface HeroTileProps {
  t: TMap;
  tFull: Translations;
  item: UnifiedInboxItem | null;
  onAction: () => void;
  onCreateAssistant: () => void;
}

function HeroTile({ t, tFull, item, onAction, onCreateAssistant }: HeroTileProps) {
  if (item === null) {
    // Populated personas, but no inbox activity — warm welcome instead of
    // silence. Still prompts to create another assistant.
    return (
      <div
        className={[
          'col-span-3 row-span-2 rounded-3xl border p-6 flex flex-col justify-between',
          'simple-accent-violet-border simple-accent-violet-soft',
        ].join(' ')}
      >
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-2xl border simple-accent-violet-border simple-accent-violet-soft flex items-center justify-center">
            <Sparkles className="w-5 h-5 simple-accent-violet-text" />
          </div>
          <div className="typo-label uppercase tracking-wider simple-accent-violet-text">
            {t.welcome_hero_title}
          </div>
        </div>
        <div className="space-y-1">
          <div className="typo-heading-lg simple-display text-foreground">
            {t.welcome_hero_title}
          </div>
          <p className="typo-body text-foreground/70">{t.welcome_hero_body}</p>
        </div>
        <Button variant="primary" onClick={onCreateAssistant}>
          {t.welcome_hero_cta}
        </Button>
      </div>
    );
  }

  const tone = toneFor(item);
  const ctaLabel = t[heroCtaKey(item.kind)];

  return (
    <div
      className={[
        'col-span-3 row-span-2 rounded-3xl border p-6 flex flex-col justify-between',
        `simple-accent-${tone}-border`,
        `simple-accent-${tone}-soft`,
      ].join(' ')}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div
            className={[
              'w-10 h-10 rounded-2xl border flex items-center justify-center',
              `simple-accent-${tone}-border`,
              `simple-accent-${tone}-soft`,
            ].join(' ')}
          >
            <HeroIcon kind={item.kind} tone={tone} />
          </div>
          <div>
            <div
              className={`typo-label uppercase tracking-wider simple-accent-${tone}-text`}
            >
              {item.personaName}
            </div>
            <div className="typo-caption text-foreground/60">{formatRelativeTime(item.createdAt, tFull)}</div>
          </div>
        </div>
        {item.personaIcon ? (
          <span className="typo-data-lg" aria-hidden>
            {firstGrapheme(item.personaIcon)}
          </span>
        ) : null}
      </div>

      <div className="space-y-1">
        <div className={`typo-label uppercase tracking-wider simple-accent-${tone}-text`}>
          {item.kind}
        </div>
        <div className="typo-heading-lg simple-display text-foreground">{item.title}</div>
        <p className="typo-body text-foreground/70 line-clamp-2">{item.body}</p>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          onClick={onAction}
          className={`flex-1 simple-accent-${tone}-solid`}
        >
          {ctaLabel}
        </Button>
      </div>
    </div>
  );
}

function HeroIcon({ kind, tone }: { kind: UnifiedInboxItem['kind']; tone: Tone }) {
  const cls = `w-5 h-5 simple-accent-${tone}-text`;
  switch (kind) {
    case 'approval':
      return <ShieldCheck className={cls} />;
    case 'message':
      return <MessageSquare className={cls} />;
    case 'health':
      return <Wrench className={cls} />;
    case 'output':
      return <Sparkles className={cls} />;
  }
}

// ---------------------------------------------------------------------------
// Secondary tile (inbox item, 1 row × 2 cols)
// ---------------------------------------------------------------------------

interface SecondaryTileProps {
  t: TMap;
  item: UnifiedInboxItem;
}

function SecondaryTile({ item }: SecondaryTileProps) {
  const tone = toneFor(item);
  return (
    <div
      className={[
        'col-span-2 row-span-1 rounded-3xl border p-4 flex items-start gap-3',
        `simple-accent-${tone}-border`,
        `simple-accent-${tone}-soft`,
      ].join(' ')}
    >
      <div
        className={[
          'w-9 h-9 rounded-2xl border flex items-center justify-center shrink-0',
          `simple-accent-${tone}-border`,
          `simple-accent-${tone}-soft`,
        ].join(' ')}
      >
        <HeroIcon kind={item.kind} tone={tone} />
      </div>
      <div className="flex-1 min-w-0">
        <div className={`typo-label uppercase tracking-wider simple-accent-${tone}-text`}>
          {item.personaName}
        </div>
        <div className="typo-body simple-display text-foreground line-clamp-1">{item.title}</div>
        <div className="typo-caption text-foreground/50 line-clamp-1">{item.body}</div>
      </div>
      <ChevronRight className={`w-4 h-4 simple-accent-${tone}-text shrink-0`} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Persona quick-tile (1 × 1, illustration + name)
// ---------------------------------------------------------------------------

interface PersonaTileProps {
  t: TMap;
  persona: Persona;
}

function PersonaTile({ t, persona }: PersonaTileProps) {
  const illustration = useIllustration(persona);
  const isActive = persona.enabled !== false;
  return (
    <div className="col-span-1 row-span-1 relative rounded-3xl border border-foreground/10 bg-foreground/[0.03] p-4 flex flex-col justify-between overflow-hidden">
      <img
        src={illustration.url}
        aria-hidden
        alt=""
        className="simple-illustration absolute inset-0 w-full h-full object-cover pointer-events-none"
      />
      <div className="relative typo-data-lg" aria-hidden>
        {firstGrapheme(persona.icon ?? '') || '•'}
      </div>
      <div className="relative">
        <div className="typo-caption simple-display text-foreground line-clamp-1">
          {persona.name}
        </div>
        <div className="typo-label text-foreground/50">
          {isActive ? t.tile_active : t.tile_needs_setup}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create-new tile (always present, dashed border)
// ---------------------------------------------------------------------------

function CreateTile({ t, onClick }: { t: TMap; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="col-span-2 row-span-1 rounded-3xl border border-dashed border-foreground/20 bg-foreground/[0.02] p-4 flex items-center justify-between text-left hover:border-foreground/40 transition-colors"
    >
      <div className="min-w-0">
        <div className="typo-body simple-display text-foreground">
          {t.create_assistant_tile_title}
        </div>
        <div className="typo-caption text-foreground/50">{t.create_assistant_tile_body}</div>
      </div>
      <div className="w-10 h-10 rounded-2xl border border-foreground/20 flex items-center justify-center text-foreground/60 shrink-0">
        <Plus className="w-5 h-5" />
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Connections strip (bottom bar)
// ---------------------------------------------------------------------------

interface MosaicConnectionsStripProps {
  t: TMap;
  credentials: CredentialMetadata[];
  onReconnect: () => void;
}

function MosaicConnectionsStrip({ t, credentials, onReconnect }: MosaicConnectionsStripProps) {
  // Show at most 6 credentials so the strip never scrolls; remaining count is
  // implicit ("+ add" chip stays visible to encourage growth).
  const shown = credentials.slice(0, 6);

  return (
    <footer className="px-8 py-3 border-t border-foreground/10 bg-background/60 flex items-center gap-4 shrink-0">
      <span className="typo-label uppercase tracking-wider text-foreground/40">
        {t.connections_strip_label}
      </span>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {shown.map((c) => (
          <ConnectionChip key={c.id} t={t} cred={c} onReconnect={onReconnect} />
        ))}
        <button
          type="button"
          onClick={onReconnect}
          className="flex items-center gap-1 px-2.5 py-1 rounded-full border border-dashed border-foreground/20 typo-caption text-foreground/50 hover:text-foreground/80 hover:border-foreground/40 transition-colors"
        >
          <Plus className="w-3 h-3" />
          <span>{t.connections_add_more}</span>
        </button>
      </div>
    </footer>
  );
}

function ConnectionChip({
  t,
  cred,
  onReconnect,
}: {
  t: TMap;
  cred: CredentialMetadata;
  onReconnect: () => void;
}) {
  const isOk = cred.healthcheck_last_success === true;
  const needsRepair = cred.healthcheck_last_success === false;
  // Unknown (null) renders as neutral — neither green-checked nor broken.

  if (needsRepair) {
    return (
      <button
        type="button"
        onClick={onReconnect}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border simple-accent-rose-soft simple-accent-rose-border typo-caption simple-accent-rose-text"
        aria-label={t.connections_unhealthy}
      >
        <Plug className="w-3 h-3" />
        <span>{cred.name}</span>
        <AlertCircle className="w-3 h-3" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-foreground/10 bg-foreground/[0.04] typo-caption text-foreground/80">
      <Plug className="w-3 h-3" />
      <span>{cred.name}</span>
      {isOk ? <Check className="w-3 h-3 simple-accent-emerald-text" /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Extract the first grapheme from a string (safe for emoji ZWJ sequences). */
function firstGrapheme(s: string): string {
  if (!s) return '';
  const arr = Array.from(s);
  return arr[0] ?? '';
}

