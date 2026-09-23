// The winner's state glyph, one 16px mark per council state, drawn in the
// deed's own tone. The shape carries the state (a diamond waits at the gate, a
// triangle failed, a split circle is incomplete), so the register reads in
// greyscale too; the accessible name is the product's own state word.
import { councilLabel, type CouncilGlyphKind } from '@/features/plugins/dev-tools/sub_context/councilGlyph';
import type { TDevTools } from '@/features/plugins/dev-tools/sub_context/contextLedgerShared';

function Shape({ kind }: { kind: CouncilGlyphKind | null }) {
  switch (kind) {
    case 'running':
      return (
        <>
          <circle cx="8" cy="8" r="6" fill="none" stroke="var(--c-session)" strokeWidth="1.6" />
          <circle className="pulse motion-reduce:animate-none" cx="8" cy="8" r="3" fill="var(--c-session)" />
        </>
      );
    case 'ready':
      return <path d="M8 1.5 14.5 8 8 14.5 1.5 8Z" fill="var(--c-gate)" />;
    case 'approved':
      return (
        <>
          <circle cx="8" cy="8" r="6.5" fill="var(--c-proven)" />
          <path d="M5 8.2l2 2 4-4.2" fill="none" stroke="var(--ink-on-tone)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
    case 'machine_pass':
      return (
        <>
          <circle cx="8" cy="8" r="6" fill="none" stroke="var(--c-proven)" strokeWidth="1.8" />
          <circle cx="8" cy="8" r="2.8" fill="var(--c-proven)" />
        </>
      );
    case 'approved_drifted':
      return (
        <>
          <circle cx="8" cy="8" r="6" fill="none" stroke="var(--c-proven)" strokeWidth="1.8" strokeDasharray="3 2" />
          <circle cx="12.5" cy="3.5" r="2.6" fill="var(--c-trouble)" />
        </>
      );
    case 'fail':
      return (
        <>
          <path d="M8 1.8 14.8 13.8H1.2Z" fill="var(--c-trouble)" />
          <path d="M8 6v3.6" stroke="var(--ink-on-tone)" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="8" cy="11.6" r=".95" fill="var(--ink-on-tone)" />
        </>
      );
    case 'rejected':
      return (
        <>
          <circle cx="8" cy="8" r="6.5" fill="var(--c-trouble)" />
          <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="var(--ink-on-tone)" strokeWidth="1.7" strokeLinecap="round" />
        </>
      );
    case 'incomplete':
      return (
        <>
          <circle cx="8" cy="8" r="6" fill="none" stroke="var(--c-trouble)" strokeWidth="1.6" />
          <path d="M8 2a6 6 0 0 0 0 12Z" fill="var(--c-trouble)" />
        </>
      );
    case 'stalled':
      return (
        <>
          <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="none" stroke="var(--c-trouble)" strokeWidth="1.6" />
          <path d="M6.2 5v6M9.8 5v6" stroke="var(--c-trouble)" strokeWidth="2" strokeLinecap="round" />
        </>
      );
    default:
      return <circle cx="8" cy="8" r="5.6" fill="none" stroke="var(--c-staked)" strokeWidth="1.5" />;
  }
}

export function DeedGlyph({ kind, tDev, className = 'glyph' }: { kind: CouncilGlyphKind | null; tDev: TDevTools; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" role="img" aria-label={councilLabel(kind, tDev)}>
      <Shape kind={kind} />
    </svg>
  );
}
