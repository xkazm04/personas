/**
 * THE HEADER PRINTS WHAT A PERSON READS, NOT WHAT A MACHINE READS.
 *
 * The plan run's id and the registry HEAD sha are both real and both useful to
 * somebody chasing a run - and neither is something a reader reads off a page
 * header. They stood there anyway, taking the width from the two facts that
 * are the header's job: when the scan was taken, and that this is a projection
 * rather than live truth.
 *
 * "Not on the surface" is the kind of claim that quietly becomes false the
 * next time someone adds a debug span, so it is asserted on the rendered text
 * rather than trusted. The demotion is also asserted: both identifiers are
 * still REACHABLE, in the clock's own tip, or this would be a deletion rather
 * than a move.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import en from '@/i18n/locales/en.json';
import { interpolate } from '@/i18n/useTranslation';

import { utcStamp } from '../format';
import { TopBar } from '../ledger/TopBar';
import { buildModel } from '../model/buildModel';
import { unmeasuredModel } from '../model/unmeasured';
import type { BlueprintModel } from '../model/types';
import type { BlueprintStrings, BlueprintWords } from '../words';
import { BlueprintWordsProvider } from '../words';

import { plan } from './fixture';

// The English catalog is the generated type's own source, so this names the
// invariant rather than hiding a shape mismatch: `types.ts` is codegen'd from
// exactly this file.
const words: BlueprintWords = {
  w: en.companions.blueprint as unknown as BlueprintStrings,
  tx: interpolate,
};
const W = en.companions.blueprint;

const RUN = 'plan-1';
const SHA = 'cc01b2b8';

function bar(model: BlueprintModel) {
  return render(
    <BlueprintWordsProvider value={words}>
      <TopBar
        model={model}
        waiting={0}
        docketOpen={false}
        onToggleDocket={() => undefined}
        queueOpen={false}
        onToggleQueue={() => undefined}
        query=""
        onQuery={() => undefined}
        onHelp={() => undefined}
      />
    </BlueprintWordsProvider>,
  );
}

describe('the header carries no machine identifier', () => {
  it('prints neither the run id nor the registry sha', () => {
    const { container } = bar(buildModel(plan()));
    const text = container.textContent ?? '';
    expect(text).not.toContain(RUN);
    expect(text).not.toContain(SHA);
  });

  it('still says when the scan was taken, and that it is a projection', () => {
    const { container } = bar(buildModel(plan()));
    const text = container.textContent ?? '';
    // The load-bearing word. A reader who loses it reads the ledger as live.
    expect(text).toContain(W.projection_note);
    // Against `utcStamp`, not a hard-coded string: the clock's own format is
    // the reader's locale's, and this test is about WHICH FACT is drawn.
    expect(container.querySelector('[data-role="cb-scan"]')?.textContent).toBe(
      interpolate(W.scan_at, { at: utcStamp('2026-09-22T22:39:52.343Z') }),
    );
  });

  it('keeps both identifiers reachable, on the clock, rather than deleting them', () => {
    const { container } = bar(buildModel(plan()));
    const tip = container.querySelector('[data-role="cb-scan"]')?.getAttribute('data-cb-tip') ?? '';
    expect(tip).toContain(RUN);
    expect(tip).toContain(SHA);
  });

  it('says the head is unanswered rather than naming a commit it does not have', () => {
    const model = buildModel(plan({ run: { ...plan().run, registryHeadSha: null } }));
    const tip = bar(model).container.querySelector('[data-role="cb-scan"]')?.getAttribute('data-cb-tip') ?? '';
    expect(tip).toBe(interpolate(W.scan_tip_no_head, { run: RUN }));
    expect(tip).not.toContain(SHA);
  });

  it('carries one true sentence, and no clock at all, before anything has been measured', () => {
    const { container } = bar(unmeasuredModel());
    expect(container.textContent).toContain(W.meta_unrun);
    expect(container.querySelector('[data-role="cb-scan"]')).toBeNull();
    expect(container.querySelector('[data-role="cb-projection"]')).toBeNull();
  });
});
