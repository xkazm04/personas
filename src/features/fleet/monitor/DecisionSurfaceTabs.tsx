/**
 * Chips | Lanes in the Monitor header (spark mandate-lanes). The switch lived in
 * Settings > Admin, away from the surface it changes, and the operator reported
 * it "does not switch anything"; it now sits beside the view tabs, where the
 * change is seen the moment it is made. Every reader follows the store
 * (`useDecisionSurface`), so the board re-renders with no reload. It is a mode
 * switch, not a tab strip (no panel is swapped), so it is a pressed-button pair in
 * one rounded track, inked like the view pills beside it. Default stays
 * Chips until the owner approves Lanes for daily use (PLAN WP10).
 */
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';

type Surface = 'chips' | 'lanes';

export function DecisionSurfaceTabs() {
  const { t } = useTranslation();
  const m = t.monitor;
  const surface = useSystemStore((s) => s.decisionSurface);
  const setSurface = useSystemStore((s) => s.setDecisionSurface);
  const options: Array<{ id: Surface; label: string }> = [
    { id: 'chips', label: m.ml_setting_chips },
    { id: 'lanes', label: m.ml_setting_lanes },
  ];
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-full border border-primary/15 bg-secondary/20 p-0.5"
      role="group"
      aria-label={m.ml_setting_title}
      data-testid="decision-surface-switch"
    >
      {options.map((o) => {
        const on = surface === o.id;
        return (
          <Button
            key={o.id}
            variant="ghost"
            size="sm"
            aria-pressed={on}
            onClick={() => setSurface(o.id)}
            data-testid={`decision-surface-${o.id}`}
            className={`!rounded-full !py-0.5 typo-body-lg ${on ? 'bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary' : ''}`}
          >
            {o.label}
          </Button>
        );
      })}
    </div>
  );
}
