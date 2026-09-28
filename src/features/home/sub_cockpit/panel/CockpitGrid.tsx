import { useMemo } from 'react';

import type { CompanionCockpitWidget } from '@/api/companion';
import { KitHost, Tile, Tiles } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';

import { cockpitWidgetRegistry } from '../widgetRegistry';
import { parseWidgetActions } from '../briefing/actions';
import { WidgetActionBar } from '../briefing/WidgetActionBar';

/**
 * The Cockpit grid: the kit's Tiles (12 columns, content-sized rows, spans that
 * collapse by the grid's own width; the page scrolls, never a tile). Each widget
 * IS its Tile, a direct child of the grid, so the cell adds no wrapper.
 */
export function CockpitGrid({ label, widgets }: { label: string; widgets: CompanionCockpitWidget[] }) {
  return (
    <KitHost compact testId="cockpit-grid">
      {/* Transitional (home-2): a child that is not yet a kit Tile spans the row,
          so a widget mid-migration never lands in a one-column sliver. */}
      <div className="[&_.k-dtiles>:not(.k-dtile)]:col-span-12">
        <Tiles label={label}>
          {widgets.map((w) => (
            <CockpitWidgetCell key={w.id} widget={w} />
          ))}
        </Tiles>
      </div>
    </KitHost>
  );
}

/** One widget at Athena's column span, with the Morning Director's enum-validated
 *  actions (re-parsed here: never trust a stored/composed spec's raw shape)
 *  handed to it as its Tile footer. An unknown kind is an error Tile, never a gap. */
function CockpitWidgetCell({ widget }: { widget: CompanionCockpitWidget }) {
  const { t, tx } = useTranslation();
  const span = Math.max(1, Math.min(12, widget.span ?? 6));
  const Component = cockpitWidgetRegistry[widget.kind];
  const actions = useMemo(() => parseWidgetActions(widget.actions), [widget.actions]);
  if (!Component) {
    return <Tile span={span} error={{ title: tx(t.overview.cockpit.unknown_widget, { kind: widget.kind }) }} />;
  }
  const footer = actions.length > 0 ? <WidgetActionBar actions={actions} /> : undefined;
  return <Component title={widget.title} config={widget.config} span={span} footer={footer} />;
}
