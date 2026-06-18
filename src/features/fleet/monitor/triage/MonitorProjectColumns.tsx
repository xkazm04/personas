// Variant 2 — PROJECT COLUMNS.
//
// A column per team/dev project (goal 3) for a complete project overview at a
// glance: each column carries the team's active goals (preview data) and the
// personas in that team that need manual attention (goal 1 — actionable only;
// goal 2 — initials glyph, no status caption). Personas with no home team get
// their own "No team" column. Horizontal-scrolling board.

import { memo, useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Target, CheckCircle2, Layers } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { colorWithAlpha } from '@/lib/utils/colorWithAlpha';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import { primaryDrawerSection, healthSegments, HEALTH_TONE_CLASS, type PersonaCardModel, type DrawerSection } from '../monitorModel';
import { PersonaGlyph } from './PersonaGlyph';
import {
  actionBadges, isActionable, actionWeight, mockGoalsForGroup, COPY,
  type ActionBadge, type MockGoal,
} from './triageModel';

interface Props {
  cards: PersonaCardModel[];
  personas: Persona[];
  teams: PersonaTeam[];
  selectedPersonaId: string | null;
  onSelect: (personaId: string, section: DrawerSection) => void;
}

interface Column { id: string; name: string; color: string; cards: PersonaCardModel[]; goals: MockGoal[] }

function badgeAria(t: ReturnType<typeof useTranslation>['t'], tx: ReturnType<typeof useTranslation>['tx'], b: ActionBadge): string {
  switch (b.key) {
    case 'review': return tx(t.monitor.open_reviews_with_count, { count: b.count });
    case 'message': return tx(t.monitor.open_messages_with_count, { count: b.count });
    case 'input': return t.monitor.status_input_required;
    case 'draft': return t.monitor.status_draft_ready;
    case 'failed': return t.monitor.last_failed;
  }
}

const HEALTH_LINE_LENGTH = 7;

function AttentionRow({ card, selected, reducedMotion, onSelect, t, tx }: {
  card: PersonaCardModel; selected: boolean; reducedMotion: boolean;
  onSelect: (id: string, s: DrawerSection) => void;
  t: ReturnType<typeof useTranslation>['t']; tx: ReturnType<typeof useTranslation>['tx'];
}) {
  const failed = card.execState === 'failed';
  const running = card.running > 0;
  const segs = card.totalRecent > 0 ? healthSegments(card, HEALTH_LINE_LENGTH) : null;
  // Thin recent-run line: a bar per run (success/fail/other), no percentage.
  const lineChildren = segs
    ? segs.map((tone, i) => <span key={i} className={`flex-1 ${HEALTH_TONE_CLASS[tone]}`} />)
    : <span className="flex-1 bg-primary" />;
  const lineClass = 'pointer-events-none absolute inset-x-0 top-0 flex h-[2px] gap-px';

  return (
    <button
      type="button"
      onClick={() => onSelect(card.personaId, primaryDrawerSection(card))}
      title={card.personaName}
      className={`relative flex w-full items-center gap-2 overflow-hidden rounded-interactive border px-2 pb-1.5 pt-2 text-left transition-colors ${
        failed
          ? 'border-red-500/35 bg-red-500/[0.1] hover:bg-red-500/[0.16]'
          : selected
            ? 'border-primary/45 bg-secondary/40 ring-1 ring-primary/40'
            : 'border-primary/10 bg-secondary/25 hover:bg-secondary/50'
      }`}
    >
      {/* Recent-run health line; pulses while the persona is actively running. */}
      {(segs || running) && (running && !reducedMotion ? (
        <motion.span aria-hidden className={lineClass} animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.9, repeat: Infinity, ease: 'easeInOut' }}>
          {lineChildren}
        </motion.span>
      ) : (
        <span aria-hidden className={lineClass}>{lineChildren}</span>
      ))}
      <PersonaGlyph icon={card.personaIcon} color={card.personaColor} name={card.personaName} size="sm" />
      <span className="typo-caption font-medium truncate text-foreground flex-1">{card.personaName}</span>
      <span className="flex flex-shrink-0 items-center gap-1">
        {actionBadges(card).map((b) => (
          <span key={b.key} title={badgeAria(t, tx, b)} className={`inline-flex items-center gap-0.5 rounded-full border px-1 py-0.5 typo-caption font-medium ${b.tone}`}>
            <b.icon className="h-2.5 w-2.5" />
            {b.count > 0 && <span className="tabular-nums">{b.count}</span>}
          </span>
        ))}
      </span>
    </button>
  );
}

