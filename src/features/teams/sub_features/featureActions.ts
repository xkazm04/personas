// The page's three writes, kept out of the page.
//
// `deleteScenario` is an IRREVERSIBLE door: the scenario and every result that
// judged it go. The consent for it lives on the panel that owns the affordance
// (`ScenariosPanel`'s `ConfirmDialog`), and the IPC call lives here, so no
// rendering component imports a delete door it does not itself gate
// (`docs/concepts/golden-paths/informed-consent-gate.md`).
//
// Each one refetches the board on success, because the board is the page's ONE
// read and a write that does not invalidate it leaves the screen lying.
import { setUseCaseTier, type UseCaseTier } from '@/api/devTools/council';
import { deleteScenario, upsertScenario } from '@/api/devTools/features';
import type { UpsertScenarioInput } from '@/lib/bindings/UpsertScenarioInput';
import { toastCatch } from '@/lib/silentCatch';

/** Create or update one branch, then refetch. */
export async function saveScenario(input: UpsertScenarioInput, refresh: () => void): Promise<void> {
  await upsertScenario(input)
    .then(() => refresh())
    .catch(toastCatch('features:upsertScenario'));
}

/** Remove one branch and the results that judged it. The CALLER has already
 *  taken the person's consent; this only performs it. */
export async function removeScenario(id: string, refresh: () => void): Promise<void> {
  await deleteScenario(id)
    .then(() => refresh())
    .catch(toastCatch('features:deleteScenario'));
}

/** Flip a feature between the tiers. Only `major` reaches the human gate, so
 *  this is the one control that changes whose move a feature is on. */
export async function toggleTier(
  useCaseId: string,
  current: string,
  refresh: () => void,
): Promise<void> {
  const next: UseCaseTier = current === 'major' ? 'standard' : 'major';
  await setUseCaseTier(useCaseId, next)
    .then(() => refresh())
    .catch(toastCatch('features:setUseCaseTier'));
}
