// Single-UC card wrapper. Renders the header, an expandable description
// panel, and an AnimatePresence block that swaps between the Cockpit
// view-mode layout and the Forge edit-mode editor. All the per-UC
// derived state reads from the shared state hook.

import { AnimatePresence, motion } from 'framer-motion';
import type { UseCaseOption } from '../useCasePickerShared';
import { MOCK_EMIT_EVENTS_BY_UC } from '../MessagingPickerShared';
import { UcCardHeader } from './ucCardHeader';
import { CockpitView } from './ucCockpitView';
import { ForgeEditor } from './ucForgeEditor';
import { FADE, HEIGHT_FADE, UC_CODE, UC_DESCRIPTION, UC_SUBTITLE, type DestId } from './ucPickerTypes';
import type { UcPickerState } from './useUcPickerState';

interface Props {
  uc: UseCaseOption;
  state: UcPickerState;
}

export function UcCard({ uc, state }: Props) {
  const on = state.enabled.has(uc.id);
  const trigger = state.triggerByUc[uc.id] ?? {};
  const ucRoutes = state.eventRoutes[uc.id] ?? {};
  const emits = MOCK_EMIT_EVENTS_BY_UC[uc.id] ?? [];
  const subtitle = UC_SUBTITLE[uc.id] ?? uc.capability_summary ?? uc.description ?? 'User-defined capability';
  const description = UC_DESCRIPTION[uc.id] ?? uc.description ?? subtitle;
  const code = UC_CODE[uc.id] ?? uc.id.slice(0, 3).toUpperCase();
  const status = state.testStatus[uc.id] ?? 'idle';
  const firing = status === 'running';
  const canPreview = Boolean(state.previewReady[uc.id]);
  const descExpanded = state.expandedDesc.has(uc.id);
  const cardMode = state.mode[uc.id] ?? 'view';

  const activeDestinations = new Set<DestId>();
  for (const s of Object.values(ucRoutes)) for (const d of s) activeDestinations.add(d);
  const subscribedCount = emits.reduce(
    (n, ev) => ((ucRoutes[ev.event_type]?.size ?? 0) > 0 ? n + 1 : n),
    0,
  );

  return (
    <motion.div
      layout
      transition={{ duration: 0.25, ease: FADE.ease }}
      className={`rounded-card overflow-hidden transition-colors ${
        on
          ? 'ring-1 ring-primary/50 bg-primary/[0.04] shadow-elevation-2'
          : 'ring-1 ring-border/70 bg-foreground/[0.015]'
      }`}
    >
      <UcCardHeader
        ucName={uc.name}
        on={on}
        descExpanded={descExpanded}
        canPreview={canPreview}
        cardMode={cardMode}
        status={status}
        onToggle={() => state.toggleEnabled(uc.id)}
        onToggleDesc={() => state.toggleDesc(uc.id)}
        onToggleMode={() => state.toggleMode(uc.id)}
        onPreview={() => state.setPreviewUcId(uc.id)}
        onRunTest={() => state.runTest(uc.id)}
      />

      <AnimatePresence initial={false}>
        {on && descExpanded && (
          <motion.div key="desc" {...HEIGHT_FADE} className="overflow-hidden">
            <div className="px-5 py-3.5 bg-foreground/[0.02] border-b border-border/50">
              <p className="typo-body-lg text-foreground/80 leading-relaxed">{description}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait" initial={false}>
        {on && cardMode === 'view' && (
          <motion.div
            key="view"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: FADE.ease }}
            className="overflow-hidden"
          >
            <CockpitView
              code={code}
              subtitle={subtitle}
              trigger={trigger}
              destinations={state.destinations}
              activeDestinations={activeDestinations}
              firing={firing}
              onEdit={() => state.toggleMode(uc.id)}
            />
          </motion.div>
        )}
        {on && cardMode === 'edit' && (
          <motion.div
            key="edit"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: FADE.ease }}
            className="overflow-hidden"
          >
            <ForgeEditor
              ucId={uc.id}
              trigger={trigger}
              eventOptions={state.eventOptions}
              availableEventKeys={state.availableEventKeys}
              emits={emits}
              ucRoutes={ucRoutes}
              destinations={state.destinations}
              subtitle={subtitle}
              subscribedCount={subscribedCount}
              status={status}
              onTriggerChange={(next) => state.setTriggerSelection(uc.id, next)}
              onToggleRoute={state.toggleRoute}
              onRemoveChannel={state.removeChannel}
              onAddChannel={(eventType) => state.setQuickAddCtx({ ucId: uc.id, eventType })}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
