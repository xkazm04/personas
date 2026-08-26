// PROTOTYPE SCAFFOLD — throwaway A/B switcher (deleted at consolidation).
//
// Two independent decisions: the inbox row treatment (Ledger vs Console) and
// the autonomous log (Table vs Trail). Baseline is the pre-prototype inbox,
// kept selectable for comparison only — its grouping / lane / single-row model
// is what the two directions replace.

import { useState } from 'react';
import IncidentsInboxBaseline from './IncidentsInbox';
import { IncidentsInboxShell, type InboxVariant, type AutonomousVariant } from './IncidentsInboxShell';

type Selection = 'baseline' | InboxVariant;

const INBOX_TABS: { key: Selection; label: string; sub: string }[] = [
  { key: 'ledger', label: 'Ledger', sub: 'dense two-row ledger, zebra, mono metadata' },
  { key: 'console', label: 'Console', sub: 'surfaced bands, severity wash, named actions' },
  { key: 'baseline', label: 'Baseline', sub: 'current grouped inbox' },
];

const AUTONOMOUS_TABS: { key: AutonomousVariant; label: string; sub: string }[] = [
  { key: 'table', label: 'Table', sub: 'one compact row per handled incident' },
  { key: 'trail', label: 'Trail', sub: 'summary strip + two-row audit records' },
];

export default function IncidentsInboxSwitcher() {
  const [selection, setSelection] = useState<Selection>('ledger');
  const [autonomousVariant, setAutonomousVariant] = useState<AutonomousVariant>('trail');

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-primary/10 bg-secondary/20 px-4 py-1.5">
        <TabGroup
          legend="Inbox"
          tabs={INBOX_TABS}
          value={selection}
          onChange={(v) => setSelection(v as Selection)}
        />
        {selection !== 'baseline' && (
          <TabGroup
            legend="Autonomous"
            tabs={AUTONOMOUS_TABS}
            value={autonomousVariant}
            onChange={(v) => setAutonomousVariant(v as AutonomousVariant)}
          />
        )}
      </div>

      {selection === 'baseline' ? (
        <IncidentsInboxBaseline />
      ) : (
        <IncidentsInboxShell variant={selection} autonomousVariant={autonomousVariant} />
      )}
    </div>
  );
}

function TabGroup({
  legend, tabs, value, onChange,
}: {
  legend: string;
  tabs: { key: string; label: string; sub: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="typo-caption font-mono uppercase tracking-widest text-foreground mr-1">{legend}</span>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onChange(tab.key)}
          title={tab.sub}
          className={`px-2.5 py-1 typo-caption rounded-interactive border transition-colors focus-ring ${
            value === tab.key
              ? 'bg-primary/15 text-primary border-primary/30'
              : 'text-foreground border-transparent hover:bg-primary/[0.06]'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
