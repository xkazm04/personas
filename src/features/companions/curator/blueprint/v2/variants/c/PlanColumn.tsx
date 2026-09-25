/**
 * Her plan, at half width, as the reference he consults while filing.
 *
 * WHAT HAPPENED TO THE NINE COLUMNS. They became one drawn quantity per row.
 * Points are units of four (`UnitStrip`), coloured by WEIGHT BAND - error for a
 * 5-or-6-point reason, warning for 3-or-4, neutral for 1-or-2 - and glyphed by
 * WHICH reason inside that band. So the row's magnitude is drawn, its severity
 * is coloured, and the reason stays readable as itself because the meta line
 * names it in the scan's own words. Nothing is flattened into "weak".
 *
 * WHAT MAKES IT A WORKING COLUMN RATHER THAN A REPORT. The last cell of every
 * row is the join: how many of HIS intakes point at this bundle. Pressing it
 * filters his queue to them. That is the whole reason both columns are on one
 * page - the plan tells him what she is already going to do about the thing he
 * is about to file more of.
 */
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Dot, KitButton, ListRow, Meta, Rows, Section, UnitStrip, apportion } from '@/features/shared/components/kit';
import type { Glyph, Tone } from '@/features/shared/components/kit';

import { channelSpec, type ChannelId } from '../../../model/channels';
import { useWords } from '../../../words';
import { PLAN } from './fixture';
import { Fact, FourFacts, INK } from './Ink';
import type { Join } from './useBench';
import type { PlanRow } from './types';

/** Colour is how heavily the reason scores; the glyph says which one it is. */
function reasonInk(id: ChannelId): { tone: Tone; glyph: Glyph } {
  const { weight } = channelSpec(id);
  const tone: Tone = weight >= 5 ? 'error' : weight >= 3 ? 'warning' : 'neutral';
  const glyph: Glyph = id === 1 || id === 4 || id === 6 ? 'solid' : id === 2 || id === 7 || id === 8 ? 'soft' : 'hollow';
  return { tone, glyph };
}

/** One unit is the heaviest a single clause can score, so a unit is one worst reason. */
const QUANTUM = 6;

const PLAN_MARK: Record<PlanRow['state'], { tone: Tone; glyph: Glyph }> = {
  planned: { tone: 'agent', glyph: 'hollow' },
  dispatched: { tone: 'primary', glyph: 'live' },
  landed: { tone: 'success', glyph: 'solid' },
  declined: { tone: 'neutral', glyph: 'soft' },
  idled: { tone: 'neutral', glyph: 'empty' },
  blocked: { tone: 'error', glyph: 'hollow' },
};

/**
 * The join, told as one of four facts and never as a bare number.
 *
 * `pending` outranks everything: while any intake is unread, ANY of them could
 * land in this bundle, so the honest answer is that nobody can say. A zero here
 * would be the page telling its own central lie in the one cell that is new.
 */
function JoinValue({ join, domain, active, onPress }: {
  join: Join;
  domain: string;
  active: boolean;
  onPress: () => void;
}) {
  const { n, pending, unreadable } = join;
  // The number is always a MEASURED one: how many read intakes point here. What
  // is outside it is drawn beside it as a tail, in its own ink, rather than
  // being folded in (which would overstate) or collapsing the cell to unknown
  // (which would hide a count he has). The tail's size is stated once, in the
  // column's own sentence, so ten rows do not repeat the same two numbers.
  const tip = [
    // i18n: the join, spelled out.
    n > 0 ? `${String(n)} of your intakes point at ${domain}.` : `0 measured: no intake that has been read points at ${domain}.`,
    pending > 0 ? `${String(pending)} are still unread, so they could still land here - UNKNOWN, not zero.` : null,
    unreadable > 0 ? `${String(unreadable)} could not be read at all, so this bundle can never be asked of them.` : null,
    pending === 0 && unreadable === 0 ? 'Your lane is fully read, so this count is closed.' : null,
  ].filter(Boolean).join(' ');
  return (
    <KitButton quiet onClick={onPress} className={active ? 'cb-join is-on' : 'cb-join'}>
      <Fact kind={n > 0 ? 'count' : 'measured-zero'} tip={tip}>{n}</Fact>
      {pending > 0 && <Dot {...INK.unknown} />}
      {unreadable > 0 && <Dot {...INK.unmeasurable} />}
    </KitButton>
  );
}

export function PlanColumn({ joinFor, bundle, onBundle, filed }: {
  joinFor: (domain: string) => Join;
  bundle: string | null;
  onBundle: (domain: string | null) => void;
  filed: { total: number; read: number; pending: number; unreadable: number };
}) {
  const { w, tx } = useWords();

  // i18n: the sentence that makes the two columns one workflow.
  const sentence = filed.total === 0
    ? 'Your lane is read and empty, so every count below is a measured zero rather than an unknown.'
    : `${String(filed.read)} of your ${String(filed.total)} intakes have a bundle. `
      + (filed.pending > 0 ? `${String(filed.pending)} are still unread and point nowhere yet. ` : '')
      + (filed.unreadable > 0 ? `${String(filed.unreadable)} could never be read.` : '');

  return (
    <>
      <Section
        level={1}
        // i18n: her half of the page.
        title="Her plan"
        count={PLAN.length}
        meta={<Meta parts={[tx(w.head_projection, { sha: '4f2a1c9' }), tx(w.verdict_in_bundles, { n: 10 })]} />}
        desc={sentence}
      >
        <div className="cb-scroll">
          <Rows count={PLAN.length} empty={{ title: w.no_plan_title, hint: w.no_plan_body, tone: 'agent' }}>
            {PLAN.map((p) => {
              const join = joinFor(p.domain);
              const segments = apportion(p.marks.map((m) => ({ value: m.points, ...reasonInk(m.channel) })), QUANTUM);
              const names = p.marks.map((m) => w.channel[`c${String(m.channel)}` as keyof typeof w.channel]);
              return (
                <ListRow
                  key={p.id}
                  size="s"
                  state={p.state === 'dispatched' ? 'live' : p.state === 'idled' ? 'muted' : undefined}
                  mark={{ ...PLAN_MARK[p.state], label: w.state[p.state] }}
                  name={<span className="typo-body k-strong k-ellipsis">{p.slug}</span>}
                  nameClass="k-ellipsis"
                  meta={<Meta parts={[p.domain, names.join(' · ')]} />}
                  figures={
                    <>
                      <Tooltip content={tx(w.row_total_tip, { points: p.points, total: 218 })}>
                        <span className="cb-units">
                          <UnitStrip
                            size="s"
                            segments={segments}
                            label={tx(w.group_points, { n: p.points, total: 218 })}
                          />
                        </span>
                      </Tooltip>
                      <JoinValue
                        join={join}
                        domain={p.domain}
                        active={bundle === p.domain}
                        onPress={() => { onBundle(bundle === p.domain ? null : p.domain); }}
                      />
                    </>
                  }
                />
              );
            })}
          </Rows>
        </div>
      </Section>
      {/* i18n: the legend for the four inks both columns draw through. */}
      <Section
        level={2}
        title="Four facts, four marks"
        desc="One unit of a strip is 6 points - the most a single reason can score. Its colour is how heavily that reason scores; its shape is which reason it is."
      >
        <FourFacts />
      </Section>
    </>
  );
}
