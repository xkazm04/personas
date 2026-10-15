/**
 * The product blueprint drawing set (spark one-control, Stage 2, WP4a) on its FIXTURE source: bp's synthetic
 * Kettle sample, trimmed (src/features/decision-center/blueprint/fixture/), with a static BlueprintActions that
 * applies the state table locally and answers in the store's shapes. No IPC: the tape is empty.
 *
 *   decision-center/blueprint   --query "feature=<slug>"   open the L4 sheet of a feature at once
 *                               --query "lens=<id>"        (reserved) start on a lens sheet
 *
 * The sheet closes on Esc at the whole-site level; the page then shows a stand-in with a reopen control so a
 * driver can tell "closed by the sheet" from "never opened". `window.__BLUEPRINT__` exposes what happened
 * (closed, the fixture actions) for the shot driver (blueprintShots.mjs).
 */
import { useMemo, useState, type ReactNode } from 'react';
import type { HarnessModule } from './registry';

interface BlueprintProbe { closed: number; actions: unknown }
declare global { interface Window { __BLUEPRINT__?: BlueprintProbe } }

async function keyboardProvider() {
  const { AppKeyboardProvider } = await import('@/lib/keyboard/AppKeyboardProvider');
  return (children: ReactNode) => <AppKeyboardProvider>{children}</AppKeyboardProvider>;
}

export const BLUEPRINT_MODULES: Record<string, HarnessModule> = {
  'decision-center/blueprint': {
    load: async () => {
      const [{ BlueprintSheet }, { kettleData }, { createFixtureActions }, { useTranslation }] = await Promise.all([
        import('@/features/decision-center/blueprint/BlueprintSheet'),
        import('@/features/decision-center/blueprint/fixture/kettle'),
        import('@/features/decision-center/blueprint/fixture/actions'),
        import('@/i18n/useTranslation'),
      ]);
      function BlueprintPage() {
        const { t } = useTranslation();
        const params = new URLSearchParams(window.location.search);
        const feature = params.get('feature') ?? undefined;
        const data = useMemo(() => kettleData(), []);
        const actions = useMemo(() => createFixtureActions(data), [data]);
        const [open, setOpen] = useState(true);
        window.__BLUEPRINT__ = window.__BLUEPRINT__ ?? { closed: 0, actions };
        window.__BLUEPRINT__.actions = actions;
        return (
          <div className="flex flex-1 flex-col gap-3 p-8">
            <h1 className="typo-heading-lg text-foreground">{t.decisionCenter.blueprint.title}</h1>
            {open
              ? <BlueprintSheet data={data} actions={actions} initialFeature={feature} onClose={() => { window.__BLUEPRINT__!.closed += 1; setOpen(false); }} />
              : <button type="button" data-testid="blueprint-reopen" onClick={() => setOpen(true)}>{t.decisionCenter.blueprint.drawing_set}</button>}
          </div>
        );
      }
      return { default: BlueprintPage };
    },
    providers: keyboardProvider,
  },
};
