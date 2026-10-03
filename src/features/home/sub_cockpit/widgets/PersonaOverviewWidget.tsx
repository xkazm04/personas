/**
 * PersonaOverviewWidget: one kit Tile that LEADS with a featured persona and
 * lists the rest of the roster under it.
 *
 * Athena composes this widget when she wants to point the user at a specific
 * persona ("here's the one to look at, and here's why"). The featured persona
 * is a compact head (a large row on the spine with its Open action, its
 * description, then its trust / budget / max-turns strip); every other persona
 * is a pressable row under it, capped with an in-place "Show all" because a
 * real roster holds forty.
 *
 * The two regions are a kit `Stack divided` (grow-4): the featured block and the roster are
 * different things and a quiet rule on the band's reading line says so, which the bare stack of
 * siblings never did (owner, 2026-10-03: "components inside are flying empty without subtle
 * dividers or structure"). The roster is ONE `UnifiedTable` - the app's shared table (see
 * `widgetTable.tsx`), the owner's 2026-10-03 ruling that it wins everywhere - with named columns
 * the rows fill: description, model, state, trust. A persona's metadata spreads across the band
 * instead of stacking under its name and leaving the rest of a 1920 row empty.
 *
 * Config:
 *   { "limit": N, "filter": "active" | "all", "hero": "persona_id"? }
 *   - `limit` is how many roster rows show before "Show all" (3 to 8).
 *   - `hero` pins a specific persona as the featured one; otherwise the picker
 *     prefers `setup_status === 'ready'` then most-recent.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ArrowRight } from 'lucide-react';

import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { Hint, KitButton, ListRow, Meta, Stack, StatStrip, Tile, type Glyph, type Tone } from '@/features/shared/components/kit';
import type { Persona } from '@/lib/bindings/Persona';
import { silentCatch } from '@/lib/silentCatch';
import { formatCost, formatRelativeTime } from '@/lib/utils/formatters';

import type { CockpitWidgetProps } from '../widgetRegistry';
import { attentionFor, modelTierLabel, recentActivity, trustPercent, trustToneFor, type TrustTone } from './personaStats';
import { Cell, WidgetTable, nameCell, type TableColumn } from './widgetTable';

type Translations = ReturnType<typeof useTranslation>['t'];

const TRUST_TONE: Record<TrustTone, Tone> = { good: 'success', warn: 'warning', bad: 'error' };

/** A persona's state as one Tone x Glyph on the spine; setup reads info-blue (Gate 5). */
function personaMark(p: Persona, t: Translations): { tone: Tone; glyph: Glyph; label: string } {
  const flag = attentionFor(p);
  const c = t.overview.cockpit;
  if (flag?.kind === 'setup') return { tone: 'info', glyph: 'hollow', label: c.default_attention_setup };
  if (flag?.kind === 'disabled') return { tone: 'neutral', glyph: 'hollow', label: c.default_attention_paused };
  if (flag?.kind === 'low_trust') return { tone: 'error', glyph: 'solid', label: c.default_attention_low_trust };
  return { tone: 'success', glyph: 'soft', label: t.overview.health.healthy };
}

function openPersona(id: string) {
  useSystemStore.getState().setSidebarSection('personas');
  useAgentStore.getState().selectPersona(id);
}

