import { useSheet } from '../controller/SheetContext';
import { capOf, keysFor } from '../model/keymap';

/**
 * The bar's key reminder while nothing is targeted (bp KeysSheet KeyLine): "J/K move · Space check · Enter compare
 * · ? keys" for the packs, "A approve · X decline" for the backlog. The keys are read from the one keymap.
 */
export function KeyLine({ scope }: { scope: 'packs' | 'backlog' }) {
  const { B } = useSheet().text;
  const k = (act: Parameters<typeof keysFor>[0]) => capOf(keysFor(act)[0] ?? '');
  const items: [string, string][] = [
    [k('next') + '/' + k('prev'), B.lg_key_move],
    [k('select'), B.lg_key_check],
    ...(scope === 'packs' ? [[k('enter'), B.lg_key_compare]] as [string, string][] : [[k('approve'), B.verb_approve], [k('decline'), B.verb_decline]] as [string, string][]),
    [k('help'), B.lg_key_keys],
  ];
  return (
    <span className="tr-hint">
      {items.map(([key, word], i) => <span key={key}>{i ? ' · ' : ''}<kbd>{key}</kbd>{word}</span>)}
    </span>
  );
}
