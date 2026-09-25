/**
 * The operator's queue: the subject of this page, and the column designed first.
 *
 * THE FILTER SPANS BOTH AXES. "Needs you" collects failed REQUESTS and
 * unreadable RESOURCES together, because at forty-at-a-time he does not care
 * which axis broke - he cares that something is waiting on him. It is the one
 * control that turns a wall of forty rows into the three that want a decision.
 *
 * ACTIONS ARE BULK WHERE THE WORK IS BULK. Withdrawing is a batch act over
 * whatever the filter currently shows, with the count in the label, because he
 * files in batches and changes his mind in batches. Per-row controls exist only
 * on the rows that carry a decision nobody else can make.
 */
import { useMemo, useState } from 'react';

import { ChipView, KitButton, Meta, Rows, SearchField, Section, Segmented, Toolbar } from '@/features/shared/components/kit';

import { useWords } from '../../../words';
import { Composer } from './Composer';
import { IntakeRow } from './IntakeRow';
import type { Intake } from './types';
import type { Bench } from './useBench';

type Lens = 'all' | 'queued' | 'running' | 'settled' | 'needs';

function inLens(it: Intake, lens: Lens): boolean {
  if (lens === 'all') return true;
  if (lens === 'queued') return it.state === 'queued';
  if (lens === 'running') return it.state === 'dispatched';
  if (lens === 'settled') return it.state === 'landed' || it.state === 'declined' || it.state === 'cancelled';
  return it.state === 'failed' || it.read.kind === 'unreadable';
}

export function LaneColumn({ bench, bundle, onBundle }: {
  bench: Bench;
  bundle: string | null;
  onBundle: (d: string | null) => void;
}) {
  const { w } = useWords();
  const { intakes, file, cancel, reread } = bench;
  const [lens, setLens] = useState<Lens>('all');
  const [q, setQ] = useState('');
  const [pasting, setPasting] = useState(false);

  const counts = useMemo(() => ({
    all: intakes.length,
    queued: intakes.filter((i) => inLens(i, 'queued')).length,
    running: intakes.filter((i) => inLens(i, 'running')).length,
    settled: intakes.filter((i) => inLens(i, 'settled')).length,
    needs: intakes.filter((i) => inLens(i, 'needs')).length,
    unread: intakes.filter((i) => i.read.kind === 'unread').length,
  }), [intakes]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return intakes.filter((it) => {
      if (!inLens(it, lens)) return false;
      if (bundle && !(it.read.kind === 'read' && it.read.domain === bundle)) return false;
      if (!needle) return true;
      const topic = it.read.kind === 'read' ? it.read.topic : '';
      return `${it.url} ${it.skill} ${topic}`.toLowerCase().includes(needle);
    });
  }, [intakes, lens, bundle, q]);

  const withdrawable = shown.filter((i) => i.state === 'queued');

  return (
    <Section
      level={1}
      title={w.console.lane_title}
      count={intakes.length || null}
      meta={
        <Meta parts={[
          w.console.lane_note,
          // i18n: the unread tail, named rather than left to a blank column.
          counts.unread > 0 ? `${String(counts.unread)} topics unread` : null,
        ]}
        />
      }
      actions={
        // i18n: opens and closes the paste box.
        <KitButton quiet onClick={() => { setPasting((v) => !v); }}>{pasting ? 'hide the paste box' : 'paste links'}</KitButton>
      }
    >
      {(pasting || intakes.length === 0) && (
        <Composer onFile={(u, s, n) => { file(u, s, n); setPasting(false); }} />
      )}
      <Toolbar label={w.find_label}>
        <Segmented
          label={w.find_label}
          value={lens}
          onChange={setLens}
          options={[
            // i18n: four of the five lenses are state names the app already has.
            { v: 'all', label: 'all', count: counts.all },
            { v: 'queued', label: w.console.request_state.queued, count: counts.queued },
            { v: 'running', label: w.console.request_state.dispatched, count: counts.running },
            { v: 'settled', label: w.docket_settled, count: counts.settled },
            // i18n: the cross-axis lens - a failed request OR a resource that could not be read.
            { v: 'needs', label: 'needs you', count: counts.needs, tone: 'error', glyph: 'solid' },
          ]}
        />
        <SearchField value={q} onChange={setQ} placeholder={w.find_placeholder} testId="curator-find" />
        {bundle && (
          <ChipView chip={{
            id: 'bundle',
            label: bundle,
            state: 'selected',
            tone: 'agent',
            glyph: 'solid',
            onPress: () => { onBundle(null); },
          }}
          />
        )}
        {lens === 'queued' && withdrawable.length > 0 && (
          <KitButton
            quiet
            testId="curator-withdraw-shown"
            onClick={() => { withdrawable.forEach((i) => { cancel(i.id); }); }}
          >
            {/* i18n: the batch form of `request_cancel`; the count is what makes it safe. */}
            {w.console.request_cancel} {withdrawable.length}
          </KitButton>
        )}
      </Toolbar>
      <div className="cb-scroll" data-testid="curator-queue">
        <Rows
          count={shown.length}
          empty={intakes.length === 0
            // i18n: the empty lane is a MEASURED zero - it was read, and it holds nothing.
            ? { title: 'The lane is read, and empty.', hint: w.console.lane_empty, tone: 'human' }
            // i18n: a filter that matches nothing is not an empty lane.
            : { title: 'Nothing under this filter.', hint: 'The lane holds rows; none of them is in this view.', tone: 'neutral' }}
        >
          {shown.map((it) => (
            <IntakeRow key={it.id} intake={it} onCancel={cancel} onReread={reread} />
          ))}
        </Rows>
      </div>
    </Section>
  );
}