export function PersonaOverviewWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const cap = Math.min(8, Math.max(3, Number(config?.limit) || 6));
  const filter = ((config?.filter as string) ?? 'active') === 'all' ? 'all' : 'active';
  const heroId = config?.hero as string | undefined;

  const { personas, fetchPersonas } = useAgentStore(
    useShallow((s) => ({ personas: s.personas, fetchPersonas: s.fetchPersonas })),
  );
  // Fetch-if-empty exactly once: an empty fleet re-produces the guard state
  // (fresh [] identity per fetch), which looped fetchPersonas indefinitely.
  const personasRequestedRef = useRef(false);
  useEffect(() => {
    if ((!personas || personas.length === 0) && !personasRequestedRef.current) {
      personasRequestedRef.current = true;
      fetchPersonas().catch(silentCatch('cockpit_persona_overview_fetch_personas'));
    }
  }, [personas, fetchPersonas]);

  const ranked = useMemo(() => {
    const arr = personas ?? [];
    const filtered = filter === 'active' ? arr.filter((p) => p.enabled !== false) : arr;
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
  const rest = ranked.slice(1);
  const heading = title ?? t.athena.persona_overview_eyebrow_default;

  if (!hero) {
    return <Tile span={span} title={heading} actions={actions} footer={footer} state="empty" empty={{ title: t.athena.persona_overview_empty }} />;
  }

  const c = t.overview.cockpit;
  // The description column answers to the TILE'S SPAN, measured on both shots rather than reasoned
  // about. It was the "Detail" column the owner removed by name on 2026-10-03; on the 5-span roster
  // of `home/cockpit` keeping it cost the row its ONE emphasis (five tracks in ~590px truncated the
  // persona's NAME to "Release..." while its description read "Release Notes ..."), and dropping it
  // on the 12-span roster of `composed-a` opened ~900px of empty band between the name and Model -
  // the owner's other recorded complaint. So a narrow roster says who, how, how healthy and how
  // trusted, and a wide one lets the description take the slack. This is what the kit column's
  // `collapse` did, driven by the span the composer declared instead of by a container query.
  const wide = (span ?? 12) >= 8;
  const columns: TableColumn<Persona>[] = [
    {
      key: 'name',
      label: c.col_persona,
      width: wide ? 'minmax(0, 1fr)' : 'minmax(0, 1.6fr)',
      render: (p) => nameCell(p.name, personaMark(p, t).label, p.name),
    },
    ...(wide ? [{
      key: 'description',
      label: t.common.description,
      width: 'minmax(0, 1.6fr)',
      render: (p: Persona) => <Cell value={p.description} hint={p.description} />,
    }] : []),
    {
      key: 'model',
      label: t.common.model_label,
      width: wide ? 'minmax(0, 7rem)' : 'minmax(0, 1fr)',
      render: (p) => <Cell value={modelTierLabel(p.model_profile)} />,
    },
    {
      key: 'state',
      label: t.common.status,
      width: wide ? 'minmax(0, 9rem)' : 'minmax(0, 1fr)',
      render: (p) => {
        const mark = personaMark(p, t);
        return <Cell value={mark.label} tone={mark.tone} />;
      },
    },
    {
      key: 'trust',
      label: c.col_trust,
      width: 'minmax(0, 5rem)',
      align: 'right' as const,
      render: (p) => <Cell value={`${trustPercent(p.trust_score).pct}%`} data />,
    },
  ];
  return (
    <Tile span={span} title={heading} count={ranked.length} actions={actions} footer={footer} testId="cockpit-persona-overview">
      <Stack divided>
        <FeaturedPersona persona={hero} />
        {rest.length > 0 && (
          <WidgetTable<Persona>
            columns={columns}
            rows={rest}
            getRowKey={(p) => p.id}
            rowTone={(p) => personaMark(p, t).tone}
            onRowClick={(p) => openPersona(p.id)}
            emptyTitle={t.athena.persona_overview_empty}
            label={t.athena.persona_overview_rest_heading}
            cap={cap}
            testId="cockpit-persona-overview-table"
          />
        )}
      </Stack>
    </Tile>
  );
}

/** The featured persona: its row on the spine with Open, its description, its figures. */
function FeaturedPersona({ persona }: { persona: Persona }) {
  const { t, tx } = useTranslation();
  const trust = trustPercent(persona.trust_score);
  const trustTone = TRUST_TONE[trust.overflow ? 'warn' : trustToneFor(persona.trust_level, persona.trust_score)];
  const mark = personaMark(persona, t);
  const trustValue = <span className={`k-toned t-${trustTone}`}>{trust.pct}%</span>;
  const budget = persona.max_budget_usd == null
    ? null
    : persona.max_budget_usd <= 0
      ? t.deployment.deployments_panel.budget_no_limit
      : formatCost(persona.max_budget_usd);
  return (
    <Stack gap="s">
      <ListRow
        size="l"
        name={persona.name}
        nameClass="typo-heading k-strong"
        mark={mark}
        meta={
          <Meta
            parts={[
              modelTierLabel(persona.model_profile),
              attentionFor(persona) ? <span className={`k-toned t-${mark.tone}`}>{mark.label}</span> : null,
              recentActivity(persona.updated_at)
                ? tx(t.athena.persona_overview_active_relative, { when: formatRelativeTime(persona.updated_at) })
                : null,
            ]}
          />
        }
        figures={
          <KitButton onClick={() => openPersona(persona.id)} icon={<ArrowRight />} testId="cockpit-persona-overview-open">
            {t.athena.persona_overview_open_short}
          </KitButton>
        }
      />
      {persona.description && <p className="k-in typo-body m-0">{persona.description}</p>}
      <StatStrip
        tiles={[
          {
            label: t.athena.persona_overview_kpi_trust,
            value: trust.overflow
              ? <Hint content={t.athena.persona_overview_kpi_trust_clamped} focusable>{trustValue}</Hint>
              : trustValue,
          },
          { label: t.athena.persona_overview_kpi_budget, value: budget },
          { label: t.athena.persona_overview_kpi_max_turns, value: persona.max_turns ?? null },
        ]}
      />
    </Stack>
  );
}
