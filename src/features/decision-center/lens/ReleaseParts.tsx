/**
 * The release composition's parts (spark one-control, WP3): the version
 * facts, the items, the notes, and the "bp is not running" state. Read only:
 * nothing here writes or composes; bp does.
 */
import { KitHost, ListRow, Rows, Section } from '@/features/shared/components/kit';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useTranslation } from '@/i18n/useTranslation';

import { releaseStatusWord } from './lensAdapters';
import { BP_START_COMMAND } from './bpLink';
import type { ReleaseComposition } from './releaseComposition';

type ReleaseCopy = ReturnType<typeof useTranslation>['t']['decisionCenter']['release'];

function baseLine(R: ReleaseCopy, tx: (t: string, v: Record<string, string | number>) => string, c: ReleaseComposition): string | null {
  if (c.waiting) return null;
  return c.from ? tx(R.from_base, { from: c.from }) : R.from_none;
}

function bumpLine(R: ReleaseCopy, c: ReleaseComposition): string | null {
  if (c.bump === 'minor') return R.bump_minor;
  if (c.bump === 'patch') return R.bump_patch;
  return null;
}

export function ReleaseFacts({ comp }: { comp: ReleaseComposition }) {
  const { t, tx } = useTranslation();
  const R = t.decisionCenter.release;
  const status = comp.open ? tx(R.status_line, { version: comp.open.version, status: releaseStatusWord(R, comp.open.status) }) : null;
  const lines = [baseLine(R, tx, comp), bumpLine(R, comp), status].filter((l): l is string => !!l);
  return (
    <Section title={R.fact_version} level={2}>
      <div className="flex flex-col gap-1" data-testid="lens-release-facts">
        <span className="typo-heading-lg text-foreground" data-testid="lens-release-version">{comp.version}</span>
        {lines.map((l) => <p key={l} className="typo-caption">{l}</p>)}
      </div>
    </Section>
  );
}

export function ReleaseItems({ comp, loading }: { comp: ReleaseComposition | null; loading: boolean }) {
  const { t } = useTranslation();
  const R = t.decisionCenter.release;
  const items = comp?.items ?? [];
  return (
    <Section title={R.fact_items} count={comp ? items.length : undefined} level={2}>
      <Rows loading={loading} count={items.length} empty={{ title: R.items_none, testId: 'lens-release-items-empty' }}>
        {items.map((p) => (
          <ListRow key={p.id} name={p.title} meta={`${p.feature} · ${p.lens}`} testId="lens-release-item" />
        ))}
      </Rows>
    </Section>
  );
}

export function ReleaseNotes({ notes }: { notes: string | null }) {
  const { t } = useTranslation();
  const R = t.decisionCenter.release;
  return (
    <Section title={R.notes_label} level={2}>
      {notes
        ? <MarkdownRenderer content={notes} />
        : <p className="typo-body text-foreground" data-testid="lens-release-notes-none">{R.notes_none}</p>}
    </Section>
  );
}

/** bp did not answer: say so, and how to start it. Nothing else. */
export function BpNotRunning() {
  const { t } = useTranslation();
  const R = t.decisionCenter.release;
  return (
    <KitHost testId="lens-release-bp-down">
      <Section title={R.bp_down_title} level={2}>
        <p className="typo-body text-foreground">{R.bp_down_body}</p>
        <code className="typo-code text-foreground">{BP_START_COMMAND}</code>
      </Section>
    </KitHost>
  );
}
