/**
 * The console with no ledger under it - the page as it stands before anyone
 * has run the instrument.
 *
 * It exists because two things the console needs are installed by `<Blueprint>`
 * and `<Blueprint>` cannot mount without a plan: the words provider and the one
 * delegated tooltip the whole page shares. Without this shell every `data-cb-tip`
 * in the console would be inert on exactly the page where the operator most
 * needs to be told what things mean.
 */
import type { ReactNode } from 'react';

import { AnchoredTooltip } from '@/features/shared/components/display/Tooltip';

import { useDelegatedTip } from '../useDelegatedTip';
import { BlueprintWordsProvider, type BlueprintWords } from '../words';

export function ConsoleShell({ words, children }: { words: BlueprintWords; children: ReactNode }) {
  const { tip, bind } = useDelegatedTip();
  return (
    <BlueprintWordsProvider value={words}>
      <div className="cb-root cb-boot" data-role="cb-console-shell" {...bind}>
        {children}
        <AnchoredTooltip anchor={tip.anchor} content={tip.content} />
      </div>
    </BlueprintWordsProvider>
  );
}
