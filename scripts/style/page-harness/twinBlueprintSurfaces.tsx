/**
 * Twin blueprint variants (spark twin-portable-blueprint) on fixture models,
 * no IPC: the variant renderers take the model as a prop, so a variant can be
 * shot before the Detail page that feeds it exists. `?kit=<variant>` picks the
 * renderer (`drafting`, the "Personas blueprint" look | `strata`; default
 * `drafting`).
 *
 *   twin/blueprint/detail         L1, the one-channel twin
 *   twin/blueprint/detail-empty   L1, a just-forged twin (every "not yet drawn" state)
 *   twin/blueprint/detail-rich    L1, nine channels and a full plan (the overflow test)
 *   twin/blueprint/detail-focus   L2, the rich twin zoomed into Voice
 *   twin/blueprint/stage          stage mode mid-beat: the reconciled delta of the last answer
 *   twin/blueprint/stage-working  stage mode, empty twin, the engine working with no live question
 *
 * Usage: node scripts/style/shoot.mjs --module twin/blueprint/detail --tape synthetic --kit strata --out tmp/style-shots/twin-strata --label l1
 */
import { useState } from 'react';
import { BLUEPRINT_VARIANT_IDS, type BlueprintDelta, type BlueprintMode, type BlueprintVariantId, type SectionId, type TwinBlueprintModel } from '@/features/plugins/twin/blueprint/blueprintContract';
import { BLUEPRINT_VARIANTS } from '@/features/plugins/twin/blueprint/variantRegistry';
import {
  FIXTURE_DELTA_RECONCILED, FIXTURE_EMPTY, FIXTURE_ONE_CHANNEL, FIXTURE_RICH,
} from '@/features/plugins/twin/blueprint/__fixtures__/blueprintFixtures';
import type { HarnessModule } from './registry';

interface SurfaceState {
  model: TwinBlueprintModel;
  mode: BlueprintMode;
  focus: SectionId | null;
  delta: BlueprintDelta | null;
  working: boolean;
}

const STATES: Record<string, SurfaceState> = {
  detail: { model: FIXTURE_ONE_CHANNEL, mode: 'detail', focus: null, delta: null, working: false },
  'detail-empty': { model: FIXTURE_EMPTY, mode: 'detail', focus: null, delta: null, working: false },
  'detail-rich': { model: FIXTURE_RICH, mode: 'detail', focus: null, delta: null, working: false },
  'detail-focus': { model: FIXTURE_RICH, mode: 'detail', focus: 'voice', delta: null, working: false },
  stage: { model: FIXTURE_RICH, mode: 'stage', focus: null, delta: FIXTURE_DELTA_RECONCILED, working: false },
  'stage-working': { model: FIXTURE_EMPTY, mode: 'stage', focus: null, delta: null, working: true },
};

function variantFromUrl(): BlueprintVariantId {
  const kit = new URLSearchParams(window.location.search).get('kit') ?? '';
  return (BLUEPRINT_VARIANT_IDS as readonly string[]).includes(kit) ? (kit as BlueprintVariantId) : 'drafting';
}

function mount(state: string): HarnessModule {
  return {
    load: async () => {
      const s = STATES[state]!;
      const Variant = BLUEPRINT_VARIANTS[variantFromUrl()];
      function Surface() {
        const [focus, setFocus] = useState<SectionId | null>(s.focus);
        return (
          <div className="h-full w-full flex flex-col min-h-0">
            <Variant
              model={s.model}
              mode={s.mode}
              focus={s.mode === 'stage' ? null : focus}
              onFocus={setFocus}
              onOpenDetail={() => {}}
              delta={s.delta}
              working={s.working}
              reduced={false}
            />
          </div>
        );
      }
      return { default: Surface };
    },
  };
}

export const TWIN_BLUEPRINT_MODULE_IDS = Object.keys(STATES).map((k) => `twin/blueprint/${k}`);

export const TWIN_BLUEPRINT_MODULES: Record<string, HarnessModule> = Object.fromEntries(
  Object.keys(STATES).map((k) => [`twin/blueprint/${k}`, mount(k)]),
);
