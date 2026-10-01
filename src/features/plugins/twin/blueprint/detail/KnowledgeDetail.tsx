/**
 * L3 Knowledge: what the twin knows about its owner (spark
 * twin-portable-blueprint): memories by review state, the latest approved ones
 * by title, the self-facts, and whether a knowledge base is bound. A count the
 * page could not read says so instead of reading as none.
 */
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { KeyValueGrid, ListRow, Rows, Section } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';

import type { SectionDetailProps } from './detailParts';

/** How many memories and facts the drawer lists; the Hub holds the rest. */
const LISTED = 8;

export function KnowledgeDetail({ model, sources }: SectionDetailProps) {
  const { t } = useTranslation();
  const b = t.twin.blueprint;
  const m = b.metrics;
  const { memories, facts, kbBound } = model.knowledge;
  const latest = (sources.approved ?? sources.storeApproved).slice(0, LISTED);
  const selfFacts = (sources.facts ?? []).filter((f) => f.contact_handle === null).slice(0, LISTED);
  const figure = (n: number | null) => (n === null ? null : <Numeric value={n} />);

  return (
    <div className="flex flex-col gap-5" data-testid="twin-detail-knowledge">
      <KeyValueGrid
        items={[
          { k: m.approved, v: figure(memories.approved), none: b.states.notMeasured },
          { k: m.awaiting, v: figure(memories.pending), none: b.states.notMeasured },
          { k: m.rejected, v: figure(memories.rejected), none: b.states.notMeasured },
          { k: m.facts, v: figure(facts), none: b.states.notMeasured },
          { k: m.knowledgeBase, v: kbBound ? m.kbBound : m.kbUnbound },
        ]}
      />
      <Section level={2} title={t.twin.detail.latestMemories}>
        <Rows count={latest.length} empty={{ title: b.states.emptyKnowledge }}>
          {latest.map((memory) => {
            const title = memory.title?.trim() || null;
            return (
              <ListRow
                key={memory.id}
                name={title ?? memory.content}
                meta={title ? memory.content : undefined}
                time={<RelativeTime timestamp={memory.reviewed_at ?? memory.created_at} />}
                testId={`twin-detail-memory-${memory.id}`}
              />
            );
          })}
        </Rows>
      </Section>
      <Section level={2} title={m.facts}>
        <Rows count={selfFacts.length} empty={{ title: b.states.emptyKnowledge }}>
          {selfFacts.map((fact) => (
            <ListRow key={fact.id} name={fact.content} testId={`twin-detail-fact-${fact.id}`} />
          ))}
        </Rows>
      </Section>
    </div>
  );
}

export default KnowledgeDetail;
