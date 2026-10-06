// VariantQueue — the dossier as one worklist.
//
// THE READING: what do I do next. A drawer organised by SOURCE (reviews in
// one tab, reports in another, processes in a third) makes the operator merge
// three queues in their head and then guess which is the loudest. This
// reading does the merge once (`buildWorklist`) and ranks it: critical
// reviews, then warnings, then a process holding a question, then a draft
// waiting to be read, then loud reports, then quiet ones. Everything that is
// NOT waiting on a human — running work, queued work, the capability roster —
// is demoted to a trailing strip, present but never first.
//
// The material here is the composition kit, deliberately: this is a dense
// working list, which is what the kit is law for.

import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { KitHost, Section, StatStrip, Surface } from '@/features/shared/components/kit';
import { DrawerReviewCard } from '../DrawerReviewCard';
import { MonitorCapabilities } from '../MonitorCapabilities';
import type { DrawerSection } from '../monitorModel';
import { buildWorklist, restProcesses, type DrawerModel } from './drawerModel';
import { ActivityLine, ReportCard } from './DrawerParts';
import { sectionAnchorId, useSectionAnchor } from './useSectionAnchor';

export function VariantQueue({ model, initialSection }: { model: DrawerModel; initialSection: DrawerSection }) {
  const { t } = useTranslation();
  const m = t.monitor;
  const work = useMemo(() => buildWorklist(model), [model]);
  const rest = useMemo(() => restProcesses(model), [model]);
  useSectionAnchor(initialSection, !model.loading);

  const tiles = [
    { label: m.activity, value: rest.length },
    { label: m.capabilities, value: model.useCases.length },
  ];

  return (
    <KitHost>
      <Surface dense>
        <div id={sectionAnchorId('reviews')} />
        <div id={sectionAnchorId('messages')} />
        <Section
          title={m.triage_focus_queue}
          count={work.length}
          state={model.loading && work.length === 0 ? 'loading' : work.length === 0 ? 'empty' : undefined}
          empty={{ title: m.reviews_empty, tone: 'success', markLabel: m.reviews_empty }}
        >
          <div className="space-y-3">
            {work.map((item) => {
              if (item.kind === 'review') {
                return (
                  <DrawerReviewCard
                    key={item.key}
                    review={item.review}
                    personaName={model.card.personaName}
                    isReviewInFlight={model.isReviewInFlight}
                    onAction={model.onReviewAction}
                    onDispatchAction={model.onDispatchAction}
                  />
                );
              }
              if (item.kind === 'message') {
                return <ReportCard key={item.key} message={item.message} onMarkRead={model.onMarkRead} />;
              }
              return (
                <div key={item.key} className="overflow-hidden rounded-card border border-border/60 bg-secondary/15">
                  <ActivityLine entry={item.entry} now={model.now} onNavigate={model.onClose} />
                </div>
              );
            })}
          </div>
        </Section>

        <Section
          id={sectionAnchorId('activity')}
          level={2}
          title={m.activity}
          count={rest.length}
          meta={<StatStrip tiles={tiles} />}
          state={rest.length === 0 ? 'empty' : undefined}
          empty={{ title: m.no_activity }}
        >
          <div className="overflow-hidden rounded-card border border-border/60 bg-secondary/15">
            {rest.map((entry) => (
              <ActivityLine key={entry.key} entry={entry} now={model.now} onNavigate={model.onClose} />
            ))}
          </div>
        </Section>

        <Section
          id={sectionAnchorId('capabilities')}
          level={2}
          title={m.capabilities}
          count={model.useCases.length}
          state={model.useCases.length === 0 ? 'empty' : undefined}
          empty={{ title: m.no_capabilities }}
        >
          <MonitorCapabilities personaId={model.card.personaId} useCases={model.useCases} />
        </Section>
      </Surface>
    </KitHost>
  );
}
