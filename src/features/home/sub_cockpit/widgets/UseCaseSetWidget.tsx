import { useMemo } from 'react';
import { ChipRow, Stack, Tile, type Tone } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { CockpitWidgetProps } from '../widgetRegistry';
import { Cell, WidgetTable, nameCell, type TableColumn } from './widgetTable';

interface UseCase {
  label: string;
  role: 'golden' | 'variant' | 'out_of_scope' | string;
  description: string;
}

interface UseCaseRow extends UseCase {
  key: string;
}

type Role = 'golden' | 'variant' | 'out_of_scope';

/** The role's place in the reading order and its tone: golden first, what to refuse last. */
const ROLES: ReadonlyArray<{ role: Role; tone: Tone }> = [
  { role: 'golden', tone: 'success' },
  { role: 'variant', tone: 'info' },
  { role: 'out_of_scope', tone: 'neutral' },
];

function roleOf(role: string): Role {
  return role === 'golden' || role === 'out_of_scope' ? role : 'variant';
}

function toneOf(role: string): Tone {
  return ROLES.find((x) => x.role === roleOf(role))?.tone ?? 'info';
}

/**
 * Inline chat-card Athena emits via `show_use_case_set { intent, use_cases }`: 3-5 proposed use
 * cases tagged Golden / Variant / Out-of-scope (the persona-design doctrine's decomposition;
 * a set with only golden cases breaks on its first edge-case input).
 *
 * One kit Tile. The roles are a count strip under the head (the tile's parent layer: how the set
 * splits), then ONE `UnifiedTable` — the app's shared table (see `widgetTable.tsx`) — of the cases
 * sorted golden, variant, out of scope, each row's role its left accent and its description the
 * column beside it. The intent is not repeated here: the surface shows it once.
 */
export function UseCaseSetWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const useCases = useMemo<UseCase[]>(() => {
    const raw = config?.use_cases;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((u): u is Record<string, unknown> => typeof u === 'object' && u !== null)
      .map((u) => ({
        label: typeof u.label === 'string' ? u.label : '',
        role: typeof u.role === 'string' ? (u.role as UseCase['role']) : 'variant',
        description: typeof u.description === 'string' ? u.description : '',
      }))
      .filter((u) => u.label.length > 0);
  }, [config]);

  const roleLabel = useMemo<Record<Role, string>>(() => ({
    golden: t.athena.use_case_set_role_golden,
    variant: t.athena.use_case_set_role_variant,
    out_of_scope: t.athena.use_case_set_role_out_of_scope,
  }), [t.athena.use_case_set_role_golden, t.athena.use_case_set_role_out_of_scope, t.athena.use_case_set_role_variant]);
  const heading = title || t.athena.use_case_set_title;
  const c = t.overview.cockpit;
  const rank = (r: string) => ROLES.findIndex((x) => x.role === roleOf(r));
  const ordered: UseCaseRow[] = [...useCases]
    .sort((a, b) => rank(a.role) - rank(b.role))
    .map((uc, i) => ({ ...uc, key: `${uc.role}-${i}-${uc.label}` }));
  const chips = ROLES.map(({ role, tone }) => ({
    id: role,
    label: <span className="k-cap inline-block">{roleLabel[role]}</span>,
    count: useCases.filter((u) => roleOf(u.role) === role).length,
    tone,
    glyph: 'soft' as const,
  })).filter((chip) => chip.count > 0);

  const columns = useMemo<TableColumn<UseCaseRow>[]>(() => [
    {
      key: 'label',
      label: c.col_use_case,
      width: 'minmax(0, 1fr)',
      render: (uc) => nameCell(uc.label, roleLabel[roleOf(uc.role)], uc.label),
    },
    {
      key: 'description',
      label: t.common.description,
      width: 'minmax(0, 1.6fr)',
      render: (uc) => <Cell value={uc.description} hint={uc.description} />,
    },
  // `roleLabel` is rebuilt from `t` every render, so `t` is the honest identity for both columns.
  ], [c.col_use_case, roleLabel, t]);

  return (
    <Tile
      span={span}
      title={heading}
      count={useCases.length || undefined}
      actions={actions}
      footer={footer}
      state={useCases.length === 0 ? 'empty' : undefined}
      empty={{ title: t.athena.use_case_set_empty }}
      testId="companion-use-case-set-widget"
    >
      <Stack gap="s">
        <ChipRow chips={chips} label={heading} emptyLabel={t.athena.use_case_set_empty} />
        <WidgetTable<UseCaseRow>
          columns={columns}
          rows={ordered}
          getRowKey={(uc) => uc.key}
          rowTone={(uc) => toneOf(uc.role)}
          emptyTitle={t.athena.use_case_set_empty}
          label={heading}
          testId="companion-use-case-set-table"
        />
      </Stack>
    </Tile>
  );
}
