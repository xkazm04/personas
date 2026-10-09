/**
 * DOCS preset: the docs as an estate you can fix, top to bottom -
 *
 * - THE DOC ESTATE: the status chips (they double as the map's legend) and a
 *   path search; the clean share drawn against the line it must reach, with
 *   what it leaves out and why (`docs/ShareCard`); and the map - every doc as
 *   one cell in its folder, folders worst first and as wide as their doc count
 *   (`docs/EstateMap`). A cell peeks on hover and opens its doc in the list.
 * - FIX IN BULK: the broken and stale docs handed to Athena in one press (the
 *   same prompt as the Next panel's), and the doc-rot items already filed,
 *   each tied to the doc its title names (`docs/FixPanel`).
 * - HOW IT IS RESOLVED: the docs the filter keeps, worst first, each opening
 *   to its full broken references or changed sources, open / copy, and "Ask
 *   Athena to fix this doc" (`DocsResolution`, `docs/DocRow`).
 * - THE DOCS CHANGE LOG, by day: this step's own changes (the step detail's
 *   evidence; the snapshot's window until it is in), each opening in a modal.
 *
 * Chrome always renders; the first detail read draws the estate's ghost and
 * the list's ghost rows under their heads.
 */
import { useMemo, useState } from 'react';

import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Meta, Rows, Section } from '@/features/shared/components/kit';
import type { LifecycleDocRow } from '@/lib/bindings/LifecycleDocRow';
import type { LifecycleRelatedItem } from '@/lib/bindings/LifecycleRelatedItem';

import type { JourneyNode } from '../../journey/journeyModel';
import type { EvidenceRow } from '../blocks/evidenceRows';
import { useLifecycleViewModel } from '../context';
import { fillTemplate } from '../frame/fillTemplate';
import type { HealthStep } from '../layer1/healthModel';
import { RHYTHM } from '../system/lcSurface';
import { LT } from '../system/lcType';
import { DocChangeModal } from './DocChangeModal';
import { DocsLog } from './docs/DocsLog';
import { EstateGhost } from './docs/EstateGhost';
import { EstateMap } from './docs/EstateMap';
import { EstateToolbar } from './docs/EstateToolbar';
import { FixPanel } from './docs/FixPanel';
import { ShareCard } from './docs/ShareCard';
import { useDocsView } from './docs/useDocsView';
import { DocsResolution } from './DocsResolution';
import { docsChangeLog } from './docsModel';
import type { PresetData } from './presetData';

const NO_DOCS: LifecycleDocRow[] = [];
const NO_ITEMS: LifecycleRelatedItem[] = [];

/** The newest scan time among the rows, or null. */
function lastScanned(rows: LifecycleDocRow[]): string | null {
  return rows.reduce<string | null>((max, r) => (r.scannedAt && (!max || r.scannedAt > max) ? r.scannedAt : max), null);
}

export function DocsPreset({ step, node, data }: { step: HealthStep; node: JourneyNode; data: PresetData }) {
  const { dl, evidence } = useLifecycleViewModel();
  const rows = data.detail?.docs ?? NO_DOCS;
  const related = data.detail?.related ?? NO_ITEMS;
  const view = useDocsView(rows, related);
  const own = data.detail?.evidence;
  const log = useMemo(() => docsChangeLog(own && own.length > 0 ? own : evidence), [own, evidence]);
  const [opened, setOpened] = useState<EvidenceRow | null>(null);
  const scanned = useMemo(() => lastScanned(rows), [rows]);
  const empty = !data.loading && rows.length === 0;

  return (
    <>
      <Section
        title={dl.lcx7_estate}
        level={2}
        count={rows.length || undefined}
        meta={<Meta parts={[
          scanned && fillTemplate(dl.lcx7_scanned, { time: <RelativeTime timestamp={scanned} /> }),
          view.prefix && fillTemplate(dl.lcx7_folders_under, { prefix: <span className={LT.code}>{view.prefix}</span> }),
        ]} />}
        desc={empty ? undefined : dl.lcx7_estate_desc}
      >
        {data.loading ? <EstateGhost /> : empty ? (
          <Rows count={0} empty={{ title: data.unavailable ? dl.lc2_runs_unavailable : dl.lc2_docs_none, hint: data.unavailable ? undefined : dl.lc2_docs_none_hint }}>
            {null}
          </Rows>
        ) : (
          <div className={RHYTHM.block}>
            <EstateToolbar view={view} />
            <div className="flex flex-wrap items-start gap-4">
              <ShareCard step={step} node={node} counts={view.counts} />
              <EstateMap view={view} />
            </div>
          </div>
        )}
      </Section>
      {!data.loading && !empty && <FixPanel view={view} related={related} />}
      {!empty && (
        <Section
          title={dl.lc2_docs_resolved}
          level={2}
          count={data.loading ? undefined : view.filtering ? `${view.shown} / ${view.total}` : view.total}
          desc={dl.lcx7_list_desc}
        >
          {data.loading ? <Rows loading count={0} empty={{ title: '' }}>{null}</Rows> : <DocsResolution view={view} />}
        </Section>
      )}
      <Section title={dl.lc2_docs_log} level={2} count={log.length || undefined} desc={dl.lc2_docs_log_caption}>
        <DocsLog rows={log} onOpen={setOpened} />
      </Section>
      <DocChangeModal row={opened} docs={rows} onClose={() => setOpened(null)} />
    </>
  );
}
