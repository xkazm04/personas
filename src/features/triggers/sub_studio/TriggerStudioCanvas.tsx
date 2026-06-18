/**
 * Chain Studio — a single unified routing surface.
 *
 * **Compose** (the Switchboard patch-bay) is the primary view: arm a source +
 * a target → a route; Save commits it as a real trigger / system-op automation.
 * Below it, a collapsible **Existing routes** section embeds the live,
 * event-centric inventory (read + manage: add-listener, disconnect, rename) —
 * the view formerly hosted in a separate "Routes" sub-tab, now folded in so
 * there is one Studio surface. Committing a route in Compose refreshes the
 * inventory so the new route appears immediately.
 *
 * The export keeps its historical name so the lazy import in TriggersPage stays
 * stable (the React Flow canvas it once hosted was retired in June 2026; the
 * Compose/Routes sub-tab split was retired when Routes folded into Compose).
 * See docs/plans/studio-supersedes-builder.md.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Network } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { listAllTriggers } from '@/api/pipeline/triggers';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import { silentCatch } from '@/lib/silentCatch';
import { StudioSwitchboard } from './StudioSwitchboard';
import { EventCanvas } from './routing/EventCanvas';

export function TriggerStudioCanvas() {
  const { t } = useTranslation();
  const st = t.triggers.studio;
  const [triggers, setTriggers] = useState<PersonaTrigger[]>([]);
  const [headerExtra, setHeaderExtra] = useState<ReactNode>(null);
  const [rowCount, setRowCount] = useState<number | null>(null);
  const [showRoutes, setShowRoutes] = useState(false);

  const loadTriggers = useCallback(() => {
    listAllTriggers()
      .then(setTriggers)
      .catch(silentCatch('features/triggers/sub_studio/TriggerStudioCanvas:load'));
  }, []);

  useEffect(() => { loadTriggers(); }, [loadTriggers]);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* Compose — the patch-bay. Full height while Existing routes is collapsed. */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <StudioSwitchboard onRouteCommitted={loadTriggers} />
      </div>

      {/* Existing routes — live inventory + inline management, collapsible. */}
      <div className="flex-shrink-0 border-t border-border px-4 md:px-6 py-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setShowRoutes((v) => !v)}
          aria-expanded={showRoutes}
          className="flex items-center gap-2 typo-heading text-foreground hover:text-primary transition-colors"
        >
          {showRoutes ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <Network className="w-4 h-4" />
          {st.existing_routes}
          {rowCount !== null && <span className="typo-data text-foreground">{rowCount}</span>}
        </button>
        {showRoutes && <div className="ml-auto min-w-0 overflow-x-auto">{headerExtra}</div>}
      </div>

      {/* Inventory kept mounted (hidden when collapsed) so the count + filter
          state persist and re-expanding is instant. */}
      <div className={showRoutes ? 'flex-1 min-h-0 flex flex-col overflow-hidden' : 'hidden'}>
        <EventCanvas allTriggers={triggers} setHeaderExtra={setHeaderExtra} onRowCount={setRowCount} />
      </div>
    </div>
  );
}
