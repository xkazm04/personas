// VariantBrief — the dossier as a document.
//
// THE READING: what happened. Reports come first and are rendered as full
// markdown at DOCUMENT density, because a persona's report is prose it wrote
// to be read, not a row in a list — and reading it is the only thing the
// other two readings make hard. Nothing is behind a tab and nothing is
// ranked: it is one continuous scroll, reports then decisions then work then
// the roster, the order a briefing is written in.
//
// This is the reading that most exposes 3a: before this package the report
// body was printed with `whitespace-pre-wrap`, so every `##` and `-` showed.

import { useTranslation } from '@/i18n/useTranslation';
import { KitHost, Section, Surface } from '@/features/shared/components/kit';
import { DrawerReviewCard } from '../DrawerReviewCard';
import { MonitorCapabilities } from '../MonitorCapabilities';
import type { DrawerSection } from '../monitorModel';
import type { DrawerModel } from './drawerModel';
import { ActivityLine, ReportCard } from './DrawerParts';
import { sectionAnchorId, useSectionAnchor } from './useSectionAnchor';

export function VariantBrief({ model, initialSection }: { model: DrawerModel; initialSection: DrawerSection }) {
  const { t } = useTranslation();
  const m = t.monitor;
  useSectionAnchor(initialSection, !model.loading);

  return (
    <KitHost>
      <Surface>
        <Section
          id={sectionAnchorId('messages')}
          title={m.messages}
          count={model.counts.messages}
          state={model.loading && model.messages.length === 0
            ? 'loading'
            : model.messages.length === 0 ? 'empty' : undefined}
          empty={{ title: m.no_messages }}
        >
          <div className="space-y-4">
            {model.messages.map((message) => (
              <ReportCard
                key={message.id}
                message={message}
                onMarkRead={model.onMarkRead}
                density="document"
              />
            ))}
          </div>
        </Section>

        <Section
          id={sectionAnchorId('reviews')}
          title={m.reviews}
          count={model.counts.reviews}
          state={model.loading && model.reviews.length === 0
            ? 'loading'
            : model.reviews.length === 0 ? 'empty' : undefined}
          empty={{ title: m.no_reviews }}
        >
          <div className="space-y-3">
            {model.reviews.map((review) => (
              <DrawerReviewCard
                key={review.id}
                review={review}
                personaName={model.card.personaName}
                isReviewInFlight={model.isReviewInFlight}
                onAction={model.onReviewAction}
                onDispatchAction={model.onDispatchAction}
              />
            ))}
          </div>
        </Section>

        <Section
          id={sectionAnchorId('activity')}
          title={m.activity}
          count={model.counts.activity}
          state={model.processes.length === 0 ? 'empty' : undefined}
          empty={{ title: m.no_activity }}
        >
          <div className="overflow-hidden rounded-card border border-border/60 bg-secondary/15">
            {model.processes.map((entry) => (
              <ActivityLine key={entry.key} entry={entry} now={model.now} onNavigate={model.onClose} />
            ))}
          </div>
        </Section>

        <Section
          id={sectionAnchorId('capabilities')}
          title={m.capabilities}
          count={model.counts.capabilities}
          state={model.useCases.length === 0 ? 'empty' : undefined}
          empty={{ title: m.no_capabilities }}
        >
          <MonitorCapabilities personaId={model.card.personaId} useCases={model.useCases} />
        </Section>
      </Surface>
    </KitHost>
  );
}
