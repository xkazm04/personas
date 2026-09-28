import { Hint, ListRow, Rows, Tile } from '@/features/shared/components/kit';
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
 * One kit Tile: the intro as its lead line, one row per capability with the name as the one
 * emphasis and the prompt that triggers it as the meta ("Try: ..."); what the op does is the
 * explanation, so it lives in the name's Hint (explanations off the surface).
 */
export function DesignCapabilitiesWidget({ config, title, span, actions, footer }: CockpitWidgetProps) {
  const { t } = useTranslation();
  const a = t.athena;
  const intro = typeof config?.intro === 'string' ? config.intro.trim() : '';

  return (
    <Tile
      span={span}
      title={title || a.design_cap_title}
      actions={actions}
      footer={footer}
      testId="companion-design-capabilities-widget"
    >
      {intro && <p className="k-in typo-body pb-2" data-testid="design-capabilities-intro">{intro}</p>}
      <Rows count={CAPS.length} empty={{ title: '' }}>
        {CAPS.map((cap) => {
          const row = capText(a, cap);
          const example = `${a.design_cap_example_prefix} ${row.example}`;
          return (
            <ListRow
              key={cap}
              size="s"
              testId={`design-capability-${cap}`}
              name={<Hint content={row.behavior}><span>{row.label}</span></Hint>}
              meta={<Hint content={example}><span className="k-ellipsis">{example}</span></Hint>}
            />
          );
        })}
      </Rows>
    </Tile>
  );
}
