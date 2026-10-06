/**
 * What a gate's control surface reads: the question as a headline readout, its
 * context, the key pad, and Athena's pick as a backlit key with her reason
 * beside it and the Enter cap that confirms it. Every verb is the product's
 * (`useDecisionCard` / `useApprovalCard` / `useMcpRequestCard` through the
 * shared `CardModel`); kinds with no native body keep the product's own card.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import { useEffect } from 'react';
import type { PendingApproval } from '@/api/companion';
import { useAnnounce } from '@/features/shared/components/feedback/AriaLiveProvider';
import type { McpPendingRequest } from '@/features/companions/athena/mcp/mcpRequestStore';
import { WorkItemBody } from '../../../WorkItemBody';
import type { WorkItem } from '../../../useWorkforce';
import { hasNativeBody, useApprovalItem, useApprovalModel, useDecisionModel, useMcpItem, useMcpModel, type CardModel } from '../c/bodies/model';
import { DetailsReveal, FieldInput, FieldSubmit, Problems } from '../c/bodies/parts';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { R5B_COPY as C } from './copy';
import { Cap, KeyPad } from './KeyPad';
import { inline, splitPrompt } from './promptText';
import { useSurfaceKeys } from './useSurfaceKeys';

function Verdict({ model, animate }: { model: CardModel; animate: boolean }) {
  const rec = model.recommendation;
  const announce = useAnnounce();
  const spoken = rec?.revealed && rec.text ? rec.text : (rec?.composing ?? '');
  useEffect(() => {
    if (spoken) announce(spoken);
  }, [spoken, announce]);
  if (!rec) return null;
  const pick = model.choices.findIndex((c) => c.recommended);
  const composing = rec.composing ? (
    <p className="flex items-center gap-2.5 typo-caption">
      <span className={`r5b-lamp${animate ? ' live' : ''}`} style={{ ['--c' as string]: 'var(--primary)' }} aria-hidden />
      {C.composing}
    </p>
  ) : null;
  if (!rec.revealed || !rec.text) return composing;
  return (
    <div
      className="flex items-start gap-3 rounded-card px-4 py-3"
      style={{ borderLeft: '2px solid var(--primary)', background: 'color-mix(in srgb, var(--primary) 7%, transparent)' }}
      data-testid="companion-r5b-verdict"
    >
      <div className="min-w-0 flex-1">
        <p className="typo-code uppercase text-primary">
          {pick >= 0 ? `${C.herPick} · ${pick + 1}` : rec.label}
        </p>
        <p className="typo-body text-foreground mt-0.5">{rec.text}</p>
        {composing && <div className="mt-2">{composing}</div>}
      </div>
      {pick >= 0 && (
        <span className="shrink-0 inline-flex items-center gap-2 pt-0.5">
          <Cap>Enter</Cap>
          <span className="typo-caption whitespace-nowrap">{C.confirm}</span>
        </span>
      )}
    </div>
  );
}

/** Only the keys this surface answers to right now. */
function KeyLegend({ model }: { model: CardModel }) {
  const rec = model.recommendation;
  const canAsk = !!rec && !rec.revealed && !!rec.reveal;
  return (
    <p className="flex flex-wrap items-center gap-x-5 gap-y-1">
      <span className="inline-flex items-center gap-1.5 typo-caption"><Cap>{`1–${model.choices.length}`}</Cap>{C.keys.choose}</span>
      {canAsk && (
        <span className="inline-flex items-center gap-1.5 typo-caption">
          <Cap>0</Cap>
          <Cap>Enter</Cap>
          {C.keys.ask}
        </span>
      )}
    </p>
  );
}

function Readout({ model, animate }: { model: CardModel; animate: boolean }) {
  useSurfaceKeys(model);
  const { lead, rest } = splitPrompt(model.question);
  return (
    <div className="flex flex-col gap-4" data-testid="companion-r5b-readout-body">
      <div className="flex flex-col gap-2">
        <h2 className="typo-heading-lg text-foreground">{inline(lead)}</h2>
        {rest && <p className="typo-body text-foreground">{inline(rest)}</p>}
        {model.context && <p className="typo-body text-foreground">{inline(model.context)}</p>}
      </div>
      {model.choices.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <KeyPad model={model} />
          {!(model.recommendation?.revealed && model.recommendation.text) && <KeyLegend model={model} />}
        </div>
      )}
      <Verdict model={model} animate={animate} />
      {model.recommendation?.failed && <p className="typo-body text-status-warning">{model.recommendation.failed}</p>}
      {model.field && (
        <div className="flex flex-col gap-2">
          <FieldInput field={model.field} />
          {model.field.submit && (
            <div className="flex justify-end">
              <FieldSubmit field={model.field} />
            </div>
          )}
        </div>
      )}
      {model.details && <DetailsReveal details={model.details} />}
      <Problems model={model} />
      {model.deferrals.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {model.deferrals.map((d) => (
            <Tooltip key={d.key} content={d.hint} placement="top">
              <Button variant="secondary" size="sm" onClick={d.run} aria-description={d.hint}>
                {d.label}
              </Button>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  );
}

function DecisionReadout({ animate }: { animate: boolean }) {
  const model = useDecisionModel();
  return model ? <Readout model={model} animate={animate} /> : null;
}
function ApprovalReadout({ approval, animate }: { approval: PendingApproval; animate: boolean }) {
  return <Readout model={useApprovalModel(approval)} animate={animate} />;
}
function McpReadout({ request, animate }: { request: McpPendingRequest; animate: boolean }) {
  return <Readout model={useMcpModel(request)} animate={animate} />;
}
function ApprovalGate({ item, animate }: { item: WorkItem; animate: boolean }) {
  const approval = useApprovalItem(item);
  return approval ? <ApprovalReadout approval={approval} animate={animate} /> : null;
}
function McpGate({ item, animate }: { item: WorkItem; animate: boolean }) {
  const request = useMcpItem(item);
  return request ? <McpReadout key={request.requestId} request={request} animate={animate} /> : null;
}

export function SurfaceBody({ item, animate, onSend }: { item: WorkItem; animate: boolean; onSend: (text: string) => void }) {
  if (hasNativeBody(item.kind)) {
    if (item.kind === 'decision') return <DecisionReadout animate={animate} />;
    if (item.kind === 'approval') return <ApprovalGate item={item} animate={animate} />;
    return <McpGate item={item} animate={animate} />;
  }
  return <WorkItemBody item={item} onSend={onSend} />;
}