function MonitorProjectColumnsImpl({ cards, personas, teams, selectedPersonaId, onSelect }: Props) {
  const { t, tx } = useTranslation();
  const reducedMotion = useReducedMotion() ?? false;

  const columns = useMemo<Column[]>(() => {
    const teamOf = new Map<string, string | null>();
    const rosterTeams = new Set<string>();
    for (const p of personas) {
      teamOf.set(p.id, p.home_team_id ?? null);
      if (p.home_team_id) rosterTeams.add(p.home_team_id);
    }
    // Show personas that need the user (actionable) AND those actively running
    // (so the overview reflects live work — running rows pulse, goal 2).
    const attentionByTeam = new Map<string, PersonaCardModel[]>();
    for (const c of cards.filter((card) => isActionable(card) || card.running > 0)) {
      const key = teamOf.get(c.personaId) ?? '__ungrouped__';
      (attentionByTeam.get(key) ?? attentionByTeam.set(key, []).get(key)!).push(c);
    }
    const cols: Column[] = teams
      .filter((tm) => rosterTeams.has(tm.id))
      .map((tm) => ({ id: tm.id, name: tm.name, color: tm.color, cards: attentionByTeam.get(tm.id) ?? [], goals: mockGoalsForGroup(tm.id) }))
      .sort((a, b) => sumWeight(b.cards) - sumWeight(a.cards) || a.name.localeCompare(b.name));
    const ungrouped = attentionByTeam.get('__ungrouped__') ?? [];
    if (ungrouped.length > 0) cols.push({ id: '__ungrouped__', name: COPY.noTeam, color: '#6b7280', cards: ungrouped, goals: [] });
    return cols;
  }, [cards, personas, teams]);

  if (columns.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <Layers className="h-8 w-8 text-foreground" />
        <span className="typo-body text-foreground">{COPY.actionEmpty}</span>
      </div>
    );
  }

  return (
    <div className="flex h-full gap-3 overflow-x-auto pb-2">
      {columns.map((col) => (
        <section
          key={col.id}
          className="flex w-[288px] flex-shrink-0 flex-col rounded-card border border-primary/10 bg-secondary/15"
          style={{ borderTop: `2px solid ${colorWithAlpha(col.color, 0.85)}` }}
        >
          {/* Column header */}
          <header className="flex items-center gap-2 px-3 py-2">
            <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: col.color }} />
            <span className="typo-heading font-semibold truncate text-foreground">{col.name}</span>
            {col.cards.length > 0 && (
              <span className="ml-auto rounded-full bg-secondary/60 px-1.5 py-0.5 typo-caption text-foreground tabular-nums">
                {COPY.attentionCount(col.cards.length)}
              </span>
            )}
          </header>

          <div className="flex-1 min-h-0 space-y-3 overflow-y-auto px-2.5 pb-3">
            {/* Active goals (preview) — only for real teams */}
            {col.goals.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 px-0.5">
                  <Target className="h-3 w-3 text-foreground" />
                  <span className="typo-caption uppercase tracking-wider text-foreground">{COPY.activeGoals}</span>
                  <span className="rounded-full border border-primary/15 px-1 py-px typo-caption text-foreground">{COPY.goalsPreview}</span>
                </div>
                {col.goals.map((g, i) => (
                  <div key={i} className="rounded-interactive border border-primary/8 bg-background/40 px-2 py-1.5">
                    <span className="typo-caption text-foreground line-clamp-1">{g.title}</span>
                    <div className="mt-1 flex items-center gap-1.5">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-secondary/50">
                        <div className="h-full rounded-full" style={{ width: `${g.progress}%`, backgroundColor: colorWithAlpha(col.color, 0.9) }} />
                      </div>
                      <span className="typo-caption text-foreground tabular-nums">{g.progress}%</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Needs attention */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 px-0.5">
                <span className="typo-caption uppercase tracking-wider text-foreground">{COPY.needsAttention}</span>
              </div>
              {col.cards.length === 0 ? (
                <div className="flex items-center gap-1.5 rounded-interactive border border-primary/8 px-2 py-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-status-success/70" />
                  <span className="typo-caption text-foreground">{COPY.allClear}</span>
                </div>
              ) : (
                col.cards.map((card) => (
                  <AttentionRow
                    key={card.personaId}
                    card={card}
                    selected={card.personaId === selectedPersonaId}
                    reducedMotion={reducedMotion}
                    onSelect={onSelect}
                    t={t}
                    tx={tx}
                  />
                ))
              )}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}

function sumWeight(cards: PersonaCardModel[]): number {
  let n = 0;
  for (const c of cards) n += actionWeight(c);
  return n;
}

export const MonitorProjectColumns = memo(MonitorProjectColumnsImpl);
export default MonitorProjectColumns;
