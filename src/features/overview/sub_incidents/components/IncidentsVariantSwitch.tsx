// PROTOTYPE SCAFFOLD — throwaway (deleted at consolidation).
// Round 2 of the incidents redesign: three directions each for the inbox
// ledger and the autonomous log, chosen independently. The round-1 winners
// (Ledger / Trail) stay selectable as the reference to beat.

import { useState, type ReactNode } from 'react';

export type InboxVariant = 'signal' | 'dossier' | 'columns' | 'ledger';
export type AutonomousVariant = 'timeline' | 'receipts' | 'register' | 'trail';

export const INBOX_TABS: { key: InboxVariant; label: string; sub: string }[] = [
  { key: 'signal', label: 'Signal', sub: 'one loud thing per row — rail + big age numeral, quiet label·value facts' },
  { key: 'dossier', label: 'Dossier', sub: 'symbols carry metadata — source tile, initials disc, coloured stamps' },
  { key: 'columns', label: 'Columns', sub: 'true table, each column with its own voice — solid severity block, bold agent' },
  { key: 'ledger', label: 'Ledger (r1)', sub: 'round-1 winner, for reference' },
];
export const AUTONOMOUS_TABS: { key: AutonomousVariant; label: string; sub: string }[] = [
  { key: 'timeline', label: 'Timeline', sub: 'spine + nodes, clock numeral loud, latency as an arrow' },
  { key: 'receipts', label: 'Receipts', sub: 'one card per handled incident with a green header strip + KV block' },
  { key: 'register', label: 'Register', sub: 'strict one-line register, latency numeral first' },
  { key: 'trail', label: 'Trail (r1)', sub: 'round-1 winner, for reference' },
];

export function useIncidentsVariants() {
  const [inbox, setInbox] = useState<InboxVariant>('signal');
  const [autonomous, setAutonomous] = useState<AutonomousVariant>('timeline');
  return { inbox, setInbox, autonomous, setAutonomous };
}

export function VariantStrip({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-primary/10 bg-secondary/20 px-4 py-1.5">
      {children}
    </div>
  );
}

export function TabGroup<K extends string>({
  legend, tabs, value, onChange,
}: { legend: string; tabs: { key: K; label: string; sub: string }[]; value: K; onChange: (k: K) => void }) {
  return (
    <div className="flex items-center gap-1">
      <span className="typo-caption font-mono uppercase tracking-widest text-foreground mr-1">{legend}</span>
      {tabs.map((tab) => (
        <button key={tab.key} type="button" onClick={() => onChange(tab.key)} title={tab.sub}
          className={`px-2.5 py-1 typo-caption rounded-interactive border transition-colors focus-ring ${
            value === tab.key ? 'bg-primary/15 text-primary border-primary/30' : 'text-foreground border-transparent hover:bg-primary/[0.06]'
          }`}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}
