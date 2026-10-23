// One orphan cluster's detail: its three ways out - draft a mandate (D),
// adopt it into an existing mandate (A), archive it (X, armed twice: what
// leaves the lane is listed first; archived, not deleted) - then the cluster
// as a plate of the panel (why it asks for a mandate, and its facts). A pick (the
// mandate to adopt into, or the steward a draft names when the orphanage found
// none) is a row of chips, confirmed by the same key again or Enter.

import { Archive, FilePlus2, GitMerge, Lock } from 'lucide-react';
import { AsyncButton } from '@/features/shared/components/buttons';
import { ChipRow, KeyValueGrid } from '@/features/shared/components/kit';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import type { OrphanCluster } from '@/lib/bindings/OrphanCluster';
import { Engraved, Kbd, Lamp } from '../../parts';
import { ProjectName } from '../rowParts';
import { adoptTargets, kindsLine, stewardChoices, whyLine } from './orphanModel';
import type { OrphanageState } from './useOrphanage';

const keyRight = (k: string) => <span className="ml-1.5 inline-flex"><Kbd>{k}</Kbd></span>;

export function OrphanDetail({ cluster: c, perCard, state: o, mandates }: {
  cluster: OrphanCluster;
  perCard: number;
  state: OrphanageState;
  mandates: readonly MandateSummary[] | null;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const needsPick = !c.steward;
  const picks = o.mode === 'adopt'
    ? adoptTargets(mandates, c.projectId).map((s) => ({ id: s.charterId, label: s.projectName ?? s.title }))
    : o.mode === 'draft' ? stewardChoices(mandates).map((s) => ({ id: s.id, label: s.name })) : [];
  const steward = c.steward
    ? tx(c.steward.source === 'app-master' ? m.ml_orphans_steward_app_master : m.ml_orphans_steward_producer, { name: c.steward.name })
    : m.ml_orphans_steward_none;

  return (
    <aside className="flex w-[320px] flex-shrink-0 flex-col gap-3 overflow-y-auto" data-testid="orphan-detail" data-project={c.projectId}>
      <div className="flex flex-col gap-2">
        <AsyncButton variant="secondary" size="sm" block onClick={() => o.draft(c.projectId, c.steward?.personaId ?? null, needsPick)} icon={<FilePlus2 className="h-4 w-4" aria-hidden />} iconRight={keyRight('D')} aria-keyshortcuts="D" data-testid="orphan-draft">
          {o.mode === 'draft' ? m.ml_orphans_draft_confirm : m.ml_orphans_draft}
        </AsyncButton>
        <AsyncButton variant="secondary" size="sm" block onClick={() => o.adopt(c.projectId)} icon={<GitMerge className="h-4 w-4" aria-hidden />} iconRight={keyRight('A')} aria-keyshortcuts="A" data-testid="orphan-adopt">
          {o.mode === 'adopt' ? m.ml_orphans_adopt_confirm : m.ml_orphans_adopt}
        </AsyncButton>
        <AsyncButton variant="secondary" size="sm" block onClick={() => o.archive(c.projectId)} icon={<Archive className="h-4 w-4 text-status-error" aria-hidden />} iconRight={keyRight('X')} aria-keyshortcuts="X" data-armed={o.mode === 'archive' ? '' : undefined} data-testid="orphan-archive">
          {o.mode === 'archive' ? m.ml_orphans_archive_confirm : m.ml_orphans_archive}
        </AsyncButton>
      </div>
      {(o.mode === 'adopt' || o.mode === 'draft') && (
        <section className="flex flex-col gap-1.5" data-testid="orphan-pick">
          <span className="typo-eyebrow">{o.mode === 'adopt' ? m.ml_orphans_pick_mandate : m.ml_orphans_pick_steward}</span>
          <ChipRow
            chips={picks.map((p) => ({ id: p.id, label: p.label, state: o.pick === p.id ? 'selected' : undefined, onPress: () => o.setPick(p.id) }))}
            label={o.mode === 'adopt' ? m.ml_orphans_pick_mandate : m.ml_orphans_pick_steward}
            emptyLabel={m.ml_orphans_pick_none}
          />
          <span className="flex flex-wrap items-center gap-1.5 typo-caption"><Kbd>↵</Kbd> {m.ml_orphans_pick_confirm} <Kbd>Esc</Kbd> {m.ml_orphans_pick_cancel}</span>
        </section>
      )}
      {o.mode === 'archive' && (
        <div className="au-armed au-l-danger flex flex-col gap-1.5 rounded-input px-3 py-2.5" role="alert" data-testid="orphan-archive-armed">
          <span className="au-ink-lamp flex items-center gap-1.5 typo-eyebrow"><Lock className="h-3.5 w-3.5" aria-hidden />{m.ml_orphans_archive_armed}</span>
          <span className="typo-body text-foreground">{tx(m.ml_orphans_archive_leaves, { count: c.items, kinds: kindsLine(c, m, tx) })}</span>
          <span className="typo-caption">{m.ml_orphans_archive_not_deleted}</span>
          <span className="flex flex-wrap items-center gap-1.5 typo-caption"><Kbd>X</Kbd> <Kbd>↵</Kbd> {m.ml_orphans_archive_keys} <Kbd>Esc</Kbd> {m.dc_deck_armed_disarm}</span>
        </div>
      )}
      <p className="typo-caption text-status-warning empty:hidden" role="status" data-testid="orphan-notice">{o.notice}</p>
      <section className="ae-plate ml-plate flex flex-col gap-2 rounded-card p-3" aria-label={c.projectName ?? m.ml_project_unknown}>
        <header className="flex min-w-0 items-center gap-2">
          <Lamp lamp={{ tone: 'warn', lit: !!c.why }} />
          <Engraved className="min-w-0 truncate"><ProjectName projectId={c.projectId}>{c.projectName ?? m.ml_project_unknown}</ProjectName></Engraved>
        </header>
        <p className="typo-body text-foreground">{whyLine(c, perCard, m, tx)}</p>
        <KeyValueGrid
          min="100%"
          items={[
            { k: m.ml_orphans_fact_items, v: kindsLine(c, m, tx) },
            { k: m.ml_orphans_fact_oldest, v: c.oldestAt ? <RelativeTime timestamp={c.oldestAt} /> : null, none: m.ml_unknown },
            { k: m.ml_orphans_fact_steward, v: steward },
            { k: m.ml_orphans_fact_archived, v: String(c.archived) },
          ]}
        />
      </section>
    </aside>
  );
}
