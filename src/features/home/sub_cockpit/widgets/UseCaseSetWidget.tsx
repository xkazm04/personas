import { useMemo } from 'react';
import { ChipRow, Hint, ListRow, Rows, Stack, Tile, type RowColumn, type Tone } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { CockpitWidgetProps } from '../widgetRegistry';

interface UseCase {
  label: string;
  role: 'golden' | 'variant' | 'out_of_scope' | string;
  description: string;
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

/**
 * Inline chat-card Athena emits via `show_use_case_set { intent, use_cases }`: 3-5 proposed use
 * cases tagged Golden / Variant / Out-of-scope (the persona-design doctrine's decomposition;
 * a set with only golden cases breaks on its first edge-case input).
 *
 * One kit Tile. The roles are a count strip under the head (the tile's parent layer: how the set
 * splits), each case is one row whose mark carries its role, sorted golden, variant, out of
 * scope. The intent is not repeated here: the surface shows it once.
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

  const roleLabel: Record<Role, string> = {
    golden: t.athena.use_case_set_role_golden,
    variant: t.athena.use_case_set_role_variant,
    out_of_scope: t.athena.use_case_set_role_out_of_scope,
  };
  const heading = title || t.athena.use_case_set_title;
  const c = t.overview.cockpit;
  const columns: RowColumn[] = [{ head: c.col_detail, width: '1.6fr' }];
  const rank = (r: string) => ROLES.findIndex((x) => x.role === roleOf(r));
  const ordered = [...useCases].sort((a, b) => rank(a.role) - rank(b.role));
  const chips = ROLES.map(({ role, tone }) => ({
    id: role,
    label: <span className="k-cap inline-block">{roleLabel[role]}</span>,
    count: useCases.filter((u) => roleOf(u.role) === role).length,
    tone,
    glyph: 'soft' as const,
  })).filter((c) => c.count > 0);

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
        <Rows count={ordered.length} empty={{ title: t.athena.use_case_set_empty }} columns={columns} nameHead={c.col_use_case}>
          {ordered.map((uc, i) => {
            const role = roleOf(uc.role);
            const tone = ROLES.find((x) => x.role === role)?.tone ?? 'info';
            return (
              <ListRow
                key={`${uc.role}-${i}-${uc.label}`}
                size="line"
                name={uc.label}
                mark={{ tone, glyph: 'soft', label: roleLabel[role] }}
                cells={[uc.description ? <Hint key="d" content={uc.description}><span>{uc.description}</span></Hint> : null]}
              />
            );
          })}
        </Rows>
      </Stack>
    </Tile>
  );
}
