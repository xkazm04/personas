import { useSystemStore } from '@/stores/systemStore';
import { isSafeTourTestId } from '@/stores/slices/system/tourSlice';

/**
 * Re-summon the spotlight for a target - scroll it into view and re-pulse the
 * cut-out.
 *
 * Guarded to only fire when the element is actually mounted: re-firing at a
 * missing testid would trip TourSpotlight's onMissing handler and flag the tour
 * as pointing at nothing, so an off-screen target is a no-op rather than a risk.
 *
 * Shared by the rail (`TourPanelBody` locate buttons) and the narrative deck's
 * "Show me" control, which is why it lives outside both.
 */
export function focusTourHighlight(testId: string | null | undefined): void {
  if (!testId || !isSafeTourTestId(testId)) return;
  const el = document.querySelector(`[data-testid="${testId}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // Setting the same value is a Zustand no-op, so clear then re-set on the next
  // tick to force the spotlight to re-measure and pulse around the element.
  const setHighlight = useSystemStore.getState().setHighlightTestId;
  setHighlight(null);
  window.setTimeout(() => setHighlight(testId), 60);
}
