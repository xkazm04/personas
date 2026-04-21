/**
 * ConsoleVariant — Simple-mode "Console" tab, Phase 08.
 *
 * Where Mosaic (Phase 07) is the calm magazine-style home surface, Console is
 * the power-user-friendly live dashboard: persona grid at a glance + persistent
 * right-column inbox feed + top-rail live counts. Same underlying data
 * (`useUnifiedInbox` + `useSimpleSummary`), different layout.
 *
 * Three-band structure:
 *   ┌───────────────────────────────────────────────┐
 *   │  STATUS RAIL  (greeting + live pill counters) │  shrink-0
 *   ├───────────────────────────────────────────────┤
 *   │  PERSONA GRID (2×N) │ INBOX FEED (scroll feed) │  flex-1
 *   ├───────────────────────────────────────────────┤
 *   │  CONNECTIONS STRIP                             │  shrink-0
 *   └───────────────────────────────────────────────┘
 *
 * Tile structure per persona: an illustration background at 0.25 opacity (via
 * `<img aria-hidden>`) with a legibility gradient overlay; persona name +
 * last-run stamp rendered on top. Accent tone is hashed from persona id
 * (deterministic: same persona always gets the same tone across sessions).
 *
 * Action behaviors (v1):
 *   - Pulsing "New today" dot when `needsMeCount > 0`.
 *   - Inbox row click + row action buttons both route to the Inbox tab via
 *     `setActiveSimpleTab('inbox')`. Deep-action wiring lands in Phase 09.
 *   - Create-new tile / empty-state CTA: `startOnboarding()`.
 *   - Broken connection chip: Power mode + credentials page.
 *
 * Typography + palette constraints (Phase 11): only `typo-*` + `simple-display`
 * classes, only `simple-accent-{tone}-*` utilities + foreground tokens.
 */

import type { MouseEvent, ReactNode } from 'react';
import {
  AlertCircle,
  Check,
  FileOutput,
  Heart,
  Inbox,
  MessageSquare,
  Plug,
  Plus,
  ShieldCheck,
  Sparkles,
  UserCog,
} from 'lucide-react';

import type { Persona } from '@/lib/bindings/Persona';
import type { CredentialMetadata } from '@/lib/types/types';
import { TIERS } from '@/lib/constants/uiModes';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { useVaultStore } from '@/stores/vaultStore';

import { SimpleEmptyState } from '../SimpleEmptyState';
import { useUnifiedInbox } from '../../hooks/useUnifiedInbox';
import { useIllustration } from '../../hooks/useIllustration';
import { useSimpleSummary, type SimpleSummary } from '../../hooks/useSimpleSummary';
import type { UnifiedInboxItem } from '../../types';
import { formatRelativeTime } from '../../utils/formatRelativeTime';

// ---------------------------------------------------------------------------
// Tone selection
// ---------------------------------------------------------------------------

/** The five Simple-mode palette tones (Phase 11). */
type Tone = 'amber' | 'violet' | 'emerald' | 'rose' | 'gold';

const TONES: readonly Tone[] = ['amber', 'violet', 'emerald', 'rose', 'gold'] as const;

/** Simple cumulative char-code hash; stable across runs. Mirror of useIllustration's hashId. */
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Deterministic tone for a persona tile. Hashes the persona id and indexes
 * into the five-tone palette. Same persona → same tone across runs, which
 * keeps the grid visually stable as the user comes back to it day after day.
 */
function toneForPersona(p: Persona): Tone {
  const idx = hashId(p.id) % TONES.length;
  return TONES[idx] ?? 'gold';
}

