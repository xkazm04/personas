import { useMemo } from 'react';
import { Stack, Tile } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { CockpitWidgetProps } from '../widgetRegistry';
import { Cell, WidgetTable, nameCell, type TableColumn } from './widgetTable';

type Athena = ReturnType<typeof useTranslation>['t']['athena'];

/** The design-family ops registered in the dispatcher, in the order a design conversation meets them. */
const CAPS = ['walkthrough', 'templates', 'use_cases', 'triggers', 'tier', 'observability', 'decision_log', 'ready'] as const;

type Cap = (typeof CAPS)[number];

interface CapRow {
  cap: Cap;
  label: string;
  behavior: string;
  example: string;
}

function capText(a: Athena, cap: Cap): CapRow {
  const key = `design_cap_${cap}` as const;
  return { cap, label: a[`${key}_label`], behavior: a[`${key}_behavior`], example: a[`${key}_example`] };
}

/**
 * Onboarding card listing Athena's persona-design vocabulary. Mostly static: what changes between
 * emits is the optional `intro` Athena composes. The rows reflect the ops actually registered in
 * the dispatcher, so the user gets a true picture of "what can you help me design?" instead of a
 * model-generated capability list. Mirror CAPS when adding a design-family op.
 *
 * One kit Tile: the intro and the list are two regions of a kit Stack, and the list is ONE
 * `UnifiedTable` — the app's shared table (see `widgetTable.tsx`) — of the capability and the
 * prompt that triggers it. The second column used to be headed "Detail"; it now carries the head
 * it earned ("Try:"), so the cell no longer repeats that prefix on every row. What the op DOES is
 * the explanation, so it lives in the name's Hint (explanations off the surface).
 */
export function DesignCapabilitiesWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const a = t.athena;
  const intro = typeof config?.intro === 'string' ? config.intro.trim() : '';
  const rows = useMemo<CapRow[]>(() => CAPS.map((cap) => capText(a, cap)), [a]);
  const columns = useMemo<TableColumn<CapRow>[]>(() => [
    {
      key: 'label',
      label: a.design_cap_title,
      width: 'minmax(0, 1fr)',
      render: (row) => nameCell(row.label, undefined, row.behavior),
    },
    {
      key: 'example',
      label: a.design_cap_example_prefix,
      width: 'minmax(0, 1.6fr)',
      render: (row) => <Cell value={row.example} hint={row.example} />,
    },
  ], [a.design_cap_example_prefix, a.design_cap_title]);

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
        <WidgetTable<CapRow>
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.cap}
          emptyTitle={a.design_cap_title}
          label={a.design_cap_title}
          testId="companion-design-capabilities-table"
        />
      </Stack>
    </Tile>
  );
}
