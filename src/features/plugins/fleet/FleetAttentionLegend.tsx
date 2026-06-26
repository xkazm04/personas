import { useTranslation } from '@/i18n/useTranslation';

/**
 * Compact, always-visible legend for the grid tile *border* colours
 * (`fleetAttention.ts` → `attentionClass`). Distinct from `FleetStatusLegend`,
 * which is a hover disclosure decoding the two-axis status *dots* — this one
 * decodes the pulsing tile borders an operator sees on the grid at a glance:
 * violet = needs you, light blue = Athena's on it, amber = stale, red = errored.
 * A plain (un-pulsing) border = healthy/running, so it needs no swatch.
 *
 * Swatch colours mirror the `.fleet-attn-*` rgba values in `globals.css` so the
 * legend can never drift from the actual borders. Reuses existing i18n keys
 * (no new strings → no locale gap).
 */
export function FleetAttentionLegend() {
  const { t } = useTranslation();
  const items = [
    { color: 'rgba(167, 139, 250, 0.85)', label: t.plugins.fleet.dot_biz_awaiting }, // violet — needs you
    { color: 'rgba(56, 189, 248, 0.85)', label: t.plugins.fleet.athena_label }, // light blue — Athena's on it
    { color: 'rgba(251, 191, 36, 0.85)', label: t.plugins.fleet.state_stale }, // amber — stale
    { color: 'rgba(239, 68, 68, 0.85)', label: t.common.error }, // red — errored exit
  ];
  return (
    <ul
      data-testid="fleet-attention-legend"
      aria-label={t.plugins.fleet.legend_show}
      // Hidden on the narrowest widths so the header buttons keep priority.
      className="ml-3 hidden items-center gap-3 lg:flex"
    >
      {items.map(({ color, label }) => (
        <li key={label} className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
          <span className="typo-caption text-foreground/80">{label}</span>
        </li>
      ))}
    </ul>
  );
}