/** Per-kind inbox tone — same mapping Mosaic uses; keeps the two variants in sync. */
function toneForInbox(item: UnifiedInboxItem): Tone {
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

// ---------------------------------------------------------------------------
// Default export — composes the whole variant.
// ---------------------------------------------------------------------------

type TMap = Translations['simple_mode'];
type Tx = (template: string, vars: Record<string, string | number>) => string;

export default function ConsoleVariant() {
  const { t, tx } = useTranslation();
  const personas = useAgentStore((s) => s.personas);
  const personaLastRun = useAgentStore((s) => s.personaLastRun);
  const credentials = useVaultStore((s) => s.credentials);
  const inbox = useUnifiedInbox();
  const summary = useSimpleSummary();
  const startOnboarding = useSystemStore((s) => s.startOnboarding);
  const setActiveSimpleTab = useSystemStore((s) => s.setActiveSimpleTab);
  const setViewMode = useSystemStore((s) => s.setViewMode);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);

  // Zero-persona state: the whole surface becomes a welcome card.
  if (personas.length === 0) {
    return <SimpleEmptyState onCreate={startOnboarding} />;
  }

  const onRowClick = () => {
    // Phase 09 will wire per-item detail; v1 hands off to the Inbox tab.
    setActiveSimpleTab('inbox');
  };

  const onReconnect = () => {
    setViewMode(TIERS.TEAM);
    setSidebarSection('credentials');
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <StatusRail t={t.simple_mode} tx={tx} summary={summary} />

      <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <PersonaGrid
          t={t.simple_mode}
          tFull={t}
          personas={personas}
          lastRuns={personaLastRun}
          onCreate={startOnboarding}
        />
        <InboxFeed
          t={t.simple_mode}
          tFull={t}
          items={inbox}
          onRowClick={onRowClick}
        />
      </div>

      <ConnectionsStrip
        t={t.simple_mode}
        credentials={credentials}
        onUnhealthy={onReconnect}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status rail (top band)
// ---------------------------------------------------------------------------

interface StatusRailProps {
  t: TMap;
  tx: Tx;
  summary: SimpleSummary;
}

/**
 * Top band: greeting on the left, three compact live-counter pills on the
 * right (Connected, Assistants, New today). The "New today" pill gets a
 * pulsing dot when `needsMeCount > 0` to draw the eye toward unattended work.
 */
function StatusRail({ t, tx, summary }: StatusRailProps) {
  const greeting =
    summary.greetingKind === 'morning'
      ? t.greeting_morning
      : summary.greetingKind === 'afternoon'
        ? t.greeting_afternoon
        : t.greeting_evening;
  const name = summary.greetingName ?? t.greeting_friend;

  return (
    <header className="px-6 py-4 border-b border-foreground/10 bg-background/40 flex items-center gap-4 shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <Sparkles className="w-4 h-4 simple-accent-violet-text shrink-0" />
        <h1 className="typo-heading simple-display text-foreground truncate">
          {greeting}, {name}.
        </h1>
      </div>

      <div className="flex items-center gap-2 flex-1 justify-end flex-wrap">
        <StatusPill
          tone="amber"
          icon={<Plug className="w-3.5 h-3.5" />}
          label={t.console_status_rail_connect}
          value={tx(t.summary_connections_format, {
            ok: summary.connectedOk,
            total: summary.connectedTotal,
          })}
        />
        <StatusPill
          tone="violet"
          icon={<UserCog className="w-3.5 h-3.5" />}
          label={t.console_status_rail_active}
          value={String(summary.activePersonaCount)}
        />
        <StatusPill
          tone="emerald"
          icon={<Inbox className="w-3.5 h-3.5" />}
          label={t.console_status_rail_new}
          value={String(summary.inboxCount)}
          pulse={summary.needsMeCount > 0}
        />
      </div>
    </header>
  );
}

interface StatusPillProps {
  tone: Tone;
  icon: ReactNode;
  label: string;
  value: string;
  /** Animate the leading dot (Tailwind animate-pulse). */
  pulse?: boolean;
}

function StatusPill({ tone, icon, label, value, pulse = false }: StatusPillProps) {
  const dotClass = [
    'w-1.5 h-1.5 rounded-full',
    `simple-accent-${tone}-solid`,
    pulse ? 'animate-pulse' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={[
        'flex items-center gap-2 px-3 py-1.5 rounded-full border bg-background/60',
        `simple-accent-${tone}-border`,
      ].join(' ')}
    >
      <span className={dotClass} aria-hidden />
      <span className={`simple-accent-${tone}-text`}>{icon}</span>
      <span className="typo-caption text-foreground/60">{label}</span>
      <span className={`typo-caption simple-accent-${tone}-text`}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Persona grid (middle-left band)
// ---------------------------------------------------------------------------

interface PersonaGridProps {
  t: TMap;
  /** Full translation bundle — needed by leaf formatRelativeTime calls. */
  tFull: Translations;
  personas: Persona[];
  lastRuns: Record<string, string | null>;
  onCreate: () => void;
}

/**
 * Left column of the middle band: section label at top, scrolling 2-column
 * persona grid below (with a dashed "create new" tile at the end so the CTA
 * is always visible regardless of persona count).
 */
function PersonaGrid({ t, tFull, personas, lastRuns, onCreate }: PersonaGridProps) {
  return (
    <section className="border-r border-foreground/10 p-5 flex flex-col min-h-0">
      <div className="mb-4 shrink-0">
        <h2 className="typo-heading simple-display text-foreground">
          {t.console_persona_grid_label}
        </h2>
      </div>
      <div className="grid grid-cols-2 gap-3 content-start flex-1 min-h-0 overflow-auto pb-1">
        {personas.map((p) => (
          <PersonaTile key={p.id} t={t} tFull={tFull} persona={p} lastRun={lastRuns[p.id] ?? null} />
        ))}
        <CreateTile t={t} onClick={onCreate} />
      </div>
    </section>
  );
}

interface PersonaTileProps {
  t: TMap;
  tFull: Translations;
  persona: Persona;
  lastRun: string | null;
}

/**
 * Single persona tile. The illustration is rendered as an `<img aria-hidden>`
 * at 0.25 opacity with a top-to-transparent gradient overlay so the text
 * stays readable against any underlying artwork. Accent tone is hashed from
 * the persona id (stable across sessions).
 *
 * Connector chips row is a placeholder slot (see Phase 09+). The Persona
 * binding has no denormalized connector list; pulling `selectedPersona.tools`
 * on every tile would require per-id detail fetches which are explicitly out
 * of scope for v1 (see Plan 08-01 context). Row renders empty but reserves
 * the space so the last-run footer is always at the same height.
 */
function PersonaTile({ t, tFull, persona, lastRun }: PersonaTileProps) {
  const illustration = useIllustration(persona);
  const tone = toneForPersona(persona);
  const isActive = persona.enabled !== false;

  return (
    <article
      className={[
        'relative rounded-3xl border overflow-hidden aspect-[4/3]',
        `simple-accent-${tone}-border`,
        `simple-accent-${tone}-soft`,
      ].join(' ')}
    >
      <img
        src={illustration.url}
        aria-hidden
        alt=""
        className="simple-illustration absolute inset-0 w-full h-full object-cover pointer-events-none"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-transparent pointer-events-none" />

      <div className="relative h-full flex flex-col p-4">
        <div className="flex items-start justify-between">
          <span className="typo-data-lg" aria-hidden>
            {firstGrapheme(persona.icon ?? '') || '✨'}
          </span>
          <StatusBadge t={t} isActive={isActive} />
        </div>

        <div className="mt-auto space-y-1.5">
          <div className="typo-heading simple-display text-foreground truncate">
            {persona.name}
          </div>
          {/* Connector chips row — reserved, empty in v1. */}
          <div className="flex gap-1 flex-wrap min-h-[1px]" aria-hidden />
          <div className="flex items-center justify-between typo-caption text-foreground/60 border-t border-foreground/10 pt-1">
            <span className="italic">{t.tile_last_run_label}</span>
            <span className="text-foreground/80">{formatRelativeTime(lastRun, tFull)}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * Tri-state status badge: emerald "active" when enabled, rose "needs setup"
 * when disabled. Uses the palette tokens so light + dark themes both render
 * legibly against the illustration background.
 */
function StatusBadge({ t, isActive }: { t: TMap; isActive: boolean }) {
  const tone: Tone = isActive ? 'emerald' : 'rose';
  const label = isActive ? t.tile_active : t.tile_needs_setup;
  return (
    <span
      className={[
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full border typo-caption',
        `simple-accent-${tone}-border`,
        `simple-accent-${tone}-soft`,
        `simple-accent-${tone}-text`,
      ].join(' ')}
    >
      <span className={`w-1 h-1 rounded-full simple-accent-${tone}-solid`} aria-hidden />
      {label}
    </span>
  );
}

function CreateTile({ t, onClick }: { t: TMap; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative rounded-3xl border border-dashed border-foreground/20 bg-foreground/[0.02] hover:border-foreground/40 hover:bg-foreground/[0.04] transition-colors flex flex-col items-center justify-center gap-2 p-4 aspect-[4/3]"
    >
      <div className="w-10 h-10 rounded-2xl border border-foreground/20 flex items-center justify-center text-foreground/60">
        <Plus className="w-5 h-5" />
      </div>
      <div className="typo-body simple-display text-foreground/80">
        {t.create_assistant_tile_title}
      </div>
      <div className="typo-caption text-foreground/50 text-center">
        {t.create_assistant_tile_body}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Inbox feed (middle-right band)
// ---------------------------------------------------------------------------

interface InboxFeedProps {
  t: TMap;
  tFull: Translations;
  items: UnifiedInboxItem[];
  onRowClick: () => void;
}

/**
 * Right column of the middle band: "What's new" label + scrolling, newest-first
 * feed. Empty state is a centered "all caught up" card so the column never
 * looks broken — it always communicates state.
 */
function InboxFeed({ t, tFull, items, onRowClick }: InboxFeedProps) {
  return (
    <section className="flex flex-col min-h-0 bg-background/30">
      <div className="px-4 py-4 border-b border-foreground/10 shrink-0 flex items-center justify-between">
        <h2 className="typo-heading simple-display text-foreground">
          {t.console_inbox_feed_label}
        </h2>
        <span className="typo-caption italic text-foreground/50">
          {t.console_status_rail_live}
        </span>
      </div>
      {items.length === 0 ? (
        <EmptyFeed t={t} />
      ) : (
        <div className="flex-1 overflow-auto divide-y divide-foreground/5">
          {items.map((item) => (
            <InboxRow key={item.id} t={t} tFull={tFull} item={item} onClick={onRowClick} />
          ))}
        </div>
      )}
    </section>
  );
}

function EmptyFeed({ t }: { t: TMap }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-center">
      <div className="w-12 h-12 rounded-3xl border simple-accent-emerald-border simple-accent-emerald-soft flex items-center justify-center">
        <Check className="w-6 h-6 simple-accent-emerald-text" />
      </div>
      <div className="typo-body simple-display text-foreground">
        {t.console_empty_feed_title}
      </div>
      <div className="typo-caption text-foreground/60 max-w-xs">
        {t.console_empty_feed_body}
      </div>
    </div>
  );
}

interface InboxRowProps {
  t: TMap;
  tFull: Translations;
  item: UnifiedInboxItem;
  onClick: () => void;
}

function InboxRow({ t, tFull, item, onClick }: InboxRowProps) {
  const tone = toneForInbox(item);
  // Phase 09 will promote these to real per-item actions; for now they share
  // the row's fall-through to the Inbox tab but stop the row's onClick so the
  // button itself is visibly actionable (still routes to Inbox today).
  const onAction = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onClick();
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-foreground/[0.04] transition-colors"
    >
      <div
        className={[
          'w-7 h-7 rounded-2xl border flex items-center justify-center shrink-0',
          `simple-accent-${tone}-border`,
          `simple-accent-${tone}-soft`,
          `simple-accent-${tone}-text`,
        ].join(' ')}
      >
        <KindIcon kind={item.kind} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="typo-body simple-display text-foreground truncate">
          {item.title}
        </div>
        <div className="typo-caption text-foreground/55 flex items-center gap-1.5">
          <span className="italic truncate">{item.personaName}</span>
          <span className="text-foreground/30">·</span>
          <span className="shrink-0">{formatRelativeTime(item.createdAt, tFull)}</span>
        </div>
      </div>

      {item.kind === 'approval' ? (
        <QuickActionButton tone="amber" label={t.hero_cta_review} onClick={onAction} />
      ) : null}
      {item.severity === 'critical' && item.kind !== 'approval' ? (
        <QuickActionButton tone="rose" label={t.hero_cta_fix} onClick={onAction} />
      ) : null}
    </button>
  );
}

function KindIcon({ kind }: { kind: UnifiedInboxItem['kind'] }) {
  const cls = 'w-3.5 h-3.5';
  switch (kind) {
    case 'approval':
      return <ShieldCheck className={cls} />;
    case 'message':
      return <MessageSquare className={cls} />;
    case 'output':
      return <FileOutput className={cls} />;
    case 'health':
      return <Heart className={cls} />;
  }
}

function QuickActionButton({
  tone,
  label,
  onClick,
}: {
  tone: Tone;
  label: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'shrink-0 typo-caption px-2.5 py-1 rounded-full border',
        `simple-accent-${tone}-border`,
        `simple-accent-${tone}-soft`,
        `simple-accent-${tone}-text`,
        'hover:opacity-90 transition-opacity',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Connections strip (bottom band)
// ---------------------------------------------------------------------------

interface ConnectionsStripProps {
  t: TMap;
  credentials: CredentialMetadata[];
  onUnhealthy: () => void;
}

/**
 * Bottom band. Mirrors Mosaic's connections strip: one chip per credential
 * with ok/broken indicator; broken chips route to Power mode + credentials
 * page (Simple has no in-line credential editor in v1).
 */
function ConnectionsStrip({ t, credentials, onUnhealthy }: ConnectionsStripProps) {
  const shown = credentials.slice(0, 6);

  return (
    <footer className="px-6 py-3 border-t border-foreground/10 bg-background/60 flex items-center gap-4 shrink-0">
      <span className="typo-label uppercase tracking-wider text-foreground/40">
        {t.connections_strip_label}
      </span>
      <div className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto">
        {shown.map((c) => (
          <ConnectionChip key={c.id} t={t} cred={c} onUnhealthy={onUnhealthy} />
        ))}
        <button
          type="button"
          onClick={onUnhealthy}
          className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full border border-dashed border-foreground/20 typo-caption text-foreground/50 hover:text-foreground/80 hover:border-foreground/40 transition-colors"
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
  onUnhealthy,
}: {
  t: TMap;
  cred: CredentialMetadata;
  onUnhealthy: () => void;
}) {
  const isOk = cred.healthcheck_last_success === true;
  const needsRepair = cred.healthcheck_last_success === false;

  if (needsRepair) {
    return (
      <button
        type="button"
        onClick={onUnhealthy}
        className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full border simple-accent-rose-soft simple-accent-rose-border typo-caption simple-accent-rose-text"
        aria-label={t.connections_unhealthy}
      >
        <Plug className="w-3 h-3" />
        <span>{cred.name}</span>
        <AlertCircle className="w-3 h-3" />
      </button>
    );
  }

  return (
    <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-foreground/10 bg-foreground/[0.04] typo-caption text-foreground/80">
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

// Relative-time helper extracted to `../../utils/formatRelativeTime` in
// Phase 09 so the Inbox variant (Task 4) can render the same labels. See
// that file for bucketing rules.
