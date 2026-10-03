import { Hint, ListRow, Rows, Stack, Tile, type RowColumn } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { CockpitWidgetProps } from '../widgetRegistry';

type Athena = ReturnType<typeof useTranslation>['t']['athena'];

/** The design-family ops registered in the dispatcher, in the order a design conversation meets them. */
const CAPS = ['walkthrough', 'templates', 'use_cases', 'triggers', 'tier', 'observability', 'decision_log', 'ready'] as const;

function capText(a: Athena, cap: (typeof CAPS)[number]): { label: string; behavior: string; example: string } {
  const key = `design_cap_${cap}` as const;
  return { label: a[`${key}_label`], behavior: a[`${key}_behavior`], example: a[`${key}_example`] };
}

/**
 * Onboarding card listing Athena's persona-design vocabulary. Mostly static: what changes between
 * emits is the optional `intro` Athena composes. The rows reflect the ops actually registered in
 * the dispatcher, so the user gets a true picture of "what can you help me design?" instead of a
 * model-generated capability list. Mirror CAPS when adding a design-family op.
 *
 * One kit Tile: the intro and the list are two regions of a kit Stack, and one row per capability
 * with the name as the one emphasis and the prompt that triggers it in a declared Detail column
 * beside it (kit grow-4) rather than stacked under it; what the op does is the explanation, so it
 * lives in the name's Hint (explanations off the surface). The list draws no name head: the tile's
 * own title already says what its rows are.
 */
export function DesignCapabilitiesWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const a = t.athena;
  const intro = typeof config?.intro === 'string' ? config.intro.trim() : '';
  const columns: RowColumn[] = [{ head: t.overview.cockpit.col_detail, width: '1.6fr' }];

  return (
    <Tile
      span={span}
      title={title || a.design_cap_title}
      actions={actions}
      footer={footer}
      testId="companion-design-capabilities-widget"
    >
      <Stack gap="s">
        {intro && <p className="k-in typo-body m-0" data-testid="design-capabilities-intro">{intro}</p>}
        <Rows count={CAPS.length} empty={{ title: '' }} columns={columns}>
          {CAPS.map((cap) => {
            const row = capText(a, cap);
            const example = `${a.design_cap_example_prefix} ${row.example}`;
            return (
              <ListRow
                key={cap}
                size="line"
                testId={`design-capability-${cap}`}
                name={<Hint content={row.behavior}><span>{row.label}</span></Hint>}
                cells={[<Hint key="e" content={example}><span>{example}</span></Hint>]}
              />
            );
          })}
        </Rows>
      </Stack>
    </Tile>
  );
}
