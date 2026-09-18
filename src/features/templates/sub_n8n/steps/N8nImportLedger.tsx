// The analyze step's loss ledger.
//
// Counts of survivors alone cannot distinguish "this workflow had six nodes"
// from "this workflow had twenty and fourteen went nowhere". This panel puts
// the source count beside the parsed count so the difference is visible BEFORE
// the persona is built, which is the only moment it is cheap to act on.
//
// It reports counts and not a list of dropped nodes on purpose: the parser
// discards them before this layer sees anything, and a fabricated list would
// be the same dishonesty in a nicer shape.

import { AlertTriangle, CheckCircle2, FileStack } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { ElementNoun } from '@/lib/personas/parsers/workflowDetector';
import type { ImportLedger } from '../importLedger';

export function N8nImportLedger({ ledger }: { ledger: ImportLedger }) {
  const { t, tx } = useTranslation();
  const n = t.templates.n8n;

  const nounLabels: Record<ElementNoun, string> = {
    node: n.ledger_noun_node,
    step: n.ledger_noun_step,
    module: n.ledger_noun_module,
    job: n.ledger_noun_job,
    element: n.ledger_noun_element,
  };

  const lossy = ledger.unrepresented > 0;

  return (
    <div
      data-testid="n8n-import-ledger"
      className={`rounded-modal border px-3.5 py-2.5 ${
        lossy ? 'border-amber-500/25 bg-amber-500/5' : 'border-primary/10 bg-secondary/20'
      }`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        {lossy
          ? <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" aria-hidden />
          : <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" aria-hidden />}
        <span className="typo-label text-foreground">{n.ledger_title}</span>
      </div>
      <ul className="space-y-0.5 typo-body text-foreground">
        <li className="flex items-center gap-1.5" data-testid="n8n-ledger-detected">
          <FileStack className="w-3.5 h-3.5 text-foreground flex-shrink-0" aria-hidden />
          {tx(n.ledger_detected, { count: ledger.detected, noun: nounLabels[ledger.noun] })}
        </li>
        <li data-testid="n8n-ledger-represented" className="pl-5">
          {tx(n.ledger_represented, { count: ledger.represented })}
        </li>
        {lossy && (
          <li data-testid="n8n-ledger-unrepresented" className="pl-5 text-amber-300/90">
            {tx(n.ledger_unrepresented, { count: ledger.unrepresented })}
          </li>
        )}
        {ledger.deselected > 0 && (
          <li data-testid="n8n-ledger-deselected" className="pl-5">
            {tx(n.ledger_deselected, { count: ledger.deselected })}
          </li>
        )}
        {!lossy && ledger.deselected === 0 && (
          <li data-testid="n8n-ledger-clean" className="pl-5 text-emerald-300/90">
            {n.ledger_clean}
          </li>
        )}
      </ul>
    </div>
  );
}
