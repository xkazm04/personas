// VariantConsole — the dossier as an instrument panel.
//
// THE READING: state at a glance. Every domain is a plate on one board, lit or
// dark, with its depth drawn as a segment strip rather than printed as a
// number. Nothing is hidden behind a tab, so "is anything wrong with this
// persona" is answered by looking, not by clicking three times.
//
// The material is the Monitor's own panel language (`entryE.css`, the `ae-*`
// vocabulary the Activity board and `AutopilotTip` are built from) — which is
// exactly the complaint this package answers: the drawer looked like it came
// from a different app.

import { useTranslation } from '@/i18n/useTranslation';
import { Lamp, Segments } from '../grid/prototype/entry-e/parts';
import type { Tone } from '../grid/prototype/entry-e/tone';
import { DrawerReviewCard } from '../DrawerReviewCard';
import { MonitorCapabilities } from '../MonitorCapabilities';
import type { DrawerSection } from '../monitorModel';
import type { DrawerModel } from './drawerModel';
import { ActivityLine, NothingHere, PlateHead, ReportCard } from './DrawerParts';
import { sectionAnchorId, useSectionAnchor } from './useSectionAnchor';
import '../grid/prototype/entry-e/entryE.css';

/** How many segments a plate's depth gauge draws. */
const GAUGE = 10;

function Plate({
  section, title, count, tone, span, children,
}: {
  section: DrawerSection;
  title: string;
  count: number;
  tone: Tone;
  span?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      id={sectionAnchorId(section)}
      className={`ae-plate rounded-card ${span ? 'lg:col-span-2' : ''}`}
    >
      <PlateHead title={title} count={count}>
        <Segments className="w-14" count={GAUGE} lit={Math.min(count, GAUGE)} tone={tone} thin />
        <Lamp lamp={{ tone, lit: count > 0 }} />
      </PlateHead>
      <div className="px-3 pb-3">{children}</div>
    </section>
  );
}

export function VariantConsole({ model, initialSection }: { model: DrawerModel; initialSection: DrawerSection }) {
  const { t } = useTranslation();
  const m = t.monitor;
  useSectionAnchor(initialSection, !model.loading);

  return (
    <div className="ae-root grid gap-3 p-4 lg:grid-cols-2">
      <Plate section="reviews" title={m.reviews} count={model.counts.reviews} tone="err" span>
        {model.reviews.length === 0 ? (
          <NothingHere text={m.no_reviews} compact />
        ) : (
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
        )}
      </Plate>

      <Plate section="messages" title={m.messages} count={model.counts.messages} tone="info">
        {model.messages.length === 0 ? (
          <NothingHere text={m.no_messages} compact />
        ) : (
          <div className="space-y-2.5">
            {model.messages.map((message) => (
              <ReportCard key={message.id} message={message} onMarkRead={model.onMarkRead} />
            ))}
          </div>
        )}
      </Plate>

      <Plate section="activity" title={m.activity} count={model.counts.activity} tone="run">
        {model.processes.length === 0 ? (
          <NothingHere text={m.no_activity} compact />
        ) : (
          <div className="ae-well rounded-card overflow-hidden">
            {model.processes.map((entry) => (
              <ActivityLine key={entry.key} entry={entry} now={model.now} onNavigate={model.onClose} />
            ))}
          </div>
        )}
      </Plate>

      <Plate section="capabilities" title={m.capabilities} count={model.counts.capabilities} tone="ok" span>
        {model.useCases.length === 0 ? (
          <NothingHere text={m.no_capabilities} compact />
        ) : (
          <MonitorCapabilities personaId={model.card.personaId} useCases={model.useCases} />
        )}
      </Plate>
    </div>
  );
}
